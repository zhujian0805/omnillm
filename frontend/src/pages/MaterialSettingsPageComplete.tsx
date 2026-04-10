import {
  Info as InfoIcon,
  Speed as SpeedIcon,
  Api as ApiIcon,
  ContentCopy as CopyIcon,
} from "@mui/icons-material"
import {
  Box,
  Card,
  CardContent,
  Typography,
  Paper,
  Grid,
  Chip,
  Stack,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Skeleton,
  IconButton,
  Tooltip,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import { useEffect, useState } from "react"

import { getInfo, getStatus, type ServerInfo, type Status } from "@/api"

interface MaterialSettingsPageCompleteProps {
  showToast: (msg: string, type?: "success" | "error") => void
}

export { MaterialAboutPageComplete as MaterialSettingsPageComplete }

function MaterialDataRow({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <ListItem sx={{ px: 0, py: 1 }}>
      <ListItemText
        primary={
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        }
        sx={{ minWidth: 120 }}
      />
      <Typography
        variant="body2"
        fontFamily={accent ? "monospace" : "inherit"}
        fontWeight={accent ? 600 : 400}
        color={accent ? "primary.main" : "text.primary"}
      >
        {value}
      </Typography>
    </ListItem>
  )
}

function MaterialEndpointItem({
  method,
  path,
}: {
  method: string
  path: string
}) {
  const getMethodColor = (method: string) => {
    switch (method) {
      case "GET": return "success"
      case "POST": return "primary"
      case "PUT": return "warning"
      case "DELETE": return "error"
      default: return "default"
    }
  }

  return (
    <ListItem sx={{ px: 2, py: 1 }}>
      <ListItemIcon sx={{ minWidth: 64 }}>
        <Chip
          label={method}
          size="small"
          color={getMethodColor(method) as any}
          variant="filled"
          sx={{
            fontFamily: "monospace",
            fontSize: "0.6rem",
            fontWeight: 700,
            minWidth: 48,
          }}
        />
      </ListItemIcon>
      <ListItemText
        primary={
          <Typography
            variant="body2"
            fontFamily="monospace"
            color="text.secondary"
          >
            {path}
          </Typography>
        }
      />
    </ListItem>
  )
}

function MaterialCopyableField({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => void
}) {
  return (
    <Paper elevation={0} sx={{ p: 2, bgcolor: "grey.50", borderRadius: 2 }}>
      <Typography variant="caption" color="text.secondary" gutterBottom>
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            p: 1,
            bgcolor: alpha("#2196f3", 0.1),
            border: `1px solid ${alpha("#2196f3", 0.2)}`,
            borderRadius: 1,
          }}
        >
          <Typography
            variant="body2"
            fontFamily="monospace"
            color="primary.main"
            fontWeight={600}
          >
            {value}
          </Typography>
        </Paper>
        <Tooltip title="Copy to clipboard">
          <IconButton size="small" onClick={onCopy}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  )
}

