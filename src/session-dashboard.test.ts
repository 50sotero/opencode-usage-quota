import { describe, expect, test } from "bun:test"
import { formatSessionDashboardPrompt, formatSessionDashboardReport, summarizeSessionUsage } from "./session-dashboard.js"
import { normalizeProviderQuotaSnapshots } from "./provider-quota.js"
import { usageRecordFromMessage, type UsageRecord } from "./quota.js"

const now = new Date("2026-04-29T12:00:00Z").getTime()

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: overrides.id ?? "msg_1",
    sessionID: overrides.sessionID ?? "ses_1",
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-5.5",
    tokens: overrides.tokens ?? 136,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 20,
    reasoningTokens: overrides.reasoningTokens ?? 5,
    cacheReadTokens: overrides.cacheReadTokens ?? 10,
    cacheWriteTokens: overrides.cacheWriteTokens ?? 1,
    cost: overrides.cost ?? 0.25,
    timestamp: overrides.timestamp ?? now,
  }
}

describe("session dashboard metrics", () => {
  test("extracts token buckets for dashboard reporting without changing total tokens", () => {
    const usage = usageRecordFromMessage(
      {
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.5",
        cost: 0.25,
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 1 } },
      },
      now,
    )

    expect(usage).toMatchObject({
      tokens: 136,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 1,
    })
  })

  test("summarizes one session separately from other sessions", () => {
    const summary = summarizeSessionUsage(
      [record(), record({ id: "msg_2", sessionID: "ses_2", tokens: 999, inputTokens: 999 })],
      "ses_1",
      { contextLimit: 200 },
    )

    expect(summary).toMatchObject({
      sessionID: "ses_1",
      provider: "openai",
      model: "gpt-5.5",
      messageCount: 1,
      totalTokens: 136,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 1,
      cost: 0.25,
      context: { usedTokens: 100, limitTokens: 200, usedPercent: 50, source: "observed_input" },
    })
  })

  test("keeps the existing quota prompt intact until session usage exists", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: now,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 78, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 86, confidence: "exact", source: "official_api" },
        ],
      },
    ])

    const quotaOnly = formatSessionDashboardPrompt({ snapshots, records: [], sessionID: "ses_1", now })
    expect(quotaOnly).toContain("Codex · 5h ████████░░ 78% · wk █████████░ 86%")
    expect(quotaOnly).not.toContain("sess")

    const withSession = formatSessionDashboardPrompt({
      snapshots,
      records: [record()],
      sessionID: "ses_1",
      now,
      contextLimit: 200,
    })
    expect(withSession).toContain("Codex · 5h ████████░░ 78% · wk █████████░ 86%")
    expect(withSession).toContain("ctx 100/200 50%")
    expect(withSession).toContain("tok 136")
  })

  test("drops lower priority session extras before overflowing compact prompt budget", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: now,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 78, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 86, confidence: "exact", source: "official_api" },
        ],
      },
    ])

    const compact = formatSessionDashboardPrompt({
      snapshots,
      records: [record()],
      sessionID: "ses_1",
      contextLimit: 200,
      maxPromptLength: 70,
    })

    const compactText = compact ?? ""
    expect(compactText).toContain("Codex · 5h ████████░░ 78% · wk █████████░ 86%")
    expect(compactText).toContain("ctx 100/200 50%")
    expect(compactText).not.toContain("tok 136")
    expect(compactText.length).toBeLessThanOrEqual(70)
  })

  test("formats /dashboard detail with confidence-safe sections", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: now,
        status: "available",
        windows: [{ label: "5h", remainingPercent: 78, confidence: "exact", source: "official_api" }],
      },
    ])

    const report = formatSessionDashboardReport({
      snapshots,
      records: [record()],
      sessionID: "ses_1",
      now,
      contextLimit: 200,
    })

    expect(report).toContain("Session dashboard")
    expect(report).toContain("Quota")
    expect(report).toContain("Current session")
    expect(report).toContain("Input       100")
    expect(report).toContain("Cache read  10")
    expect(report).toContain("Context")
    expect(report).toContain("Source      observed assistant input tokens")
    expect(report).toContain("Estimated/local usage is not provider-enforced quota")
  })
})
