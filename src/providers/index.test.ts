import { describe, expect, test } from "bun:test"
import { formatProviderQuotaPrompt } from "../provider-quota.js"
import { createCodexQuotaAdapter, createLocalUsageQuotaAdapter, readProviderQuotas, type ProviderQuotaAdapter } from "./index.js"

describe("provider quota adapter registry", () => {
  test("isolates adapter failures as unavailable snapshots", async () => {
    const adapters: ProviderQuotaAdapter[] = [
      {
        provider: "broken",
        read: async () => {
          throw new Error("provider timed out")
        },
      },
      {
        provider: "codex",
        read: async () => ({
          provider: "codex",
          label: "Codex",
          fetchedAt: 42,
          status: "available",
          windows: [{ label: "5h", remainingPercent: 97, confidence: "exact", source: "official_api" }],
        }),
      },
    ]

    const snapshots = await readProviderQuotas(adapters, { client: {}, records: [], now: 42 })

    expect(snapshots).toEqual([
      {
        provider: "broken",
        label: "broken",
        fetchedAt: 42,
        status: "unavailable",
        windows: [],
        detail: "provider timed out",
      },
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 42,
        status: "available",
        windows: [{ label: "5h", remainingPercent: 97, confidence: "exact", source: "official_api" }],
      },
    ])
  })

  test("converts Codex quota into exact provider windows", async () => {
    const adapter = createCodexQuotaAdapter(async () => ({
      fiveHour: { remainingPercent: 97.2 },
      weekly: { remainingPercent: 90.1 },
      fetchedAt: 7,
    }))

    const snapshots = await readProviderQuotas([adapter], { client: {}, records: [], now: 99 })

    expect(snapshots).toEqual([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 7,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 97.2, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 90.1, confidence: "exact", source: "official_api" },
        ],
      },
    ])
    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h 97% · wk 90%")
  })

  test("labels local usage as estimated detail data and keeps it out of compact prompt", async () => {
    const now = new Date("2026-04-29T09:00:00Z").getTime()
    const snapshots = await readProviderQuotas([createLocalUsageQuotaAdapter()], {
      client: {},
      now,
      records: [
        { id: "1", provider: "anthropic", model: "claude", tokens: 1200, cost: 0.5, timestamp: now - 60_000 },
      ],
    })

    expect(snapshots).toEqual([
      {
        provider: "local-usage",
        label: "Local OpenCode usage",
        fetchedAt: now,
        status: "degraded",
        windows: [],
        detail: "estimated usage only: anthropic/claude 5h 1,200 tokens, wk 1,200 tokens",
      },
    ])
    expect(formatProviderQuotaPrompt(snapshots, "local-usage")).toBeUndefined()
  })
})
