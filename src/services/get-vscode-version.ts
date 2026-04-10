const FALLBACK = "1.114.0"

async function getLocalVSCodeVersion(): Promise<string | null> {
  try {
    // Try to detect local VSCode installation
    const proc = Bun.spawn(["code", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const output = await new Response(proc.stdout).text()
    const version = output.split("\n")[0]

    if (version && /^\d+\.\d+\.\d+/.test(version)) {
      return version
    }
  } catch {
    // code command not found or failed
  }

  return null
}

export async function getVSCodeVersion() {
  // Try local detection first
  const localVersion = await getLocalVSCodeVersion()
  if (localVersion) {
    return localVersion
  }

  // Fallback to remote detection
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, 5000)

  try {
    const response = await fetch(
      "https://aur.archlinux.org/cgit/aur.git/plain/PKGBUILD?h=visual-studio-code-bin",
      {
        signal: controller.signal,
      },
    )

    const pkgbuild = await response.text()
    const pkgverRegex = /pkgver=([0-9.]+)/
    const match = pkgbuild.match(pkgverRegex)

    if (match) {
      return match[1]
    }

    return FALLBACK
  } catch {
    return FALLBACK
  } finally {
    clearTimeout(timeout)
  }
}
