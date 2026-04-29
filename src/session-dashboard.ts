import { quotaGlyphs, type GlyphStyle } from "./glyphs.js"
import {
  clampPercent,
  formatQuotaBar,
  type UsageRecord,
} from "./quota.js"
import {
  formatProviderQuotaPrompt,
  visibleProviderQuotaWindows,
  type ProviderQuotaSnapshot,
} from "./provider-quota.js"

export type SessionContextUsage = {
  usedTokens: number
  limitTokens?: number
  usedPercent?: number
  source: "observed_input"
}

export type SessionUsageDashboard = {
  sessionID: string
  provider?: string
  model?: string
  messageCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  updatedAt?: number
  context?: SessionContextUsage
}

export type SessionDashboardInput = {
  snapshots: readonly ProviderQuotaSnapshot[]
  records: readonly UsageRecord[]
  sessionID?: string
  now?: number
  contextLimit?: number
  glyphStyle?: GlyphStyle
  maxPromptLength?: number
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordBucket(record: UsageRecord, key: keyof Pick<
  UsageRecord,
  "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens"
>) {
  return finiteNumber(record[key]) ?? 0
}

function sessionRecords(records: readonly UsageRecord[], sessionID: string) {
  return records
    .filter((record) => record.sessionID === sessionID)
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function summarizeSessionUsage(
  records: readonly UsageRecord[],
  sessionID: string | undefined,
  options: { contextLimit?: number } = {},
): SessionUsageDashboard | undefined {
  if (!sessionID) return
  const items = sessionRecords(records, sessionID)
  if (items.length === 0) return

  const latest = items[items.length - 1]
  const summary: SessionUsageDashboard = {
    sessionID,
    provider: latest.provider,
    model: latest.model,
    messageCount: items.length,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    updatedAt: latest.timestamp,
  }

  for (const record of items) {
    summary.totalTokens += record.tokens
    summary.inputTokens += recordBucket(record, "inputTokens")
    summary.outputTokens += recordBucket(record, "outputTokens")
    summary.reasoningTokens += recordBucket(record, "reasoningTokens")
    summary.cacheReadTokens += recordBucket(record, "cacheReadTokens")
    summary.cacheWriteTokens += recordBucket(record, "cacheWriteTokens")
    summary.cost += record.cost
  }

  const observedInput = recordBucket(latest, "inputTokens")
  if (observedInput > 0) {
    const contextLimit = finiteNumber(options.contextLimit)
    const usedPercent =
      contextLimit && contextLimit > 0 ? clampPercent((observedInput / contextLimit) * 100) : undefined
    summary.context = {
      usedTokens: observedInput,
      limitTokens: contextLimit,
      usedPercent,
      source: "observed_input",
    }
  }

  return summary
}

function formatCount(value: number) {
  const rounded = Math.max(0, Math.round(value))
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (rounded >= 1_000) return `${(rounded / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return rounded.toLocaleString("en-US")
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function formatMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`
}

function formatTime(value: number | undefined) {
  if (!value) return
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return
  return date.toTimeString().slice(0, 8)
}

function formatCompactContext(context: SessionContextUsage | undefined) {
  if (!context) return
  if (context.limitTokens && context.usedPercent !== undefined) {
    return `ctx ${formatCount(context.usedTokens)}/${formatCount(context.limitTokens)} ${context.usedPercent}%`
  }
  return `ctx ${formatCount(context.usedTokens)}`
}

function withoutUpdatedAt(value: string | undefined, glyphStyle: GlyphStyle) {
  if (!value) return
  const separator = quotaGlyphs(glyphStyle).compactWindowSeparator
  return value
    .split(separator)
    .filter((part) => !part.startsWith("updated "))
    .join(separator)
}

function promptLengthLimit(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 128
}

export function formatSessionDashboardPrompt(input: SessionDashboardInput) {
  const glyphStyle = input.glyphStyle ?? "unicode"
  const quota = formatProviderQuotaPrompt(input.snapshots, undefined, glyphStyle)
  const summary = summarizeSessionUsage(input.records, input.sessionID, { contextLimit: input.contextLimit })
  if (!summary) return quota

  const glyphs = quotaGlyphs(glyphStyle)
  const sessionParts = [
    formatCompactContext(summary.context),
    `tok ${formatCount(summary.totalTokens)}`,
  ].filter((part): part is string => Boolean(part))

  if (sessionParts.length === 0) return quota
  const limit = promptLengthLimit(input.maxPromptLength)
  const baseOptions = [quota, withoutUpdatedAt(quota, glyphStyle)].filter(
    (part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index,
  )
  let best = quota
  let bestExtras = 0
  let bestScore = 0

  for (const base of baseOptions) {
    let candidate = base
    let extras = 0
    let score = 0
    for (const [index, part] of sessionParts.entries()) {
      const next = [candidate, part].filter(Boolean).join(glyphs.compactWindowSeparator)
      if (next.length <= limit) {
        candidate = next
        extras++
        score += sessionParts.length - index
      }
    }
    if ((score > bestScore || (score === bestScore && extras > bestExtras)) && candidate.length <= limit) {
      best = candidate
      bestExtras = extras
      bestScore = score
    }
  }

  return best
}

function quotaLines(snapshots: readonly ProviderQuotaSnapshot[], glyphStyle: GlyphStyle) {
  const lines: string[] = []
  for (const snapshot of snapshots) {
    for (const window of visibleProviderQuotaWindows(snapshot)) {
      const percent = Math.round(window.remainingPercent ?? 0)
      lines.push(
        `${snapshot.label.padEnd(10)} ${window.label.padEnd(4)} ${formatQuotaBar(percent, 10, glyphStyle)} ${percent}% left`,
      )
    }
  }
  if (lines.length === 0) lines.push("Codex      unavailable")
  return lines
}

function metricLine(label: string, value: string) {
  return `${label.padEnd(12)}${value}`
}

function contextSourceLabel(source: SessionContextUsage["source"]) {
  if (source === "observed_input") return "observed assistant input tokens"
  return source
}

export function formatSessionDashboardReport(input: SessionDashboardInput) {
  const glyphStyle = input.glyphStyle ?? "unicode"
  const summary = summarizeSessionUsage(input.records, input.sessionID, { contextLimit: input.contextLimit })
  const lines = ["Session dashboard", "", "Quota", ...quotaLines(input.snapshots, glyphStyle), ""]

  lines.push("Current session")
  if (!summary) {
    lines.push("No assistant token usage observed for this session yet.")
  } else {
    lines.push(metricLine("Session", summary.sessionID))
    lines.push(metricLine("Provider", summary.provider ?? "unknown"))
    lines.push(metricLine("Model", summary.model ?? "unknown"))
    lines.push(metricLine("Messages", formatNumber(summary.messageCount)))
    lines.push(metricLine("Input", formatNumber(summary.inputTokens)))
    lines.push(metricLine("Output", formatNumber(summary.outputTokens)))
    lines.push(metricLine("Reasoning", formatNumber(summary.reasoningTokens)))
    lines.push(metricLine("Cache read", formatNumber(summary.cacheReadTokens)))
    lines.push(metricLine("Cache write", formatNumber(summary.cacheWriteTokens)))
    lines.push(metricLine("Total", formatNumber(summary.totalTokens)))
    lines.push(metricLine("Cost", formatMoney(summary.cost)))
    const updated = formatTime(summary.updatedAt)
    if (updated) lines.push(metricLine("Updated", updated))
  }

  lines.push("", "Context")
  if (!summary?.context) {
    lines.push("Used        unavailable from observed assistant messages")
    lines.push("Source      unavailable")
  } else if (summary.context.limitTokens && summary.context.usedPercent !== undefined) {
    lines.push(
      metricLine(
        "Used",
        `${formatNumber(summary.context.usedTokens)} / ${formatNumber(summary.context.limitTokens)} (${summary.context.usedPercent}%)`,
      ),
    )
    lines.push(metricLine("Usage", formatQuotaBar(summary.context.usedPercent, 10, glyphStyle)))
    lines.push(metricLine("Source", contextSourceLabel(summary.context.source)))
  } else {
    lines.push(metricLine("Used", formatNumber(summary.context.usedTokens)))
    lines.push(metricLine("Source", contextSourceLabel(summary.context.source)))
  }

  lines.push(
    "",
    "Estimated/local usage is not provider-enforced quota; exact/reported quota remains provider sourced.",
  )
  return lines.join("\n")
}
