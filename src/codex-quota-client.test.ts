import { describe, expect, test } from "bun:test"
import { codexQuotaFromWhamUsage, readCodexQuota } from "./codex-quota-client.js"

describe("Codex quota client", () => {
  test("uses the generated codexQuota helper when OpenCode exposes it", async () => {
    const data = { fiveHour: { remainingPercent: 72 } }
    const client = {
      experimental: {
        console: {
          codexQuota: async (input: unknown) => ({ data, input }),
          get: async () => ({ data: { codexQuota: { weekly: { remainingPercent: 11 } } } }),
        },
      },
      client: {
        get: async () => ({ data: "wrong" }),
      },
    }

    await expect(readCodexQuota(client)).resolves.toEqual(data)
  })

  test("falls back to the synced console state when the direct helper is absent", async () => {
    const data = { fiveHour: { remainingPercent: 97 }, weekly: { remainingPercent: 90 } }
    const calls: unknown[] = []
    const client = {
      experimental: {
        console: {
          get: async (input: unknown) => {
            calls.push(input)
            return { data: { codexQuota: data } }
          },
        },
      },
    }

    await expect(readCodexQuota(client)).resolves.toEqual(data)
    expect(calls).toEqual([{}])
  })

  test("falls back to the raw endpoint when generated console methods are absent", async () => {
    const data = { weekly: { remainingPercent: 64 } }
    const calls: unknown[] = []
    const client = {
      experimental: { console: {} },
      client: {
        get: async (input: unknown) => {
          calls.push(input)
          return { data }
        },
      },
    }

    await expect(readCodexQuota(client)).resolves.toEqual(data)
    expect(calls).toEqual([{ url: "/experimental/console/codex-quota" }])
  })

  test("falls through when the direct helper fails before console state is ready", async () => {
    const data = { weekly: { remainingPercent: 88 } }
    const client = {
      experimental: {
        console: {
          codexQuota: async () => {
            throw new Error("endpoint temporarily unavailable")
          },
          get: async () => ({ data: { codexQuota: data } }),
        },
      },
    }

    await expect(readCodexQuota(client)).resolves.toEqual(data)
  })

  test("normalizes ChatGPT wham usage into remaining Codex quota windows", () => {
    expect(
      codexQuotaFromWhamUsage(
        {
          rate_limit: {
            primary_window: {
              used_percent: 16,
              reset_after_seconds: 8_695,
              reset_at: 1_777_467_217,
            },
            secondary_window: {
              used_percent: "13",
              reset_after_seconds: "504856",
              reset_at: "1777963379",
            },
          },
        },
        123,
      ),
    ).toEqual({
      fiveHour: {
        remainingPercent: 84,
        resetSeconds: 8_695,
        resetAt: 1_777_467_217_000,
      },
      weekly: {
        remainingPercent: 87,
        resetSeconds: 504_856,
        resetAt: 1_777_963_379_000,
      },
      fetchedAt: 123,
    })
  })

  test("ignores stock OpenCode SPA fallback HTML and reads ChatGPT wham usage", async () => {
    const calls: unknown[] = []
    const client = {
      client: {
        get: async (input: unknown) => {
          calls.push(input)
          return { data: "<!doctype html><title>OpenCode</title>" }
        },
      },
    }

    const fetchCalls: unknown[] = []
    const fetch = async (input: string, init?: { headers?: Record<string, string> }) => {
      fetchCalls.push({ input, headers: Object.keys(init?.headers ?? {}).sort() })
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            rate_limit: {
              primary_window: { used_percent: 16 },
              secondary_window: { used_percent: 13 },
            },
          }
        },
      }
    }

    await expect(
      readCodexQuota(client, {
        auth: { access: "access-token", accountId: "account-id" },
        fetch,
        now: 456,
      }),
    ).resolves.toEqual({
      fiveHour: { remainingPercent: 84, resetSeconds: undefined, resetAt: undefined },
      weekly: { remainingPercent: 87, resetSeconds: undefined, resetAt: undefined },
      fetchedAt: 456,
    })
    expect(calls).toEqual([{ url: "/experimental/console/codex-quota" }])
    expect(fetchCalls).toEqual([
      {
        input: "https://chatgpt.com/backend-api/wham/usage",
        headers: ["accept", "authorization", "chatgpt-account-id", "user-agent"],
      },
    ])
  })
})
