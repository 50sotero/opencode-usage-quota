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
