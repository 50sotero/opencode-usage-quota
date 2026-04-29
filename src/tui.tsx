/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import {
  formatProviderQuotaPrompt,
  formatProviderQuotaReport,
  hasNativeProviderQuotaClient,
  normalizeProviderQuotaSnapshots,
  readNativeProviderQuota,
  type ProviderQuotaSnapshot,
} from "./provider-quota.js"
import {
  isUsageRecord,
  upsertUsageRecord,
  usageRecordFromEvent,
  type UsageRecord,
} from "./quota.js"
import { readProviderQuotas } from "./providers/index.js"
import { codexQuotaAdapter } from "./providers/codex.js"
import { localUsageAdapter } from "./providers/local-usage.js"

const id = "opencode-usage-quota"
const storageKey = "opencode-usage-quota.records"
const adapters = [codexQuotaAdapter, localUsageAdapter]

type Options = {
  refreshMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseOptions(value: unknown): Required<Options> {
  const record = isRecord(value) ? value : {}
  const refreshMs = typeof record.refreshMs === "number" && Number.isFinite(record.refreshMs) ? record.refreshMs : 60_000

  return {
    refreshMs: Math.max(15_000, refreshMs),
  }
}

function loadRecords(api: TuiPluginApi) {
  const value = api.kv.get<unknown>(storageKey, [])
  if (!Array.isArray(value)) return []
  return value.filter(isUsageRecord)
}

function hasNativeProviderQuota(client: unknown) {
  if (!isRecord(client)) return false
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  if (!experimental) return false

export function hasNativeProviderQuota(api: TuiPluginApi) {
  return hasNativeProviderQuotaClient(api.client)
}

function QuotaStatusText(props: { api: TuiPluginApi; snapshots: readonly ProviderQuotaSnapshot[] }) {
  const label = createMemo(() => formatProviderQuotaPrompt(props.snapshots))

  return <text fg={props.api.theme.current.textMuted}>{label() ?? ""}</text>
}

function BelowPromptStatus(props: { api: TuiPluginApi; snapshots: readonly ProviderQuotaSnapshot[]; block?: boolean }) {
  if (props.block) {
    return (
      <box width="100%" height={1} alignItems="center" justifyContent="center">
        <QuotaStatusText
          api={props.api}
          snapshots={props.snapshots}
        />
      </box>
    )
  }

  return (
    <QuotaStatusText
      api={props.api}
      snapshots={props.snapshots}
    />
  )
}

function SessionPromptWithStatus(props: {
  api: TuiPluginApi
  snapshots: readonly ProviderQuotaSnapshot[]
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
        <QuotaStatusText
          api={props.api}
          snapshots={props.snapshots}
        />
      </box>
    </box>
  )
}

export const UsageQuotaTuiPlugin: TuiPlugin = async (api, rawOptions) => {
  const options = parseOptions(rawOptions)
  const [snapshots, setSnapshots] = createSignal<ProviderQuotaSnapshot[]>([])
  const [records, setRecords] = createSignal<UsageRecord[]>(loadRecords(api))

  async function refreshProviderQuota() {
    try {
      if (hasNativeProviderQuota(api)) {
        setSnapshots(await readNativeProviderQuota(api.client))
        return
      }

      const result = await readProviderQuotas(adapters, { client: api.client, records: records() })
      setSnapshots(normalizeProviderQuotaSnapshots(result))
    } catch {
      setSnapshots([])
    }
  }

  function remember(record: UsageRecord | undefined) {
    if (!record) return
    const next = upsertUsageRecord(records(), record)
    api.kv.set(storageKey, next)
    setRecords(next)
    refreshProviderQuota()
  }

  const stopEvent = api.event.on("message.updated", (event) => {
    remember(usageRecordFromEvent(event))
  })
  api.lifecycle.onDispose(stopEvent)

  refreshProviderQuota()
  const timer = setInterval(refreshProviderQuota, options.refreshMs)
  api.lifecycle.onDispose(() => clearInterval(timer))

  if (!hasNativeProviderQuota(api)) {
    api.slots.register({
      order: 90,
      slots: {
        session_prompt(_context, props) {
          return (
            <SessionPromptWithStatus
              api={api}
              snapshots={snapshots()}
              sessionID={props.session_id}
              visible={props.visible}
              disabled={props.disabled}
              onSubmit={props.on_submit}
              promptRef={props.ref}
            />
          )
        },
        home_bottom() {
          return (
            <BelowPromptStatus
              api={api}
              snapshots={snapshots()}
              block
            />
          )
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
            message={formatProviderQuotaReport(snapshots())}
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
