import { readCodexQuota } from "../codex-quota-client.js"
import { normalizeCodexQuota, type QuotaWindow } from "../quota.js"
import type { ProviderQuotaAdapter } from "./index.js"
import type { ProviderQuotaWindow } from "../provider-quota.js"

function resetAtFrom(window: QuotaWindow, now: number) {
  if (Number.isFinite(window.resetAt)) return window.resetAt
  if (Number.isFinite(window.resetSeconds)) return now + window.resetSeconds! * 1000
}

function quotaWindow(label: string, window: QuotaWindow | undefined, now: number): ProviderQuotaWindow | undefined {
  if (!window) return
  return {
    label,
    remainingPercent: window.remainingPercent,
    resetAt: resetAtFrom(window, now),
    confidence: "exact",
    source: "official_api",
  }
}

export const codexQuotaAdapter: ProviderQuotaAdapter = {
  provider: "codex",
  async read(ctx) {
    const now = ctx.now ?? Date.now()
    const snapshot = normalizeCodexQuota(await readCodexQuota(ctx.client))
    if (!snapshot) return

    const windows = [quotaWindow("5h", snapshot.fiveHour, now), quotaWindow("wk", snapshot.weekly, now)].filter(
      (window): window is ProviderQuotaWindow => Boolean(window),
    )

    if (windows.length === 0) return

    return {
      provider: "codex",
      label: "Codex",
      fetchedAt: snapshot.fetchedAt ?? now,
      status: "available",
      windows,
    }
  },
}
