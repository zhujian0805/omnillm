import type { AuthFlow, Provider } from "@/api"

type DeviceAuthCopy = {
  codeLabel: string
  codeHint?: string
  waitingLabel: string
}

export function getDeviceAuthCopy(
  _authFlow: AuthFlow | null | undefined,
  _providers: Array<Provider>,
): DeviceAuthCopy {
  return {
    codeLabel: "Enter this code:",
    waitingLabel: "Waiting for authorization…",
  }
}
