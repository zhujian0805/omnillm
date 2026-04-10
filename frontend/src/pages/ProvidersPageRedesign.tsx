import { useCallback, useEffect, useState } from "react"

import {
  listProviders,
  getStatus,
  getAuthStatus,
  activateProvider,
  deactivateProvider,
  type Provider,
  type Status,
  type AuthFlow,
} from "@/api"

interface ProvidersPageRedesignProps {
  showToast: (msg: string, type?: "success" | "error") => void
}

// Custom hook for provider data
function useProviderData(
  showToast: (msg: string, type?: "success" | "error") => void,
) {
  const [providers, setProviders] = useState<Array<Provider>>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [authFlow, setAuthFlow] = useState<AuthFlow | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [providersData, statusData, authData] = await Promise.all([
        listProviders(),
        getStatus(),
        getAuthStatus(),
      ])
      setProviders(providersData)
      setStatus(statusData)
      setAuthFlow(authData)
    } catch {
      showToast("Failed to load providers", "error")
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const handleActivate = useCallback(
    async (providerId: string) => {
      setActivating(providerId)
      try {
        await activateProvider(providerId)
        showToast("Provider activated", "success")
        await loadData()
      } catch {
        showToast("Failed to activate provider", "error")
      } finally {
        setActivating(null)
      }
    },
    [loadData, showToast],
  )

  const handleDeactivate = useCallback(
    async (providerId: string) => {
      setActivating(providerId)
      try {
        await deactivateProvider(providerId)
        showToast("Provider deactivated", "success")
        await loadData()
      } catch {
        showToast("Failed to deactivate provider", "error")
      } finally {
        setActivating(null)
      }
    },
    [loadData, showToast],
  )

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [loadData])

  return {
    providers,
    status,
    authFlow,
    loading,
    activating,
    handleActivate,
    handleDeactivate,
    loadData,
  }
}

// Status indicator component
function StatusIndicator({
  status,
  size = 8,
}: {
  status: "active" | "inactive" | "error" | "pending"
  size?: number
}) {
  const statusStyles = {
    active: {
      background: "linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)",
      boxShadow: "0 0 12px rgba(0, 255, 136, 0.4)",
    },
    inactive: {
      background: "linear-gradient(135deg, #64748b 0%, #475569 100%)",
      boxShadow: "0 0 12px rgba(100, 116, 139, 0.2)",
    },
    error: {
      background: "linear-gradient(135deg, #ff3366 0%, #cc1a4a 100%)",
      boxShadow: "0 0 12px rgba(255, 51, 102, 0.4)",
    },
    pending: {
      background: "linear-gradient(135deg, #ffa726 0%, #ff9800 100%)",
      boxShadow: "0 0 12px rgba(255, 167, 38, 0.4)",
    },
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        ...statusStyles[status],
        animation: status === "pending" ? "pulse 2s infinite" : "none",
      }}
    />
  )
}

