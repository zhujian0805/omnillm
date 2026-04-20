
    result.push(line)
  }

  return result.join("\n")
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
}: {
  title: string
  icon?: React.ElementType
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
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

// ─── Field row ───────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  labelWidth = 160,
}: {
  label: string
  children: React.ReactNode
  labelWidth?: number
}) {
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

const inputStyle: CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-separator)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
}

const smallInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "4px 8px",
  fontSize: 11,
  background: "var(--color-bg-elevated)",
}

// ─── Claude Code Editor ───────────────────────────────────────────────────────

function ClaudeCodeEditor({
  settings,
  onChange,
}: {
  settings: ClaudeCodeSettings
  onChange: (s: ClaudeCodeSettings) => void
}) {
  const envEntries = Object.entries(settings.env ?? {})
  const pluginEntries = Object.entries(settings.enabledPlugins ?? {})

  const setEnvKey = (oldKey: string, newKey: string) => {
    const env = { ...settings.env }
    const val = env[oldKey]
    delete env[oldKey]
    env[newKey] = val
    onChange({ ...settings, env })
  }

  const setEnvVal = (key: string, val: string) => {
    onChange({ ...settings, env: { ...settings.env, [key]: val } })
  }

  const deleteEnv = (key: string) => {
    const env = { ...settings.env }
    delete env[key]
    onChange({ ...settings, env })
  }

  return (
    <div>
      {/* Model */}
      <Section title="Default Model" icon={Settings2}>
        <Field label="Model">
          <input
            value={settings.model ?? ""}
            onChange={(e) => onChange({ ...settings, model: e.target.value })}
            style={inputStyle}
            placeholder="e.g. claude-opus-4-5"
          />
        </Field>
        <Field label="Auto Updates Channel">
          <input
            value={settings.autoUpdatesChannel ?? ""}
            onChange={(e) =>
              onChange({ ...settings, autoUpdatesChannel: e.target.value })
            }
            style={inputStyle}
            placeholder="latest"
          />
        </Field>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--color-text-secondary)",
