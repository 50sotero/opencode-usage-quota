# Provider Quota Two-Track Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build both an installable standalone provider-quota plugin and an official OpenCode native PR for provider quota state and prompt UI.

**Architecture:** Keep one normalized quota vocabulary across both tracks. The standalone plugin provides immediate stock-OpenCode value with honest confidence labels and no duplicate native UI. The OpenCode PR ports the provider quota service natively for server-side auth access, async TUI sync, and prompt-line placement near built-in context usage.

**Tech Stack:** TypeScript, Bun, OpenCode TUI plugin API, OpenCode monorepo, Solid/OpenTUI, tmux visual QA harness, GitHub CLI for PR creation.

---

## Acceptance criteria

- Standalone plugin track:
  - `bun test`, `bun run typecheck`, and `bun run build` pass in `/mnt/c/users/victo/Documents/code/opencode-usage-quota`.
  - Plugin exposes normalized provider quota snapshots with `exact | reported | estimated` confidence.
  - Plugin renders compact quota only when native OpenCode quota is absent, and provides `/quota` detail UI in all modes.
  - README documents provider support and exact-vs-estimated semantics.

- Native OpenCode PR track:
  - Relevant OpenCode package tests pass from `/mnt/c/Users/victo/documents/code/opencode/packages/opencode`.
  - Native provider quota service exposes `GET /experimental/provider-quota` without blocking TUI bootstrap.
  - Prompt metrics show active provider quota beside built-in context/cost usage.
  - A PR is opened against the official OpenCode repository from the local OpenCode branch.

- Keeper/QA track:
  - Keeper detects missing native quota endpoint and duplicate TUI plugin config.
  - Keeper capture proves initial home and prompted session render under `OPENCODE_MEMORY_CAP_KB=1200000`.
  - No live `opencode` process remains after capture.

## File structure

### Standalone plugin repo: `/mnt/c/users/victo/Documents/code/opencode-usage-quota`

- Create `src/provider-quota.ts` — normalized quota types, guards, formatter helpers.
- Create `src/provider-quota.test.ts` — model/formatting tests.
- Create `src/providers/index.ts` — adapter registry and safe fan-out.
- Create `src/providers/codex.ts` — Codex/native route adapter using existing `readCodexQuota` fallback.
- Create `src/providers/local-usage.ts` — estimated local usage adapter from observed OpenCode messages.
- Modify `src/codex-quota-client.ts` — keep as low-level Codex/native route client.
- Modify `src/quota.ts` — either delegate to `provider-quota.ts` or keep backward-compatible wrappers.
- Modify `src/tui.tsx` — use provider quota snapshots, avoid duplicate native compact UI, preserve `/quota` detail command.
- Modify `src/tui.test.ts` — render-safety tests for native-present vs stock-OpenCode modes.
- Create `src/keeper.ts` — keeper command implementation.
- Create `src/keeper.test.ts` — command planning/detection tests without replacing real binaries.
- Modify `package.json` — add `bin` entry and keeper scripts if needed.
- Modify `README.md` and `qa/README.md` — install, provider support, QA commands.

### OpenCode repo: `/mnt/c/Users/victo/documents/code/opencode`

- Create `packages/opencode/src/provider/quota.ts` — native quota model, adapter interface, adapter registry.
- Modify `packages/opencode/src/plugin/codex.ts` — preserve Codex quota retrieval and expose it through the provider adapter.
- Modify `packages/opencode/src/config/console-state.ts` or create `packages/opencode/src/config/provider-quota.ts` — zod schemas for provider quota snapshots.
- Modify `packages/opencode/src/server/routes/experimental.ts` — add `GET /experimental/provider-quota`.
- Regenerate SDK files with `./packages/sdk/js/script/build.ts` when the route schema changes.
- Modify `packages/opencode/src/cli/cmd/tui/context/sync.tsx` — async quota hydration.
- Modify `packages/opencode/src/cli/cmd/tui/component/prompt/metrics.ts` — quota line formatting.
- Modify `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — include provider quota in prompt metric parts.
- Add/modify tests under `packages/opencode/test/plugin`, `packages/opencode/test/cli/tui`, and `packages/opencode/test/cli/cmd/tui`.

---

## Chunk 1: Standalone plugin quota model

### Task 1: Add normalized provider quota model

**Files:**
- Create: `src/provider-quota.ts`
- Create: `src/provider-quota.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/provider-quota.test.ts` with tests for:

```ts
import { describe, expect, test } from "bun:test"
import { formatProviderQuotaPrompt, normalizeProviderQuotaSnapshots } from "./provider-quota.js"

