import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import {
  getLogLevel,
  setLogLevel,
  subscribeToLogs,
  unsubscribeFromLogs,
  testBroadcast,
  getSubscriberCount,
} from "~/lib/logging"

const LOG_LEVEL_NAMES = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const

function serializeLogLevel(level: number): (typeof LOG_LEVEL_NAMES)[number] {
  return LOG_LEVEL_NAMES[level] ?? "info"
}

function normalizeRequestedLogLevel(level: unknown): number | null {
  if (
    typeof level === "number"
    && Number.isInteger(level)
    && level >= 0
    && level < LOG_LEVEL_NAMES.length
  ) {
    return level
  }

  if (typeof level === "string") {
    const normalized = level.trim().toLowerCase()
    const index = LOG_LEVEL_NAMES.indexOf(
      normalized as (typeof LOG_LEVEL_NAMES)[number],
    )

    if (index !== -1) {
      return index
    }

    if (normalized === "warning") {
      return LOG_LEVEL_NAMES.indexOf("warn")
    }
  }

  return null
}

export function handleGetLogLevel(c: Context) {
  return c.json({
    level: serializeLogLevel(getLogLevel()),
    levels: LOG_LEVEL_NAMES,
  })
}

export async function handleSetLogLevel(c: Context) {
  const body = await c.req.json<{ level: unknown }>()
  const level = normalizeRequestedLogLevel(body.level)
  if (level === null) {
    return c.json(
      { error: "level must be one of fatal, error, warn, info, debug, trace" },
      400,
    )
  }
  setLogLevel(level)
  return c.json({ success: true, level: serializeLogLevel(level) })
}

export function handleTestLog(c: Context) {
  // Test direct broadcasting first
  testBroadcast("🔥 Direct broadcast test - bypassing consola")

  // Then test consola
  consola.info("🧪 Test log message - if you can see this, logging is working!")
  consola.warn("⚠️ Test warning message")
  consola.error("❌ Test error message")

  return c.json({
    success: true,
    message: "Test logs sent",
    subscribers: getSubscriberCount(),
  })
}

export function handleDebugLog(c: Context) {
  const count = getSubscriberCount()

  // Broadcast directly
  testBroadcast(
    `🚨 Debug message to ${count} subscribers at ${new Date().toISOString()}`,
  )

  return c.json({
    message: "Debug log sent",
    subscribers: count,
    timestamp: new Date().toISOString(),
  })
}

export function handleWebSocketLogs(c: Context) {
  interface WebSocketWithData extends WebSocket {
    data?: { onLine: (line: string) => void }
  }

  const { response } = Bun.upgradeWebSocket(c.req.raw, {
    message: () => {
      // We don't expect messages from client
    },
    open: (ws: WebSocketWithData) => {
      const onLine = (line: string) => {
        try {
          ws.send(line)
        } catch {
          // Connection might be closed
        }
      }

      subscribeToLogs(onLine)

      // Send initial connection message
      ws.send(
        `[${new Date().toISOString()}] INFO: 🔗 WebSocket log stream connected`,
      )

      // Store the callback for cleanup
      ws.data = { onLine }
    },
    close: (ws: WebSocketWithData) => {
      if (ws.data?.onLine) {
        unsubscribeFromLogs(ws.data.onLine)
      }
    },
    error: (ws: WebSocketWithData) => {
      if (ws.data?.onLine) {
        unsubscribeFromLogs(ws.data.onLine)
      }
    },
  })

  return response as Response
}

export function handleStreamLogs(c: Context) {
  const HEARTBEAT_INTERVAL_MS = 5_000

  return streamSSE(c, async (stream) => {
    // Send an immediate comment to confirm the connection is alive
    await stream.writeSSE({ data: "", event: "connected" })

    let wakeup: (() => void) | null = null
    const pending: Array<string> = []
    let closed = false

    const onLine = (line: string) => {
      if (closed) return
      pending.push(line)
      wakeup?.()
      wakeup = null
    }

    subscribeToLogs(onLine)

    try {
      while (true) {
        // Drain any pending lines
        while (pending.length > 0) {
          const line = pending.shift() ?? ""
          await stream.writeSSE({ data: line })
        }

        // Wait for the next line or a 15s keepalive heartbeat
        let heartbeatElapsed = false
        await Promise.race([
          new Promise<void>((res) => {
            wakeup = res
          }),
          new Promise<void>((res) => {
            setTimeout(() => {
              heartbeatElapsed = true
              res()
            }, HEARTBEAT_INTERVAL_MS)
          }),
        ])
        wakeup = null

        if (stream.aborted) break

        if (heartbeatElapsed && pending.length === 0) {
          await stream.writeSSE({ data: "", event: "heartbeat" })
        }
      }
    } finally {
      closed = true
      unsubscribeFromLogs(onLine)
    }
  })
}
