import type { AuthFlow, Provider } from "@/api"

type DeviceAuthCopy = {
  codeLabel: string
  codeHint?: string
  waitingLabel: string
}

export function getDeviceAuthCopy(
  authFlow: AuthFlow | null | undefined,
  providers: Array<Provider>,
): DeviceAuthCopy {
  return {
    codeLabel: "Enter this code:",
    waitingLabel: "Waiting for authorization…",
  }
}
