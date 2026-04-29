import { readCodexQuota } from "../codex-quota-client.js"
import {
  normalizeProviderQuotaSnapshots,
  type ProviderQuotaSnapshot,
  type ProviderQuotaWindow,
} from "../provider-quota.js"
import { normalizeCodexQuota, summarizeUsage, type UsageRecord } from "../quota.js"

export type ProviderQuotaAdapterContext = {
  client: unknown
  records: readonly UsageRecord[]
  now?: number
}

export type ProviderQuotaAdapter = {
  provider: string
  read: (ctx: ProviderQuotaAdapterContext) => Promise<ProviderQuotaSnapshot | undefined>
}

function nowFrom(ctx: ProviderQuotaAdapterContext) {
  return ctx.now ?? Date.now()
}

function errorDetail(error: unknown) {
  return error instanceof Error && error.message.length > 0 ? error.message : "adapter failed"
}

function unavailableSnapshot(adapter: ProviderQuotaAdapter, ctx: ProviderQuotaAdapterContext, error: unknown): ProviderQuotaSnapshot {
  return {
    provider: adapter.provider,
    label: adapter.provider,
    fetchedAt: nowFrom(ctx),
    status: "unavailable",
    windows: [],
    detail: errorDetail(error),
  }
}

export async function readProviderQuotas(adapters: readonly ProviderQuotaAdapter[], ctx: ProviderQuotaAdapterContext) {
  const results = await Promise.all(
    adapters.map(async (adapter): Promise<ProviderQuotaSnapshot | undefined> => {
      try {
        return await adapter.read(ctx)
      } catch (error) {
        return unavailableSnapshot(adapter, ctx, error)
      }
    }),
  )

  return normalizeProviderQuotaSnapshots(results.filter((item): item is ProviderQuotaSnapshot => item !== undefined))
}

export function createCodexQuotaAdapter(readQuota: (client: unknown) => Promise<unknown> | unknown = readCodexQuota): ProviderQuotaAdapter {
  return {
    provider: "codex",
    async read(ctx) {
      const snapshot = normalizeCodexQuota(await readQuota(ctx.client))
      if (!snapshot) {
        return {
          provider: "codex",
          label: "Codex",
          fetchedAt: nowFrom(ctx),
          status: "unavailable",
          windows: [],
          detail: "codex quota unavailable",
        }
      }

      const windows: ProviderQuotaWindow[] = []
      if (snapshot.fiveHour) {
        windows.push({
          label: "5h",
          remainingPercent: snapshot.fiveHour.remainingPercent,
          confidence: "exact",
          source: "official_api",
        })
      }
      if (snapshot.weekly) {
        windows.push({
          label: "wk",
          remainingPercent: snapshot.weekly.remainingPercent,
          confidence: "exact",
          source: "official_api",
        })
      }

      return {
        provider: "codex",
        label: "Codex",
        fetchedAt: snapshot.fetchedAt ?? nowFrom(ctx),
        status: "available",
        windows,
      }
    },
  }
}

function formatTokens(tokens: number) {
  return Math.round(tokens).toLocaleString("en-US")
}

export function createLocalUsageQuotaAdapter(): ProviderQuotaAdapter {
  return {
    provider: "local-usage",
    async read(ctx) {
      const [top] = summarizeUsage(ctx.records, nowFrom(ctx))
      if (!top) return

      return {
        provider: "local-usage",
        label: "Local OpenCode usage",
        fetchedAt: nowFrom(ctx),
        status: "degraded",
        windows: [],
        detail: `estimated usage only: ${top.provider}/${top.model ?? "unknown"} 5h ${formatTokens(top.fiveHourTokens)} tokens, wk ${formatTokens(top.weeklyTokens)} tokens`,
      }
    },
  }
}

export const defaultProviderQuotaAdapters = [createCodexQuotaAdapter(), createLocalUsageQuotaAdapter()]
