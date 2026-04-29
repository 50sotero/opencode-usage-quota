type GeneratedCodexQuotaMethod = (input?: { workspace?: string }) => Promise<{ data?: unknown }>
type ConsoleGetMethod = (input?: { workspace?: string }) => Promise<{ data?: unknown }>
type RawGetMethod = (input: { url: string }) => Promise<{ data?: unknown }>

type QuotaReader = () => Promise<unknown>

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
      if (value !== undefined) return value
    } catch {
      // Try the next OpenCode client surface; installed builds can expose different generated helpers.
    }
  }
}

export async function readCodexQuota(client: unknown) {
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

  return readFirst(readers)
}
