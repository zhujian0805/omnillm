package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"omnimodel/internal/cif"
	"omnimodel/internal/ingestion"
	"omnimodel/internal/lib/modelrouting"
	"omnimodel/internal/providers/types"
	"omnimodel/internal/serialization"
)

func SetupResponseRoutes(router *gin.RouterGroup) {
	router.POST("/responses", handleResponses)
}

func handleResponses(c *gin.Context) {
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": "Invalid request format",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	// Convert Responses API format to CIF
	canonicalRequest, err := ingestion.ParseResponsesPayload(payload)
	if err != nil {
		log.Error().Err(err).Msg("Failed to parse Responses API request")
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("Failed to parse request: %v", err),
				"type":    "invalid_request_error",
			},
		})
		return
	}

	// Resolve providers
	normalizedModel := modelrouting.NormalizeModelName(canonicalRequest.Model)
	modelRoute, err := modelrouting.ResolveProvidersForModel(
		canonicalRequest.Model,
		normalizedModel,
		modelCache,
	)
	if err != nil {
		log.Error().Err(err).Str("model", canonicalRequest.Model).Msg("Failed to resolve providers")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("Failed to resolve providers: %v", err),
				"type":    "server_error",
			},
		})
		return
	}

	if len(modelRoute.CandidateProviders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("Model '%s' not found or no providers available", canonicalRequest.Model),
				"type":    "invalid_request_error",
			},
		})
		return
	}

	if normalizedModel != canonicalRequest.Model {
		log.Debug().
			Str("from", canonicalRequest.Model).
			Str("to", normalizedModel).
			Msg("Normalized Responses API request model")
		canonicalRequest.Model = normalizedModel
	}

	// Try candidate providers
	var lastErr error
	for _, provider := range modelRoute.CandidateProviders {
		adapter := provider.GetAdapter()
		if adapter == nil {
			continue
		}

		log.Debug().
			Str("model", canonicalRequest.Model).
			Str("provider", provider.GetInstanceID()).
			Msg("Trying provider for Responses API request")

		remappedModel := adapter.RemapModel(canonicalRequest.Model)
		if remappedModel != canonicalRequest.Model {
			canonicalRequest.Model = remappedModel
		}

		if canonicalRequest.Stream {
			lastErr = handleResponsesStreamingResponse(c, adapter, canonicalRequest)
		} else {
			lastErr = handleResponsesNonStreamingResponse(c, adapter, canonicalRequest)
		}

		if lastErr == nil {
			return
		}

		log.Warn().Err(lastErr).
			Str("provider", provider.GetInstanceID()).
			Msg("Provider failed for Responses API request, trying next")
	}

	errMsg := "All providers failed"
	if lastErr != nil {
		errMsg = fmt.Sprintf("All providers failed. Last error: %v", lastErr)
	}
	c.JSON(http.StatusBadGateway, gin.H{
		"error": gin.H{
			"message": errMsg,
			"type":    "server_error",
		},
	})
}

func handleResponsesNonStreamingResponse(c *gin.Context, adapter types.ProviderAdapter, canonicalRequest *cif.CanonicalRequest) error {
	response, err := adapter.Execute(canonicalRequest)
	if err != nil {
		return fmt.Errorf("adapter execute failed: %w", err)
	}

	responsesResp, err := serialization.SerializeToResponses(response)
	if err != nil {
		return fmt.Errorf("serialization failed: %w", err)
	}

	log.Info().
		Str("model", response.Model).
		Str("id", response.ID).
		Msg("Responses API request completed")

	c.JSON(http.StatusOK, responsesResp)
	return nil
}

func handleResponsesStreamingResponse(c *gin.Context, adapter types.ProviderAdapter, canonicalRequest *cif.CanonicalRequest) error {
	eventCh, err := adapter.ExecuteStream(canonicalRequest)
	if err != nil {
		log.Warn().Err(err).Msg("Streaming not supported, falling back to non-streaming")
		canonicalRequest.Stream = false
		return handleResponsesNonStreamingResponse(c, adapter, canonicalRequest)
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	state := serialization.CreateResponsesStreamState()
	flusher, _ := c.Writer.(http.Flusher)

	c.Stream(func(w io.Writer) bool {
		event, ok := <-eventCh
		if !ok {
			return false
		}

		responsesEvents, err := serialization.ConvertCIFEventToResponsesSSE(event, state)
		if err != nil {
			log.Error().Err(err).Msg("Failed to convert CIF event to Responses SSE")
			return false
		}

		for _, evt := range responsesEvents {
			eventType, _ := evt["type"].(string)
			jsonBytes, err := json.Marshal(evt)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, string(jsonBytes))
		}

		if flusher != nil {
			flusher.Flush()
		}

		if _, isEnd := event.(cif.CIFStreamEnd); isEnd {
			return false
		}
		if _, isErr := event.(cif.CIFStreamError); isErr {
			return false
		}

		return true
	})

	return nil
}
