/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import { normalizeGlyphStyle, type GlyphStyle } from "./glyphs.js"
import {
  formatProviderQuotaPrompt,
  formatProviderQuotaReport,
  hasNativeProviderQuotaClient,
  normalizeProviderQuotaSnapshots,
  readNativeProviderQuota,
  type ProviderQuotaSnapshot,
} from "./provider-quota.js"
import { isUsageRecord, upsertUsageRecord, usageRecordFromEvent, type UsageRecord } from "./quota.js"
import { defaultProviderQuotaAdapters, readProviderQuotas } from "./providers/index.js"
import { formatSessionDashboardPrompt, formatSessionDashboardReport } from "./session-dashboard.js"

const id = "opencode-usage-quota"
const storageKey = "opencode-usage-quota.records"

type Options = {
  refreshMs?: number
  eventRefreshDebounceMs?: number
  glyphs?: GlyphStyle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseOptions(value: unknown): Required<Options> {
  const record = isRecord(value) ? value : {}
  const refreshMs = typeof record.refreshMs === "number" && Number.isFinite(record.refreshMs) ? record.refreshMs : 60_000
  const eventRefreshDebounceMs =
    typeof record.eventRefreshDebounceMs === "number" && Number.isFinite(record.eventRefreshDebounceMs)
      ? record.eventRefreshDebounceMs
      : 5_000

  return {
    refreshMs: Math.max(15_000, refreshMs),
    eventRefreshDebounceMs: Math.max(1_000, eventRefreshDebounceMs),
    glyphs: normalizeGlyphStyle(record.glyphs),
  }
}

function loadRecords(api: TuiPluginApi) {
  const value = api.kv.get<unknown>(storageKey, [])
  if (!Array.isArray(value)) return []
  return value.filter(isUsageRecord)
}

function hasNativeProviderQuota(client: unknown) {
  return hasNativeProviderQuotaClient(client)
}

type PromptRef = Parameters<TuiPluginApi["ui"]["Prompt"]>[0]["ref"]

function currentRouteSessionID(api: TuiPluginApi) {
  const current = api.route.current
  if (current.name !== "session" || !current.params) return
  return typeof current.params.sessionID === "string" ? current.params.sessionID : undefined
}

function latestSessionRecord(records: readonly UsageRecord[], sessionID: string | undefined) {
  if (!sessionID) return
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]
    if (record.sessionID === sessionID) return record
  }
}

function contextLimitForSession(api: TuiPluginApi, records: readonly UsageRecord[], sessionID: string | undefined) {
  const latest = latestSessionRecord(records, sessionID)
  if (!latest) return
  const provider = api.state.provider.find((item) => item.id === latest.provider)
  const context = provider?.models?.[latest.model]?.limit?.context
  return typeof context === "number" && Number.isFinite(context) ? context : undefined
}

function QuotaStatusText(props: { api: TuiPluginApi; snapshots: readonly ProviderQuotaSnapshot[]; glyphs: GlyphStyle }) {
  const label = createMemo(() => formatProviderQuotaPrompt(props.snapshots, undefined, props.glyphs))

  return <text fg={props.api.theme.current.textMuted}>{label() ?? ""}</text>
}

function DashboardStatusText(props: {
  api: TuiPluginApi
  snapshots: readonly ProviderQuotaSnapshot[]
  records: readonly UsageRecord[]
  sessionID: string
  glyphs: GlyphStyle
}) {
  const label = createMemo(() =>
    formatSessionDashboardPrompt({
      snapshots: props.snapshots,
      records: props.records,
      sessionID: props.sessionID,
      contextLimit: contextLimitForSession(props.api, props.records, props.sessionID),
      glyphStyle: props.glyphs,
    }),
  )

  return <text fg={props.api.theme.current.textMuted}>{label() ?? ""}</text>
}

function BelowPromptStatus(props: {
  api: TuiPluginApi
  snapshots: readonly ProviderQuotaSnapshot[]
  glyphs: GlyphStyle
  block?: boolean
}) {
  if (props.block) {
    return (
      <box width="100%" height={1} alignItems="center" justifyContent="center">
        <QuotaStatusText api={props.api} snapshots={props.snapshots} glyphs={props.glyphs} />
      </box>
    )
  }

  return <QuotaStatusText api={props.api} snapshots={props.snapshots} glyphs={props.glyphs} />
}

