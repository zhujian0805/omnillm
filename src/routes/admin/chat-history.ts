import type { Context } from "hono"
import { ChatStore } from "~/lib/database"

export async function handleListSessions(c: Context) {
  const sessions = ChatStore.listSessions()
  return c.json(sessions)
}

export async function handleGetSession(c: Context) {
  const sessionId = c.req.param("id")
  const session = ChatStore.getSession(sessionId)
  if (!session) return c.json({ error: "Session not found" }, 404)
  const messages = ChatStore.getMessages(sessionId)
  return c.json({ session, messages })
}

export async function handleCreateSession(c: Context) {
  const body = await c.req.json<{
    session_id: string
    title: string
    model_id: string
    api_shape: string
  }>()
  ChatStore.createSession(body.session_id, body.title, body.model_id, body.api_shape)
  return c.json({ ok: true })
}

export async function handleUpdateSession(c: Context) {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ title?: string }>()
  if (body.title) ChatStore.updateSessionTitle(sessionId, body.title)
  ChatStore.touchSession(sessionId)
  return c.json({ ok: true })
}

export async function handleAddMessage(c: Context) {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{
    message_id: string
    role: "user" | "assistant" | "system"
    content: string
  }>()
  ChatStore.addMessage(body.message_id, sessionId, body.role, body.content)
  ChatStore.touchSession(sessionId)
  return c.json({ ok: true })
}

export async function handleDeleteSession(c: Context) {
  const sessionId = c.req.param("id")
  ChatStore.deleteSession(sessionId)
  return c.json({ ok: true })
}

export async function handleDeleteAllSessions(c: Context) {
  ChatStore.deleteAllSessions()
  return c.json({ ok: true })
}
