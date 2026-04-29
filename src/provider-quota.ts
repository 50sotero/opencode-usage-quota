export type ProviderQuotaConfidence = "exact" | "reported" | "estimated"
export type ProviderQuotaSource = "official_api" | "response_headers" | "client_state" | "heuristic"
export type ProviderQuotaStatus = "available" | "unavailable" | "degraded"

export type ProviderQuotaWindow = {
  label: string
  remainingPercent?: number
  remaining?: number
  limit?: number
  resetAt?: number
  confidence: ProviderQuotaConfidence
  source: ProviderQuotaSource
}

export type ProviderQuotaSnapshot = {
  provider: string
  label: string
  fetchedAt?: number
  status: ProviderQuotaStatus
  windows: ProviderQuotaWindow[]
  detail?: string
}

const confidences = new Set<ProviderQuotaConfidence>(["exact", "reported", "estimated"])
const sources = new Set<ProviderQuotaSource>(["official_api", "response_headers", "client_state", "heuristic"])
const statuses = new Set<ProviderQuotaStatus>(["available", "unavailable", "degraded"])
const compactConfidences = new Set<ProviderQuotaConfidence>(["exact", "reported"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function clampProviderQuotaPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeWindow(value: unknown): ProviderQuotaWindow | undefined {
  if (!isRecord(value)) return

  const label = nonEmptyString(value.label)
  const confidence = confidences.has(value.confidence as ProviderQuotaConfidence)
    ? (value.confidence as ProviderQuotaConfidence)
    : undefined
  const source = sources.has(value.source as ProviderQuotaSource) ? (value.source as ProviderQuotaSource) : undefined

  if (!label || !confidence || !source) return

  const remainingPercent = finiteNumber(value.remainingPercent)
  const remaining = finiteNumber(value.remaining)
  const limit = finiteNumber(value.limit)
  const resetAt = finiteNumber(value.resetAt)

  if (remainingPercent === undefined && remaining === undefined && limit === undefined && resetAt === undefined) return

  return {
    label,
    remainingPercent,
    remaining,
    limit,
    resetAt,
    confidence,
    source,
  }
}

function normalizeSnapshot(value: unknown): ProviderQuotaSnapshot | undefined {
  if (!isRecord(value)) return

  const provider = nonEmptyString(value.provider)
  if (!provider) return

  const rawWindows = Array.isArray(value.windows) ? value.windows : []
  const windows = rawWindows.map(normalizeWindow).filter((window): window is ProviderQuotaWindow => Boolean(window))
  if (windows.length === 0) return

  const label = nonEmptyString(value.label) ?? provider
  const fetchedAt = finiteNumber(value.fetchedAt)
  const detail = nonEmptyString(value.detail)
  const status = statuses.has(value.status as ProviderQuotaStatus) ? (value.status as ProviderQuotaStatus) : "degraded"

  return {
    provider,
    label,
    fetchedAt,
    status,
    windows,
    detail,
  }
}

export function normalizeProviderQuotaSnapshots(values: unknown): ProviderQuotaSnapshot[] {
  if (!Array.isArray(values)) return []
  return values.map(normalizeSnapshot).filter((snapshot): snapshot is ProviderQuotaSnapshot => Boolean(snapshot))
}

export function visibleProviderQuotaWindows(snapshot: ProviderQuotaSnapshot | undefined) {
  if (!snapshot || snapshot.status === "unavailable") return []
  return snapshot.windows.filter((window) => compactConfidences.has(window.confidence) && window.remainingPercent !== undefined)
}

function providerHasVisibleQuota(snapshot: ProviderQuotaSnapshot) {
  return visibleProviderQuotaWindows(snapshot).length > 0
}

function selectProviderQuotaSnapshot(snapshots: readonly ProviderQuotaSnapshot[], activeProvider?: string) {
  const active = activeProvider ? snapshots.find((snapshot) => snapshot.provider === activeProvider && providerHasVisibleQuota(snapshot)) : undefined
  return active ?? snapshots.find(providerHasVisibleQuota)
}

export function formatProviderQuotaPrompt(snapshots: readonly ProviderQuotaSnapshot[], activeProvider?: string) {
  const snapshot = selectProviderQuotaSnapshot(snapshots, activeProvider)
  if (!snapshot) return

  const parts = visibleProviderQuotaWindows(snapshot).map(
    (window) => `${window.label} ${clampProviderQuotaPercent(window.remainingPercent!)}%`,
  )
  if (parts.length === 0) return

  return `${snapshot.provider} ${parts.join(" · ")}`
}


function formatProviderQuotaValue(window: ProviderQuotaWindow) {
  const values = []
  if (window.remainingPercent !== undefined) values.push(`${clampProviderQuotaPercent(window.remainingPercent)}%`)
  if (window.remaining !== undefined && window.limit !== undefined) values.push(`${Math.round(window.remaining)}/${Math.round(window.limit)}`)
  else if (window.remaining !== undefined) values.push(`${Math.round(window.remaining).toLocaleString("en-US")}`)
  return values.length > 0 ? values.join(" ") : "status only"
}

export function formatProviderQuotaReport(snapshots: readonly ProviderQuotaSnapshot[]) {
  const lines = ["Provider quota status", ""]

  if (snapshots.length === 0) {
    lines.push("No provider quota snapshots are available yet.")
    return lines.join("\n")
  }

  for (const snapshot of snapshots) {
    const suffix = snapshot.detail ? ` — ${snapshot.detail}` : ""
    lines.push(`${snapshot.label} (${snapshot.provider}): ${snapshot.status}${suffix}`)
    for (const window of snapshot.windows) {
      lines.push(`- ${window.label}: ${formatProviderQuotaValue(window)} ${window.confidence} from ${window.source}`)
    }
    lines.push("")
  }

  lines.push("Confidence labels: exact = current provider-reported remaining quota; reported = official limits/headers; estimated = local usage or heuristic, not provider-enforced remaining quota.")
  return lines.join("\n").trimEnd()
}

type ProviderQuotaClientMethod = (input?: unknown) => Promise<{ data?: unknown }>
type RawClientGetMethod = (input: { url: string }) => Promise<{ data?: unknown }>

function generatedProviderQuotaReader(client: unknown) {
  if (!isRecord(client)) return
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  const providerQuota = experimental?.providerQuota
  if (typeof providerQuota === "function") {
    const method = providerQuota as ProviderQuotaClientMethod
    return async () => (await method({})).data
  }
  if (isRecord(providerQuota)) {
    if (typeof providerQuota.get === "function") {
      const method = providerQuota.get as ProviderQuotaClientMethod
      return async () => (await method({})).data
    }
    if (typeof providerQuota.list === "function") {
      const method = providerQuota.list as ProviderQuotaClientMethod
      return async () => (await method({})).data
    }
  }
}

function rawProviderQuotaReader(client: unknown) {
  if (!isRecord(client)) return
  const rawClient = isRecord(client.client) ? client.client : undefined
  if (typeof rawClient?.get !== "function") return
  const get = rawClient.get as RawClientGetMethod
  return async () => (await get({ url: "/experimental/provider-quota" })).data
}

export function hasNativeProviderQuotaClient(client: unknown) {
  return Boolean(generatedProviderQuotaReader(client))
}

export async function readNativeProviderQuota(client: unknown) {
  const readers = [generatedProviderQuotaReader(client), rawProviderQuotaReader(client)].filter(
    (reader): reader is () => Promise<unknown> => Boolean(reader),
  )

  for (const reader of readers) {
    try {
      const data = await reader()
      if (Array.isArray(data)) return normalizeProviderQuotaSnapshots(data)
      if (isRecord(data)) {
        if (Array.isArray(data.providerQuota)) return normalizeProviderQuotaSnapshots(data.providerQuota)
        if (Array.isArray(data.provider_quota)) return normalizeProviderQuotaSnapshots(data.provider_quota)
        if (Array.isArray(data.snapshots)) return normalizeProviderQuotaSnapshots(data.snapshots)
      }
    } catch {
      // Try the next available client surface. Stock OpenCode may not have this endpoint.
    }
  }

  return []
}
