import consola, { type ConsolaOptions } from "consola"
import fs from "node:fs"
import path from "node:path"

// ─── Source location utilities ───────────────────────────────────────────────

interface CallerInfo {
  file: string
  function: string
  line: number
  column: number
}

function getCallerInfo(skipFrames: number = 2): CallerInfo | null {
  const originalPrepareStackTrace = Error.prepareStackTrace
  try {
    Error.prepareStackTrace = (_, stack) => stack
    const stack = new Error().stack as unknown as NodeJS.CallSite[]

    if (!stack || stack.length <= skipFrames) {
      return null
    }

    // Look for the first frame that's not from logging libraries
    for (let i = skipFrames; i < Math.min(stack.length, skipFrames + 10); i++) {
      const caller = stack[i]
      if (!caller) continue

      const fileName = caller.getFileName()
      if (!fileName) continue

      // Skip frames from logging libraries and node_modules
      if (
        fileName.includes('node_modules/consola/') ||
        fileName.includes('node_modules\\consola\\') ||
        fileName.endsWith('/logging.ts') ||
        fileName.endsWith('\\logging.ts')
      ) {
        continue
      }

      const functionName = caller.getFunctionName() || caller.getMethodName() || '<anonymous>'
      const lineNumber = caller.getLineNumber() || 0
      const columnNumber = caller.getColumnNumber() || 0

      // Get relative path from project root
      const projectRoot = process.cwd()
      const relativePath = path.relative(projectRoot, fileName).replace(/\\/g, '/')

      return {
        file: relativePath,
        function: functionName,
        line: lineNumber,
        column: columnNumber
      }
    }

    // Fallback to the original skipFrames if no suitable frame found
    const caller = stack[skipFrames]
    if (!caller) return null

    const fileName = caller.getFileName()
    const functionName = caller.getFunctionName() || caller.getMethodName() || '<anonymous>'
    const lineNumber = caller.getLineNumber() || 0
    const columnNumber = caller.getColumnNumber() || 0

    if (!fileName) return null

    // Get relative path from project root
    const projectRoot = process.cwd()
    const relativePath = path.relative(projectRoot, fileName).replace(/\\/g, '/')

    return {
      file: relativePath,
      function: functionName,
      line: lineNumber,
      column: columnNumber
    }
  } catch {
    return null
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace
  }
}

function formatCallerInfo(caller: CallerInfo): string {
  return `[${caller.file}:${caller.line} in ${caller.function}()]`
}

const LOG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".local",
  "share",
  "omnimodel",
  "logs",
)

// ─── Live log broadcaster ────────────────────────────────────────────────────

const logSubscribers = new Set<(line: string) => void>()

export function subscribeToLogs(cb: (line: string) => void): void {
  logSubscribers.add(cb)
}

export function unsubscribeFromLogs(cb: (line: string) => void): void {
  logSubscribers.delete(cb)
}

function broadcastLogLine(line: string): void {
  for (const cb of logSubscribers) {
    try {
      cb(line)
    } catch {
      // Silent error handling to avoid infinite loops
    }
  }
}

// ─── Log level control ───────────────────────────────────────────────────────
// Log levels: 0: fatal, 1: error, 2: warn, 3: info (default), 4: debug, 5: trace

// The live level — mutated by setLogLevel at runtime
let currentLogLevel =
  process.env.LOG_LEVEL ? Number.parseInt(process.env.LOG_LEVEL) : 3

export function getLogLevel(): number {
  return currentLogLevel
}

export function setLogLevel(level: number): void {
  currentLogLevel = level
  consola.level = level
  // Persist to DB (best-effort — DB may not be ready on early startup calls)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
    const { ConfigStore } = require("./database") as typeof import("./database")
    ConfigStore.set("log_level", String(level))
  } catch {
    // ignore
  }
}

// ─── Comprehensive console interception ──────────────────────────────────────

interface OriginalConsole {
  log: typeof console.log
  info: typeof console.info
  warn: typeof console.warn
  error: typeof console.error
  debug: typeof console.debug
  trace: typeof console.trace
}

