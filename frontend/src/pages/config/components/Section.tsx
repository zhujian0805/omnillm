import { ChevronDown, ChevronRight } from "lucide-react"
import { CSSProperties, useState } from "react"

interface SectionProps {
  title: string
  icon?: React.ElementType
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}

export function Section({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "9px 12px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-separator)",
          borderRadius: "var(--radius-md)",
          borderBottomLeftRadius: open ? 0 : "var(--radius-md)",
          borderBottomRightRadius: open ? 0 : "var(--radius-md)",
          color: "var(--color-text)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {Icon && <Icon size={13} style={{ color: "var(--color-blue)" }} />}
        {open ?
          <ChevronDown size={13} />
        : <ChevronRight size={13} />}
        {title}
        {count !== undefined && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-separator)",
              borderRadius: 999,
              padding: "0 7px",
              color: "var(--color-text-tertiary)",
            }}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            padding: 14,
            border: "1px solid var(--color-separator)",
            borderTop: "none",
            borderBottomLeftRadius: "var(--radius-md)",
            borderBottomRightRadius: "var(--radius-md)",
            background: "var(--color-bg-elevated)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
