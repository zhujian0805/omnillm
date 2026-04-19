import { useState } from "react"

import type { Provider } from "@/api"
import { PROVIDER_ICONS, TYPE_NAMES } from "@/pages/providers/constants/providerRegistry"

export function GroupHeader({
  providerType,
  typeProviders,
  isCollapsed,
  accent,
  onToggle,
}: {
  providerType: string
  typeProviders: Provider[]
  isCollapsed: boolean
  accent: string
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const clickable = typeProviders.length > 0
  const activeCount = typeProviders.filter((p) => p.isActive).length

  return (
    <div
      onClick={clickable ? onToggle : undefined}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: isCollapsed ? 0 : 12,
        cursor: clickable ? "pointer" : "default",
        userSelect: "none",
        ...(isCollapsed
          ? {
              background: hovered
                ? "color-mix(in srgb, var(--color-bg-elevated) 90%, var(--color-text))"
                : "var(--color-bg-elevated)",
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${hovered ? `${accent}40` : "var(--color-separator)"}`,
              boxShadow: hovered
                ? "var(--shadow-card), 0 0 0 1px rgba(48,209,88,0.15)"
                : "var(--shadow-card)",
              padding: "14px 18px",
              transition: "all 0.2s var(--ease)",
            }
          : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            background: `${accent}18`,
            border: `1px solid ${accent}28`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
          }}
        >
          {PROVIDER_ICONS[providerType] ?? <span style={{ fontSize: 14 }}>◌</span>}
        </div>
        <div>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 15,
              color: "var(--color-text)",
              letterSpacing: "-0.01em",
            }}
          >
            {TYPE_NAMES[providerType] ?? providerType}
          </span>
          {typeProviders.length > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                fontWeight: 400,
              }}
            >
              {typeProviders.length} {typeProviders.length === 1 ? "account" : "accounts"}
            </span>
          )}
          {isCollapsed && activeCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-success)",
                background: "rgba(48, 209, 88, 0.12)",
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {activeCount} active
            </span>
          )}
        </div>
      </div>
      {isCollapsed && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-tertiary)" }}>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}
