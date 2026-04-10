import { Settings as SettingsIcon, Save as SaveIcon } from "@mui/icons-material"
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
} from "@mui/material"
import { useState } from "react"

interface MaterialExampleCardProps {
  title: string
  description: string
  onSave?: (data: { name: string; enabled: boolean }) => void
}

export function MaterialExampleCard({
  title,
  description,
  onSave,
}: MaterialExampleCardProps) {
  const [name, setName] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const handleSave = () => {
    onSave?.({ name, enabled })
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), 3000)
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SettingsIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {description}
        </Typography>

        {showSuccess && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Settings saved successfully!
          </Alert>
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            label="Configuration Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
          />

          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                color="primary"
              />
            }
            label="Enable this feature"
          />

          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={!name.trim()}
            sx={{ alignSelf: "flex-start" }}
          >
            Save Configuration
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
