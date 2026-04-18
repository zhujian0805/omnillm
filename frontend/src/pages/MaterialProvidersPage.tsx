import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
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
  Chip,
  IconButton,
} from "@mui/material"
import { useState } from "react"

interface Provider {
  id: number
  name: string
  enabled: boolean
  type: string
}

interface MaterialProvidersPageProps {
  showToast: (message: string, type?: "success" | "error" | "info") => void
}

function ProviderCard({
  provider,
  onToggle,
}: {
  provider: Provider
  onToggle: (id: number) => void
}) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" component="h2">
              {provider.name}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Chip
                label={provider.type}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Chip
                label={provider.enabled ? "Active" : "Inactive"}
                size="small"
                color={provider.enabled ? "success" : "default"}
                variant={provider.enabled ? "filled" : "outlined"}
              />
            </Box>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={provider.enabled}
                  onChange={() => onToggle(provider.id)}
                  color="primary"
                />
              }
              label=""
            />
            <IconButton size="small" color="primary">
              <EditIcon />
            </IconButton>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

function AddProviderForm({
  show,
  onAdd,
  onCancel,
  value,
  onChange,
}: {
  show: boolean
  onAdd: () => void
  onCancel: () => void
  value: string
  onChange: (value: string) => void
}) {
  if (!show) return null

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Add New Provider
        </Typography>
        <TextField
          fullWidth
          label="Provider Name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          sx={{ mb: 2 }}
          autoFocus
        />
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" onClick={onAdd}>
            Add Provider
          </Button>
          <Button variant="outlined" onClick={onCancel}>
            Cancel
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}

export function MaterialProvidersPage({
  showToast,
}: MaterialProvidersPageProps) {
  const [providers, setProviders] = useState<Array<Provider>>([
    { id: 1, name: "OpenAI GPT-4", enabled: true, type: "OpenAI Compatible" },
    { id: 2, name: "Qwen 3.6 Plus", enabled: true, type: "Alibaba DashScope" },
    { id: 3, name: "Llama 2", enabled: false, type: "Local" },
  ])

  const [showAddForm, setShowAddForm] = useState(false)
  const [newProviderName, setNewProviderName] = useState("")

  const toggleProvider = (id: number) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    )
    showToast("Provider status updated", "success")
  }

  const addProvider = () => {
    if (newProviderName.trim()) {
      setProviders((prev) => [
        ...prev,
        {
          id: Date.now(),
          name: newProviderName,
          enabled: false,
          type: "Custom",
        },
      ])
      setNewProviderName("")
      setShowAddForm(false)
      showToast("Provider added successfully", "success")
    }
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      <Typography variant="h4" component="h1" gutterBottom>
        LLM Providers
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Configure and manage your language model providers with beautiful
        Material Design.
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Material Design makes managing providers more intuitive with clear
        visual hierarchy and smooth interactions.
      </Alert>

      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          onToggle={toggleProvider}
        />
      ))}

      <AddProviderForm
        show={showAddForm}
        onAdd={addProvider}
        onCancel={() => setShowAddForm(false)}
        value={newProviderName}
        onChange={setNewProviderName}
      />

      {!showAddForm && (
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setShowAddForm(true)}
          sx={{ mt: 3 }}
        >
          Add New Provider
        </Button>
      )}
    </Box>
  )
}
