#!/usr/bin/env bun
/**
 * scripts/release.ts — Automate version bumping, tagging, and releasing
 *
 * Cross-platform: works on Linux, macOS, and Windows (via Bun or Node.js).
 *
 * Usage:
 *   bun run scripts/release.ts              # Auto-bump (patch by default)
 *   bun run scripts/release.ts patch        # v0.0.1 → v0.0.2
 *   bun run scripts/release.ts minor        # v0.0.2 → v0.1.0
 *   bun run scripts/release.ts major        # v0.1.0 → v1.0.0
 *   bun run scripts/release.ts v0.5.0       # Set explicit version
 *
 * What it does:
 *   1. Validates no uncommitted changes
 *   2. Computes next version from VERSION file (or uses explicit version)
 *   3. Writes new version to VERSION file
 *   4. Creates annotated git tag
 *   5. Pushes commit + tag to remote
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"

const REPO_ROOT = join(dirname(import.meta.dirname), "..")
const VERSION_FILE = join(REPO_ROOT, "VERSION")

// ── Helpers ──────────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim()
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    die(`Command failed: ${cmd}\n${err.stderr ?? err.stdout ?? String(e)}`)
  }
}

function bumpVersion(current: string, part: string): string {
  // Strip leading 'v'
  const nums = current.replace(/^v/, "").split(".").map(Number)
  if (nums.length !== 3 || nums.some((n) => Number.isNaN(n))) {
    die(`Invalid version format: ${current}`)
  }

  const [major, minor, patch] = nums
  switch (part) {
    case "major": {
      return `v${major + 1}.0.0`
    }
    case "minor": {
      return `v${major}.${minor + 1}.0`
    }
    case "patch": {
      return `v${major}.${minor}.${patch + 1}`
    }
    default: {
      die(`Unknown bump type: ${part} (use major/minor/patch)`)
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  // Read current version
  if (!existsSync(VERSION_FILE)) {
    die(`VERSION file not found at ${VERSION_FILE}`)
  }
  const currentVersion = readFileSync(VERSION_FILE, "utf8").trim()
  if (!currentVersion) {
    die("VERSION file is empty")
  }

  const input = process.argv[2] ?? "patch"

  // Check if user passed an explicit version like "v1.2.3"
  let newVersion: string
  if (/^v?\d+\.\d+\.\d+$/.test(input)) {
    newVersion = input.startsWith("v") ? input : `v${input}`
    console.log(`Setting explicit version: ${newVersion}`)
  } else {
    newVersion = bumpVersion(currentVersion, input)
    console.log(`Bumping ${input}: ${currentVersion} → ${newVersion}`)
  }

  // ── Pre-flight checks ──────────────────────────────────────────────────

  const status = run("git status --porcelain")
  if (status) {
    die("Working tree is dirty. Commit or stash changes before releasing.")
  }

  const existingTags = run("git tag")
  if (existingTags.split("\n").includes(newVersion)) {
    die(`Tag ${newVersion} already exists locally.`)
  }

  // ── Apply changes ──────────────────────────────────────────────────────

  writeFileSync(VERSION_FILE, `${newVersion}\n`, "utf8")

  run("git add VERSION")
  run(`git commit -m "release: ${newVersion}"`)
  run(`git tag -a ${newVersion} -m "Release ${newVersion}"`)

  // ── Push ──────────────────────────────────────────────────────────────

  console.log("")
  console.log("Pushing to remote...")
  run("git push origin master")
  run(`git push origin ${newVersion}`)

  console.log("")
  console.log(`Done! Released ${newVersion}`)
  console.log(`  Tag:        ${newVersion}`)
  console.log(`  VERSION:    ${newVersion}`)
}

try {
  main()
} catch (err: unknown) {
  console.error(err)
  process.exit(1)
}
