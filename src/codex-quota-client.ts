import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { normalizeCodexQuota, type CodexQuotaSnapshot } from "./quota.js"

type GeneratedCodexQuotaMethod = (input?: { workspace?: string }) => Promise<{ data?: unknown }>
type ConsoleGetMethod = (input?: { workspace?: string }) => Promise<{ data?: unknown }>
type RawGetMethod = (input: { url: string }) => Promise<{ data?: unknown }>

type QuotaReader = () => Promise<unknown>
type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export type CodexQuotaAuth = {
  access: string
  accountId?: string
}

export type CodexQuotaReadOptions = {
  auth?: CodexQuotaAuth
  authPaths?: readonly string[]
  fetch?: FetchLike
  now?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function consoleClientFrom(client: unknown) {
  if (!isRecord(client)) return
  const experimental = isRecord(client.experimental) ? client.experimental : undefined
  return isRecord(experimental?.console) ? experimental.console : undefined
}

function generatedCodexQuotaMethod(client: unknown) {
  const method = consoleClientFrom(client)?.codexQuota
  if (typeof method !== "function") return
  return method as GeneratedCodexQuotaMethod
}

function consoleGetMethod(client: unknown) {
  const method = consoleClientFrom(client)?.get
  if (typeof method !== "function") return
  return method as ConsoleGetMethod
}

function rawGetMethod(client: unknown) {
  if (!isRecord(client)) return
  const rawClient = isRecord(client.client) ? client.client : undefined
  const method = rawClient?.get
  if (typeof method !== "function") return
  return method as RawGetMethod
}

async function readFirst(readers: QuotaReader[]) {
  for (const reader of readers) {
    try {
      const value = await reader()
      const snapshot = normalizeCodexQuota(value)
      if (snapshot) return snapshot
    } catch {
      // Try the next OpenCode client surface; installed builds can expose different generated helpers.
    }
  }
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
}

function windowFromWham(value: unknown) {
  if (!isRecord(value)) return
  const usedPercent = numberFrom(value.used_percent)
  if (usedPercent === undefined) return

  const resetAfterSeconds = numberFrom(value.reset_after_seconds)
  const resetAtSeconds = numberFrom(value.reset_at)

  return {
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetSeconds: resetAfterSeconds,
    resetAt: resetAtSeconds === undefined ? undefined : resetAtSeconds * 1000,
  }
}

export function codexQuotaFromWhamUsage(value: unknown, now = Date.now()): CodexQuotaSnapshot | undefined {
  if (!isRecord(value)) return
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : undefined
  if (!rateLimit) return

  const fiveHour = windowFromWham(rateLimit.primary_window)
  const weekly = windowFromWham(rateLimit.secondary_window)
  if (!fiveHour && !weekly) return

  return {
    fiveHour,
    weekly,
    fetchedAt: now,
  }
}

function defaultAuthPaths() {
  const home = homedir()
  const xdgData = process.env.XDG_DATA_HOME ?? join(home, ".local", "share")
  const codexHome = process.env.CODEX_HOME ?? join(home, ".codex")
  return [
    join(xdgData, "opencode", "auth.json"),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(codexHome, "auth.json"),
    join(home, ".codex", "auth.json"),
  ]
}

function authFromValue(value: unknown): CodexQuotaAuth | undefined {
  if (!isRecord(value)) return
  const openai = isRecord(value.openai) ? value.openai : value
  const access = stringFrom(openai.access) ?? stringFrom(openai.access_token) ?? stringFrom(openai.accessToken)
  if (!access) return
  const accountId = stringFrom(openai.accountId) ?? stringFrom(openai.account_id) ?? stringFrom(openai.accountID)
  return { access, accountId }
}

function readAuth(paths: readonly string[]) {
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue
    seen.add(path)
    try {
      if (!existsSync(path)) continue
      const auth = authFromValue(JSON.parse(readFileSync(path, "utf8")))
      if (auth) return auth
    } catch {
      // Try the next auth location.
    }
  }
}

async function readWhamUsage(auth: CodexQuotaAuth, fetchLike: FetchLike, now = Date.now()) {
  const response = await fetchLike("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      authorization: `Bearer ${auth.access}`,
      accept: "application/json",
      "user-agent": "opencode-usage-quota/0.1",
      ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
    },
  })
  if (!response.ok) return
  return codexQuotaFromWhamUsage(await response.json(), now)
}

export async function readCodexQuota(client: unknown, options: CodexQuotaReadOptions = {}) {
  const generated = generatedCodexQuotaMethod(client)
  const consoleGet = consoleGetMethod(client)
  const rawGet = rawGetMethod(client)
  const readers: QuotaReader[] = []

  if (generated) readers.push(async () => (await generated({})).data)
  if (consoleGet) {
    readers.push(async () => {
      const data = (await consoleGet({})).data
      return isRecord(data) ? data.codexQuota : undefined
    })
  }
  if (rawGet) readers.push(async () => (await rawGet({ url: "/experimental/console/codex-quota" })).data)

  const auth = options.auth ?? readAuth(options.authPaths ?? defaultAuthPaths())
  const fetchLike = options.fetch ?? (globalThis.fetch as FetchLike | undefined)
  if (auth && fetchLike) readers.push(async () => readWhamUsage(auth, fetchLike, options.now))

  return readFirst(readers)
}
