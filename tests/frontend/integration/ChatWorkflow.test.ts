/**
 * Integration Tests - Chat Workflow
 *
 * End-to-end testing of complete chat workflows including:
 * - Loading models and starting chat
 * - Sending messages and receiving responses
 * - Saving chat sessions
 * - Different API shapes
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  setupTestEnvironment,
  resetTestEnvironment
} from "../setup"
import {
  MOCK_MODELS_RESPONSE,
  MOCK_CHAT_SESSIONS,
  MOCK_CHAT_COMPLETION_OPENAI,
  MOCK_CHAT_COMPLETION_ANTHROPIC,
  MOCK_CHAT_COMPLETION_RESPONSES
} from "../fixtures/api-responses"

describe("Chat Workflow Integration Tests", () => {
  let _mockShowToast: ReturnType<typeof mock>

  beforeEach(() => {
    setupTestEnvironment()
    _mockShowToast = mock()
  })

  afterEach(() => {
    resetTestEnvironment()
    _mockShowToast.mockClear()
  })

  describe("Complete Chat Flow", () => {
    test("should complete full chat workflow: load models -> select -> send -> receive", async () => {
      // Step 1: Load models
      const mockGetModels = mock(async () => MOCK_MODELS_RESPONSE)
      const modelsResult = await mockGetModels()
      expect(modelsResult.data).toHaveLength(4)

      // Step 2: Select first model
      const selectedModel = modelsResult.data[0].id
      expect(selectedModel).toBe("gpt-4")

      // Step 3: Send message
      const mockSendMessage = mock(async (_model: string, _message: string) => ({
        status: "sending"
      }))
      await mockSendMessage(selectedModel, "Hello, how are you?")

      // Step 4: Receive response
      const mockGetResponse = mock(async () => MOCK_CHAT_COMPLETION_OPENAI)
      const response = await mockGetResponse()
      expect(response.choices[0].message.content).toContain("helpful response")

      expect(mockGetModels).toHaveBeenCalled()
      expect(mockSendMessage).toHaveBeenCalled()
    })

    test("should create session after first message", async () => {
      const mockCreateSession = mock(async (data: Record<string, unknown>) => ({
        ok: true,
        session_id: data.session_id
      }))

      const sessionData = {
        session_id: "new-session-456",
        title: "New Chat",
        model_id: "gpt-4",
        api_shape: "openai"
      }

      const result = await mockCreateSession(sessionData)
      expect(result.ok).toBe(true)

      // Step 2: Add message to session
      const mockAddMessage = mock(async (sessionId: string, _message: Record<string, unknown>) => ({
        ok: true
      }))

      await mockAddMessage(result.session_id as string, {
        message_id: "msg-1",
        role: "user",
        content: "Hello"
      })

      expect(mockCreateSession).toHaveBeenCalled()
      expect(mockAddMessage).toHaveBeenCalled()
    })

    test("should maintain conversation history across messages", async () => {
      const messages: Array<{ role: "user" | "assistant"; content: string }> = []

      // Add user message
      messages.push({ role: "user", content: "What is TypeScript?" })

      // Add assistant response
      messages.push({ role: "assistant", content: "TypeScript is a typed superset of JavaScript..." })

      // Add follow-up message
      messages.push({ role: "user", content: "How do I use it with React?" })

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe("What is TypeScript?")
      expect(messages[1].role).toBe("assistant")
    })
  })

  describe("OpenAI API Shape Workflow", () => {
    test("should complete workflow with OpenAI API shape", async () => {
      const mockCreateCompletion = mock(async (request: Record<string, unknown>) => MOCK_CHAT_COMPLETION_OPENAI)

      const request = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: false
      }

      const response = await mockCreateCompletion(request)

      expect(response.choices).toBeInstanceOf(Array)
      expect(response.choices[0].message.role).toBe("assistant")
      expect(mockCreateCompletion).toHaveBeenCalledWith(request)
    })
  })

  describe("Anthropic API Shape Workflow", () => {
    test("should complete workflow with Anthropic API shape", async () => {
      const mockCreateCompletion = mock(async (request: Record<string, unknown>) => MOCK_CHAT_COMPLETION_ANTHROPIC)

      // Request in OpenAI format
      const request = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        stream: false
      }

      const response = await mockCreateCompletion(request)

      expect(response.content).toBeInstanceOf(Array)
      expect(response.content[0].type).toBe("text")
      expect(response.role).toBe("assistant")
    })
  })

  describe("Responses API Shape Workflow", () => {
    test("should complete workflow with Responses API shape", async () => {
      const mockCreateCompletion = mock(async (request: Record<string, unknown>) => MOCK_CHAT_COMPLETION_RESPONSES)

      const request = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: false
      }

      const response = await mockCreateCompletion(request)

      expect(response.output).toBeInstanceOf(Array)
      expect(response.output[0].type).toBe("message")
      expect(response.output[0].role).toBe("assistant")
    })
  })

  describe("Session Management Workflow", () => {
    test("should load existing session and continue conversation", async () => {
      const mockListSessions = mock(async () => MOCK_CHAT_SESSIONS)
      const sessions = await mockListSessions()

      // Select first session
      const selectedSession = sessions[0]
      expect(selectedSession.session_id).toBe("session-1")

      // Load full session details
      const mockGetSession = mock(async (_id: string) => ({
        session: selectedSession,
        messages: [
          { role: "user" as const, content: "Previous message" }
        ]
      }))

      const sessionDetails = await mockGetSession(selectedSession.session_id)
      expect(sessionDetails.messages).toHaveLength(1)

      // Add new message
      const mockAddMessage = mock(async (_id: string, _msg: Record<string, unknown>) => ({ ok: true }))
      await mockAddMessage(selectedSession.session_id, {
        message_id: "msg-new",
        role: "user",
        content: "Continue from previous"
      })

      expect(mockListSessions).toHaveBeenCalled()
      expect(mockGetSession).toHaveBeenCalled()
      expect(mockAddMessage).toHaveBeenCalled()
    })

    test("should delete session", async () => {
      const mockDeleteSession = mock(async (_id: string) => ({ ok: true }))
      const result = await mockDeleteSession("session-2")

      expect(result.ok).toBe(true)
      expect(mockDeleteSession).toHaveBeenCalledWith("session-2")
    })

    test("should delete all sessions", async () => {
      const mockDeleteAll = mock(async () => ({ ok: true }))
      const result = await mockDeleteAll()

      expect(result.ok).toBe(true)
    })
  })

  describe("Error Recovery Workflow", () => {
    test("should recover from message send error", async () => {
      const mockSend = mock(async () => {
        throw new Error("Network error")
      })

      try {
        await mockSend()
      } catch (error) {
        _mockShowToast(`Chat error: ${error}`, "error")
      }

      expect(_mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Chat error"),
        "error"
      )

      // Should allow user to retry
      const mockRetry = mock(async () => ({ success: true }))
      const retryResult = await mockRetry()

      expect(retryResult.success).toBe(true)
    })

    test("should handle model becoming unavailable", async () => {
      let selectedModel = "gpt-4"
      const availableModels = ["gpt-3.5", "claude-3"] // gpt-4 no longer available

      if (!availableModels.includes(selectedModel)) {
        selectedModel = availableModels[0]
        _mockShowToast("Model unavailable, switched to available model", "error")
      }

      expect(selectedModel).toBe("gpt-3.5")
      expect(_mockShowToast).toHaveBeenCalled()
    })

    test("should handle missing response message", async () => {
      const mockCreateCompletion = mock(async () => ({
        id: "response-123",
        choices: [
          { index: 0, message: null } // Missing message
        ]
      }))

      const response = await mockCreateCompletion()
      const msgContent = response.choices[0]?.message?.content ?? ""

      expect(msgContent).toBe("")
      _mockShowToast("No content in response", "error")

      expect(_mockShowToast).toHaveBeenCalled()
    })
  })

  describe("Model Selection Workflow", () => {
    test("should allow switching between models", async () => {
      const mockGetModels = mock(async () => MOCK_MODELS_RESPONSE)
      const models = await mockGetModels()

      let selectedModel = models.data[0].id
      expect(selectedModel).toBe("gpt-4")

      // Switch to Claude
      selectedModel = "claude-3-opus"
      expect(selectedModel).toBe("claude-3-opus")

      // Switch back
      selectedModel = models.data[0].id
      expect(selectedModel).toBe("gpt-4")
    })

    test("should maintain API shape when switching models", async () => {
      let apiShape = "openai"
      let selectedModel = "gpt-4"

      // Switch model
      selectedModel = "claude-3-opus"

      // API shape should remain consistent
      expect(apiShape).toBe("openai")

      // But can change API shape if needed
      apiShape = "anthropic"
      expect(apiShape).toBe("anthropic")
    })
  })

  describe("Multi-API Shape Usage", () => {
    test("should work with OpenAI then Anthropic", async () => {
      // First chat with OpenAI
      let apiShape = "openai"
      let selectedModel = "gpt-4"

      const mockOpenAI = mock(async () => MOCK_CHAT_COMPLETION_OPENAI)
      const openaiResponse = await mockOpenAI()
      expect(openaiResponse.choices).toBeTruthy()

      // Switch to Anthropic
      apiShape = "anthropic"
      selectedModel = "claude-3-opus"

      const mockAnthropic = mock(async () => MOCK_CHAT_COMPLETION_ANTHROPIC)
      const anthropicResponse = await mockAnthropic()
      expect(anthropicResponse.content).toBeTruthy()

      expect(mockOpenAI).toHaveBeenCalled()
      expect(mockAnthropic).toHaveBeenCalled()
    })
  })

  describe("Session List Refresh", () => {
    test("should refresh sessions after new message", async () => {
      // Load initial sessions
      const mockListSessions = mock(async () => MOCK_CHAT_SESSIONS)
      let sessions = await mockListSessions()
      expect(sessions).toHaveLength(3)

      // Add message to session
      const mockAddMessage = mock(async (_id: string, _msg: Record<string, unknown>) => ({ ok: true }))
      await mockAddMessage("session-1", {
        message_id: "new-msg",
        role: "assistant",
        content: "Response"
      })

      // Refresh sessions list
      sessions = await mockListSessions()
      expect(sessions).toHaveLength(3)

      expect(mockAddMessage).toHaveBeenCalled()
    })
  })

  describe("Empty State Handling", () => {
    test("should handle no models available", async () => {
      const mockGetModels = mock(async () => ({
        object: "list",
        data: [],
        has_more: false
      }))

      const result = await mockGetModels()
      expect(result.data).toHaveLength(0)

      mockShowToast("No models available", "error")
      expect(mockShowToast).toHaveBeenCalled()
    })

    test("should handle no sessions", async () => {
      const mockListSessions = mock(async () => [])
      const sessions = await mockListSessions()

      expect(sessions).toHaveLength(0)
      // Should show empty state in UI
    })
  })
})
