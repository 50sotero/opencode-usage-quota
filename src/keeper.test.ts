import { describe, expect, test } from "bun:test"
import {
  containsQuotaEndpoint,
  createRepairPlan,
  hasDuplicateUsageQuotaPlugin,
  summarizeMemoryCap,
  type KeeperRepairInput,
} from "./keeper.js"

describe("opencode quota keeper", () => {
  test("detects either native or codex quota endpoint strings", () => {
    expect(containsQuotaEndpoint("GET /experimental/provider-quota")).toBe(true)
    expect(containsQuotaEndpoint("/experimental/console/codex-quota")).toBe(true)
    expect(containsQuotaEndpoint("stock opencode")).toBe(false)
  })

  test("detects duplicate usage quota plugin entries only when native quota is present", () => {
    const config = {
      plugin: [
        "github:someone/other-plugin",
        ["/repo/opencode-usage-quota/src/tui.tsx", { refreshMs: 60000 }],
      ],
    }

    expect(hasDuplicateUsageQuotaPlugin(config, true)).toBe(true)
    expect(hasDuplicateUsageQuotaPlugin(config, false)).toBe(false)
    expect(hasDuplicateUsageQuotaPlugin({ plugin: ["github:someone/other-plugin"] }, true)).toBe(false)
  })

  test("summarizes memory cap pass and fail states", () => {
    expect(summarizeMemoryCap(881_428, 1_200_000)).toEqual({ ok: true, maxRssKb: 881_428, capKb: 1_200_000 })
    expect(summarizeMemoryCap(1_250_000, 1_200_000)).toEqual({ ok: false, maxRssKb: 1_250_000, capKb: 1_200_000 })
  })

  test("plans repair as backup then install and refuses missing patched binary", () => {
    const input: KeeperRepairInput = {
      installedBinary: "/home/user/.opencode/bin/opencode",
      patchedBinary: "/repo/opencode/packages/opencode/opencode",
      backupBinary: "/home/user/.opencode/bin/opencode.bak-20260429",
      installedHasQuotaEndpoint: false,
      patchedBinaryExists: true,
    }

    expect(createRepairPlan(input)).toEqual({
      needed: true,
      steps: [
        { action: "backup", from: input.installedBinary, to: input.backupBinary },
        { action: "install", from: input.patchedBinary, to: input.installedBinary },
      ],
    })

    expect(createRepairPlan({ ...input, installedHasQuotaEndpoint: true })).toEqual({ needed: false, steps: [] })
    expect(() => createRepairPlan({ ...input, patchedBinaryExists: false })).toThrow("patched OpenCode binary is missing")
  })
})
