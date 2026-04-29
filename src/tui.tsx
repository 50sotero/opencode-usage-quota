/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import {
  formatUsageQuotaReport,
  formatUsageQuotaStatus,
  isUsageRecord,
  normalizeCodexQuota,
  summarizeUsage,
  upsertUsageRecord,
  usageRecordFromEvent,
  type CodexQuotaSnapshot,
  type UsageRecord,
} from "./quota.js"
import { readCodexQuota } from "./codex-quota-client.js"

const id = "opencode-usage-quota"
const storageKey = "opencode-usage-quota.records"

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

type PromptRef = Parameters<TuiPluginApi["ui"]["Prompt"]>[0]["ref"]

function QuotaStatusText(props: { api: TuiPluginApi; snapshot: CodexQuotaSnapshot | undefined }) {
  const label = createMemo(() => formatUsageQuotaStatus(props.snapshot))

  return <text fg={props.api.theme.current.textMuted}>{label()}</text>
}

function BelowPromptStatus(props: { api: TuiPluginApi; snapshot: CodexQuotaSnapshot | undefined; block?: boolean }) {
  if (props.block) {
    return (
      <box width="100%" height={1} alignItems="center" justifyContent="center">
        <QuotaStatusText
          api={props.api}
          snapshot={props.snapshot}
        />
      </box>
    )
  }

  return (
    <QuotaStatusText
      api={props.api}
      snapshot={props.snapshot}
    />
  )
}

function SessionPromptWithStatus(props: {
  api: TuiPluginApi
  snapshot: CodexQuotaSnapshot | undefined
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
          snapshot={props.snapshot}
        />
      </box>
    </box>
  )
}

export const UsageQuotaTuiPlugin: TuiPlugin = async (api, rawOptions) => {
  const options = parseOptions(rawOptions)
  const [snapshot, setSnapshot] = createSignal<CodexQuotaSnapshot>()
  const [records, setRecords] = createSignal<UsageRecord[]>(loadRecords(api))

  async function refreshCodexQuota() {
    try {
      const result = await readCodexQuota(api.client)
      setSnapshot(normalizeCodexQuota(result))
    } catch {
      setSnapshot(undefined)
    }
  }

  function remember(record: UsageRecord | undefined) {
    if (!record) return
    const next = upsertUsageRecord(records(), record)
    api.kv.set(storageKey, next)
    setRecords(next)
  }

  const stopEvent = api.event.on("message.updated", (event) => {
    remember(usageRecordFromEvent(event))
  })
  api.lifecycle.onDispose(stopEvent)

  refreshCodexQuota()
  const timer = setInterval(refreshCodexQuota, options.refreshMs)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 90,
    slots: {
      session_prompt(_context, props) {
        return (
          <SessionPromptWithStatus
            api={api}
            snapshot={snapshot()}
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
            snapshot={snapshot()}
            block
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
