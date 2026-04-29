import { describe, expect, test } from "bun:test"
import {
  formatProviderQuotaPrompt,
  formatProviderQuotaReport,
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

    const prompt = formatProviderQuotaPrompt(snapshots, "codex")

    expect(prompt).toBe("codex 5h ██████████ 97% · wk █████████░ 90%")
    expect(formatProviderQuotaPrompt(snapshots, "codex", "ascii")).toBe("codex 5h ########## 97% | wk #########- 90%")
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

  test("keeps compact prompt visible when codex quota is not available yet", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 1,
        status: "unavailable",
        windows: [],
        detail: "codex quota unavailable",
      },
    ])

    expect(formatProviderQuotaPrompt([])).toBe("codex quota unavailable")
    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex quota unavailable")
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
    expect(formatProviderQuotaPrompt(snapshots)).toBe("anthropic req ██████████ 100% · tok ░░░░░░░░░░ 0%")
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

    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h ██████████ 97%")
    expect(formatProviderQuotaPrompt(snapshots, "anthropic")).toBe("gemini rpm ███████░░░ 71%")
  })

  test("reads native OpenCode provider quota snapshots from generated clients", async () => {
    const client = {
      experimental: {
        providerQuota: async () => ({
          data: {
            providerQuota: [
              {
                provider: "anthropic",
                label: "Anthropic",
                fetchedAt: 3,
                status: "available",
                windows: [{ label: "req", remainingPercent: 82, confidence: "reported", source: "response_headers" }],
              },
            ],
          },
        }),
      },
    }

    expect(hasNativeProviderQuotaClient(client)).toBe(true)
    await expect(readNativeProviderQuota(client)).resolves.toEqual([
      {
        provider: "anthropic",
        label: "Anthropic",
        fetchedAt: 3,
        status: "available",
        windows: [{ label: "req", remainingPercent: 82, confidence: "reported", source: "response_headers" }],
      },
    ])
  })

  test("formats detail reports with confidence labels", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "openrouter",
        label: "OpenRouter",
        fetchedAt: 4,
        status: "degraded",
        windows: [{ label: "credits", remaining: 12, limit: 20, confidence: "reported", source: "official_api" }],
        detail: "key-level credits",
      },
    ])

    const report = formatProviderQuotaReport(snapshots)

    expect(report).toContain("OpenRouter (openrouter): degraded — key-level credits")
    expect(formatProviderQuotaReport(snapshots, "ascii")).toContain(
      "OpenRouter (openrouter): degraded - key-level credits",
    )
    expect(report).toContain("credits: 12/20 reported from official_api")
    expect(formatProviderQuotaReport([])).toContain("No provider quota snapshots")
  })
})