let originalConsole: OriginalConsole | null = null

function interceptAllConsoleOutput(): void {
  if (originalConsole) return // Already intercepted

  // Store original console methods
  originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    trace: console.trace.bind(console),
  }

  // Override console methods to capture ALL output
  console.log = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-3] INFO${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.log(message)
    broadcastLogLine(message)
  }

  console.info = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-3] INFO${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.info(message)
    broadcastLogLine(message)
  }

  console.warn = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-2] WARN${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.warn(message)
    broadcastLogLine(message)
  }

  console.error = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-1] ERROR${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.error(message)
    broadcastLogLine(message)
  }

  console.debug = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-4] DEBUG${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.debug(message)
    broadcastLogLine(message)
  }

  console.trace = (...args: Array<unknown>) => {
    const caller = getCallerInfo(3)
    const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
    const timestamp = new Date().toISOString()
    const message = `[${timestamp}] [LOG-5] TRACE${callerStr}: ${args.join(" ")}`

    // Send enhanced format to console AND file
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    originalConsole!.trace(message)
    broadcastLogLine(message)
  }
}

// ─── File logging setup ──────────────────────────────────────────────────────

export function setupFileLogging(): void {
  // Intercept all console output first
  interceptAllConsoleOutput()

  // Create logs directory if it doesn't exist
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  } catch (error) {
    originalConsole?.warn("Failed to create logs directory:", error)
  }

  // Generate log filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-")
  const logFile = path.join(LOG_DIR, `proxy-${timestamp}.log`)
  const errorLogFile = path.join(LOG_DIR, `proxy-errors-${timestamp}.log`)

  // Create write streams
  const logStream = fs.createWriteStream(logFile, { flags: "a" })
  const errorStream = fs.createWriteStream(errorLogFile, { flags: "a" })

  // Enhanced console reporter that shows source location
  const enhancedConsoleReporter = {
    log: (logObj: ConsolaOptions & { level: number; args: Array<unknown> }) => {
      const timestamp = new Date().toISOString()
      const caller = getCallerInfo(6) // Skip consola internals

      // Fix level mapping - consola uses different level numbers
      let level: string
      let levelNum: number
      switch (logObj.level) {
        case 0: {
          level = "FATAL"
          levelNum = 0
          break
        }
        case 1: {
          level = "ERROR"
          levelNum = 1
          break
        }
        case 2: {
          level = "WARN"
          levelNum = 2
          break
        }
        case 3: {
          level = "INFO"
          levelNum = 3
          break
        }
        case 4: {
          level = "DEBUG"
          levelNum = 4
          break
        }
        case 5: {
          level = "TRACE"
          levelNum = 5
          break
        }
        default: {
          level = "DEBUG"
          levelNum = 4
        }
      }

      const messageText = logObj.args.join(" ")

      // Filter out verbose debug messages from CONSOLE output (but keep in files)
      const isVerboseDebug =
        // ALL DEBUG level messages are filtered from console by default
        logObj.level >= 4 ||
        // Specific verbose patterns that are always filtered
        (messageText.includes("[Azure OpenAI]") && messageText.includes("Raw responses API response:")) ||
        messageText.includes("Raw response:") ||
        messageText.includes("Raw completion response:") ||
        // Any message with formatted JSON (JSON.stringify with null, 2)
        (messageText.includes('{\n  ') || messageText.includes('\n    ') || messageText.length > 1000) ||
        // MCP tool schema logging
        (messageText.includes('"type": "function"') && messageText.includes('"description":') && messageText.includes('"parameters":')) ||
        messageText.includes("mcp__plugin_") ||
        // Other large verbose patterns
        (messageText.includes('"name":') && messageText.includes('"parameters":') && messageText.length > 300)

      // Skip verbose debug messages in console output (they'll still go to files via fileReporter)
      if (isVerboseDebug) {
        return
      }

      // Also respect current log level for console output
      if (logObj.level > currentLogLevel) {
        return
      }

      const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
      const message = `[${timestamp}] [LOG-${levelNum}] ${level}${callerStr}: ${messageText}`

      // Send enhanced format to console
      if (logObj.level <= 1) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        originalConsole!.error(message)
      } else if (logObj.level === 2) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        originalConsole!.warn(message)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        originalConsole!.log(message)
      }
    },
  }

  // Configure consola for file logging (as backup)
  const fileReporter = {
    log: (logObj: ConsolaOptions & { level: number; args: Array<unknown> }) => {
      const timestamp = new Date().toISOString()
      const caller = getCallerInfo(6) // Increased skip count to bypass consola internals

      // Fix level mapping - consola uses different level numbers
      // Consola levels: 0: fatal, 1: error, 2: warn, 3: info, 4: debug, 5: trace
      let level: string
      let levelNum: number
      switch (logObj.level) {
        case 0: {
          level = "FATAL"
          levelNum = 0

          break
        }
        case 1: {
          level = "ERROR"
          levelNum = 1

          break
        }
        case 2: {
          level = "WARN"
          levelNum = 2

          break
        }
        case 3: {
          level = "INFO"
          levelNum = 3

          break
        }
        case 4: {
          level = "DEBUG"
          levelNum = 4

          break
        }
        case 5: {
          level = "TRACE"
          levelNum = 5

          break
        }
        default: {
          level = "DEBUG"
          levelNum = 4
        }
      }

      // Filter out verbose MCP tool schema logging and function payloads
      const messageText = logObj.args.join(" ")
      const isVerboseToolSchema =
        (messageText.includes('"type": "function"')
          && messageText.includes('"description":')
          && messageText.includes('"parameters":'))
        || messageText.includes("mcp__plugin_")
        || (messageText.includes('"name":')
          && messageText.includes('"parameters":')
          && messageText.length > 500) // Catch other verbose function schemas

      // Skip verbose tool schema logging unless in debug (4) or trace (5) mode
      if (isVerboseToolSchema && currentLogLevel < 4) {
        return
      }

      const callerStr = caller ? ` ${formatCallerInfo(caller)}` : ''
      const message = `[${timestamp}] [LOG-${levelNum}] ${level}${callerStr}: ${messageText}`

      // Write to main log
      logStream.write(`${message}\n`)

      // Also write errors to separate error log (fatal, error, warn)
      if (logObj.level <= 2) {
        errorStream.write(`${message}\n`)
      }

      // Broadcast to live subscribers (backup for consola logs)
      broadcastLogLine(message)
    },
  }

  // Configure consola
  const options: ConsolaOptions = {
    level: currentLogLevel,
    reporters: [
      enhancedConsoleReporter,  // Use our enhanced console reporter instead of default
      fileReporter,
    ],
  }

  consola.wrapConsole()
  Object.assign(consola.options, options)
  consola.level = currentLogLevel

  // Log startup message
  console.info(`📝 Logging to files:`)
  console.info(`📋 Main log: ${logFile}`)
  console.info(`🚨 Error log: ${errorLogFile}`)
  console.info(
    `🔧 Log level set to ${currentLogLevel} - ALL console output will be streamed`,
  )

  // Add a delayed test

  setTimeout(() => {
    console.info(
      `🚀 Console interception active - broadcasting to ${logSubscribers.size} subscribers`,
    )
  }, 1000)

  // Handle graceful shutdown
  const cleanup = () => {
    // Restore original console methods
    if (originalConsole) {
      Object.assign(console, originalConsole)
      originalConsole = null
    }
    logStream.end()
    errorStream.end()
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("exit", cleanup)
}

export function getSubscriberCount(): number {
  return logSubscribers.size
}

export function testBroadcast(
  message: string = "Test broadcast message",
): void {
  const timestamp = new Date().toISOString()
  const formattedMessage = `[${timestamp}] INFO: ${message}`
  broadcastLogLine(formattedMessage)
}
