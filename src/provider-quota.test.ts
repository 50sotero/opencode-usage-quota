import { describe, expect, test } from "bun:test"
import {
  formatProviderQuotaPrompt,
  hasNativeProviderQuotaClient,
  normalizeProviderQuotaSnapshots,
  readNativeProviderQuota,
} from "./provider-quota.js"

describe("provider quota model", () => {
  test("keeps exact and reported windows visible in compact prompt output", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 1,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 97.4, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 90.2, confidence: "reported", source: "response_headers" },
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

  test("drops malformed snapshots and clamps non-exact provider percentages", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      null,
      {
        provider: "anthropic",
        label: "Anthropic",
        fetchedAt: 1,
        status: "available",
        windows: [
          { label: "req", remainingPercent: 140, confidence: "reported", source: "response_headers" },
          { label: "tok", remainingPercent: -3, confidence: "reported", source: "response_headers" },
          { label: "bad", remainingPercent: 50, confidence: "exact", source: "private_dashboard" },
        ],
      },
    ])

    expect(snapshots).toEqual([
      {
        provider: "anthropic",
        label: "Anthropic",
        fetchedAt: 1,
        status: "available",
        windows: [
          { label: "req", remainingPercent: 100, confidence: "reported", source: "response_headers" },
          { label: "tok", remainingPercent: 0, confidence: "reported", source: "response_headers" },
        ],
      },
    ])
    expect(formatProviderQuotaPrompt(snapshots)).toBe("anthropic req 100% · tok 0%")
  })

  test("prefers active provider but falls back to first visible exact or reported quota", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "gemini",
        label: "Gemini",
        fetchedAt: 1,
        status: "available",
        windows: [{ label: "rpm", remainingPercent: 71, confidence: "reported", source: "official_api" }],
      },
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 1,
        status: "available",
        windows: [{ label: "5h", remainingPercent: 97, confidence: "exact", source: "official_api" }],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h 97%")
    expect(formatProviderQuotaPrompt(snapshots, "anthropic")).toBe("gemini rpm 71%")
  })


  test("detects explicit native provider quota helpers without hiding stock raw clients", async () => {
    expect(hasNativeProviderQuotaClient({ client: { get: async () => ({ data: { providerQuota: [] } }) } })).toBe(false)
    expect(hasNativeProviderQuotaClient({ experimental: { providerQuota: { get: async () => ({ data: { providerQuota: [] } }) } } })).toBe(true)

    const snapshots = await readNativeProviderQuota({
      client: {
        get: async () => ({
          data: {
            providerQuota: [
              {
                provider: "codex",
                label: "Codex",
                fetchedAt: 1,
                status: "available",
                windows: [{ label: "5h", remainingPercent: 91, confidence: "exact", source: "official_api" }],
              },
            ],
          },
        }),
      },
    })

    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h 91%")
  })
})
