import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

type PackageJson = {
  main?: unknown
  exports?: Record<string, unknown>
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson
}

describe("package install metadata", () => {
  test("advertises only the TUI entrypoint to OpenCode's plugin installer", () => {
    const pkg = readPackageJson()

    expect(pkg.main).toBeUndefined()
    expect(pkg.exports).toBeDefined()
    expect(pkg.exports?.["./tui"]).toBeDefined()
    expect(pkg.exports?.["./server"]).toBeUndefined()
  })
})
