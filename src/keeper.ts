#!/usr/bin/env bun
import { copyFile, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

export type KeeperRepairStep =
  | { action: "backup"; from: string; to: string }
  | { action: "install"; from: string; to: string }

export type KeeperRepairInput = {
  installedBinary: string
  patchedBinary: string
  backupBinary: string
  installedHasQuotaEndpoint: boolean
  patchedBinaryExists: boolean
}

export type KeeperRepairPlan = {
  needed: boolean
  steps: KeeperRepairStep[]
}

export function containsQuotaEndpoint(content: string | Uint8Array) {
  const text = typeof content === "string" ? content : new TextDecoder().decode(content)
  return text.includes("/experimental/provider-quota") || text.includes("/experimental/console/codex-quota")
}

function pluginEntryText(entry: unknown): string {
  if (typeof entry === "string") return entry
  if (Array.isArray(entry)) return entry.map(pluginEntryText).join(" ")
  if (entry && typeof entry === "object") return Object.values(entry).map(pluginEntryText).join(" ")
  return ""
}

export function hasDuplicateUsageQuotaPlugin(config: unknown, nativeQuotaAvailable: boolean) {
  if (!nativeQuotaAvailable || !config || typeof config !== "object") return false
  const plugin = (config as { plugin?: unknown }).plugin
  const entries = Array.isArray(plugin) ? plugin : plugin === undefined ? [] : [plugin]
  return entries.some((entry) => /opencode-usage-quota|usage-quota/i.test(pluginEntryText(entry)))
}

export function summarizeMemoryCap(maxRssKb: number, capKb: number) {
  return {
    ok: maxRssKb <= capKb,
    maxRssKb,
    capKb,
  }
}

export function createRepairPlan(input: KeeperRepairInput): KeeperRepairPlan {
  if (input.installedHasQuotaEndpoint) return { needed: false, steps: [] }
  if (!input.patchedBinaryExists) throw new Error("patched OpenCode binary is missing")

  return {
    needed: true,
    steps: [
      { action: "backup", from: input.installedBinary, to: input.backupBinary },
      { action: "install", from: input.patchedBinary, to: input.installedBinary },
    ],
  }
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readTextIfExists(path: string) {
  try {
    return await readFile(path, "utf8")
  } catch {
    return ""
  }
}

function defaultInstalledBinary() {
  return process.env.OPENCODE_BIN ?? join(homedir(), ".opencode", "bin", "opencode")
}

function defaultPatchedBinary() {
  return process.env.OPENCODE_PATCHED_BIN ?? "/mnt/c/Users/victo/documents/code/opencode/packages/opencode/opencode"
}

function defaultTuiConfig() {
  return process.env.OPENCODE_TUI_CONFIG ?? join(homedir(), ".config", "opencode", "tui.json")
}

function backupPath(binary: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z")
  return `${binary}.bak-${stamp}`
}

async function inspectDoctor() {
  const installedBinary = defaultInstalledBinary()
  const binary = await readTextIfExists(installedBinary)
  const quotaEndpointPresent = containsQuotaEndpoint(binary)
  const tuiConfigPath = defaultTuiConfig()
  const tuiConfigText = await readTextIfExists(tuiConfigPath)
  let duplicatePlugin = false

  if (tuiConfigText) {
    try {
      duplicatePlugin = hasDuplicateUsageQuotaPlugin(JSON.parse(tuiConfigText), quotaEndpointPresent)
    } catch {
      duplicatePlugin = false
    }
  }

  return {
    installedBinary,
    quotaEndpointPresent,
    tuiConfigPath,
    duplicatePlugin,
  }
}

export async function runDoctor() {
  const report = await inspectDoctor()
  console.log("OpenCode quota keeper")
  console.log(`- installed binary: ${report.installedBinary}`)
  console.log(`- quota endpoint: ${report.quotaEndpointPresent ? "present" : "missing"}`)
  console.log(`- duplicate TUI plugin: ${report.duplicatePlugin ? "present" : "absent"}`)
  if (!report.quotaEndpointPresent) process.exitCode = 1
}

export async function runRepair() {
  const installedBinary = defaultInstalledBinary()
  const patchedBinary = defaultPatchedBinary()
  const installed = await readTextIfExists(installedBinary)
  const plan = createRepairPlan({
    installedBinary,
    patchedBinary,
    backupBinary: backupPath(installedBinary),
    installedHasQuotaEndpoint: containsQuotaEndpoint(installed),
    patchedBinaryExists: await exists(patchedBinary),
  })

  if (!plan.needed) {
    console.log("OpenCode quota keeper: installed binary already has a quota endpoint")
    return
  }

  for (const step of plan.steps) {
    if (step.action === "backup") {
      await copyFile(step.from, step.to)
      console.log(`backup: ${step.from} -> ${step.to}`)
    } else {
      await copyFile(step.from, step.to)
      console.log(`install: ${step.from} -> ${step.to}`)
    }
  }
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env })
    child.on("exit", (code) => resolve(code ?? 1))
    child.on("error", () => resolve(1))
  })
}

export async function runCapture(label = "keeper-capture") {
  const script = join(process.cwd(), "qa", "capture-opencode-tui.sh")
  const env = {
    ...process.env,
    OPENCODE_MEMORY_CAP_KB: process.env.OPENCODE_MEMORY_CAP_KB ?? "1200000",
    OPENCODE_CAPTURE_SECONDS: process.env.OPENCODE_CAPTURE_SECONDS ?? "10",
  }
  const code = await runProcess(script, [label], env)
  process.exitCode = code
}

async function main(argv: string[]) {
  const [command = "doctor", label] = argv
  if (command === "doctor") return runDoctor()
  if (command === "install" || command === "repair") return runRepair()
  if (command === "capture") return runCapture(label)
  console.error("Usage: opencode-quota-keeper <doctor|install|repair|capture> [capture-label]")
  process.exitCode = 2
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
