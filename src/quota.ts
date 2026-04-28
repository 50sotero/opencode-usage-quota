export type QuotaWindow = {
  remainingPercent: number
  resetSeconds?: number
  resetAt?: number
}

export type CodexQuotaSnapshot = {
  fiveHour?: QuotaWindow
  weekly?: QuotaWindow
  fetchedAt?: number
}

export type UsageRecord = {
  id: string
  sessionID?: string
  provider: string
  model: string
  tokens: number
  cost: number
  timestamp: number
}

export type ProviderUsageSummary = {
  provider: string
  model?: string
  fiveHourTokens: number
  weeklyTokens: number
  weeklyCost: number
}

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberFrom(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringFrom(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function windowFrom(value: unknown): QuotaWindow | undefined {
  if (!isRecord(value)) return

  const remainingPercent = numberFrom(value.remainingPercent, Number.NaN)
  if (!Number.isFinite(remainingPercent)) return

  return {
    remainingPercent,
    resetSeconds: numberFrom(value.resetSeconds, Number.NaN),
    resetAt: numberFrom(value.resetAt, Number.NaN),
  }
}

function cleanWindow(value: QuotaWindow | undefined) {
  if (!value) return

  return {
    remainingPercent: value.remainingPercent,
    resetSeconds: Number.isFinite(value.resetSeconds) ? value.resetSeconds : undefined,
    resetAt: Number.isFinite(value.resetAt) ? value.resetAt : undefined,
  }
}

export function normalizeCodexQuota(value: unknown): CodexQuotaSnapshot | undefined {
  if (!isRecord(value)) return

  const fiveHour = cleanWindow(windowFrom(value.fiveHour))
  const weekly = cleanWindow(windowFrom(value.weekly))
  if (!fiveHour && !weekly) return

  const fetchedAt = numberFrom(value.fetchedAt, Number.NaN)
  return {
    fiveHour,
    weekly,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : undefined,
  }
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function formatQuotaBar(percent: number, width: number) {
  const columns = Math.max(0, Math.floor(width))
  const filled = Math.round((clampPercent(percent) / 100) * columns)
  return `${"█".repeat(filled)}${"░".repeat(columns - filled)}`
}

function formatWindow(label: "5h" | "wk", item: QuotaWindow, barWidth: number) {
  const percent = clampPercent(item.remainingPercent)
  return `${label} ${formatQuotaBar(percent, barWidth)} ${percent}%`
}

export function formatCodexQuotaPrompt(snapshot: CodexQuotaSnapshot | undefined) {
  if (!snapshot?.fiveHour && !snapshot?.weekly) return

  const parts = [
    snapshot.fiveHour ? formatWindow("5h", snapshot.fiveHour, 5) : undefined,
    snapshot.weekly ? formatWindow("wk", snapshot.weekly, 5) : undefined,
  ].filter((part): part is string => Boolean(part))

  return `codex ${parts.join(" · ")}`
}

export function usageRecordFromMessage(message: unknown, timestamp = Date.now()): UsageRecord | undefined {
  if (!isRecord(message)) return
  if (message.role !== "assistant") return

  const tokens = isRecord(message.tokens) ? message.tokens : undefined
  if (!tokens) return

  const cache = isRecord(tokens.cache) ? tokens.cache : {}
  const total =
    numberFrom(tokens.input) +
    numberFrom(tokens.output) +
    numberFrom(tokens.reasoning) +
    numberFrom(cache.read) +
    numberFrom(cache.write)

  if (total <= 0) return

  return {
    id: stringFrom(message.id, `${stringFrom(message.providerID, "unknown")}:${stringFrom(message.modelID, "unknown")}:${timestamp}`),
    sessionID: typeof message.sessionID === "string" ? message.sessionID : undefined,
    provider: stringFrom(message.providerID, "unknown"),
    model: stringFrom(message.modelID, "unknown"),
    tokens: total,
    cost: numberFrom(message.cost),
    timestamp,
  }
}

export function usageRecordFromEvent(event: unknown, timestamp = Date.now()) {
  if (!isRecord(event)) return
  if (event.type !== "message.updated") return
  const properties = isRecord(event.properties) ? event.properties : undefined
  return usageRecordFromMessage(properties?.info, timestamp)
}

export function isUsageRecord(value: unknown): value is UsageRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.tokens === "number" &&
    typeof value.cost === "number" &&
    typeof value.timestamp === "number"
  )
}

export function upsertUsageRecord(records: readonly UsageRecord[], record: UsageRecord, now = Date.now()) {
  const cutoff = now - WEEK_MS
  const next = records.filter((item) => item.id !== record.id && item.timestamp >= cutoff)
  next.push(record)
  return next.sort((a, b) => a.timestamp - b.timestamp)
}

export function summarizeUsage(records: readonly UsageRecord[], now = Date.now()): ProviderUsageSummary[] {
  const weeklyCutoff = now - WEEK_MS
  const fiveHourCutoff = now - FIVE_HOURS_MS
  const summaries = new Map<string, ProviderUsageSummary>()

  for (const record of records) {
    if (record.timestamp < weeklyCutoff) continue

    const key = `${record.provider}:${record.model}`
    const current = summaries.get(key) ?? {
      provider: record.provider,
      model: record.model,
      fiveHourTokens: 0,
      weeklyTokens: 0,
      weeklyCost: 0,
    }

    current.weeklyTokens += record.tokens
    current.weeklyCost += record.cost
    if (record.timestamp >= fiveHourCutoff) current.fiveHourTokens += record.tokens
    summaries.set(key, current)
  }

  return [...summaries.values()].sort((a, b) => b.weeklyTokens - a.weeklyTokens)
}

function formatTokens(tokens: number) {
  return Math.round(tokens).toLocaleString("en-US")
}

export function formatLocalUsagePrompt(summary: readonly ProviderUsageSummary[]) {
  const [top] = summary
  if (!top) return
  return `${top.provider} local 5h ${formatTokens(top.fiveHourTokens)}t · wk ${formatTokens(top.weeklyTokens)}t`
}

export function formatUsageQuotaPrompt(snapshot: CodexQuotaSnapshot | undefined, summary: readonly ProviderUsageSummary[]) {
  return formatCodexQuotaPrompt(snapshot) ?? formatLocalUsagePrompt(summary)
}

export function formatUsageQuotaReport(snapshot: CodexQuotaSnapshot | undefined, summary: readonly ProviderUsageSummary[]) {
  const lines = ["Usage quota status", ""]
  const codex = formatCodexQuotaPrompt(snapshot)

  lines.push(codex ? `Codex remote quota: ${codex}` : "Codex remote quota: unavailable")
  lines.push("")
  lines.push("Local OpenCode usage, not provider-enforced quota:")

  if (summary.length === 0) {
    lines.push("- no assistant token usage observed in this TUI session yet")
  } else {
    for (const item of summary.slice(0, 8)) {
      lines.push(
        `- ${item.provider}/${item.model ?? "unknown"}: 5h ${formatTokens(item.fiveHourTokens)} tokens, wk ${formatTokens(item.weeklyTokens)} tokens`,
      )
    }
  }

  lines.push("")
  lines.push("Other providers: quota endpoints are unavailable unless a provider-specific adapter is added.")
  return lines.join("\n")
}
