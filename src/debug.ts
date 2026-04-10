#!/usr/bin/env bun

import { defineCommand } from "citty"
import consola from "consola"

import { PATHS } from "./lib/paths"

interface DebugInfo {
  version: string
  runtime: {
    name: string
    version: string
    platform: string
    arch: string
  }
  paths: {
    APP_DIR: string
    GITHUB_TOKEN_PATH: string
  }
  tokenExists: boolean
}

interface RunDebugOptions {
  json: boolean
}

async function getPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url).pathname
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text()) as {
      version: string
    }
    return packageJson.version
  } catch {
    return "unknown"
  }
}

function getRuntimeInfo() {
  return {
    name: "bun",
    version: Bun.version,
    platform: process.platform,
    arch: process.arch,
  }
}

async function checkTokenExists(): Promise<boolean> {
  try {
    const file = Bun.file(PATHS.GITHUB_TOKEN_PATH)
    const exists = await file.exists()
    if (!exists) return false

    const content = await file.text()
    return content.trim().length > 0
  } catch {
    return false
  }
}

async function getDebugInfo(): Promise<DebugInfo> {
  const [version, tokenExists] = await Promise.all([
    getPackageVersion(),
    checkTokenExists(),
  ])

  return {
    version,
    runtime: getRuntimeInfo(),
    paths: {
      APP_DIR: PATHS.APP_DIR,
      GITHUB_TOKEN_PATH: PATHS.GITHUB_TOKEN_PATH,
    },
    tokenExists,
  }
}

function printDebugInfoPlain(info: DebugInfo): void {
  consola.info(`omnimodel debug

Version: ${info.version}
Runtime: ${info.runtime.name} ${info.runtime.version} (${info.runtime.platform} ${info.runtime.arch})

Paths:
- APP_DIR: ${info.paths.APP_DIR}
- GITHUB_TOKEN_PATH: ${info.paths.GITHUB_TOKEN_PATH}

Token exists: ${info.tokenExists ? "Yes" : "No"}`)
}

function printDebugInfoJson(info: DebugInfo): void {
  consola.info(JSON.stringify(info, null, 2))
}

export async function runDebug(options: RunDebugOptions): Promise<void> {
  const debugInfo = await getDebugInfo()

  if (options.json) {
    printDebugInfoJson(debugInfo)
  } else {
    printDebugInfoPlain(debugInfo)
  }
}

export const debug = defineCommand({
  meta: {
    name: "debug",
    description: "Print debug information about the application",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Output debug information as JSON",
    },
  },
  run({ args }) {
    return runDebug({
      json: args.json,
    })
  },
})
