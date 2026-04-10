package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"omnimodel/internal/registry"
)

func SetupTokenRoutes(router *gin.RouterGroup) {
	router.GET("/token", handleToken)
}

func handleToken(c *gin.Context) {
	providerRegistry := registry.GetProviderRegistry()
	activeProvider, err := providerRegistry.GetActive()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": "No active provider",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	token := activeProvider.GetToken()
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{
				"message": "Provider not authenticated",
				"type":    "authentication_error",
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": token,
		"token_type":   "Bearer",
	})
}
