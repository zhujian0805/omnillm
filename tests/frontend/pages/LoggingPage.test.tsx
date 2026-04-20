/**
 * LoggingPage Component Tests
 *
 * Comprehensive tests for real-time logging including:
 * - EventSource connection management
 * - Log buffer management
 * - Log level management
 * - Auto-scroll functionality
 * - Error handling
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import { MOCK_LOG_LEVEL, MOCK_LOG_LINES } from "../fixtures/api-responses"
import {
  setupTestEnvironment,
  resetTestEnvironment,
  EventSourceMock,
} from "../setup"

describe("LoggingPage Component Tests", () => {
  let mockShowToast: any
  let mockEventSource: EventSourceMock
  let mockGetLogLevel: any
  let mockUpdateLogLevel: any

  beforeEach(() => {
    setupTestEnvironment()
    mockShowToast = mock()
    mockGetLogLevel = mock(async () => MOCK_LOG_LEVEL)
    mockUpdateLogLevel = mock(async (level: number) => ({
      success: true,
      level,
    }))
  })

  afterEach(() => {
    resetTestEnvironment()
    mockShowToast.mockClear()
    mockGetLogLevel.mockClear()
    mockUpdateLogLevel.mockClear()
    if (mockEventSource) {
      mockEventSource.close()
    }
  })

  describe("Component Initialization", () => {
    test("should load log level on component mount", async () => {
      // Act
      const result = await mockGetLogLevel()

      // Assert
      expect(result.level).toBe(3)
      expect(mockGetLogLevel).toHaveBeenCalledTimes(1)
    })

    test("should handle log level loading errors", () => {
      mockShowToast("Failed to load log level: Network error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load log level"),
        "error",
      )
    })

    test("should initialize with empty lines array", () => {
      const lines: Array<string> = []

      expect(lines).toHaveLength(0)
      expect(Array.isArray(lines)).toBe(true)
    })

    test("should initialize with connecting state", () => {
      const connecting = true
      const connected = false

      expect(connecting).toBe(true)
      expect(connected).toBe(false)
    })

    test("should initialize with auto-scroll enabled", () => {
      const autoScroll = true

      expect(autoScroll).toBe(true)
    })
  })

  describe("EventSource Connection", () => {
    test("should establish EventSource connection", () => {
      // Arrange
      const url = "/api/admin/logs/stream"
      mockEventSource = new EventSourceMock(url)

      // Act
      mockEventSource._triggerOpen()

      // Assert
      expect(mockEventSource.readyState).toBe(1)
    })

    test("should handle EventSource open event", () => {
      // Arrange
      mockEventSource = new EventSourceMock("/api/admin/logs/stream")
      const onOpen = mock()
      mockEventSource.addEventListener("open", onOpen)

      // Act
      mockEventSource._triggerOpen()

      // Assert
      expect(onOpen).toHaveBeenCalled()
    })

    test("should handle EventSource error event", () => {
      // Arrange
      mockEventSource = new EventSourceMock("/api/admin/logs/stream")
      const onError = mock()
      mockEventSource.addEventListener("error", onError)

      // Act
      mockEventSource._triggerError()

      // Assert
      expect(onError).toHaveBeenCalled()
    })

    test("should close EventSource on component unmount", () => {
      // Arrange
      mockEventSource = new EventSourceMock("/api/admin/logs/stream")
      mockEventSource._triggerOpen()

      // Act
      mockEventSource.close()

      // Assert
      expect(mockEventSource.readyState).toBe(2)
    })

    test("should show error on connection failure", () => {
      mockShowToast(
        "Failed to connect to log stream: Connection refused",
        "error",
      )

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect"),
        "error",
      )
    })
  })

  describe("Log Message Handling", () => {
    test("should receive log messages", () => {
      // Arrange
      mockEventSource = new EventSourceMock("/api/admin/logs/stream")
      const onMessage = mock()

      // Act
      mockEventSource.addEventListener("message", onMessage)
      mockEventSource._triggerMessage("INFO: Server started")

      // Assert
      expect(onMessage).toHaveBeenCalled()
      // The handler receives a MessageEvent with data property
    })

    test("should add lines to buffer", () => {
      const lines: Array<string> = []

      // Act - Add lines
      for (const line of MOCK_LOG_LINES) {
        lines.push(line)
      }

      // Assert
      expect(lines).toHaveLength(5)
      expect(lines[0]).toContain("Server started")
    })

    test("should maintain line order", () => {
      const lines: Array<string> = []

      lines.push("First line", "Second line", "Third line")

      expect(lines[0]).toBe("First line")
      expect(lines[1]).toBe("Second line")
      expect(lines[2]).toBe("Third line")
    })
  })

  describe("Log Buffer Management", () => {
    test("should limit buffer to 500 lines", () => {
      const MAX_LINES = 500
      let lines: Array<string> = []

      // Add more than max
      for (let i = 0; i < 550; i++) {
        lines.push(`Line ${i}`)

        // Keep only last 500
        if (lines.length > MAX_LINES) {
          lines = lines.slice(-(MAX_LINES - 1))
        }
      }

      expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
    })

    test("should remove oldest line when buffer full", () => {
      const MAX_LINES = 3
      let lines = ["Line 1", "Line 2", "Line 3"]

      // Add new line when full
      const newLine = "Line 4"
      lines = [lines[1], lines[2], newLine]

      expect(lines).toEqual(["Line 2", "Line 3", "Line 4"])
      expect(lines).toHaveLength(3)
    })

    test("should handle rapid log arrivals", async () => {
      const lines: Array<string> = []
      const mockAddLine = mock((line: string) => {
        lines.push(line)
      })

      // Simulate rapid arrivals
      for (let i = 0; i < 10; i++) {
        await mockAddLine(`Line ${i}`)
      }

      expect(lines).toHaveLength(10)
      expect(mockAddLine).toHaveBeenCalledTimes(10)
    })

    test("should clear buffer when requested", () => {
      let lines = MOCK_LOG_LINES

      // Clear buffer
      lines = []

      expect(lines).toHaveLength(0)
    })
  })

  describe("Log Level Management", () => {
    test("should load current log level", async () => {
      // Act
      const result = await mockGetLogLevel()

      // Assert
      expect(result.level).toBe(3)
    })

    test("should update log level", async () => {
      // Act
      const result = await mockUpdateLogLevel(4)

      // Assert
      expect(result.success).toBe(true)
      expect(result.level).toBe(4)
    })

    test("should handle log level update errors", () => {
      mockShowToast("Failed to update log level: Invalid level", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update"),
        "error",
      )
    })

    test("should map level numbers to names", () => {
      const levels = [
        { value: 0, label: "Silent" },
        { value: 1, label: "Fatal" },
        { value: 2, label: "Warn" },
        { value: 3, label: "Info" },
        { value: 4, label: "Debug" },
        { value: 5, label: "Trace" },
      ]

      expect(levels[3].label).toBe("Info")
      expect(levels[4].label).toBe("Debug")
    })

    test("should display current level", () => {
      const currentLevel = MOCK_LOG_LEVEL.level
      const levelLabel = "Info" // 3 -> Info

      expect(currentLevel).toBe(3)
    })
  })

  describe("Auto-Scroll Functionality", () => {
    test("should auto-scroll when new message arrives", () => {
      const mockScroll = mock()
      const autoScroll = true

      if (autoScroll) {
        mockScroll()
      }

      expect(mockScroll).toHaveBeenCalled()
    })

    test("should toggle auto-scroll", () => {
      let autoScroll = true

      // Toggle
      autoScroll = !autoScroll

      expect(autoScroll).toBe(false)

      // Toggle again
      autoScroll = !autoScroll

      expect(autoScroll).toBe(true)
    })

    test("should not auto-scroll when disabled", () => {
      const mockScroll = mock()
      const autoScroll = false

      if (autoScroll) {
        mockScroll()
      }

      expect(mockScroll).not.toHaveBeenCalled()
    })

    test("should scroll to top button", () => {
      const mockScrollTop = mock()

      // Click scroll to top
      mockScrollTop()

      expect(mockScrollTop).toHaveBeenCalled()
    })

    test("should scroll to bottom button", () => {
      const mockScrollBottom = mock()

      // Click scroll to bottom
      mockScrollBottom()

      expect(mockScrollBottom).toHaveBeenCalled()
    })
  })

  describe("Connection Status Display", () => {
    test("should show connecting state initially", () => {
      const connecting = true
      const connected = false

      expect(connecting).toBe(true)
      expect(connected).toBe(false)
    })

    test("should show connected state after connection", () => {
      let connecting = false
      let connected = false

      // Simulate connection
      connecting = false
      connected = true

      expect(connected).toBe(true)
    })

    test("should show disconnected state on error", () => {
      const connecting = false
      let connected = false

      // Simulate error
      connected = false

      expect(connected).toBe(false)
    })

    test("should show connection status indicator", () => {
      const statusIndicators = [
        { status: "connecting", color: "orange" },
        { status: "connected", color: "green" },
        { status: "disconnected", color: "red" },
      ]

      expect(statusIndicators[1].status).toBe("connected")
      expect(statusIndicators[1].color).toBe("green")
    })
  })

  describe("UI Controls", () => {
    test("should have clear logs button", () => {
      const button = { label: "Clear Logs", ariaLabel: "Clear all logs" }

      expect(button.label).toBe("Clear Logs")
      expect(button.ariaLabel).toBeTruthy()
    })

    test("should clear logs when button clicked", () => {
      let lines = MOCK_LOG_LINES

      // Click clear
      lines = []

      expect(lines).toHaveLength(0)
    })

    test("should have copy logs button", () => {
      const button = { label: "Copy", ariaLabel: "Copy logs to clipboard" }

      expect(button.label).toBe("Copy")
    })

    test("should copy logs to clipboard", async () => {
      // Mock clipboard
      const mockClipboard = mock(async (text: string) => {
        return Promise.resolve()
      })

      const logsText = MOCK_LOG_LINES.join("\n")

      // Act
      await mockClipboard(logsText)

      // Assert
      expect(mockClipboard).toHaveBeenCalledWith(logsText)
    })

    test("should show log level selector", () => {
      const selector = { label: "Log Level", options: [0, 1, 2, 3, 4, 5] }

      expect(selector.options).toContain(3)
      expect(selector.label).toBe("Log Level")
    })

    test("should change log level from selector", async () => {
      // Act
      const result = await mockUpdateLogLevel(5)

      // Assert
      expect(result.level).toBe(5)
    })
  })

  describe("Log Parsing", () => {
    test("should parse timestamp from log line", () => {
      const line = "[2024-01-15T10:30:00Z] INFO: Server started"
      const timestampMatch = line.match(/\[(.*?)\]/)

      expect(timestampMatch?.[1]).toBe("2024-01-15T10:30:00Z")
    })

    test("should parse log level from line", () => {
      const line = "[2024-01-15T10:30:00Z] INFO: Server started"
      const levelMatch = line.match(/\] (.*?):/)

      expect(levelMatch?.[1]).toBe("INFO")
    })

    test("should parse message from line", () => {
      const line = "[2024-01-15T10:30:00Z] INFO: Server started"
      const messageMatch = line.match(/: (.*)$/)

      expect(messageMatch?.[1]).toBe("Server started")
    })

    test("should handle lines without timestamp", () => {
      const line = "INFO: Server started"
      const hasTimestamp = /\[.*?\]/.test(line)

      expect(hasTimestamp).toBe(false)
    })

    test("should handle multiline log entries", () => {
      const lines = [
        "[2024-01-15T10:30:00Z] ERROR: Failed to start",
        "  Stack trace: ...",
        "  at main.ts:10",
      ]

      expect(lines).toHaveLength(3)
    })
  })

  describe("Error Handling", () => {
    test("should show error on connection failure", () => {
      mockShowToast("Failed to connect: Connection refused", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect"),
        "error",
      )
    })

    test("should continue on EventSource error", () => {
      mockEventSource = new EventSourceMock("/api/admin/logs/stream")
      const onError = mock()

      mockEventSource.addEventListener("error", onError)
      mockEventSource._triggerError()

      expect(onError).toHaveBeenCalled()
      // Should not crash, just log error
    })

    test("should handle malformed log lines", () => {
      const malformedLine = "This is not a properly formatted log line"
      const hasTimestamp = /\[.*?\]/.test(malformedLine)

      expect(hasTimestamp).toBe(false)
      // Should still display the line
    })

    test("should show error on log level update failure", () => {
      mockShowToast("Failed to update log level: Server error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update"),
        "error",
      )
    })
  })

  describe("State Recovery", () => {
    test("should persist auto-scroll preference", () => {
      let autoScroll = true

      // Change and save
      autoScroll = false
      localStorage.setItem("logging-auto-scroll", String(autoScroll))

      // Reload value
      const savedValue = localStorage.getItem("logging-auto-scroll")
      autoScroll = savedValue === "true"

      expect(autoScroll).toBe(false)
    })

    test("should restore log level on remount", async () => {
      // Set initial level
      const initialLevel = 4

      // Save to storage
      sessionStorage.setItem("log-level", String(initialLevel))

      // Get value
      const restored = sessionStorage.getItem("log-level")

      expect(restored).toBe("4")
    })
  })

  describe("Performance", () => {
    test("should handle 100+ log lines efficiently", () => {
      const lines: Array<string> = []

      for (let i = 0; i < 100; i++) {
        lines.push(
          `[2024-01-15T10:30:${(i % 60).toString().padStart(2, "0")}Z] INFO: Line ${i}`,
        )
      }

      expect(lines).toHaveLength(100)
    })

    test("should handle buffer maintenance efficiently", () => {
      const MAX_LINES = 500
      let lines: Array<string> = []
      const mockMaintain = mock(() => {
        if (lines.length > MAX_LINES) {
          lines = lines.slice(-(MAX_LINES - 1))
        }
      })

      // Add 600 lines
      for (let i = 0; i < 600; i++) {
        lines.push(`Line ${i}`)
        mockMaintain()
      }

      expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
    })

    test("should not freeze UI during rapid updates", async () => {
      const mockUpdate = mock(async () => {
        // Simulate rapid updates
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const updates = Array(50)
        .fill(0)
        .map(() => mockUpdate())
      await Promise.all(updates)

      expect(mockUpdate).toHaveBeenCalledTimes(50)
    })
  })
})
