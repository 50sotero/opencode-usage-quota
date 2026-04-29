import { describe, expect, test } from "bun:test"
import { formatProviderQuotaPrompt, normalizeProviderQuotaSnapshots } from "./provider-quota.js"

describe("provider quota model", () => {
  test("keeps exact and reported windows visible in compact prompt output", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 1,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 97, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 90, confidence: "exact", source: "official_api" },
        ],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h 97% · wk 90%")
  })

  test("hides estimated-only windows from compact prompt output", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "copilot",
        label: "Copilot",
        fetchedAt: 1,
        status: "degraded",
        windows: [{ label: "weekly", remainingPercent: 58, confidence: "estimated", source: "heuristic" }],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "copilot")).toBeUndefined()
  })

  test("clamps percentages and falls back to the first visible provider", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "local",
        label: "Local usage",
        fetchedAt: 1,
        status: "degraded",
        windows: [{ label: "wk", remainingPercent: 67, confidence: "estimated", source: "heuristic" }],
      },
      {
        provider: "anthropic",
        label: "Anthropic",
        fetchedAt: 2,
        status: "available",
        windows: [{ label: "req", remainingPercent: 100.8, confidence: "reported", source: "response_headers" }],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "missing")).toBe("anthropic req 100%")
  })

  test("drops malformed snapshots and windows", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      null,
      { provider: "", label: "Bad", fetchedAt: 1, status: "available", windows: [] },
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: Number.NaN,
        status: "unknown",
        windows: [
          { label: "", remainingPercent: 88, confidence: "exact", source: "official_api" },
          { label: "5h", remainingPercent: "bad", confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 91.2, confidence: "exact", source: "official_api" },
        ],
      },
    ])

    expect(snapshots).toEqual([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: undefined,
        status: "degraded",
        windows: [{ label: "wk", remainingPercent: 91.2, confidence: "exact", source: "official_api" }],
      },
    ])
  })
})
