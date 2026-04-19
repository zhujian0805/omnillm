import type { Provider } from "@/api"

export function StatsBar({
  providers,
  totalActive,
}: {
  providers: Array<Provider>
  totalActive: number
}) {
  const totalModels = providers.reduce((sum, p) => sum + (p.totalModelCount ?? 0), 0)
  const enabledModels = providers.reduce((sum, p) => sum + (p.enabledModelCount ?? 0), 0)
  const authCount = providers.filter((p) => p.authStatus === "authenticated").length

  const stats = [
    {
      label: "Active",
      value: totalActive,
      color: "var(--color-green)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.08 9 11.08" />
        </svg>
      ),
    },
    {
      label: "Instances",
      value: providers.length,
      color: "var(--color-blue)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
    {
      label: "Models",
      value: enabledModels,
      suffix: totalModels > 0 ? ` / ${totalModels}` : "",
      color: "var(--color-orange)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      ),
    },
    {
      label: "Authenticated",
      value: authCount,
      color: "var(--color-text-secondary)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
    },
  ]

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
        marginBottom: 28,
      }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-separator)",
            borderRadius: "var(--radius-lg)",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            transition: "border-color 0.15s var(--ease)",
          }}
        >
          <div
            style={{
              color: stat.color,
              display: "flex",
              alignItems: "center",
              opacity: 0.8,
            }}
          >
            {stat.icon}
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 20,
                fontWeight: 700,
                color: stat.color,
                lineHeight: 1,
              }}
            >
              {stat.value}
              {stat.suffix && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 400,
                    color: "var(--color-text-tertiary)",
                    marginLeft: 2,
                  }}
                >
                  {stat.suffix}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                marginTop: 3,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 500,
              }}
            >
              {stat.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