// Provider card component
function ProviderCard({
  provider,
  isActivating,
  onActivate,
  onDeactivate,
}: {
  provider: Provider
  isActivating: boolean
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
}) {
  const isActive = provider.status === "active"

  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "16px",
        padding: "24px",
        backdropFilter: "blur(20px)",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        transform: "translateZ(0)", // Enable GPU acceleration
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = "translateY(-2px) scale(1.01)"
        el.style.border =
          isActive ?
            "1px solid rgba(0, 255, 136, 0.3)"
          : "1px solid rgba(255,255,255,0.15)"
        el.style.boxShadow =
          "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)"
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = "translateY(0) scale(1)"
        el.style.border = "1px solid rgba(255,255,255,0.08)"
        el.style.boxShadow = "none"
      }}
    >
      {/* Animated background gradient for active providers */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background:
              "linear-gradient(135deg, rgba(0, 255, 136, 0.05) 0%, transparent 50%, rgba(0, 255, 136, 0.02) 100%)",
            borderRadius: "16px",
            pointerEvents: "none",
            animation: "shimmer 3s ease-in-out infinite",
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "8px",
            }}
          >
            <StatusIndicator
              status={
                isActivating ? "pending"
                : isActive ?
                  "active"
                : "inactive"
              }
              size={10}
            />
            <h3
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: "600",
                color: "var(--color-text)",
                fontFamily:
                  '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
              }}
            >
              {provider.name}
            </h3>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-tertiary)",
                fontFamily: '"SF Mono", Monaco, monospace',
                background: "rgba(255,255,255,0.05)",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {provider.id}
            </span>
            <span
              style={{
                fontSize: "11px",
                color: isActive ? "#00ff88" : "#64748b",
                fontWeight: "500",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {isActivating ?
                "SWITCHING..."
              : isActive ?
                "ONLINE"
              : "OFFLINE"}
            </span>
          </div>

          {provider.description && (
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "var(--color-text-secondary)",
                lineHeight: "1.5",
              }}
            >
              {provider.description}
            </p>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation()
            if (isActivating) return
            isActive ? onDeactivate(provider.id) : onActivate(provider.id)
          }}
          disabled={isActivating}
          style={{
            background:
              isActive ?
                "linear-gradient(135deg, #ff3366 0%, #cc1a4a 100%)"
              : "linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)",
            border: "none",
            borderRadius: "12px",
            padding: "12px 20px",
            color: "white",
            fontSize: "13px",
            fontWeight: "600",
            cursor: isActivating ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
            boxShadow:
              isActive ?
                "0 4px 16px rgba(255, 51, 102, 0.3)"
              : "0 4px 16px rgba(0, 255, 136, 0.3)",
            opacity: isActivating ? 0.7 : 1,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => {
            if (!isActivating) {
              const el = e.currentTarget as HTMLElement
              el.style.transform = "translateY(-1px)"
              el.style.boxShadow =
                isActive ?
                  "0 6px 20px rgba(255, 51, 102, 0.4)"
                : "0 6px 20px rgba(0, 255, 136, 0.4)"
            }
          }}
          onMouseLeave={(e) => {
            if (!isActivating) {
              const el = e.currentTarget as HTMLElement
              el.style.transform = "translateY(0)"
              el.style.boxShadow =
                isActive ?
                  "0 4px 16px rgba(255, 51, 102, 0.3)"
                : "0 4px 16px rgba(0, 255, 136, 0.3)"
            }
          }}
        >
          {isActivating ?
            "•••"
          : isActive ?
            "Disable"
          : "Enable"}
        </button>
      </div>
    </div>
  )
}

// System status banner
function SystemStatus({ status }: { status: Status | null }) {
  if (!status) return null

  const activeProviders =
    status.providers?.filter((p) => p.status === "active").length || 0
  const totalRequests = status.metrics?.totalRequests || 0

  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(0, 255, 136, 0.1) 0%, rgba(0, 204, 106, 0.05) 100%)",
        border: "1px solid rgba(0, 255, 136, 0.2)",
        borderRadius: "16px",
        padding: "20px",
        marginBottom: "32px",
        backdropFilter: "blur(20px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <StatusIndicator status="active" size={12} />
          <span
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "#00ff88",
              fontFamily:
                '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
            }}
          >
            System Online
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "700",
                color: "var(--color-text)",
              }}
            >
              {activeProviders}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Active Providers
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "700",
                color: "var(--color-text)",
              }}
            >
              {totalRequests.toLocaleString()}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Total Requests
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProvidersPageRedesign({
  showToast,
}: ProvidersPageRedesignProps) {
  const {
    providers,
    status,
    loading,
    activating,
    handleActivate,
    handleDeactivate,
  } = useProviderData(showToast)

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            border: "3px solid rgba(0, 255, 136, 0.3)",
            borderTop: "3px solid #00ff88",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        <span
          style={{ color: "var(--color-text-secondary)", fontSize: "14px" }}
        >
          Loading providers...
        </span>
      </div>
    )
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "0",
      }}
    >
      <div style={{ marginBottom: "40px" }}>
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "32px",
            fontWeight: "700",
            color: "var(--color-text)",
            fontFamily:
              '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
            letterSpacing: "-0.02em",
          }}
        >
          Control Tower
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            color: "var(--color-text-secondary)",
            lineHeight: "1.5",
          }}
        >
          Monitor and manage your LLM provider infrastructure
        </p>
      </div>

      <SystemStatus status={status} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
          gap: "20px",
          animation: "fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {providers.map((provider, index) => (
          <div
            key={provider.id}
            style={{
              animation: `fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.1}s both`,
            }}
          >
            <ProviderCard
              provider={provider}
              isActivating={activating === provider.id}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
            />
          </div>
        ))}
      </div>

      {providers.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "var(--color-text-secondary)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.5 }}>
            ⚡
          </div>
          <h3
            style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}
          >
            No providers configured
          </h3>
          <p style={{ margin: 0, fontSize: "14px" }}>
            Add your first LLM provider to get started
          </p>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          @keyframes shimmer {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 0.8; }
          }

          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `,
        }}
      />
    </div>
  )
}
