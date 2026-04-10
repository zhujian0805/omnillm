import {
  Error as ErrorIcon,
  Terminal as TerminalIcon,
  Clear as ClearIcon,
  ContentCopy as CopyIcon,
  VerticalAlignTop as TopIcon,
  VerticalAlignBottom as BottomIcon,
  FiberManualRecord as DotIcon,
} from "@mui/icons-material"
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Stack,
  Skeleton,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  LinearProgress,
  Switch,
  FormControlLabel,
} from "@mui/material"
import { alpha, type Theme } from "@mui/material/styles"
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  getLogLevel,
  subscribeToLogs,
  updateLogLevel,
  type LogLevel,
} from "@/api"
import { parseLogLine } from "@/lib/logs"

interface MaterialLoggingPageProps {
  showToast: (msg: string, type?: "success" | "error") => void
}

const LOG_LEVELS = [
  { value: "trace", label: "Trace" },
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
  { value: "fatal", label: "Fatal" },
] as const

const MAX_LINES = 500

function getLogTone(level: number): {
  resolveAccent: (theme: Theme) => string
} {
  switch (level) {
    case 0:
    case 1: {
      return {
        resolveAccent: (theme) => theme.palette.error.main,
      }
    }
    case 2: {
      return {
        resolveAccent: (theme) => theme.palette.warning.main,
      }
    }
    case 3: {
      return {
        resolveAccent: (theme) => theme.palette.primary.main,
      }
    }
    case 4: {
      return {
        resolveAccent: (theme) => theme.palette.success.main,
      }
    }
    default: {
      return {
        resolveAccent: (theme) => theme.palette.text.secondary,
      }
    }
  }
}

function MaterialConnectionStatus({
  connected,
  connecting,
}: {
  connected: boolean
  connecting: boolean
}) {
  let color: "success" | "warning" | "error" = "error"
  let label = "Retrying"

  if (connecting) {
    color = "warning"
    label = "Connecting"
  } else if (connected) {
    color = "success"
    label = "Live"
  }

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <DotIcon
        sx={{
          fontSize: 12,
          color: `${color}.main`,
          animation: connecting ? "pulse 2s infinite" : "none",
        }}
      />
      <Typography variant="caption" color={`${color}.main`} fontWeight={500}>
        {label}
      </Typography>
    </Stack>
  )
}

