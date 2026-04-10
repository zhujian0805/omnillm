import {
  Download as DownloadIcon,
  Clear as ClearIcon,
  Info as InfoIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from "@mui/icons-material"
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from "@mui/material"
import { useState } from "react"

interface MaterialLoggingPageProps {
  showToast: (message: string, type?: "success" | "error" | "info") => void
}

interface LogEntry {
  id: number
  timestamp: string
  level: "info" | "warning" | "error"
  message: string
  source: string
}

function LogStats({ logs }: { logs: Array<LogEntry> }) {
  return (
    <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Typography variant="h6" color="info.main">
            {logs.filter((log) => log.level === "info").length}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Info Messages
          </Typography>
        </CardContent>
      </Card>
      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Typography variant="h6" color="warning.main">
            {logs.filter((log) => log.level === "warning").length}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Warnings
          </Typography>
        </CardContent>
      </Card>
      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Typography variant="h6" color="error.main">
            {logs.filter((log) => log.level === "error").length}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Errors
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}

function LogControls({
  logCount,
  onDownload,
  onClear,
}: {
  logCount: number
  onDownload: () => void
  onClear: () => void
}) {
  return (
    <Paper
      sx={{
        p: 2,
        mb: 3,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <Box>
        <Typography variant="h6">Log Management</Typography>
        <Typography variant="body2" color="text.secondary">
          {logCount} log entries
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={onDownload}
        >
          Download
        </Button>
        <Button
          variant="outlined"
          startIcon={<ClearIcon />}
          onClick={onClear}
          color="error"
        >
          Clear Logs
        </Button>
      </Box>
    </Paper>
  )
}

export function MaterialLoggingPage({ showToast }: MaterialLoggingPageProps) {
  const [logs] = useState<Array<LogEntry>>([
    {
      id: 1,
      timestamp: "2026-04-07 22:03:22",
      level: "info",
      message: "Proxy server started on port 4141",
      source: "server",
    },
    {
      id: 2,
      timestamp: "2026-04-07 22:03:25",
      level: "info",
      message: "OpenAI provider initialized successfully",
      source: "provider",
    },
    {
      id: 3,
      timestamp: "2026-04-07 22:04:12",
      level: "warning",
      message: "Rate limit approaching for client 192.168.1.100",
      source: "rate-limiter",
    },
    {
      id: 4,
      timestamp: "2026-04-07 22:05:01",
      level: "error",
      message: "Failed to connect to Claude API - timeout after 30s",
      source: "provider",
    },
    {
      id: 5,
      timestamp: "2026-04-07 22:05:15",
      level: "info",
      message: "Request processed successfully - 245 tokens",
      source: "request",
    },
  ])

  const getLogIcon = (level: LogEntry["level"]) => {
    switch (level) {
      case "info": {
        return <InfoIcon color="info" />
      }
      case "warning": {
        return <WarningIcon color="warning" />
      }
      case "error": {
        return <ErrorIcon color="error" />
      }
      default: {
        return <InfoIcon />
      }
    }
  }

  const getLogColor = (
    level: LogEntry["level"],
  ): "info" | "warning" | "error" | "default" => {
    switch (level) {
      case "info": {
        return "info"
      }
      case "warning": {
        return "warning"
      }
      case "error": {
        return "error"
      }
      default: {
        return "default"
      }
    }
  }

  const downloadLogs = () => {
    showToast("Logs downloaded successfully!", "success")
  }

  const clearLogs = () => {
    showToast("Logs cleared!", "info")
  }

  return (
    <Box sx={{ maxWidth: 900, mx: "auto" }}>
      <Typography variant="h4" component="h1" gutterBottom>
        System Logs
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Monitor your LLM proxy activity with Material Design's clear and
        organized logging interface.
      </Typography>

      <LogControls
        logCount={logs.length}
        onDownload={downloadLogs}
        onClear={clearLogs}
      />

      <LogStats logs={logs} />

      {/* Log Entries */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          <List>
            {logs.map((log, index) => (
              <Box key={log.id}>
                <ListItem>
                  <ListItemIcon>{getLogIcon(log.level)}</ListItemIcon>
                  <ListItemText
                    primary={
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Typography variant="body1">{log.message}</Typography>
                        <Chip
                          label={log.level.toUpperCase()}
                          size="small"
                          color={getLogColor(log.level)}
                          variant="outlined"
                        />
                        <Chip
                          label={log.source}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    }
                    secondary={log.timestamp}
                  />
                </ListItem>
                {index < logs.length - 1 && (
                  <Box sx={{ mx: 2 }}>
                    <Alert severity="info" sx={{ opacity: 0.1, height: 1 }} />
                  </Box>
                )}
              </Box>
            ))}
          </List>
        </CardContent>
      </Card>

      <Alert severity="info" sx={{ mt: 3 }}>
        Material Design makes log monitoring more intuitive with clear visual
        hierarchy, color coding, and smooth interactions.
      </Alert>
    </Box>
  )
}
