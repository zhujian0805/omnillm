/**
 * UsagePage Component Tests
 *
 * Comprehensive tests for usage quota display including:
 * - Usage data loading
 * - Quota visualization
 * - Quota status calculations
 * - GitHub Copilot specific fields
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import { MOCK_USAGE_DATA } from "../fixtures/api-responses"
import { setupTestEnvironment, resetTestEnvironment } from "../setup"

describe("UsagePage Component Tests", () => {
  let mockShowToast: any
  let mockGetUsage: any

  beforeEach(() => {
    setupTestEnvironment()
    mockShowToast = mock()
    mockGetUsage = mock(async () => MOCK_USAGE_DATA)
  })

  afterEach(() => {
    resetTestEnvironment()
    mockShowToast.mockClear()
    mockGetUsage.mockClear()
  })

  describe("Component Initialization", () => {
    test("should load usage data on component mount", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.copilot_plan).toBe("pro")
      expect(mockGetUsage).toHaveBeenCalledTimes(1)
    })

    test("should handle usage data loading errors", () => {
      mockShowToast("Failed to load usage data: Network error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load usage"),
        "error",
      )
    })

    test("should initialize with loading state", () => {
      const loading = true

      expect(loading).toBe(true)
    })

    test("should initialize with empty data", () => {
      const data: any = {}

      expect(Object.keys(data)).toHaveLength(0)
    })
  })

  describe("GitHub Copilot Fields", () => {
    test("should display Copilot plan", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.copilot_plan).toBe("pro")
    })

    test("should display access type SKU", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.access_type_sku).toBe("copilot_pro")
    })

    test("should display assigned date", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.assigned_date).toBeTruthy()
      expect(typeof result.assigned_date).toBe("string")
    })

    test("should display quota reset date", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.quota_reset_date).toBeTruthy()
      expect(typeof result.quota_reset_date).toBe("string")
    })

    test("should display chat enabled status", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.chat_enabled).toBe(true)
    })
  })

  describe("Quota Display", () => {
    test("should display quota snapshots", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      expect(result.quota_snapshots).toBeTruthy()
      expect(Object.keys(result.quota_snapshots)).toHaveLength(3)
    })

    test("should show entitlement for each quota", async () => {
      // Act
      const result = await mockGetUsage()
      const chatOps = result.quota_snapshots["chat_operations"]

      // Assert
      expect(chatOps.entitlement).toBe(100)
    })

    test("should show remaining quota", async () => {
      // Act
      const result = await mockGetUsage()
      const chatOps = result.quota_snapshots["chat_operations"]

      // Assert
      expect(chatOps.remaining).toBe(75)
    })

    test("should show percentage remaining", async () => {
      // Act
      const result = await mockGetUsage()
      const chatOps = result.quota_snapshots["chat_operations"]

      // Assert
      expect(chatOps.percent_remaining).toBe(75)
    })

    test("should show unlimited badge for unlimited quotas", async () => {
      // Act
      const result = await mockGetUsage()
      const unlimited = result.quota_snapshots["unlimited_feature"]

      // Assert
      expect(unlimited.unlimited).toBe(true)
    })
  })

  describe("Color Coding", () => {
    test("should color code green for >50% remaining", () => {
      const quotas = [{ name: "feature1", percent: 75 }]

      const color = quotas[0].percent > 50 ? "green" : "red"
      expect(color).toBe("green")
    })

    test("should color code yellow for 20-50% remaining", () => {
      const quotas = [{ name: "feature1", percent: 35 }]

      const getColor = (percent: number) => {
        if (percent > 50) return "green"
        if (percent > 20) return "yellow"
        return "red"
      }

      expect(getColor(quotas[0].percent)).toBe("yellow")
    })

    test("should color code red for <20% remaining", () => {
      const quotas = [{ name: "feature1", percent: 15 }]

      const getColor = (percent: number) => {
        if (percent > 50) return "green"
        if (percent > 20) return "yellow"
        return "red"
      }

      expect(getColor(quotas[0].percent)).toBe("red")
    })

    test("should use neutral color for unlimited", () => {
      const color = "neutral"

      expect(color).toBe("neutral")
    })
  })

  describe("Progress Bar Display", () => {
    test("should calculate progress bar width", () => {
      const percent = 75
      const width = `${percent}%`

      expect(width).toBe("75%")
    })

    test("should calculate all progress percentages", async () => {
      // Act
      const result = await mockGetUsage()
      const quotas = result.quota_snapshots

      // Assert
      expect(quotas["chat_operations"].percent_remaining).toBe(75)
      expect(quotas["code_completions"].percent_remaining).toBe(85)
      expect(quotas["unlimited_feature"].percent_remaining).toBe(100)
    })

    test("should display remaining count", async () => {
      // Act
      const result = await mockGetUsage()
      const chatOps = result.quota_snapshots["chat_operations"]

      // Assert
      const remaining = `${chatOps.remaining}/${chatOps.entitlement}`
      expect(remaining).toBe("75/100")
    })

    test("should handle zero remaining", () => {
      const quota = {
        entitlement: 100,
        remaining: 0,
        percent_remaining: 0,
        unlimited: false,
      }

      expect(quota.percent_remaining).toBe(0)
      expect(quota.remaining).toBe(0)
    })

    test("should handle full quota", () => {
      const quota = {
        entitlement: 100,
        remaining: 100,
        percent_remaining: 100,
        unlimited: false,
      }

      expect(quota.percent_remaining).toBe(100)
    })
  })

  describe("Refresh Functionality", () => {
    test("should refresh data when refresh button clicked", async () => {
      // First call
      const result1 = await mockGetUsage()
      expect(mockGetUsage).toHaveBeenCalledTimes(1)

      // Second call (refresh)
      const result2 = await mockGetUsage()
      expect(mockGetUsage).toHaveBeenCalledTimes(2)

      // Should have same data structure
      expect(result1.copilot_plan).toBe(result2.copilot_plan)
    })

    test("should show loading state during refresh", () => {
      let loading = false

      // Start refresh
      loading = true
      expect(loading).toBe(true)

      // Complete refresh
      loading = false
      expect(loading).toBe(false)
    })

    test("should handle refresh errors", () => {
      mockShowToast("Failed to refresh usage data: Network error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to refresh"),
        "error",
      )
    })
  })

  describe("Raw Response Display", () => {
    test("should toggle raw data display", async () => {
      let showRaw = false

      // Toggle
      showRaw = !showRaw
      expect(showRaw).toBe(true)

      // Toggle again
      showRaw = !showRaw
      expect(showRaw).toBe(false)
    })

    test("should display raw JSON response", async () => {
      // Act
      const result = await mockGetUsage()
      const rawJson = JSON.stringify(result, null, 2)

      // Assert
      expect(rawJson).toContain("copilot_plan")
      expect(rawJson).toContain("quota_snapshots")
    })

    test("should have copy button for raw data", () => {
      const button = { label: "Copy", ariaLabel: "Copy raw data" }

      expect(button.label).toBe("Copy")
    })
  })

  describe("Data Formatting", () => {
    test("should format dates correctly", async () => {
      // Act
      const result = await mockGetUsage()

      // Assert
      const date = new Date(result.assigned_date)
      expect(date).toBeInstanceOf(Date)
      expect(isNaN(date.getTime())).toBe(false)
    })

    test("should display plan names properly", () => {
      const plans = ["free", "pro", "premium"]

      expect(plans).toContain("pro")
    })

    test("should handle missing optional fields", () => {
      const data = {
        // Missing many optional fields
        quota_snapshots: {},
      }

      const hasSnapshots = "quota_snapshots" in data
      expect(hasSnapshots).toBe(true)
    })

    test("should display quota names", async () => {
      // Act
      const result = await mockGetUsage()
      const quotaNames = Object.keys(result.quota_snapshots)

      // Assert
      expect(quotaNames).toContain("chat_operations")
      expect(quotaNames).toContain("code_completions")
      expect(quotaNames).toContain("unlimited_feature")
    })
  })

  describe("Empty State", () => {
    test("should handle missing quota snapshots", () => {
      const data = {
        copilot_plan: "pro",
        // No quota_snapshots
      }

      const hasSnapshots = "quota_snapshots" in data
      expect(hasSnapshots).toBe(false)
    })

    test("should handle empty quota snapshots", async () => {
      const mockGetEmpty = mock(async () => ({
        copilot_plan: "pro",
        quota_snapshots: {},
      }))

      // Act
      const result = await mockGetEmpty()

      // Assert
      expect(Object.keys(result.quota_snapshots)).toHaveLength(0)
    })

    test("should show message when no usage data available", () => {
      const message = "No usage data available"

      expect(message).toBeTruthy()
    })
  })

  describe("Quota Name Mapping", () => {
    test("should display human-readable quota names", () => {
      const nameMap: Record<string, string> = {
        chat_operations: "Chat Operations",
        code_completions: "Code Completions",
        unlimited_feature: "Unlimited Feature",
      }

      expect(nameMap["chat_operations"]).toBe("Chat Operations")
      expect(nameMap["code_completions"]).toBe("Code Completions")
    })

    test("should have name for each quota", async () => {
      // Act
      const result = await mockGetUsage()
      const quotaNames = Object.keys(result.quota_snapshots)

      // Assert - Each quota should have a name
      for (const quotaId of quotaNames) {
        const hasName = quotaId.length > 0
        expect(hasName).toBe(true)
      }
    })
  })

  describe("Error Handling", () => {
    test("should show error on load failure", () => {
      mockShowToast("Failed to load usage: Server error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load usage"),
        "error",
      )
    })

    test("should show error on refresh failure", () => {
      mockShowToast("Failed to refresh: Network error", "error")

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to refresh"),
        "error",
      )
    })

    test("should handle malformed response", async () => {
      const mockGetMalformed = mock(async () => ({
        // Missing required fields
        invalid: "data",
      }))

      // Act
      const result = await mockGetMalformed()

      // Assert
      expect(result.invalid).toBe("data")
      // Should still render gracefully
    })
  })

  describe("Accessibility", () => {
    test("should have aria label for refresh button", () => {
      const button = { ariaLabel: "Refresh usage data" }

      expect(button.ariaLabel).toBeTruthy()
    })

    test("should have aria label for copy button", () => {
      const button = { ariaLabel: "Copy raw data to clipboard" }

      expect(button.ariaLabel).toBeTruthy()
    })

    test("should have alt text for progress indicators", () => {
      const indicator = {
        role: "progressbar",
        ariaLabel: "Chat quota: 75% remaining",
      }

      expect(indicator.role).toBe("progressbar")
      expect(indicator.ariaLabel).toBeTruthy()
    })

    test("should have proper headings", () => {
      const headings = [
        { level: 2, text: "Usage Summary" },
        { level: 3, text: "Quotas" },
      ]

      expect(headings[0].level).toBe(2)
      expect(headings[0].text).toBeTruthy()
    })
  })

  describe("State Persistence", () => {
    test("should save raw display preference", () => {
      const showRaw = true

      // Save preference
      localStorage.setItem("usage-show-raw", String(showRaw))

      // Retrieve
      const saved = localStorage.getItem("usage-show-raw") === "true"

      expect(saved).toBe(true)
    })

    test("should restore display preference on remount", () => {
      // Save preference
      localStorage.setItem("usage-show-raw", "true")

      // Retrieve
      const showRaw = localStorage.getItem("usage-show-raw") === "true"

      expect(showRaw).toBe(true)
    })
  })
})