function MaterialLogLine({ line }: { line: string }) {
  const parsed = parseLogLine(line)
  const logTone = getLogTone(parsed.levelNumber)

  const segments: Array<ReactNode> = []

  if (parsed.timestamp) {
    segments.push(
      <Typography
        key="timestamp"
        variant="caption"
        color="text.secondary"
        fontFamily="monospace"
        sx={{ fontSize: "0.68rem" }}
      >
        {parsed.timestamp}
      </Typography>,
    )
  }

  if (parsed.source) {
    segments.push(
      <Typography
        key="source"
        variant="caption"
        fontFamily="monospace"
        sx={(theme) => ({
          fontSize: "0.68rem",
          fontWeight: 700,
          color: logTone.resolveAccent(theme),
        })}
      >
        {parsed.source}
      </Typography>,
    )
  }

  segments.push(
    <Typography
      key="level"
      variant="caption"
      fontFamily="monospace"
      sx={(theme) => ({
        fontSize: "0.68rem",
        fontWeight: 700,
        color: logTone.resolveAccent(theme),
      })}
    >
      {parsed.level}
    </Typography>,
  )

  segments.push(
    <Typography
      key="message"
      variant="body2"
      fontFamily="monospace"
      sx={{
        fontSize: "0.76rem",
        fontWeight: 600,
        lineHeight: 1.45,
        color: "text.primary",
      }}
    >
      {parsed.message}
    </Typography>,
  )

  if (parsed.location) {
    segments.push(
      <Typography
        key="location"
        variant="caption"
        color="text.secondary"
        fontFamily="monospace"
        sx={{ fontSize: "0.68rem" }}
      >
        location={parsed.location}
      </Typography>,
    )
  }

  for (const field of parsed.fields) {
    segments.push(
      <Typography
        key={`${field.key}-${field.value}`}
        variant="caption"
        fontFamily="monospace"
        sx={{ fontSize: "0.68rem", color: "text.secondary" }}
      >
        <Box component="span" sx={{ color: "text.disabled" }}>
          {field.key}=
        </Box>
        <Box component="span" sx={{ color: "text.primary" }}>
          {field.value}
        </Box>
      </Typography>,
    )
  }

  return (
    <Box
      sx={(theme) => {
        const accentColor = logTone.resolveAccent(theme)

        return {
          p: 1.5,
          borderLeft: 3,
          borderColor: accentColor,
          bgcolor: alpha(accentColor, 0.02),
          transition: "all 0.2s ease",
          overflowX: "auto",
          "&:hover": {
            bgcolor: alpha(accentColor, 0.05),
          },
        }
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        useFlexGap
        flexWrap="wrap"
      >
        {segments.map((segment, index) => (
          <Fragment key={`${parsed.raw}-${index}`}>
            {index > 0 && (
              <Typography
                variant="caption"
                color="text.disabled"
                fontFamily="monospace"
                sx={{ fontSize: "0.68rem" }}
              >
                |
              </Typography>
            )}
            {segment}
          </Fragment>
        ))}
      </Stack>
    </Box>
  )
}

export function MaterialLoggingPageComplete({
  showToast,
}: MaterialLoggingPageProps) {
  const [lines, setLines] = useState<Array<string>>([])
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [logLevel, setLogLevelState] = useState<LogLevel | null>(null)
  const logViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getLogLevel()
      .then((result) => setLogLevelState(result.level))
      .catch((e: unknown) =>
        showToast(
          "Failed to load log level: "
            + (e instanceof Error ? e.message : String(e)),
          "error",
        ),
      )
  }, [showToast])

  useEffect(() => {
    let es: EventSource | null = null

    const setupLogStream = async () => {
      try {
        es = await subscribeToLogs((line) => {
          setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line])
          setConnected(true)
          setConnecting(false)
        })

        es.addEventListener("open", () => {
          setConnected(true)
          setConnecting(false)
        })

        es.addEventListener("error", (e) => {
          console.error("EventSource error:", e)
          setConnected(false)
          setConnecting(false)
        })
      } catch (error) {
        console.error("Failed to setup log stream:", error)
        setConnected(false)
        setConnecting(false)
        showToast(
          "Failed to connect to log stream: "
            + (error instanceof Error ? error.message : String(error)),
          "error",
        )
      }
    }

    void setupLogStream()

    return () => {
      if (es) {
        es.close()
      }
    }
  }, [showToast])

  useEffect(() => {
    if (!autoScroll) return
    const viewport = logViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [autoScroll, lines])

  const scrollToTop = () => {
    const viewport = logViewportRef.current
    if (viewport) {
      viewport.scrollTop = 0
      setAutoScroll(false)
    }
  }

  const scrollToBottom = () => {
    const viewport = logViewportRef.current
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      setAutoScroll(true)
    }
  }

  const clearLogs = () => {
    setLines([])
    showToast("Cleared visible log buffer")
  }

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      showToast("Copied visible logs")
    } catch (e) {
      showToast(
        "Copy failed: " + (e instanceof Error ? e.message : String(e)),
        "error",
      )
    }
  }

  const handleLogLevelChange = async (newLevel: LogLevel) => {
    try {
      await updateLogLevel(newLevel)
      setLogLevelState(newLevel)
      const levelLabel = LOG_LEVELS.find((l) => l.value === newLevel)?.label
      showToast(`Log level changed to ${levelLabel}`)
    } catch (error) {
      showToast(
        `Failed to update log level: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      )
    }
  }

  if (connecting && lines.length === 0) {
    return (
      <Box sx={{ maxWidth: 1400, mx: "auto" }}>
        <Box sx={{ mb: 4 }}>
          <Skeleton variant="text" width={200} height={40} />
          <Skeleton variant="text" width={400} height={20} />
        </Box>
        <Skeleton variant="rectangular" height={600} sx={{ borderRadius: 2 }} />
      </Box>
    )
  }

  let streamStatusLabel = `Showing latest ${lines.length} lines`

  if (lines.length === 0) {
    streamStatusLabel =
      connecting ? "Connecting to stream..." : "No logs received yet"
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 2,
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              Logging
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Live proxy output. Real-time streaming of all application logs.
            </Typography>
          </Box>

          {/* Controls */}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  size="small"
                />
              }
              label="Auto-scroll"
            />
            <Tooltip title="Scroll to top">
              <IconButton
                size="small"
                onClick={scrollToTop}
                disabled={lines.length === 0}
              >
                <TopIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Scroll to bottom">
              <IconButton
                size="small"
                onClick={scrollToBottom}
                disabled={lines.length === 0}
              >
                <BottomIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ClearIcon />}
              onClick={clearLogs}
            >
              Clear
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CopyIcon />}
              onClick={copyLogs}
              disabled={lines.length === 0}
            >
              Copy
            </Button>
          </Stack>
        </Box>
      </Box>

      {/* Stream Status & Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3} alignItems="center">
            <Grid>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Connection
                </Typography>
                <MaterialConnectionStatus
                  connected={connected}
                  connecting={connecting}
                />
              </Stack>
            </Grid>
            <Grid>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Buffer
                </Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {lines.length} / {MAX_LINES}
                </Typography>
              </Stack>
            </Grid>
            <Grid>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Log Level</InputLabel>
                <Select
                  value={logLevel ?? "info"}
                  label="Log Level"
                  onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
                >
                  {LOG_LEVELS.map((level) => (
                    <MenuItem key={level.value} value={level.value}>
                      {level.value} - {level.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid sx={{ flex: 1 }}>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Stream Endpoint
                </Typography>
                <Typography
                  variant="body2"
                  fontFamily="monospace"
                  color="text.secondary"
                >
                  /api/admin/logs/stream
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Log Output */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          {/* Header bar */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: "grey.50",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Stack direction="row" alignItems="center" spacing={2}>
              <TerminalIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Live Output</Typography>
              <MaterialConnectionStatus
                connected={connected}
                connecting={connecting}
              />
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              fontFamily="monospace"
            >
              {streamStatusLabel}
            </Typography>
          </Box>

          {/* Log content */}
          <Box
            ref={logViewportRef}
            sx={{
              height: "60vh",
              maxHeight: 800,
              overflow: "auto",
              bgcolor: "background.default",
            }}
          >
            {lines.length === 0 ?
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  p: 4,
                  textAlign: "center",
                }}
              >
                {connecting ?
                  <Stack alignItems="center" spacing={2}>
                    <LinearProgress sx={{ width: 200 }} />
                    <Typography variant="body2" color="text.secondary">
                      Connecting to log stream...
                    </Typography>
                  </Stack>
                : <Stack alignItems="center" spacing={2}>
                    <ErrorIcon
                      sx={{
                        fontSize: 48,
                        color: "text.secondary",
                        opacity: 0.5,
                      }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      No log lines received yet.
                    </Typography>
                  </Stack>
                }
              </Box>
            : <Stack>
                {lines.map((line, index) => (
                  <MaterialLogLine key={`${index}-${line}`} line={line} />
                ))}
              </Stack>
            }
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