export function MaterialAboutPageComplete({
  showToast,
}: MaterialAboutPageCompleteProps) {
  const [status, setStatus] = useState<Status | null>(null)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getStatus(), getInfo()])
      .then(([nextStatus, nextInfo]) => {
        setStatus(nextStatus)
        setInfo(nextInfo)
      })
      .catch((e: unknown) =>
        showToast(
          "Failed: " + (e instanceof Error ? e.message : String(e)),
          "error",
        ),
      )
      .finally(() => setLoading(false))
  }, [showToast])

  const handleCopy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text)
    showToast(`Copied ${label}!`)
  }

  if (loading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto" }}>
        <Box sx={{ mb: 4 }}>
          <Skeleton variant="text" width={200} height={40} />
          <Skeleton variant="text" width={400} height={20} />
        </Box>
        <Grid container spacing={3}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid key={i} sx={{ width: { xs: '100%', md: '50%' } }}>
              <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  }

  if (!status || !info) return null

  const port = info.port ?? 4141

  const endpoints = [
    { method: "GET", path: "/v1/models" },
    { method: "POST", path: "/v1/chat/completions" },
    { method: "POST", path: "/v1/messages" },
    { method: "POST", path: "/v1/responses" },
    { method: "POST", path: "/v1/embeddings" },
    { method: "GET", path: "/usage" },
    { method: "GET", path: "/api/admin/providers" },
    { method: "POST", path: "/api/admin/providers/switch" },
    { method: "GET", path: "/api/admin/status" },
    { method: "GET", path: "/api/admin/settings/log-level" },
    { method: "PUT", path: "/api/admin/settings/log-level" },
    { method: "GET", path: "/api/admin/logs/stream" },
  ]

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          About
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Runtime configuration and API endpoints
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Server Info */}
        <Grid sx={{ width: { xs: '100%', md: '50%' } }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <InfoIcon color="primary" />
                <Typography variant="h6">Server Info</Typography>
              </Stack>
              <List dense>
                <MaterialDataRow label="Version" value={info.version ?? "—"} accent />
                <Divider />
                <MaterialDataRow label="Port" value={`:${info.port}`} accent />
                <Divider />
                <ListItem sx={{ px: 0, py: 1, flexDirection: "column", alignItems: "stretch" }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Base URL
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                    <Paper
                      elevation={0}
                      sx={{
                        flex: 1,
                        p: 1,
                        bgcolor: alpha("#2196f3", 0.1),
                        border: `1px solid ${alpha("#2196f3", 0.2)}`,
                        borderRadius: 1,
                      }}
                    >
                      <Typography
                        variant="body2"
                        fontFamily="monospace"
                        color="primary.main"
                        fontWeight={600}
                      >
                        http://localhost:{port}
                      </Typography>
                    </Paper>
                    <Tooltip title="Copy base URL">
                      <IconButton
                        size="small"
                        onClick={() => handleCopy(`http://localhost:${port}`, "base URL")}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Runtime State */}
        <Grid sx={{ width: { xs: '100%', md: '50%' } }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <SpeedIcon color="primary" />
                <Typography variant="h6">Runtime State</Typography>
              </Stack>
              <List dense>
                <MaterialDataRow
                  label="Active Provider"
                  value={status.activeProvider?.name ?? "None"}
                />
                <Divider />
                <MaterialDataRow
                  label="Available Models"
                  value={String(status.modelCount)}
                  accent
                />
                <Divider />
                <ListItem sx={{ px: 0, py: 1 }}>
                  <ListItemText
                    primary={
                      <Typography variant="body2" color="text.secondary">
                        Manual Approve
                      </Typography>
                    }
                    sx={{ minWidth: 120 }}
                  />
                  <Chip
                    label={status.manualApprove ? "Enabled" : "Disabled"}
                    size="small"
                    color={status.manualApprove ? "success" : "default"}
                    variant={status.manualApprove ? "filled" : "outlined"}
                  />
                </ListItem>
                <Divider />
                <MaterialDataRow
                  label="Rate Limit"
                  value={
                    status.rateLimitSeconds !== null
                      ? `${status.rateLimitSeconds}s`
                      : "None"
                  }
                />
                <Divider />
                <ListItem sx={{ px: 0, py: 1 }}>
                  <ListItemText
                    primary={
                      <Typography variant="body2" color="text.secondary">
                        Rate Limit Mode
                      </Typography>
                    }
                    sx={{ minWidth: 120 }}
                  />
                  <Chip
                    label={status.rateLimitWait ? "Wait" : "Error"}
                    size="small"
                    color={status.rateLimitWait ? "success" : "warning"}
                    variant="filled"
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* API Endpoints */}
        <Grid sx={{ width: { xs: '100%', md: '50%' } }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <ApiIcon color="primary" />
                <Typography variant="h6">API Endpoints</Typography>
              </Stack>
              <Paper
                elevation={0}
                sx={{
                  bgcolor: "grey.50",
                  borderRadius: 1,
                  overflow: "hidden",
                  border: 1,
                  borderColor: "divider",
                }}
              >
                <List dense sx={{ p: 0 }}>
                  {endpoints.map((endpoint, index) => (
                    <div key={`${endpoint.method}-${endpoint.path}`}>
                      <MaterialEndpointItem
                        method={endpoint.method}
                        path={endpoint.path}
                      />
                      {index < endpoints.length - 1 && <Divider />}
                    </div>
                  ))}
                </List>
              </Paper>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Copy */}
        <Grid sx={{ width: { xs: '100%', md: '50%' } }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <CopyIcon color="primary" />
                <Typography variant="h6">Quick Copy</Typography>
              </Stack>
              <Stack spacing={2}>
                <MaterialCopyableField
                  label="OpenAI Base URL"
                  value={`http://localhost:${port}/v1`}
                  onCopy={() => handleCopy(`http://localhost:${port}/v1`, "OpenAI base URL")}
                />
                <MaterialCopyableField
                  label="Claude API Base"
                  value={`http://localhost:${port}`}
                  onCopy={() => handleCopy(`http://localhost:${port}`, "Claude API base")}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}