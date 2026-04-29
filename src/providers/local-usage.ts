import { summarizeUsage } from "../quota.js"
import type { ProviderQuotaWindow } from "../provider-quota.js"
import type { ProviderQuotaAdapter } from "./index.js"

export const localUsageAdapter: ProviderQuotaAdapter = {
  provider: "local-usage",
  async read(ctx) {
    const now = ctx.now ?? Date.now()
    const summary = summarizeUsage(ctx.records, now)
    if (summary.length === 0) return

    const windows = summary.slice(0, 8).map(
      (item): ProviderQuotaWindow => ({
        label: `${item.provider}/${item.model ?? "unknown"}`,
        remaining: item.fiveHourTokens > 0 ? item.fiveHourTokens : item.weeklyTokens,
        confidence: "estimated",
        source: "heuristic",
      }),
    )

    return {
      provider: "local-usage",
      label: "Local usage",
      fetchedAt: now,
      status: "degraded",
      windows,
      detail: "Observed OpenCode token usage only; not provider-enforced remaining quota.",
    }
  },
}
