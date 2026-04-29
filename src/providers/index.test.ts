import { describe, expect, test } from "bun:test"
import { codexQuotaAdapter } from "./codex.js"
import { localUsageAdapter } from "./local-usage.js"
import { readProviderQuotas, type ProviderQuotaAdapter } from "./index.js"
import type { UsageRecord } from "../quota.js"

const now = new Date("2026-04-29T09:00:00Z").getTime()

describe("provider quota adapters", () => {
  test("isolates adapter failures as unavailable snapshots", async () => {
    const adapters: ProviderQuotaAdapter[] = [
      {
        provider: "ok",
        read: async () => ({
          provider: "ok",
          label: "OK",
          fetchedAt: now,
          status: "available",
          windows: [{ label: "req", remainingPercent: 80, confidence: "reported", source: "response_headers" }],
        }),
      },
      {
        provider: "broken",
        read: async () => {
          throw new Error("boom")
        },
      },
    ]

    await expect(readProviderQuotas(adapters, { client: {}, records: [], now })).resolves.toEqual([
      {
        provider: "ok",
        label: "OK",
        fetchedAt: now,
        status: "available",
        windows: [{ label: "req", remainingPercent: 80, confidence: "reported", source: "response_headers" }],
      },
      {
        provider: "broken",
        label: "broken",
        fetchedAt: now,
        status: "unavailable",
        windows: [{ label: "status", confidence: "reported", source: "client_state" }],
        detail: "provider quota adapter failed",
      },
    ])
  })

  test("converts Codex quota into exact provider windows", async () => {
    const client = {
      experimental: {
        console: {
          codexQuota: async () => ({
            data: {
              fiveHour: { remainingPercent: 97.4, resetSeconds: 120 },
              weekly: { remainingPercent: 90.2, resetAt: 1_765_000_000 },
              fetchedAt: now,
            },
          }),
        },
      },
    }

    await expect(codexQuotaAdapter.read({ client, records: [], now })).resolves.toEqual({
      provider: "codex",
      label: "Codex",
      fetchedAt: now,
      status: "available",
      windows: [
        { label: "5h", remainingPercent: 97.4, resetAt: now + 120_000, confidence: "exact", source: "official_api" },
        { label: "wk", remainingPercent: 90.2, resetAt: 1_765_000_000, confidence: "exact", source: "official_api" },
      ],
    })
  })

  test("reports local usage as estimated detail without compact remaining quota", async () => {
    const records: UsageRecord[] = [
      { id: "a", provider: "anthropic", model: "claude", tokens: 2500, cost: 0.02, timestamp: now - 1_000 },
    ]

    await expect(localUsageAdapter.read({ client: {}, records, now })).resolves.toEqual({
      provider: "local-usage",
      label: "Local usage",
      fetchedAt: now,
      status: "degraded",
      windows: [{ label: "anthropic/claude", remaining: 2500, confidence: "estimated", source: "heuristic" }],
      detail: "Observed OpenCode token usage only; not provider-enforced remaining quota.",
    })
  })
})
