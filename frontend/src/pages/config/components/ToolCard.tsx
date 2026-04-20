import { FileJson, FileText } from "lucide-react"
import type { ConfigFileEntry } from "../types"

interface ToolCardProps {
  entry: ConfigFileEntry
  isActive: boolean
  onClick: () => void
}

// Map config names to their actual file paths
const configPaths: Record<string, string> = {
  "claude-code": "~/.claude/settings.json",
  "codex": "~/.codex/config.toml",
  "droid": "~/.factory/settings.json",
  "opencode": "~/.opencode/config.json",
  "amp": "~/.amp/config.json",
}

export function ToolCard({
  entry,
  isActive,
  onClick,
}: ToolCardProps) {
  const Icon = entry.language === "json" ? FileJson : FileText
  const desc = configPaths[entry.name] || (
    entry.language === "json" ? "~/.config/settings.json" : "~/.config/config.toml"
  )

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 16px",
        borderRadius: "var(--radius-lg)",
        border:
          isActive ?
            "2px solid var(--color-blue)"
          : "1px solid var(--color-separator)",
        background:
          isActive ? "var(--color-blue-fill)" : "var(--color-bg-elevated)",
        boxShadow:
          isActive ? "0 0 0 3px rgba(56,189,248,0.12)" : "var(--shadow-card)",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s var(--ease)",
        minHeight: 100,
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = "var(--color-blue)"
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(56,189,248,0.08)"
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = "var(--color-separator)"
          e.currentTarget.style.boxShadow = "var(--shadow-card)"
        }
      }}
    >
      {/* Header with icon and title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "var(--radius-md)",
            background:
              isActive ? "var(--color-blue)" : "var(--color-surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 0.2s ease",
          }}
        >
          <Icon
            size={16}
            color={isActive ? "white" : "var(--color-text-secondary)"}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: isActive ? "var(--color-blue)" : "var(--color-text)",
              letterSpacing: "-0.01em",
              marginBottom: 3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {entry.label}
          </div>
          <div
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-tertiary)",
              wordBreak: "break-all",
              lineHeight: 1.3,
            }}
          >
            {desc}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
        <span
          style={{
            fontSize: 9,
            padding: "2px 6px",
            borderRadius: 999,
            background:
              entry.exists ?
                "rgba(74, 222, 128, 0.12)"
              : "var(--color-surface-2)",
            color:
              entry.exists ? "var(--color-green)" : (
                "var(--color-text-tertiary)"
              ),
            fontWeight: 600,
            border: `1px solid ${entry.exists ? "rgba(74,222,128,0.3)" : "var(--color-separator)"}`,
          }}
        >
          {entry.exists ? "● exists" : "○ new"}
        </span>
        <span
          style={{
            fontSize: 9,
            padding: "2px 6px",
            borderRadius: 999,
            background: "var(--color-surface-2)",
            color: "var(--color-text-tertiary)",
            border: "1px solid var(--color-separator)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {entry.language}
        </span>
      </div>
    </button>
  )
}
