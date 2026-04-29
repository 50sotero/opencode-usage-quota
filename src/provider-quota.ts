import { quotaGlyphs, type GlyphStyle } from "./glyphs.js"

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

type ProviderQuotaClientMethod = (input?: unknown) => Promise<{ data?: unknown }>
type RawClientGetMethod = (input: { url: string }) => Promise<{ data?: unknown }>
type NativeQuotaReader = () => Promise<unknown>

const confidenceValues = new Set<ProviderQuotaConfidence>(["exact", "reported", "estimated"])
const sourceValues = new Set<ProviderQuotaSource>(["official_api", "response_headers", "client_state", "heuristic"])
const statusValues = new Set<ProviderQuotaStatus>(["available", "unavailable", "degraded"])
const promptConfidenceValues = new Set<ProviderQuotaConfidence>(["exact", "reported"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonNegativeNumber(value: unknown) {
  const number = finiteNumber(value)
  return number === undefined ? undefined : Math.max(0, number)
}

export function clampProviderQuotaPercent(value: number) {
  if (!Number.isFinite(value)) return 0
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
    remainingPercent: remainingPercent === undefined ? undefined : clampProviderQuotaPercent(remainingPercent),
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

export function visibleProviderQuotaWindows(snapshot: ProviderQuotaSnapshot | undefined) {
  if (!snapshot || snapshot.status === "unavailable") return []
  return snapshot.windows.filter(
    (window) => window.remainingPercent !== undefined && promptConfidenceValues.has(window.confidence),
  )
}

function snapshotWithPromptWindows(snapshots: readonly ProviderQuotaSnapshot[], provider?: string) {
  const preferred = provider
    ? snapshots.find((snapshot) => snapshot.provider === provider && visibleProviderQuotaWindows(snapshot).length > 0)
    : undefined
  return preferred ?? snapshots.find((snapshot) => visibleProviderQuotaWindows(snapshot).length > 0)
}

function unavailableSnapshot(snapshots: readonly ProviderQuotaSnapshot[], provider?: string) {
  const preferred = provider
    ? snapshots.find((snapshot) => snapshot.provider === provider && snapshot.status === "unavailable")
    : undefined
  return (
    preferred ??
    snapshots.find((snapshot) => snapshot.provider === "codex" && snapshot.status === "unavailable") ??
    snapshots.find((snapshot) => snapshot.status === "unavailable")
  )
}

function formatUnavailablePrompt(snapshot: ProviderQuotaSnapshot | undefined) {
  return `${snapshot?.provider ?? "codex"} quota unavailable`
}

export function formatProviderQuotaPrompt(
  snapshots: readonly ProviderQuotaSnapshot[],
  activeProvider?: string,
  glyphStyle: GlyphStyle = "unicode",
) {
  const snapshot = snapshotWithPromptWindows(snapshots, activeProvider)
  if (!snapshot) {
    const unavailable = unavailableSnapshot(snapshots, activeProvider)
    return unavailable || snapshots.length === 0 ? formatUnavailablePrompt(unavailable) : undefined
  }

  const parts = visibleProviderQuotaWindows(snapshot).map(
    (window) => `${window.label} ${Math.round(clampProviderQuotaPercent(window.remainingPercent!))}%`,
  )
  if (parts.length === 0) return
  return `${snapshot.provider} ${parts.join(quotaGlyphs(glyphStyle).compactWindowSeparator)}`
}

function formatProviderQuotaValue(window: ProviderQuotaWindow) {
  const parts: string[] = []
  if (window.remainingPercent !== undefined)
    parts.push(`${Math.round(clampProviderQuotaPercent(window.remainingPercent))}%`)
  if (window.remaining !== undefined && window.limit !== undefined) {
    parts.push(
      `${Math.round(window.remaining).toLocaleString("en-US")}/${Math.round(window.limit).toLocaleString("en-US")}`,
    )
  } else if (window.remaining !== undefined) {
    parts.push(Math.round(window.remaining).toLocaleString("en-US"))
  }
  return parts.length > 0 ? parts.join(" ") : "status only"
}

export function formatProviderQuotaReport(
  snapshots: readonly ProviderQuotaSnapshot[],
  glyphStyle: GlyphStyle = "unicode",
) {
  const lines = ["Provider quota status", ""]
  const glyphs = quotaGlyphs(glyphStyle)

  if (snapshots.length === 0) {
    lines.push("No provider quota snapshots are available yet.")
    return lines.join("\n")
  }

  for (const snapshot of snapshots) {
    const suffix = snapshot.detail ? `${glyphs.detailSeparator}${snapshot.detail}` : ""
    lines.push(`${snapshot.label} (${snapshot.provider}): ${snapshot.status}${suffix}`)
    for (const window of snapshot.windows) {
      lines.push(`- ${window.label}: ${formatProviderQuotaValue(window)} ${window.confidence} from ${window.source}`)
    }
    lines.push("")
  }

  lines.push(
    "Confidence labels: exact = current provider-reported remaining quota; reported = official limits/headers; estimated = local usage or heuristic, not provider-enforced remaining quota.",
  )
  return lines.join("\n").trimEnd()
}

function generatedProviderQuotaReader(client: unknown) {
  if (!isRecord(client)) return
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  if (!experimental) return

  const direct = experimental.providerQuota ?? experimental.provider_quota
  if (typeof direct === "function") {
    const method = direct as ProviderQuotaClientMethod
    return async () => (await method({})).data
  }
  if (isRecord(direct)) {
    if (typeof direct.get === "function") {
      const method = direct.get as ProviderQuotaClientMethod
      return async () => (await method({})).data
    }
    if (typeof direct.list === "function") {
      const method = direct.list as ProviderQuotaClientMethod
      return async () => (await method({})).data
    }
  }

  const provider = isRecord(experimental.provider) ? experimental.provider : undefined
  const quota = provider?.quota
  if (typeof quota === "function") {
    const method = quota as ProviderQuotaClientMethod
    return async () => (await method({})).data
  }
  if (isRecord(quota) && typeof quota.get === "function") {
    const method = quota.get as ProviderQuotaClientMethod
    return async () => (await method({})).data
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
      // Try the next OpenCode client surface; stock builds may not expose native provider quota.
    }
  }

  return []
}
