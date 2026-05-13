import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const repoRoot = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8")
}

describe("post-split omnicode cleanup", () => {
  test("build-install scripts no longer build omnicode", () => {
    expect(read("scripts/build-install-binaries.ps1")).not.toContain("cmd\\omnicode")
    expect(read("scripts/build-install-binaries.ps1")).not.toContain("'omnicode'")

    expect(read("scripts/build-install-binaries.sh")).not.toContain("/cmd/omnicode")
    expect(read("scripts/build-install-binaries.sh")).not.toContain('"omnicode"')
  })

  test("readmes no longer document omnicode as a binary shipped by this repo", () => {
    const readme = read("README.md")
    expect(readme).not.toContain("cmd/omnicode/")
    expect(readme).not.toContain("go run ./cmd/omnicode")
    expect(readme).not.toContain("| `omnicode` | `cmd/omnicode/main.go` |")

    const readmeZh = read("README.zh-CN.md")
    expect(readmeZh).not.toContain("cmd/omnicode/")
    expect(readmeZh).not.toContain("go run ./cmd/omnicode")
    expect(readmeZh).not.toContain("| `omnicode` | `cmd/omnicode/main.go` |")
  })
})
