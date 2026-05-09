package copilot

import (
	"strings"

	"omnillm/internal/cif"
	"omnillm/internal/providers/shared"
)

// selectShape returns the copilotAPIShape to use for the given (already
// remapped) model name and incoming request.
//
// Priority order:
//  1. ForceChatCompletions extension → shapeChat
//  2. Model found in shapeCache → use cached shape
//  3. Cache miss / nil cache → fall back to IsGPT5Family heuristic
func (a *CopilotAdapter) selectShape(model string, request *cif.CanonicalRequest) copilotAPIShape {
	if a.forceChatCompletions(request) {
		return shapeChat
	}

	if a.provider.shapeCache != nil {
		if shape, ok := a.provider.shapeCache[model]; ok {
			return shape
		}
	}

	// Cache miss: fall back to family heuristic so the provider works
	// before GetModels() has been called.
	lower := strings.ToLower(strings.TrimSpace(model))
	if shared.IsGPT5Family(lower) && !strings.Contains(lower, "-mini") {
		return shapeResponses
	}
	return shapeChat
}
