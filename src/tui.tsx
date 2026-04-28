/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Show, createMemo, createSignal } from "solid-js"
import {
  formatUsageQuotaPrompt,
  formatUsageQuotaReport,
  isUsageRecord,
  normalizeCodexQuota,
  summarizeUsage,
  upsertUsageRecord,
  usageRecordFromEvent,
  usageRecordFromMessage,
  type CodexQuotaSnapshot,
  type UsageRecord,
} from "./quota.js"

const id = "opencode-usage-quota"
const storageKey = "opencode-usage-quota.records"

type Options = {
  refreshMs?: number
  showLocalUsageFallback?: boolean
}

type CodexQuotaClient = {
  experimental?: {
    console?: {
      codexQuota?: (input?: { workspace?: string }) => Promise<{ data?: unknown }>
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseOptions(value: unknown): Required<Options> {
  const record = isRecord(value) ? value : {}
  const refreshMs = typeof record.refreshMs === "number" && Number.isFinite(record.refreshMs) ? record.refreshMs : 60_000
  const showLocalUsageFallback = typeof record.showLocalUsageFallback === "boolean" ? record.showLocalUsageFallback : true

  return {
    refreshMs: Math.max(15_000, refreshMs),
    showLocalUsageFallback,
  }
}

function codexQuotaMethod(client: unknown) {
  if (!isRecord(client)) return
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  const consoleClient = isRecord(experimental?.console) ? experimental.console : undefined
  const method = consoleClient?.codexQuota
  if (typeof method !== "function") return
  return method as CodexQuotaClient["experimental"] extends infer Experimental
    ? Experimental extends { console?: infer Console }
      ? Console extends { codexQuota?: infer Method }
        ? Method
        : never
      : never
    : never
}

function loadRecords(api: TuiPluginApi) {
  const value = api.kv.get<unknown>(storageKey, [])
  if (!Array.isArray(value)) return []
  return value.filter(isUsageRecord)
}

function rememberRecord(api: TuiPluginApi, setRecords: (records: UsageRecord[]) => void, records: readonly UsageRecord[], record: UsageRecord) {
  const next = upsertUsageRecord(records, record)
  api.kv.set(storageKey, next)
  setRecords(next)
}

function View(props: {
  api: TuiPluginApi
  snapshot: CodexQuotaSnapshot | undefined
  records: readonly UsageRecord[]
  showLocalUsageFallback: boolean
}) {
  const label = createMemo(() =>
    formatUsageQuotaPrompt(props.snapshot, props.showLocalUsageFallback ? summarizeUsage(props.records) : []),
  )

  return <Show when={label()}>{(value) => <text fg={props.api.theme.current.textMuted}>{value()}</text>}</Show>
}

export const UsageQuotaTuiPlugin: TuiPlugin = async (api, rawOptions) => {
  const options = parseOptions(rawOptions)
  const [snapshot, setSnapshot] = createSignal<CodexQuotaSnapshot>()
  const [records, setRecords] = createSignal<UsageRecord[]>(loadRecords(api))

  async function refreshCodexQuota() {
    const method = codexQuotaMethod(api.client)
    if (!method) return

    try {
      const result = await method({})
      setSnapshot(normalizeCodexQuota(result.data))
    } catch {
      setSnapshot(undefined)
    }
  }

  function remember(record: UsageRecord | undefined) {
    if (!record) return
    rememberRecord(api, setRecords, records(), record)
  }

  const stopEvent = api.event.on("message.updated", (event) => {
    remember(usageRecordFromEvent(event))
  })
  api.lifecycle.onDispose(stopEvent)

  refreshCodexQuota()
  const timer = setInterval(refreshCodexQuota, options.refreshMs)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 200,
    slots: {
      session_prompt_right(_ctx, props) {
        for (const message of api.state.session.messages(props.session_id)) {
          remember(usageRecordFromMessage(message))
        }

        return (
          <View
            api={api}
            snapshot={snapshot()}
            records={records()}
            showLocalUsageFallback={options.showLocalUsageFallback}
          />
        )
      },
      home_prompt_right() {
        return (
          <View
            api={api}
            snapshot={snapshot()}
            records={records()}
            showLocalUsageFallback={options.showLocalUsageFallback}
          />
        )
      },
    },
  })

  const unregisterCommand = api.command.register(() => [
    {
      title: "Show Usage Quota",
      value: "usage-quota.open",
      category: "Usage",
      description: "Show Codex quota and local provider usage windows",
      slash: {
        name: "quota",
        aliases: ["usage-quota"],
      },
      onSelect() {
        api.ui.dialog.replace(() => (
          <api.ui.DialogAlert
            title="Usage quota"
            message={formatUsageQuotaReport(snapshot(), summarizeUsage(records()))}
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
