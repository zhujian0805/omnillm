export interface ResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface ResponsesPayload {
  model: string
  input: string | Array<InputItem>
  instructions?: string | null
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  tools?: Array<ResponsesTool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
}

export interface InputTextContentBlock {
  type: "input_text" | "output_text"
  text: string
}

export type InputContentBlock = InputTextContentBlock

export interface MessageInputItem {
  type: "message"
  role: "user" | "assistant" | "system"
  content: string | Array<InputContentBlock>
}

export interface FunctionCallInputItem {
  type: "function_call"
  id?: string
  call_id?: string
  role?: "assistant"
  name: string
  arguments: string
}

export interface FunctionCallOutputInputItem {
  type: "function_call_output"
  call_id: string
  output: string
  name?: string
}

export type InputItem =
  | MessageInputItem
  | FunctionCallInputItem
  | FunctionCallOutputInputItem

// Response types

export interface ResponsesResponse {
  id: string
  object: "realtime.response"
  model: string
  output: Array<OutputItem>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
  created_at?: number
}

export interface OutputItem {
  type: "message" | "function_call"
  id: string
  role: "user" | "assistant" | "system"
  content?: Array<ContentBlock>
  name?: string
  arguments?: string
}

export interface ContentBlock {
  type: "output_text" | "function_parameters"
  text?: string
}

// Streaming event types

export interface ResponsesEvent {
  type: string
  [key: string]: unknown
}

export interface ResponseCreatedEvent extends ResponsesEvent {
  type: "response.created"
  response: ResponsesResponse
}

export interface OutputItemAddedEvent extends ResponsesEvent {
  type: "response.output_item.added"
  item: OutputItem
}

export interface ContentBlockAddedEvent extends ResponsesEvent {
  type: "response.content_block.added"
  content_block: ContentBlock
}

export interface OutputTextDeltaEvent extends ResponsesEvent {
  type: "response.output_text.delta"
  delta: string
}

export interface OutputTextDoneEvent extends ResponsesEvent {
  type: "response.output_text.done"
  text: string
}

export interface OutputItemDoneEvent extends ResponsesEvent {
  type: "response.output_item.done"
  item: OutputItem
}

export interface ResponseCompletedEvent extends ResponsesEvent {
  type: "response.completed"
  response: ResponsesResponse
}
