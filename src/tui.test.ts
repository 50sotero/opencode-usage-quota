import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

function sessionPromptBody(source: string) {
  const start = source.indexOf("session_prompt(")
  if (start === -1) return ""
  const end = source.indexOf("home_bottom()", start)
  return source.slice(start, end === -1 ? undefined : end)
}

function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}`)
  if (start === -1) return ""
  const next = source.indexOf("\n  function ", start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe("usage quota TUI plugin render safety", () => {
  test("does not persist local usage records from session prompt render", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")
    const body = sessionPromptBody(source)

    expect(body).not.toContain("usageRecordFromMessage")
    expect(body).not.toContain("remember(")
    expect(body).not.toContain("api.kv.set")
    expect(body).not.toContain("scheduleSessionUsageScan")
  })

  test("renders quota status below prompt rows", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

    expect(source).toContain("session_prompt(")
    expect(source).toContain("SessionPromptWithStatus")
    expect(source).not.toContain("session_prompt_right")
    expect(source).toContain("home_bottom()")
    expect(source).toContain("block")
    expect(source).toContain("order: 90")
    expect(source).not.toContain("home_prompt_right")
  })

  test("keeps the /quota detail command available in native and stock modes", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

    expect(source).toContain("api.command.register")
    expect(source).toContain('name: "quota"')
    expect(source).toContain('aliases: ["usage-quota"]')
  })

  test("registers a /dashboard detail command without removing /quota", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

    expect(source).toContain('name: "dashboard"')
    expect(source).toContain("formatSessionDashboardReport")
    expect(source).toContain("formatSessionDashboardPrompt")
    expect(source).toContain('name: "quota"')
  })

  test("guards compact prompt slots behind native provider quota detection", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

    expect(source).toContain("function hasNativeProviderQuota")
    expect(source).toContain("const nativeProviderQuota = hasNativeProviderQuota(api.client)")
    expect(source).toContain("if (!nativeProviderQuota)")
  })

  test("defaults quota rendering to configurable unicode glyphs", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

    expect(source).toContain("normalizeGlyphStyle")
    expect(source).toContain("glyphs: normalizeGlyphStyle(record.glyphs)")
    expect(source).toContain("formatProviderQuotaPrompt(props.snapshots, undefined, props.glyphs)")
  })

  test("debounces quota refreshes triggered by streaming message updates", () => {
    const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")
    const body = functionBody(source, "remember")

    expect(source).toContain("eventRefreshDebounceMs")
    expect(source).toContain("let refreshInFlight = false")
    expect(source).toContain("let refreshQueued = false")
    expect(body).toContain("scheduleProviderQuotaRefresh(options.eventRefreshDebounceMs)")
    expect(body).not.toContain("refreshProviderQuota()")
  })
})
