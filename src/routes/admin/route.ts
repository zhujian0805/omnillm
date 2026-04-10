import { Hono } from "hono"

import {
  handleListProviders,
  handleGetStatus,
  handleGetAuthStatus,
  handleGetInfo,
  handleSwitchProvider,
  handleProviderAuth,
  handleListProviderModels,
  handleGetProviderUsage,
  handleActivateProvider,
  handleDeactivateProvider,
  handleToggleProviderModel,
  handleGetProviderPriorities,
  handleSetProviderPriorities,
  handleAddProviderInstance,
  handleDeleteProvider,
  handleUpdateProviderConfig,
  handleSetModelVersion,
  handleGetModelVersion,
} from "./providers"
import {
  handleGetLogLevel,
  handleSetLogLevel,
  handleStreamLogs,
  handleTestLog,
  handleDebugLog,
  handleWebSocketLogs,
} from "./settings"
import {
  handleListSessions,
  handleGetSession,
  handleCreateSession,
  handleUpdateSession,
  handleAddMessage,
  handleDeleteSession,
  handleDeleteAllSessions,
} from "./chat-history"

export const adminRoutes = new Hono()

adminRoutes.get("/providers", handleListProviders)
adminRoutes.post("/providers/switch", handleSwitchProvider)
adminRoutes.post("/providers/:type/add-instance", handleAddProviderInstance)
adminRoutes.delete("/providers/:id", handleDeleteProvider)
adminRoutes.get("/providers/priorities", handleGetProviderPriorities)
adminRoutes.post("/providers/priorities", handleSetProviderPriorities)
adminRoutes.get("/providers/:id/models", handleListProviderModels)
adminRoutes.post("/providers/:id/models/toggle", handleToggleProviderModel)
adminRoutes.get("/providers/:id/usage", handleGetProviderUsage)
adminRoutes.post("/providers/:id/auth", handleProviderAuth)
adminRoutes.put("/providers/:id/config", handleUpdateProviderConfig)
adminRoutes.post("/providers/:id/activate", handleActivateProvider)
adminRoutes.post("/providers/:id/deactivate", handleDeactivateProvider)
adminRoutes.put("/providers/:id/models/:modelId/version", handleSetModelVersion)
adminRoutes.get("/providers/:id/models/:modelId/version", handleGetModelVersion)
adminRoutes.get("/status", handleGetStatus)
adminRoutes.get("/auth-status", handleGetAuthStatus)
adminRoutes.get("/info", handleGetInfo)
adminRoutes.get("/settings/log-level", handleGetLogLevel)
adminRoutes.put("/settings/log-level", handleSetLogLevel)
adminRoutes.post("/settings/test-log", handleTestLog)
adminRoutes.post("/settings/debug-log", handleDebugLog)
adminRoutes.get("/logs/stream", handleStreamLogs)
adminRoutes.get("/logs/websocket", handleWebSocketLogs)

// Chat history
adminRoutes.get("/chat/sessions", handleListSessions)
adminRoutes.post("/chat/sessions", handleCreateSession)
adminRoutes.delete("/chat/sessions", handleDeleteAllSessions)
adminRoutes.get("/chat/sessions/:id", handleGetSession)
adminRoutes.put("/chat/sessions/:id", handleUpdateSession)
adminRoutes.post("/chat/sessions/:id/messages", handleAddMessage)
adminRoutes.delete("/chat/sessions/:id", handleDeleteSession)
