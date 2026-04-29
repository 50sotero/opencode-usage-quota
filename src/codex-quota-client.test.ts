import { describe, expect, test } from "bun:test"
import { readCodexQuota } from "./codex-quota-client.js"

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
})
