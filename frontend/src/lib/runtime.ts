// Runtime hook for distinguishing desktop (Tauri) vs browser execution.
//
// The desktop entrypoint sets window.__OMNILLM_DESKTOP__ before the React app
// mounts, supplying the local backend baseUrl + apiKey discovered/spawned by
// the Rust sidecar. The browser build never sets this, so isDesktop()
// returns false and the existing auto-detect/meta-tag logic stays in effect.
//
// This module deliberately has no Tauri import — both browser and desktop
// builds compile the exact same shared frontend, and the bridge value is
// injected as a plain global.

declare global {
  interface Window {
    __OMNILLM_DESKTOP__?: {
      baseUrl: string
      apiKey: string
    }
  }
}

export interface DesktopBackend {
  baseUrl: string
  apiKey: string
}

export function isDesktop(): boolean {
  if (typeof globalThis === "undefined") return false
  const w = globalThis as unknown as { __OMNILLM_DESKTOP__?: DesktopBackend }
  return Boolean(
    w.__OMNILLM_DESKTOP__
      && typeof w.__OMNILLM_DESKTOP__.baseUrl === "string"
      && w.__OMNILLM_DESKTOP__.baseUrl.length > 0,
  )
}

export function getDesktopBackend(): DesktopBackend | null {
  if (typeof globalThis === "undefined") return null
  const w = globalThis as unknown as { __OMNILLM_DESKTOP__?: DesktopBackend }
  const bridge = w.__OMNILLM_DESKTOP__
  if (
    !bridge
    || typeof bridge.baseUrl !== "string"
    || bridge.baseUrl.length === 0
  ) {
    return null
  }
  return {
    baseUrl: bridge.baseUrl.replace(/\/+$/, ""),
    apiKey: typeof bridge.apiKey === "string" ? bridge.apiKey : "",
  }
}

export function setDesktopBackend(bridge: DesktopBackend | null): void {
  if (typeof globalThis === "undefined") return
  const w = globalThis as unknown as { __OMNILLM_DESKTOP__?: DesktopBackend }
  if (bridge === null) {
    delete w.__OMNILLM_DESKTOP__
    return
  }
  w.__OMNILLM_DESKTOP__ = bridge
}

export {}
