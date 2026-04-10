import { useEffect, useRef, useState, type CSSProperties } from "react"

import { getLogLevel, subscribeToLogs, updateLogLevel } from "@/api"

const LOG_LEVELS = [
  { value: 0, label: "Silent" },
  { value: 1, label: "Fatal" },
  { value: 2, label: "Warn" },
  { value: 3, label: "Info" },
  { value: 4, label: "Debug" },
  { value: 5, label: "Trace" },
] as const

const MAX_LINES = 500

function Spin() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      className="animate-spin"
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="10"
        fill="none"
        opacity="0.6"
      />
    </svg>
  )
}

// eslint-disable-next-line max-lines-per-function
export function LoggingPage({
  showToast,
}: {
  showToast: (msg: string, type?: "success" | "error") => void
}) {
  const [lines, setLines] = useState<Array<string>>([])
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [logLevel, setLogLevelState] = useState<number | null>(null)
  const logViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getLogLevel()
      .then((result) => setLogLevelState(result.level))
      .catch((e: unknown) =>
        showToast(
          "Failed to load log level: "
            + (e instanceof Error ? e.message : String(e)),
          "error",
        ),
      )
  }, [showToast])

  useEffect(() => {
    let es: EventSource | null = null

    const setupLogStream = async () => {
      try {
        es = await subscribeToLogs((line) => {
          setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line])
          setConnected(true)
          setConnecting(false)
        })

        es.addEventListener("open", () => {
          setConnected(true)
          setConnecting(false)
        })

        es.addEventListener("error", (e) => {
          console.error("EventSource error:", e)
          setConnected(false)
          setConnecting(false)
        })
      } catch (error) {
        console.error("Failed to setup log stream:", error)
        setConnected(false)
        setConnecting(false)
        showToast(
          "Failed to connect to log stream: "
            + (error instanceof Error ? error.message : String(error)),
          "error",
        )
      }
    }

    setupLogStream()

    return () => {
      if (es) {
        es.close()
      }
    }
  }, [showToast])

  useEffect(() => {
    if (!autoScroll) return
    const viewport = logViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [autoScroll, lines])

  const scrollToTop = () => {
    const viewport = logViewportRef.current
    if (viewport) {
      viewport.scrollTop = 0
      setAutoScroll(false) // Disable auto-scroll when manually scrolling
    }
  }

  const scrollToBottom = () => {
    const viewport = logViewportRef.current
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      setAutoScroll(true) // Enable auto-scroll when scrolling to bottom
    }
  }

  const clearLogs = () => {
    setLines([])
    showToast("Cleared visible log buffer")
  }

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      showToast("Copied visible logs")
    } catch (e) {
      showToast(
        "Copy failed: " + (e instanceof Error ? e.message : String(e)),
        "error",
      )
    }
  }

  const _logLevelLabel =
    LOG_LEVELS.find((level) => level.value === logLevel)?.label ?? "—"

  const card: CSSProperties = {
    background: "var(--color-bg-elevated)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-separator)",
    boxShadow: "var(--shadow-card)",
    overflow: "hidden",
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 26,
              color: "var(--color-text)",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            Logging
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              marginTop: 5,
            }}
          >
            Live proxy output. Real-time streaming of all application logs.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setAutoScroll((prev) => !prev)}
          >
            {autoScroll ? "Auto-scroll On" : "Auto-scroll Off"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={scrollToTop}
            disabled={lines.length === 0}
            title="Scroll to top"
          >
            ↑ Top
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={scrollToBottom}
            disabled={lines.length === 0}
            title="Scroll to bottom"
          >
            ↓ Bottom
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearLogs}>
            Clear
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={lines.length === 0}
            onClick={copyLogs}
          >
            Copy
          </button>
        </div>
      </div>

      {/* Stream State moved to top */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            marginBottom: 10,
          }}
        >
          Stream State
        </div>
        <div
          style={{
            ...card,
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
            >
              Connection
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
                background:
                  connected ?
                    "var(--color-green-fill)"
                  : "var(--color-orange-fill)",
                color: connected ? "var(--color-green)" : "var(--color-orange)",
              }}
            >
              {
                /* eslint-disable-next-line no-nested-ternary */
                connecting ?
                  "Connecting"
                : connected ?
                  "Live"
                : "Retrying"
              }
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
            >
              Visible Lines
            </span>
            <span
              style={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                color: "var(--color-text)",
                fontWeight: 600,
              }}
            >
              {lines.length}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
            >
              Log Level
            </span>
            <select
              value={logLevel ?? 3}
              onChange={async (e) => {
                const newLevel = Number(e.target.value)
                try {
                  await updateLogLevel(newLevel)
                  setLogLevelState(newLevel)
                  showToast(
                    `Log level changed to ${LOG_LEVELS[newLevel]?.label}`,
                  )
                } catch (error) {
                  showToast(
                    `Failed to update log level: ${error instanceof Error ? error.message : String(error)}`,
                    "error",
                  )
                }
              }}
              style={{
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--color-blue)",
                fontWeight: 600,
                background: "transparent",
                border: "1px solid var(--color-separator)",
                borderRadius: "var(--radius-sm)",
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.value} {level.label}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: "auto",
            }}
          >
            {connecting ?
              <Spin />
            : <span
                className={`status-dot ${
                  connected ? "status-dot-active" : "status-dot-inactive"
                }`}
              />
            }
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-tertiary)",
              }}
            >
              /api/admin/logs/stream
            </span>
          </div>
        </div>
      </div>

      {/* Full-width logging area */}
      <section>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            marginBottom: 10,
          }}
        >
          Live Output
        </div>
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "11px 16px",
              borderBottom: "1px solid var(--color-separator)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--color-text-secondary)",
                fontSize: 12,
              }}
            >
              {connecting ?
                <Spin />
              : <span
                  className={`status-dot ${
                    connected ? "status-dot-active" : "status-dot-inactive"
                  }`}
                />
              }
              {
                /* eslint-disable-next-line no-nested-ternary */
                connecting ?
                  "Opening stream..."
                : connected ?
                  "Receiving new log lines"
                : "Waiting for reconnect"
              }
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-tertiary)",
              }}
            >
              Buffer: {lines.length}/{MAX_LINES} lines
            </span>
          </div>

          <div
            ref={logViewportRef}
            style={{
              minHeight: 500,
              maxHeight: "calc(100vh - 280px)",
              overflow: "auto",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.005))",
            }}
          >
            {lines.length === 0 ?
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 500,
                  padding: "36px 24px",
                  textAlign: "center",
                  color: "var(--color-text-secondary)",
                  fontSize: 13,
                }}
              >
                {connecting ?
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Spin /> Connecting to log stream...
                  </div>
                : "No log lines received yet."}
              </div>
            : <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-text)",
                }}
              >
                {lines.map((line, index) => (
                  <div
                    key={`${index}-${line}`}
                    style={{
                      padding: "8px 14px",
                      borderBottom:
                        index < lines.length - 1 ?
                          "1px solid var(--color-separator)"
                        : "none",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      </section>
    </div>
  )
}