describe("provider quota model", () => {
  test("keeps exact and reported windows visible in compact prompt output", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "codex",
        label: "Codex",
        fetchedAt: 1,
        status: "available",
        windows: [
          { label: "5h", remainingPercent: 97, confidence: "exact", source: "official_api" },
          { label: "wk", remainingPercent: 90, confidence: "exact", source: "official_api" },
        ],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "codex")).toBe("codex 5h 97% · wk 90%")
  })

  test("hides estimated-only windows from compact prompt output", () => {
    const snapshots = normalizeProviderQuotaSnapshots([
      {
        provider: "copilot",
        label: "Copilot",
        fetchedAt: 1,
        status: "degraded",
        windows: [{ label: "weekly", remainingPercent: 58, confidence: "estimated", source: "heuristic" }],
      },
    ])

    expect(formatProviderQuotaPrompt(snapshots, "copilot")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/provider-quota.test.ts
```

Expected: fail because `src/provider-quota.ts` does not exist.

- [ ] **Step 3: Implement minimal model**

Create `src/provider-quota.ts` with exported types:

```ts
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
```

Implement `normalizeProviderQuotaSnapshots()` and `formatProviderQuotaPrompt()` with these rules:

- Drop malformed snapshots.
- Clamp percentages to `0..100` and round in prompt formatting.
- Compact prompt includes only `exact` and `reported` windows.
- Prefer the requested active provider; fallback to first available exact/reported provider.

- [ ] **Step 4: Run model tests**

Run:

```bash
bun test src/provider-quota.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit standalone model**

```bash
git add src/provider-quota.ts src/provider-quota.test.ts
git commit -m "Add provider quota model for plugin adapters"
```

Use Lore trailers for constraints and tested commands.

### Task 2: Add plugin adapter registry

**Files:**
- Create: `src/providers/index.ts`
- Create: `src/providers/codex.ts`
- Create: `src/providers/local-usage.ts`
- Test: `src/providers/index.test.ts`

- [ ] **Step 1: Write failing registry tests**

Test that adapter failures return degraded/unavailable snapshots and do not throw the whole registry.

- [ ] **Step 2: Run failing test**

```bash
bun test src/providers/index.test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement adapter interface**

Define:

```ts
export type ProviderQuotaAdapterContext = {
  client: unknown
  records: readonly UsageRecord[]
  now?: number
}

export type ProviderQuotaAdapter = {
  provider: string
  read: (ctx: ProviderQuotaAdapterContext) => Promise<ProviderQuotaSnapshot | undefined>
}
```

Implement `readProviderQuotas(adapters, ctx)` with safe `Promise.allSettled` behavior.

- [ ] **Step 4: Implement Codex adapter**

Use `readCodexQuota(api.client)` and convert to `ProviderQuotaSnapshot` with exact windows.

- [ ] **Step 5: Implement local usage adapter**

Use `summarizeUsage(records)` to produce estimated usage details only. Do not expose estimated windows to compact prompt unless explicitly configured later.

- [ ] **Step 6: Run focused tests**

```bash
bun test src/provider-quota.test.ts src/providers/index.test.ts src/codex-quota-client.test.ts
```

Expected: all pass.

---

## Chunk 2: Standalone plugin UI and docs

### Task 3: Wire provider quota into TUI plugin without duplicate native UI

**Files:**
- Modify: `src/tui.tsx`
- Modify: `src/tui.test.ts`
- Modify: `src/quota.ts` if compatibility wrappers are needed

- [ ] **Step 1: Add failing render-safety tests**

Tests should verify:

- Plugin still registers `/quota`.
- Compact quota slot renders only when native provider quota is absent.
- When native quota is detected, plugin does not render a duplicate compact row.
- Session prompt render does not persist usage records.

- [ ] **Step 2: Run failing tests**

```bash
bun test src/tui.test.ts
```

Expected: fail on missing native-present behavior.

- [ ] **Step 3: Implement native detection**

Add a small helper in `src/tui.tsx` or `src/provider-quota.ts`:

```ts
function hasNativeProviderQuota(api: TuiPluginApi) {
  // Prefer positive detection: provider quota route/synced native line exists.
  // Fall back to false on stock OpenCode.
}
```

Keep implementation conservative: if detection is uncertain, render detail command but do not duplicate a native prompt line that is visibly present.

- [ ] **Step 4: Wire provider snapshots**

Replace direct `snapshot`-only state with `ProviderQuotaSnapshot[]`, while preserving existing Codex compatibility through the Codex adapter.

- [ ] **Step 5: Run plugin tests**

```bash
bun test src/provider-quota.test.ts src/providers/index.test.ts src/quota.test.ts src/tui.test.ts
bun run typecheck
```

Expected: all pass.

### Task 4: Update standalone plugin documentation

**Files:**
- Modify: `README.md`
- Modify: `qa/README.md`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Document two install modes**

README must describe:

- Stock OpenCode plugin install.
- Native OpenCode mode where plugin hides compact duplicate UI.
- Provider support tiers.
- Exact/reported/estimated labels.

- [ ] **Step 2: Document QA commands**

`qa/README.md` must include:

```bash
OPENCODE_MEMORY_CAP_KB=1200000 OPENCODE_CAPTURE_SECONDS=10 qa/capture-opencode-tui.sh local-home
```

and the real-config prompted-session command.

- [ ] **Step 3: Run docs-adjacent verification**

```bash
bun test
bun run typecheck
```

Expected: all pass.

- [ ] **Step 4: Commit plugin track**

```bash
git add README.md JOURNAL.md qa/README.md src package.json bun.lock
git commit -m "Add standalone provider quota plugin framework"
```

---

## Chunk 3: OpenCode native quota service foundation

### Task 5: Add native provider quota schema and service

**Repo:** `/mnt/c/Users/victo/documents/code/opencode`

**Files:**
- Create: `packages/opencode/src/provider/quota.ts`
- Create or modify: `packages/opencode/src/config/provider-quota.ts`
- Modify: `packages/opencode/src/server/routes/experimental.ts`
- Test: `packages/opencode/test/plugin/provider-quota.test.ts`

- [ ] **Step 1: Write failing native service tests**

Test:

- Codex adapter returns exact five-hour/weekly windows.
- Adapter failures return unavailable/degraded results without throwing.
- `GET /experimental/provider-quota` returns an array of snapshots.

- [ ] **Step 2: Run focused failing tests**

```bash
cd /mnt/c/Users/victo/documents/code/opencode/packages/opencode
bun test test/plugin/provider-quota.test.ts --timeout 30000
```

Expected: fail because files/routes do not exist.

- [ ] **Step 3: Implement schema**

Use zod schemas matching the design:

```ts
export const ProviderQuotaWindow = z.object({
  label: z.string(),
  remainingPercent: z.number().min(0).max(100).optional(),
  remaining: z.number().nonnegative().optional(),
  limit: z.number().nonnegative().optional(),
  resetAt: z.number().int().nonnegative().optional(),
  confidence: z.enum(["exact", "reported", "estimated"]),
  source: z.enum(["official_api", "response_headers", "client_state", "heuristic"]),
})
```

- [ ] **Step 4: Implement adapter registry**

In `packages/opencode/src/provider/quota.ts`, implement a registry with Codex adapter first. Reuse `getCodexQuotaSnapshot()` from `src/plugin/codex.ts`.

- [ ] **Step 5: Add route**

Add `GET /experimental/provider-quota` to `experimental.ts`. It should catch adapter failures and return JSON without blocking existing `/experimental/console`.

- [ ] **Step 6: Run native service tests**

```bash
bun test test/plugin/provider-quota.test.ts --timeout 30000
```

Expected: pass.

### Task 6: Regenerate OpenCode SDK surface

**Repo:** `/mnt/c/Users/victo/documents/code/opencode`

**Files:**
- Modify generated SDK files under `packages/sdk/js/src/v2/gen/`
- Modify `packages/sdk/openapi.json` if generation updates it

- [ ] **Step 1: Run SDK generator**

```bash
cd /mnt/c/Users/victo/documents/code/opencode
./packages/sdk/js/script/build.ts
```

Expected: generated route includes `experimental.providerQuota` or equivalent operation.

- [ ] **Step 2: Verify generated route**

```bash
rg "provider-quota|providerQuota" packages/sdk packages/opencode/src/server/routes/experimental.ts
```

Expected: route and generated client references are present.

- [ ] **Step 3: Commit native service foundation**

```bash
git add packages/opencode/src/provider/quota.ts packages/opencode/src/config/provider-quota.ts packages/opencode/src/server/routes/experimental.ts packages/opencode/test/plugin/provider-quota.test.ts packages/sdk
git commit -m "Add native provider quota service"
```

---

## Chunk 4: OpenCode native TUI sync and prompt UI

### Task 7: Add async sync hydration

**Repo:** `/mnt/c/Users/victo/documents/code/opencode`

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- Test: `packages/opencode/test/cli/tui/sync-provider.test.tsx`

- [ ] **Step 1: Extend existing sync tests**

Add assertions that provider quota hydration:

- runs after console bootstrap,
- does not block the bootstrap request,
- refreshes on workspace change,
- clears stale in-flight locks on failure.

- [ ] **Step 2: Run failing sync test**

```bash
cd /mnt/c/Users/victo/documents/code/opencode/packages/opencode
bun test test/cli/tui/sync-provider.test.tsx --timeout 30000
```

Expected: fail until sync includes provider quota.

- [ ] **Step 3: Implement sync**

Follow the existing Codex quota sync pattern, but generalize to provider quota state.

- [ ] **Step 4: Run sync tests**

```bash
bun test test/cli/tui/sync-provider.test.tsx --timeout 30000
```

Expected: pass.

### Task 8: Add native prompt formatting

**Repo:** `/mnt/c/Users/victo/documents/code/opencode`

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/component/prompt/metrics.ts`
- Modify: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- Test: `packages/opencode/test/cli/cmd/tui/prompt-metrics.test.ts`

- [ ] **Step 1: Write failing prompt metrics tests**

Test exact/reported formatting, estimated hiding, active-provider priority, and width fallback.

- [ ] **Step 2: Run failing test**

```bash
bun test test/cli/cmd/tui/prompt-metrics.test.ts --timeout 30000
```

- [ ] **Step 3: Implement formatting**

Add provider quota formatting functions that preserve current Codex compact output:

```text
codex 5h █████ 97% · wk █████ 90%
```

For narrow terminals, fall back to percentages before clipping into `ctrl+p commands`.

- [ ] **Step 4: Wire prompt metric parts**

In prompt `index.tsx`, include provider quota between context usage and cost, using the active session/model provider where available.

- [ ] **Step 5: Run prompt tests**

```bash
bun test test/cli/cmd/tui/prompt-metrics.test.ts test/cli/tui/sync-provider.test.tsx --timeout 30000
```

Expected: pass.

- [ ] **Step 6: Commit native TUI UI**

```bash
git add packages/opencode/src/cli/cmd/tui/context/sync.tsx packages/opencode/src/cli/cmd/tui/component/prompt packages/opencode/test/cli
git commit -m "Show provider quota in native prompt metrics"
```

---

## Chunk 5: Provider adapters beyond Codex

### Task 9: Add Anthropic adapter with honest confidence

**Repos:** start in OpenCode, port safe subset to plugin after tests pass.

**Files:**
- OpenCode: `packages/opencode/src/provider/quota.ts` or `packages/opencode/src/provider/quota/anthropic.ts`
- Plugin: `src/providers/anthropic.ts`
- Tests in both repos

- [ ] **Step 1: Write parsing tests for Anthropic headers**

Use fixture headers for request and token limits. Expected confidence: `reported`, source: `response_headers`.

- [ ] **Step 2: Implement header parser only**

Do not add a live network call until parser tests pass.

- [ ] **Step 3: Add optional Admin API path**

Gate behind explicit config/admin key. Expected source: `official_api` but only configured limits unless current remaining data is returned.

- [ ] **Step 4: Run targeted tests in both repos**

```bash
# plugin
bun test src/providers/anthropic.test.ts

# opencode
cd /mnt/c/Users/victo/documents/code/opencode/packages/opencode
bun test test/plugin/provider-quota.test.ts --timeout 30000
```

### Task 10: Add Gemini adapter with conservative labeling

- [ ] **Step 1: Write fixture tests for Gemini quota data available from documented APIs/config.**
- [ ] **Step 2: Implement parser and label static/project limits as `reported`, not exact remaining quota.**
- [ ] **Step 3: Add detail output explaining unavailable current remaining quota when applicable.**
- [ ] **Step 4: Run provider adapter tests in both repos.**

### Task 11: Add Copilot official metrics first, experimental individual quota second

- [ ] **Step 1: Add docs-backed tests for Copilot usage metrics shape.**
- [ ] **Step 2: Implement official org/team metrics adapter as usage visibility, not exact quota.**
- [ ] **Step 3: Add experimental individual quota probe only if a stable source is verified.**
- [ ] **Step 4: Ensure prompt UI hides estimated-only Copilot data by default.**

---

## Chunk 6: Keeper and visual QA

### Task 12: Add keeper doctor/capture commands

**Files:**
- Create: `src/keeper.ts`
- Create: `src/keeper.test.ts`
- Modify: `package.json`
- Modify: `qa/README.md`

- [ ] **Step 1: Write failing keeper detection tests**

Test pure functions for:

- endpoint string present/missing,
- duplicate TUI plugin present/missing,
- memory summary pass/fail.

- [ ] **Step 2: Implement pure detection helpers**

Keep real file writes behind command functions so tests do not replace real binaries.

- [ ] **Step 3: Add `doctor` and `capture` commands**

`capture` should call `qa/capture-opencode-tui.sh` with memory cap defaults.

- [ ] **Step 4: Run tests**

```bash
bun test src/keeper.test.ts
bun run typecheck
```

### Task 13: Add keeper repair command

- [ ] **Step 1: Write repair planning test**

Given installed binary missing endpoint and local patched binary present, assert repair plan backs up then installs.

- [ ] **Step 2: Implement repair with explicit backup path**

Never overwrite without backup.

- [ ] **Step 3: Run keeper tests**

```bash
bun test src/keeper.test.ts
```

- [ ] **Step 4: Run real keeper capture**

```bash
OPENCODE_MEMORY_CAP_KB=1200000 bun src/keeper.ts capture
```

Expected: native quota line present, no `quota unavailable`, no live OpenCode process after capture.

---

## Chunk 7: Final verification and official PR

### Task 14: Full local verification

- [ ] **Step 1: Verify plugin repo**

```bash
cd /mnt/c/users/victo/Documents/code/opencode-usage-quota
bun run typecheck
bun run build
bun test
```

Expected: all pass.

- [ ] **Step 2: Verify OpenCode repo focused tests**

```bash
cd /mnt/c/Users/victo/documents/code/opencode/packages/opencode
bun typecheck
bun test test/plugin/provider-quota.test.ts test/plugin/codex.test.ts test/cli/tui/sync-provider.test.tsx test/cli/cmd/tui/prompt-metrics.test.ts --timeout 30000
```

Expected: all pass.

- [ ] **Step 3: Verify visual runtime under memory cap**

```bash
cd /mnt/c/users/victo/Documents/code/opencode-usage-quota
OPENCODE_USE_REAL_HOME=1 OPENCODE_CAPTURE_SECONDS=10 OPENCODE_MEMORY_CAP_KB=1200000 qa/capture-opencode-tui.sh final-native-quota
```

Expected: quota line visible and RSS below cap.

### Task 15: Open official OpenCode PR

**Repo:** `/mnt/c/Users/victo/documents/code/opencode`

- [ ] **Step 1: Review branch diff**

```bash
git status --short
git diff --stat dev...HEAD || git diff --stat origin/dev...HEAD
```

Expected: only native provider quota files and generated SDK files are included.

- [ ] **Step 2: Push branch**

```bash
git push -u fork feat/provider-quota-framework
```

Use the correct remote if `fork` is not the push remote.

- [ ] **Step 3: Open draft PR**

```bash
gh pr create --draft --base dev --head 50sotero:feat/provider-quota-framework --title "Add provider quota visibility to prompt metrics" --body-file /tmp/opencode-provider-quota-pr.md
```

PR body must include:

- Summary of native provider quota service.
- Provider support tiers.
- Exact/reported/estimated labeling policy.
- Verification commands and visual QA evidence.
- Note that local keeper remains outside upstream PR.

### Task 16: Commit standalone plugin release path

- [ ] **Step 1: Ensure standalone plugin repo has clean, reviewable commits.**
- [ ] **Step 2: Push plugin branch.**
- [ ] **Step 3: Update README with link to official OpenCode PR.**
- [ ] **Step 4: Tag or prepare npm/GitHub install instructions after final tests pass.**

---

## Manual QA checklist

- [ ] Stock OpenCode + standalone plugin: plugin detail UI works and compact fallback is not misleading.
- [ ] Patched/native OpenCode without standalone compact row: one quota line appears near context usage.
- [ ] Prompted session after `say ok`: quota line persists.
- [ ] Memory cap never trips during capture.
- [ ] Copilot data, if present, is labeled usage/estimated unless a verified current quota source exists.
- [ ] Vault-Tec text remains absent.
