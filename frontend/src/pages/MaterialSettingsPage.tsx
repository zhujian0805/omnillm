import {
  Save as SaveIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon,
} from "@mui/icons-material"
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Switch,
  FormControlLabel,
  TextField,
  Alert,
  Paper,
} from "@mui/material"
import { useState } from "react"

interface MaterialSettingsPageProps {
  showToast: (message: string, type?: "success" | "error" | "info") => void
}

interface Settings {
  port: string
  maxTokens: string
  enableLogging: boolean
  enableCors: boolean
  apiKey: string
  rateLimit: string
}

function ServerConfigCard({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (key: string, value: string) => void
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SettingsIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">Server Configuration</Typography>
        </Box>

        <Box sx={{ display: "grid", gap: 2 }}>
          <TextField
            label="Server Port"
            value={settings.port}
            onChange={(e) => onChange("port", e.target.value)}
            type="number"
            helperText="The port number for the proxy server"
          />

          <TextField
            label="Max Tokens"
            value={settings.maxTokens}
            onChange={(e) => onChange("maxTokens", e.target.value)}
            type="number"
            helperText="Maximum tokens per request"
          />

          <TextField
            label="Rate Limit (requests/min)"
            value={settings.rateLimit}
            onChange={(e) => onChange("rateLimit", e.target.value)}
            type="number"
            helperText="Maximum requests per minute per client"
          />
        </Box>
      </CardContent>
    </Card>
  )
}

function SecurityCard({
  settings,
  onTextChange,
  onToggleChange,
}: {
  settings: Settings
  onTextChange: (key: string, value: string) => void
  onToggleChange: (key: string, value: boolean) => void
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SecurityIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">Security & API</Typography>
        </Box>

        <Box sx={{ display: "grid", gap: 2 }}>
          <TextField
            label="API Key"
            value={settings.apiKey}
            onChange={(e) => onTextChange("apiKey", e.target.value)}
            type="password"
            helperText="Optional API key for authentication"
            fullWidth
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.enableCors}
                onChange={(e) => onToggleChange("enableCors", e.target.checked)}
                color="primary"
              />
            }
            label="Enable CORS"
          />
        </Box>
      </CardContent>
    </Card>
  )
}

export function MaterialSettingsPage({ showToast }: MaterialSettingsPageProps) {
  const [settings, setSettings] = useState<Settings>({
    port: "4141",
    maxTokens: "2048",
    enableLogging: true,
    enableCors: true,
    apiKey: "",
    rateLimit: "100",
  })

  const handleSave = () => {
    showToast("Settings saved successfully!", "success")
  }

  const updateTextSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const updateToggleSetting = (key: string, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Settings
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Configure your LLM proxy settings with Material Design's clean and
        intuitive interface.
      </Typography>

      <ServerConfigCard settings={settings} onChange={updateTextSetting} />

      <SecurityCard
        settings={settings}
        onTextChange={updateTextSetting}
        onToggleChange={updateToggleSetting}
      />

      {/* System Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            System Settings
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={settings.enableLogging}
                onChange={(e) =>
                  updateToggleSetting("enableLogging", e.target.checked)
                }
                color="primary"
              />
            }
            label="Enable detailed logging"
            sx={{ mb: 2 }}
          />

          <Alert severity="info">
            Material Design makes these settings more accessible with clear
            visual feedback and intuitive controls.
          </Alert>
        </CardContent>
      </Card>

      {/* Save Actions */}
      <Paper sx={{ p: 2, display: "flex", justifyContent: "flex-end", gap: 1 }}>
        <Button variant="outlined">Reset to Defaults</Button>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
        >
          Save Settings
        </Button>
      </Paper>
    </Box>
  )
}
