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
  fetchedAt: number
  status: ProviderQuotaStatus
  windows: ProviderQuotaWindow[]
  detail?: string
}

const confidenceValues = new Set<ProviderQuotaConfidence>(["exact", "reported", "estimated"])
const sourceValues = new Set<ProviderQuotaSource>(["official_api", "response_headers", "client_state", "heuristic"])
const statusValues = new Set<ProviderQuotaStatus>(["available", "unavailable", "degraded"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonNegativeNumber(value: unknown) {
  const number = finiteNumber(value)
  return number === undefined ? undefined : Math.max(0, number)
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function normalizeWindow(value: unknown): ProviderQuotaWindow | undefined {
  if (!isRecord(value)) return

  const label = nonEmptyString(value.label)
  const confidence = confidenceValues.has(value.confidence as ProviderQuotaConfidence)
    ? (value.confidence as ProviderQuotaConfidence)
    : undefined
  const source = sourceValues.has(value.source as ProviderQuotaSource) ? (value.source as ProviderQuotaSource) : undefined

  if (!label || !confidence || !source) return

  const remainingPercent = finiteNumber(value.remainingPercent)
  const remaining = nonNegativeNumber(value.remaining)
  const limit = nonNegativeNumber(value.limit)
  const resetAt = nonNegativeNumber(value.resetAt)

  return {
    label,
    remainingPercent: remainingPercent === undefined ? undefined : clampPercent(remainingPercent),
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
  const label = nonEmptyString(value.label)
  const fetchedAt = finiteNumber(value.fetchedAt)
  const status = statusValues.has(value.status as ProviderQuotaStatus) ? (value.status as ProviderQuotaStatus) : undefined

  if (!provider || !label || fetchedAt === undefined || !status) return

  const windows = Array.isArray(value.windows)
    ? value.windows.map(normalizeWindow).filter((item): item is ProviderQuotaWindow => item !== undefined)
    : []
  const detail = nonEmptyString(value.detail)

  return {
    provider,
    label,
    fetchedAt,
    status,
    windows,
    detail,
  }
}

export function normalizeProviderQuotaSnapshots(value: unknown): ProviderQuotaSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeSnapshot).filter((item): item is ProviderQuotaSnapshot => item !== undefined)
}

function promptWindows(snapshot: ProviderQuotaSnapshot) {
  if (snapshot.status === "unavailable") return []
  return snapshot.windows.filter(
    (window) => window.remainingPercent !== undefined && (window.confidence === "exact" || window.confidence === "reported"),
  )
}

function snapshotWithPromptWindows(snapshots: readonly ProviderQuotaSnapshot[], provider?: string) {
  const preferred = provider ? snapshots.find((snapshot) => snapshot.provider === provider && promptWindows(snapshot).length > 0) : undefined
  return preferred ?? snapshots.find((snapshot) => promptWindows(snapshot).length > 0)
}

export function formatProviderQuotaPrompt(snapshots: readonly ProviderQuotaSnapshot[], activeProvider?: string) {
  const snapshot = snapshotWithPromptWindows(snapshots, activeProvider)
  if (!snapshot) return

  const parts = promptWindows(snapshot).map((window) => `${window.label} ${Math.round(clampPercent(window.remainingPercent!))}%`)
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

function generatedProviderQuotaReader(client: unknown) {
  if (!isRecord(client)) return
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  const providerQuota = experimental?.providerQuota
  if (typeof providerQuota === "function") return async () => (await providerQuota({})).data
  if (isRecord(providerQuota)) {
    if (typeof providerQuota.get === "function") return async () => (await providerQuota.get({})).data
    if (typeof providerQuota.list === "function") return async () => (await providerQuota.list({})).data
  }
  if (isRecord(experimental) && typeof experimental.providerQuota === "function") {
    return async () => (await experimental.providerQuota({})).data
  }
}

function rawProviderQuotaReader(client: unknown) {
  if (!isRecord(client)) return
  const rawClient = isRecord(client.client) ? client.client : undefined
  if (typeof rawClient?.get !== "function") return
  return async () => (await rawClient.get({ url: "/experimental/provider-quota" })).data
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