function SessionPromptWithStatus(props: {
  api: TuiPluginApi
  snapshots: readonly ProviderQuotaSnapshot[]
  records: readonly UsageRecord[]
  glyphs: GlyphStyle
  sessionID: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  promptRef?: PromptRef
}) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={props.promptRef}
      />
      <box width="100%" height={1} flexDirection="row" justifyContent="flex-end" paddingRight={2}>
        <DashboardStatusText
          api={props.api}
          snapshots={props.snapshots}
          records={props.records}
          sessionID={props.sessionID}
          glyphs={props.glyphs}
        />
      </box>
    </box>
  )
}

export const UsageQuotaTuiPlugin: TuiPlugin = async (api, rawOptions) => {
  const options = parseOptions(rawOptions)
  const nativeProviderQuota = hasNativeProviderQuota(api.client)
  const [snapshots, setSnapshots] = createSignal<ProviderQuotaSnapshot[]>([])
  const [records, setRecords] = createSignal<UsageRecord[]>(loadRecords(api))
  const [lastSessionID, setLastSessionID] = createSignal<string | undefined>()
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let refreshInFlight = false
  let refreshQueued = false

  async function refreshProviderQuota() {
    try {
      if (nativeProviderQuota) {
        setSnapshots(await readNativeProviderQuota(api.client))
        return
      }

      const result = await readProviderQuotas(defaultProviderQuotaAdapters, { client: api.client, records: records() })
      setSnapshots(normalizeProviderQuotaSnapshots(result))
    } catch {
      setSnapshots([])
    }
  }

  async function runProviderQuotaRefresh() {
    if (refreshInFlight) {
      refreshQueued = true
      return
    }

    refreshInFlight = true
    try {
      do {
        refreshQueued = false
        await refreshProviderQuota()
      } while (refreshQueued)
    } finally {
      refreshInFlight = false
    }
  }

  function scheduleProviderQuotaRefresh(delayMs = 0) {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      runProviderQuotaRefresh()
    }, delayMs)
  }

  function remember(record: UsageRecord | undefined) {
    if (!record) return
    const next = upsertUsageRecord(records(), record)
    api.kv.set(storageKey, next)
    setRecords(next)
    if (record.sessionID) setLastSessionID(record.sessionID)
    scheduleProviderQuotaRefresh(options.eventRefreshDebounceMs)
  }

  const stopEvent = api.event.on("message.updated", (event) => {
    remember(usageRecordFromEvent(event))
  })
  api.lifecycle.onDispose(stopEvent)

  scheduleProviderQuotaRefresh()
  const timer = setInterval(() => scheduleProviderQuotaRefresh(), options.refreshMs)
  api.lifecycle.onDispose(() => {
    clearInterval(timer)
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  if (!nativeProviderQuota) {
    api.slots.register({
      order: 90,
      slots: {
        session_prompt(_context, props) {
          return (
            <SessionPromptWithStatus
              api={api}
              snapshots={snapshots()}
              records={records()}
              glyphs={options.glyphs}
              sessionID={props.session_id}
              visible={props.visible}
              disabled={props.disabled}
              onSubmit={props.on_submit}
              promptRef={props.ref}
            />
          )
        },
        home_bottom() {
          return <BelowPromptStatus api={api} snapshots={snapshots()} glyphs={options.glyphs} block />
        },
      },
    })
  }

  const unregisterCommand = api.command.register(() => [
    {
      title: "Show Provider Quota",
      value: "usage-quota.open",
      category: "Usage",
      description: "Show provider quota and local usage confidence labels",
      slash: {
        name: "quota",
        aliases: ["usage-quota"],
      },
      onSelect() {
        api.ui.dialog.replace(() => (
          <api.ui.DialogAlert
            title="Provider quota"
            message={formatProviderQuotaReport(snapshots(), options.glyphs)}
            onConfirm={() => api.ui.dialog.clear()}
          />
        ))
      },
    },
    {
      title: "Show Session Dashboard",
      value: "usage-quota.dashboard",
      category: "Usage",
      description: "Show per-session tokens, context usage, quota, and update timing",
      slash: {
        name: "dashboard",
        aliases: ["usage-dashboard"],
      },
      onSelect() {
        const sessionID = currentRouteSessionID(api) ?? lastSessionID()
        api.ui.dialog.replace(() => (
          <api.ui.DialogAlert
            title="Session dashboard"
            message={formatSessionDashboardReport({
              snapshots: snapshots(),
              records: records(),
              sessionID,
              contextLimit: contextLimitForSession(api, records(), sessionID),
              glyphStyle: options.glyphs,
            })}
            onConfirm={() => api.ui.dialog.clear()}
          />
        ))
      },
    },
  ])
  api.lifecycle.onDispose(unregisterCommand)
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui: UsageQuotaTuiPlugin,
}

export default plugin
