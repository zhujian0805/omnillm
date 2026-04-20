import { CSSProperties } from "react"

interface FieldProps {
  label: string
  children: React.ReactNode
  labelWidth?: number
}

export function Field({
  label,
  children,
  labelWidth = 160,
}: FieldProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        marginBottom: 10,
      }}
    >
      <label
        style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          minWidth: labelWidth,
          flexShrink: 0,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export const inputStyle: CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-separator)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
}

export const smallInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "4px 8px",
  fontSize: 11,
  background: "var(--color-bg-elevated)",
}
