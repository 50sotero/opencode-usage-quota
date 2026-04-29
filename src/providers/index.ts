import type { ProviderQuotaSnapshot } from "../provider-quota.js"
import type { UsageRecord } from "../quota.js"

export type ProviderQuotaAdapterContext = {
  client: unknown
  records: readonly UsageRecord[]
  now?: number
}

export type ProviderQuotaAdapter = {
  provider: string
  read: (ctx: ProviderQuotaAdapterContext) => Promise<ProviderQuotaSnapshot | undefined>
}

export async function readProviderQuotas(adapters: readonly ProviderQuotaAdapter[], ctx: ProviderQuotaAdapterContext) {
  const now = ctx.now ?? Date.now()
  const results = await Promise.allSettled(adapters.map(async (adapter) => ({ adapter, snapshot: await adapter.read({ ...ctx, now }) })))
  const snapshots: ProviderQuotaSnapshot[] = []

  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    const adapter = adapters[index]
    if (result.status === "fulfilled") {
      if (result.value.snapshot) snapshots.push(result.value.snapshot)
      continue
    }

    snapshots.push({
      provider: adapter.provider,
      label: adapter.provider,
      fetchedAt: now,
      status: "unavailable",
      windows: [{ label: "status", confidence: "reported", source: "client_state" }],
      detail: "provider quota adapter failed",
    })
  }

  return snapshots
}
