import { useCallback, useState } from "react"

import { createLogger } from "@/lib/logger"

const log = createLogger("toast")

export interface Toast {
  id: number
  message: string
  type: "success" | "error"
}

let _id = 0

export function useToast() {
  const [toasts, setToasts] = useState<Array<Toast>>([])

  const showToast = useCallback(
    (message: string, type: Toast["type"] = "success") => {
      log.info(message, { type })
      const id = ++_id
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        3500,
      )
    },
    [],
  )

  return { toasts, showToast }
}

export function ToastContainer({ toasts }: { toasts: Array<Toast> }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.type === "success" ? "toast-success" : "toast-error"}`}
        >
          <span style={{ opacity: 0.6, marginRight: 6 }}>
            {t.type === "success" ? "▶" : "✕"}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  )
}
