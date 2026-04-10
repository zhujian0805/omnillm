import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { getUsage, type UsageData } from "@/api"
import { Spinner } from "@/components/Spinner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

function getBarColor(percentUsed: number, unlimited: boolean): string {
  if (unlimited) return "bg-gruvbox-blue"
  if (percentUsed > 90) return "bg-gruvbox-red"
  if (percentUsed > 75) return "bg-gruvbox-yellow"
  return "bg-gruvbox-green"
}

function CopilotMeta({ data }: { data: UsageData }) {
  const fields = [
    { label: "Plan", value: data.copilot_plan },
    { label: "SKU", value: data.access_type_sku },
    {
      label: "Quota resets",
      value:
        data.quota_reset_date ?
          new Date(data.quota_reset_date).toLocaleDateString()
        : undefined,
    },
    {
      label: "Assigned",
      value:
        data.assigned_date ?
          new Date(data.assigned_date).toLocaleDateString()
        : undefined,
    },
    {
      label: "Chat enabled",
      value:
        data.chat_enabled !== undefined ? String(data.chat_enabled) : undefined,
    },
  ].filter((f) => f.value !== undefined)

  if (fields.length === 0) return null

  return (
    <Card className="mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
        {fields.map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs text-gruvbox-fg-dark">{label}</p>
            <p className="text-sm font-semibold text-gruvbox-fg-lightest capitalize">
              {value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function UsagePage({
  showToast,
}: {
  showToast: (msg: string, type?: "success" | "error") => void
}) {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getUsage())
    } catch (e) {
      showToast(
        "Failed to load usage: " + (e instanceof Error ? e.message : String(e)),
        "error",
      )
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-gruvbox-gray text-sm">
        <Spinner /> Loading usage data...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gruvbox-fg-lightest">
          Usage Statistics
        </h2>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      {data && <CopilotMeta data={data} />}

      {data?.quota_snapshots && (
        <div>
          <h3 className="text-base font-bold mb-3 text-gruvbox-fg-lightest">
            Usage Quotas
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {Object.entries(data.quota_snapshots).map(([key, value]) => {
              const {
                entitlement,
                percent_remaining,
                unlimited,
                overage_count,
                overage_permitted,
              } = value
              const remaining = value.quota_remaining ?? value.remaining
              const percentUsed = unlimited ? 0 : 100 - percent_remaining
              const used =
                unlimited ? "N/A" : (entitlement - remaining).toLocaleString()
              const barColor = getBarColor(percentUsed, unlimited)

              return (
                <Card key={key}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold capitalize text-sm text-gruvbox-fg-lightest">
                      {key.replaceAll("_", " ")}
                    </span>
                    {unlimited ?
                      <span className="text-xs px-2 py-0.5 bg-gruvbox-blue/20 text-gruvbox-blue-accent font-semibold">
                        Unlimited
                      </span>
                    : <span className="text-xs font-mono text-gruvbox-fg-medium">
                        {percentUsed.toFixed(1)}% Used
                      </span>
                    }
                  </div>
                  <Progress
                    value={unlimited ? 100 : percentUsed}
                    className="mb-2"
                    indicatorClassName={barColor}
                  />
                  <div className="flex justify-between text-xs font-mono text-gruvbox-fg-dark">
                    <span>
                      {used} / {unlimited ? "∞" : entitlement.toLocaleString()}
                    </span>
                    <span>
                      {unlimited ? "∞" : remaining.toLocaleString()} remaining
                    </span>
                  </div>
                  {overage_permitted
                    && overage_count !== undefined
                    && overage_count > 0 && (
                      <p className="mt-1 text-xs text-gruvbox-yellow-accent">
                        {overage_count.toLocaleString()} overage
                      </p>
                    )}
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {data && (
        <div>
          <h3 className="text-sm font-bold mb-2 text-gruvbox-fg-lightest">
            Raw Response
          </h3>
          <Card>
            <pre className="text-xs overflow-auto max-h-96 text-gruvbox-fg-medium font-mono">
              {JSON.stringify(data, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  )
}
