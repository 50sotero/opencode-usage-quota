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
