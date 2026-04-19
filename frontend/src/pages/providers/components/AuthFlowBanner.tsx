import type { ComponentType } from "react"

import type { AuthFlow, Provider } from "@/api"
import { getDeviceAuthCopy } from "@/lib/device-auth"

export function AuthFlowBanner({
  authFlow,
  providers,
  onCancel,
  Spin,
}: {
  authFlow: AuthFlow | null | undefined
  providers: Array<Provider>
  onCancel: () => void
  Spin: ComponentType<{ size?: number }>
}) {
  if (!authFlow || authFlow.status === "complete" || authFlow.status === "error") {
    return null
  }

  const name = providers.find((p) => p.id === authFlow.providerId)?.name ?? authFlow.providerId
  const authCopy = getDeviceAuthCopy(authFlow, providers)

  return (
    <div
      style={{
        background: "rgba(255,159,10,0.1)",
        border: "1px solid rgba(255,159,10,0.25)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
        marginBottom: 24,
      }}
    >
      {authFlow.status === "pending" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--color-orange)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <Spin size={14} />
          Initiating auth flow for {name}…
        </div>
      )}
      {authFlow.status === "awaiting_user" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              color: "var(--color-orange)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Authorization Required — {name}
          </div>
          {authFlow.userCode && (
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 6,
                }}
              >
                {authCopy.codeLabel}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--color-orange)",
                  letterSpacing: "0.2em",
                  background: "rgba(255,159,10,0.08)",
                  border: "1px solid rgba(255,159,10,0.2)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 16px",
                  display: "inline-block",
                }}
              >
                {authFlow.userCode}
              </div>
              {authCopy.codeHint && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    marginTop: 8,
                    lineHeight: 1.5,
                  }}
                >
                  {authCopy.codeHint}
                </div>
              )}
            </div>
          )}
          {authFlow.instructionURL && (
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 6,
                }}
              >
                Authorization URL:
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--color-separator)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 12px",
                  wordBreak: "break-all",
                  marginBottom: 10,
                }}
              >
                {authFlow.instructionURL}
              </div>
              <a href={authFlow.instructionURL} target="_blank" rel="noopener noreferrer">
                <button className="btn btn-amber btn-sm">Open in Browser ↗</button>
              </a>
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--color-text-secondary)",
              fontSize: 13,
            }}
          >
            <Spin size={13} />
            {authCopy.waitingLabel}
          </div>
          <div>
            <button className="btn btn-sm" style={{ color: "var(--color-text-secondary)" }} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
