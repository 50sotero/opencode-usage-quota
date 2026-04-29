import { describe, expect, test } from "bun:test"
import {
  formatCodexQuotaPrompt,
  formatQuotaBar,
  formatUsageQuotaStatus,
  formatUsageQuotaPrompt,
  formatUsageQuotaReport,
  normalizeCodexQuota,
  summarizeUsage,
  truncatePromptLabel,
  upsertUsageRecord,
  usageRecordFromEvent,
  usageRecordFromMessage,
  type UsageRecord,
} from "./quota.js"

const now = new Date("2026-04-28T18:00:00Z").getTime()

describe("usage quota formatting", () => {
  test("hides the prompt status when no quota or local usage is available", () => {
    expect(formatUsageQuotaPrompt(undefined, [])).toBeUndefined()
  })

  test("normalizes and formats codex five-hour and weekly quota", () => {
    const snapshot = normalizeCodexQuota({
      fiveHour: { remainingPercent: 88.4, resetSeconds: 600 },
      weekly: { remainingPercent: 94.2, resetAt: 1_765_000_000 },
      fetchedAt: now,
    })

    expect(snapshot).toEqual({
      fiveHour: { remainingPercent: 88.4, resetSeconds: 600, resetAt: undefined },
      weekly: { remainingPercent: 94.2, resetSeconds: undefined, resetAt: 1_765_000_000 },
      fetchedAt: now,
    })
    expect(formatCodexQuotaPrompt(snapshot)).toBe("5h 88% left")
    expect(formatCodexQuotaPrompt({ weekly: { remainingPercent: 94.2 } })).toBe("wk 94% left")
    const status = formatUsageQuotaStatus(snapshot)
    const report = formatUsageQuotaReport(snapshot, [])

    expect(status).toBe("codex quota 5h 88% left · wk 94% left")
    expect(formatUsageQuotaStatus(snapshot, "ascii")).toBe("codex quota 5h 88% left | wk 94% left")
    expect(report).toContain("Codex remote quota: 5h 88% left · wk 94% left")
    expect(formatUsageQuotaReport(snapshot, [], "ascii")).toContain(
      "Codex remote quota: 5h 88% left | wk 94% left",
    )
  })

  test("extracts assistant token usage from messages and events", () => {
    const message = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet",
      cost: 0.25,
      tokens: {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 10, write: 1 },
      },
    }

    expect(usageRecordFromMessage(message, now)).toMatchObject({
      id: "msg_1",
      provider: "anthropic",
      model: "claude-sonnet",
      tokens: 136,
      cost: 0.25,
      timestamp: now,
    })
    expect(usageRecordFromEvent({ type: "message.updated", properties: { info: message } }, now)).toMatchObject({
      id: "msg_1",
      tokens: 136,
    })
  })

  test("summarizes local rolling five-hour and weekly usage without calling it provider quota", () => {
    const records: UsageRecord[] = [
      { id: "old", provider: "openai", model: "gpt", tokens: 100, cost: 0.1, timestamp: now - 8 * 24 * 60 * 60 * 1000 },
      { id: "week", provider: "openai", model: "gpt", tokens: 200, cost: 0.2, timestamp: now - 2 * 24 * 60 * 60 * 1000 },
      { id: "recent", provider: "openai", model: "gpt", tokens: 300, cost: 0.3, timestamp: now - 60 * 60 * 1000 },
    ]

    const summary = summarizeUsage(records, now)
    expect(summary).toEqual([
      {
        provider: "openai",
        model: "gpt",
        fiveHourTokens: 300,
        weeklyTokens: 500,
        weeklyCost: 0.5,
      },
    ])
    expect(formatUsageQuotaPrompt(undefined, summary)).toBeUndefined()
    expect(formatUsageQuotaReport(undefined, summary)).toContain("Local OpenCode usage, not provider-enforced quota")
  })

  test("does not put local token counts in the right-side quota prompt", () => {
    const summary = [
      {
        provider: "anthropic",
        model: "claude-sonnet",
        fiveHourTokens: 1_250_000,
        weeklyTokens: 9_500_000,
        weeklyCost: 0,
      },
    ]

    const prompt = formatUsageQuotaPrompt(undefined, summary)

    expect(prompt).toBeUndefined()
    expect(formatUsageQuotaPrompt(undefined, [{ ...summary[0], fiveHourTokens: 1_000_000, weeklyTokens: 2_000 }])).toBe(
      undefined,
    )
    expect(formatUsageQuotaPrompt(undefined, [{ ...summary[0], fiveHourTokens: 0, weeklyTokens: 2_000 }])).toBe(
      undefined,
    )
    expect(formatUsageQuotaStatus(undefined)).toBe("codex quota unavailable")
  })

  test("truncates prompt labels to a terminal-safe width", () => {
    expect(truncatePromptLabel("123456789", 6)).toBe("12345…")
    expect(truncatePromptLabel("123456789", 6, "ascii")).toBe("123...")
    expect(truncatePromptLabel("short", 6)).toBe("short")
  })

  test("formats quota bars with the selected glyph style", () => {
    expect(formatQuotaBar(50, 6)).toBe("███░░░")
    expect(formatQuotaBar(50, 6, "ascii")).toBe("###---")
  })

  test("upserts usage records and prunes stale weekly entries", () => {
    const existing: UsageRecord[] = [
      { id: "stale", provider: "openai", model: "gpt", tokens: 1, cost: 0, timestamp: now - 8 * 24 * 60 * 60 * 1000 },
      { id: "same", provider: "openai", model: "gpt", tokens: 1, cost: 0, timestamp: now - 1_000 },
    ]
    const next = upsertUsageRecord(
      existing,
      { id: "same", provider: "openai", model: "gpt", tokens: 2, cost: 0, timestamp: now },
      now,
    )

    expect(next).toEqual([{ id: "same", provider: "openai", model: "gpt", tokens: 2, cost: 0, timestamp: now }])
  })
})
