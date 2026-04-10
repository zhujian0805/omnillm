/**
 * API Response Fixtures for Frontend Tests
 *
 * Mock responses for common API endpoints
 */

export const MOCK_PROVIDERS_LIST = [
  {
    id: "github-copilot-1",
    type: "github-copilot",
    name: "GitHub Copilot",
    isActive: true,
    authStatus: "authenticated" as const,
    enabledModelCount: 2,
    totalModelCount: 2,
    priority: 1
  },
  {
    id: "alibaba-1",
    type: "alibaba",
    name: "Alibaba",
    isActive: false,
    authStatus: "unauthenticated" as const,
    enabledModelCount: 0,
    totalModelCount: 5,
    priority: 2
  },
  {
    id: "azure-1",
    type: "azure-openai",
    name: "Azure OpenAI",
    isActive: true,
    authStatus: "authenticated" as const,
    enabledModelCount: 1,
    totalModelCount: 1,
    priority: 3,
    config: {
      endpoint: "https://test.openai.azure.com/",
      apiVersion: "2024-02-15-preview",
      deployments: ["gpt-4-deployment"]
    }
  }
]

export const MOCK_MODELS_RESPONSE = {
  object: "list",
  data: [
    { id: "gpt-4", display_name: "GPT-4", owned_by: "openai" },
    { id: "gpt-3.5-turbo", display_name: "GPT-3.5 Turbo", owned_by: "openai" },
    { id: "claude-3-opus", display_name: "Claude 3 Opus", owned_by: "anthropic" },
    { id: "claude-3-sonnet", display_name: "Claude 3 Sonnet", owned_by: "anthropic" }
  ],
  has_more: false
}

export const MOCK_STATUS_RESPONSE = {
  activeProvider: { id: "github-copilot-1", name: "GitHub Copilot" },
  modelCount: 4,
  manualApprove: false,
  rateLimitSeconds: null,
  rateLimitWait: false,
  authFlow: null
}

export const MOCK_SERVER_INFO = {
  version: "0.1.0",
  port: 4141
}

export const MOCK_CHAT_SESSIONS = [
  {
    session_id: "session-1",
    title: "How to learn TypeScript",
    model_id: "gpt-4",
    api_shape: "openai",
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    session_id: "session-2",
    title: "Debugging React hooks",
    model_id: "claude-3-opus",
    api_shape: "anthropic",
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
  },
  {
    session_id: "session-3",
    title: "API design best practices",
    model_id: "gpt-3.5-turbo",
    api_shape: "openai",
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString()
  }
]

export const MOCK_CHAT_SESSION_DETAIL = {
  session: MOCK_CHAT_SESSIONS[0],
  messages: [
    {
      message_id: "msg-1",
      session_id: "session-1",
      role: "user",
      content: "How do I get started with TypeScript?",
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    },
    {
      message_id: "msg-2",
      session_id: "session-1",
      role: "assistant",
      content: "TypeScript is a typed superset of JavaScript. Here are the steps to get started...",
      created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString()
    }
  ]
}

export const MOCK_CHAT_COMPLETION_OPENAI = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Here's a helpful response to your question!"
      },
      finish_reason: "stop"
    }
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30
  }
}

export const MOCK_CHAT_COMPLETION_ANTHROPIC = {
  id: "msg-123",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "text",
      text: "Here's a helpful response to your question!"
    }
  ],
  model: "claude-3-opus",
  stop_reason: "end_turn",
  usage: {
    input_tokens: 10,
    output_tokens: 20
  }
}

export const MOCK_CHAT_COMPLETION_RESPONSES = {
  id: "response-123",
  object: "realtime.response",
  model: "gpt-4",
  output: [
    {
      type: "message",
      id: "msg-1",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Here's a helpful response to your question!"
        }
      ]
    }
  ],
  created_at: Date.now()
}

export const MOCK_USAGE_DATA = {
  access_type_sku: "copilot_pro",
  copilot_plan: "pro",
  quota_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  chat_enabled: true,
  assigned_date: new Date().toISOString(),
  quota_snapshots: {
    "chat_operations": {
      entitlement: 100,
      remaining: 75,
      percent_remaining: 75,
      unlimited: false
    },
    "code_completions": {
      entitlement: 1000,
      remaining: 850,
      percent_remaining: 85,
      unlimited: false
    },
    "unlimited_feature": {
      entitlement: 0,
      remaining: 0,
      percent_remaining: 100,
      unlimited: true
    }
  }
}

export const MOCK_LOG_LEVEL = {
  level: 3 // Info level
}

export const MOCK_LOG_LINES = [
  "[2024-01-15T10:30:00Z] INFO: Server started on port 4141",
  "[2024-01-15T10:30:01Z] DEBUG: Initializing providers",
  "[2024-01-15T10:30:02Z] INFO: GitHub Copilot provider initialized",
  "[2024-01-15T10:30:03Z] WARN: Azure OpenAI credentials not yet configured",
  "[2024-01-15T10:30:04Z] INFO: All providers ready"
]

// Provider default auth flow states
export const MOCK_AUTH_FLOW_PENDING = {
  providerId: "github-copilot-1",
  status: "pending" as const,
  instructionURL: null,
  userCode: null,
  error: null
}

export const MOCK_AUTH_FLOW_AWAITING_USER = {
  providerId: "github-copilot-1",
  status: "awaiting_user" as const,
  instructionURL: "https://github.com/login/device",
  userCode: "ABCD-1234",
  error: null
}

export const MOCK_AUTH_FLOW_COMPLETE = {
  providerId: "github-copilot-1",
  status: "complete" as const,
  instructionURL: null,
  userCode: null,
  error: null
}

export const MOCK_AUTH_FLOW_ERROR = {
  providerId: "alibaba-1",
  status: "error" as const,
  instructionURL: null,
  userCode: null,
  error: "Authentication timed out"
}

// Error responses
export const MOCK_ERROR_RESPONSES = {
  notFound: {
    error: "Provider not found"
  },
  unauthorized: {
    error: "Authentication required"
  },
  badRequest: {
    error: "Invalid request parameters"
  },
  serverError: {
    error: "Internal server error"
  }
}

// Build endpoint response map for fetch mocking
export function buildEndpointMap() {
  return {
    "/api/admin/providers": {
      GET: { response: MOCK_PROVIDERS_LIST }
    },
    "/models": {
      GET: { response: MOCK_MODELS_RESPONSE }
    },
    "/api/admin/status": {
      GET: { response: MOCK_STATUS_RESPONSE }
    },
    "/api/admin/info": {
      GET: { response: MOCK_SERVER_INFO }
    },
    "/api/admin/chat/sessions": {
      GET: { response: MOCK_CHAT_SESSIONS }
    },
    "/api/admin/settings/log-level": {
      GET: { response: MOCK_LOG_LEVEL }
    },
    "/usage": {
      GET: { response: MOCK_USAGE_DATA }
    },
    "/api/admin/auth-status": {
      GET: { response: MOCK_AUTH_FLOW_PENDING }
    }
  }
}
