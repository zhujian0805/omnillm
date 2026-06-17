import { invoke } from "@tauri-apps/api/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import AppComponent from "@/App"
import { setDesktopBackend } from "@/lib/runtime"

import "./desktop/desktop.css"

interface BackendInfo {
  baseUrl: string
  apiKey: string
  version: string
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove()
}

function showSplash(root: HTMLElement): void {
  clear(root)
  const wrap = document.createElement("div")
  wrap.className = "olp-desktop-splash"

  const spinner = document.createElement("div")
  spinner.className = "spinner"
  spinner.setAttribute("aria-hidden", "true")

  const label = document.createElement("div")
  label.textContent = "Starting OmniLLM…"

  wrap.append(spinner, label)
  root.append(wrap)
}

function showError(root: HTMLElement, detail: string): void {
  clear(root)
  const wrap = document.createElement("div")
  wrap.className = "olp-desktop-error"

  const heading = document.createElement("h2")
  heading.textContent = "Could not start the OmniLLM backend"

  const intro = document.createElement("p")
  intro.textContent = "The bundled proxy failed to launch. You can retry below."

  const pre = document.createElement("pre")
  pre.textContent = detail

  const button = document.createElement("button")
  button.textContent = "Retry"
  button.addEventListener("click", () => {
    void invoke("restart_backend").then(() => {
      globalThis.location.reload()
    })
  })

  wrap.append(heading, intro, pre, button)
  root.append(wrap)
}

async function bootstrap(): Promise<void> {
  const root = document.querySelector("#root")
  if (!root) throw new Error("missing #root")

  showSplash(root)

  let info: BackendInfo
  try {
    info = await invoke<BackendInfo>("desktop_backend_info")
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    showError(root, detail)
    return
  }

  setDesktopBackend({ baseUrl: info.baseUrl, apiKey: info.apiKey })

  clear(root)
  createRoot(root).render(
    <StrictMode>
      <AppComponent />
    </StrictMode>,
  )
}

void bootstrap()
