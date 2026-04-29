# Provider quota framework and persistent OpenCode quota keeper design

Date: 2026-04-29
Status: proposed design
Scope: standalone provider quota plugin, official OpenCode native quota PR, provider adapters, and local persistence guardrails

## Context

The current working Codex quota display depends on a patched OpenCode binary. Stock OpenCode 1.14.29 did not contain the `/experimental/console/codex-quota` endpoint, so the UI regressed to `codex quota unavailable` after the installed binary was overwritten. Rebuilding and installing the local patched OpenCode branch restored the native prompt quota line.

The desired end state is explicitly two-fold:

1. A standalone plugin path that can be installed independently and provide provider quota visibility without requiring a custom OpenCode build.
2. An official OpenCode PR path that brings the quota service and native prompt UI into the upstream app.

A standalone TUI plugin can render quota data and can own sidecar/provider adapters, but it cannot reliably add server endpoints to stock OpenCode or place status exactly next to built-in context usage without cooperation from native OpenCode. The durable solution should therefore share the provider-quota model across both tracks: the plugin gives immediate portable value, while OpenCode itself becomes the long-term owner of quota state and native prompt placement. A local keeper prevents upgrades from removing the patched native behavior before it is upstreamed.

## Goals

- Deliver a standalone installable plugin that reports provider quota or clearly labeled usage estimates.
- Open an official OpenCode PR that implements native provider quota state and prompt UI.
- Show provider quota near the built-in prompt context usage line with no duplicate plugin row when the native path is available.
- Preserve the working Codex five-hour and weekly quota display across local OpenCode updates.
- Add a provider adapter framework that can support Codex, Anthropic, Gemini, Copilot, OpenRouter, and future providers without hardcoding UI logic per provider.
- Clearly distinguish exact quota from usage metrics and heuristic estimates.
- Keep runtime overhead low and avoid memory-leak traps during verification.
- Provide a repeatable caged visual test that proves the initial home screen and prompted-session screen render correctly.

## Non-goals

- Do not claim exact remaining quota for providers that do not expose it.
- Do not scrape private web dashboards as the default path.
- Do not require provider credentials beyond what OpenCode already uses unless an adapter explicitly documents that requirement.
- Do not reintroduce the redundant usage-quota TUI plugin row once native OpenCode can render provider quota; the standalone plugin should auto-degrade to detail views or hide compact rows when native quota is present.
- Do not ship a background daemon that continuously rebuilds OpenCode without an explicit user-run command or shell hook.

## Recommended approach

Build two product tracks from one shared design:

1. **Standalone plugin track** in this repository. It ships an installable TUI plugin plus provider adapters/sidecar logic for immediate quota visibility on stock OpenCode. It must label confidence honestly and avoid duplicating native quota when native support exists.
2. **Official OpenCode native PR track** in the local OpenCode checkout. It ports the normalized provider quota service into OpenCode, adds native sync state, and renders the compact quota line beside built-in prompt metrics.

Add an **opencode-quota-keeper** utility in this repository to guard the local patched binary until upstream OpenCode includes the native feature.

This beats a pure plugin because provider quota needs native auth/state access and exact prompt placement. It also beats a native-only patch because the standalone plugin remains useful before the upstream PR lands and can support experimental adapters without blocking official OpenCode review.

## Architecture

```text
provider credentials / response headers / provider APIs
                  │
                  ▼
        ProviderQuotaAdapter[]
          │                         │
          ▼                         ▼
standalone plugin/sidecar       OpenCode native provider quota service
          │                         │
          ├── TUI slot/detail UI     ├── GET /experimental/provider-quota
          ├── /quota command         ├── sync.data.provider_quota
          └── stock OpenCode path    └── native prompt metrics line

local repo utility
  opencode-quota-keeper doctor|install|repair|capture
                  │
                  ├── verifies installed binary contains quota endpoint
                  ├── rebuilds/reinstalls patched OpenCode when missing
                  └── runs memory-caged tmux visual smoke tests
```

## Normalized quota model

Adapters return a common shape:

```ts
type ProviderQuotaSnapshot = {
  provider: string
  label: string
  fetchedAt: number
  status: "available" | "unavailable" | "degraded"
  windows: ProviderQuotaWindow[]
  detail?: string
}

type ProviderQuotaWindow = {
  label: string
  remainingPercent?: number
  remaining?: number
  limit?: number
  resetAt?: number
  confidence: "exact" | "reported" | "estimated"
  source: "official_api" | "response_headers" | "client_state" | "heuristic"
}
```

Rules:

- `exact`: provider reports current remaining quota or reliable reset window.
- `reported`: provider reports current limits or headers but not a complete long-window quota picture.
- `estimated`: inferred from usage, warnings, or local counters.
- Prompt UI may show `exact` and `reported` values.
- Detail dialog may show `estimated` values, but must label them as estimates.

## Provider adapter tiers

### Tier 1: exact or reported official sources

- **Codex / ChatGPT OAuth**: keep the working Codex quota snapshot retrieval and native prompt line.
- **Anthropic API**: use official rate-limit headers from API responses and optionally the Admin Rate Limits API when an admin key is configured. The Admin API exposes configured limits, while response headers expose current remaining/replenishment data.
- **Gemini API**: use documented Gemini quota and Google project quota surfaces where available. Treat static model limits as configured limits, not current remaining usage, unless a current usage source is available.

### Tier 2: official usage metrics, not exact remaining quota

- **GitHub Copilot organization/team metrics**: use official Copilot metrics where available for usage visibility. These are not the same as per-user remaining session quota.
- **OpenRouter / compatible providers**: support provider-specific APIs or response headers when present.

### Tier 3: experimental / heuristic

- **GitHub Copilot individual quota**: GitHub documents session and weekly limits, but a stable public “remaining quota now” API may not exist. If a reliable client-state or endpoint source is found, gate it behind `experimental: true` and label output as estimated unless the source is official and current.
- Any provider based only on local token counters remains estimated usage, not quota.

## OpenCode integration

Add a server route:

```text
GET /experimental/provider-quota
```

The route returns all available provider quota snapshots. It should be non-blocking for initial TUI startup: bootstrap can load normal console state first, then hydrate quota asynchronously.

TUI sync stores the result under:

```ts
sync.data.provider_quota
```

The prompt metrics component selects display priority:

1. Active session/model provider quota.
2. Codex quota, if the active provider is OpenAI OAuth/Codex.
3. Highest-risk exact/reported quota window.
4. Nothing, if only unavailable or estimated data exists.

Prompt examples:

```text
codex 5h 97% · wk 90%
anthropic req 82% · tok 64%
gemini rpm 71%
copilot usage estimated 58%
```

The detail command/dialog shows all providers, confidence labels, source names, and failure reasons.

## Standalone plugin track

The standalone plugin remains a first-class deliverable, not a throwaway fallback.

Responsibilities:

- Install through normal OpenCode TUI plugin configuration.
- Fetch provider quota through plugin-owned adapters when safe credentials are available through environment, OpenCode config, or explicit plugin options.
- Read native OpenCode provider quota state when the native route exists, so it can reuse official data rather than duplicate network calls.
- Render a compact TUI slot only on stock OpenCode where native quota is absent.
- Prefer a command/detail dialog when native quota is present to avoid duplicate prompt rows.
- Ship the visual capture harness and memory cap as plugin QA.

Standalone limitations must be documented in the README: exact prompt placement and some auth internals require native OpenCode support.

## Official OpenCode PR track

The upstream PR is the long-term product path.

Responsibilities:

- Add provider quota types, service, and tests inside the OpenCode monorepo.
- Preserve the existing working Codex quota path.
- Add provider adapters incrementally, beginning with Codex and a minimal adapter registry.
- Add native TUI sync and prompt metrics formatting.
- Add a detail command/dialog if upstream maintainers accept it; otherwise keep the PR focused on state + prompt metrics.
- Include tests for route behavior, prompt formatting, async hydration, and failure isolation.

The PR should avoid including local keeper scripts or repo-specific QA artifacts unless maintainers ask for them.


## Keeper utility

Add a local utility in this repo rather than a background daemon.

Commands:

```bash
opencode-quota-keeper doctor
opencode-quota-keeper install
opencode-quota-keeper repair
opencode-quota-keeper capture
```

Responsibilities:

- Check installed OpenCode version and binary path.
- Check whether the installed binary contains `/experimental/console/codex-quota` or `/experimental/provider-quota`.
- Check that user TUI config does not load the obsolete duplicate quota plugin when native quota is available.
- Rebuild the local patched OpenCode branch with safe flags.
- Back up the existing installed binary before replacement.
- Run the tmux capture harness with `OPENCODE_MEMORY_CAP_KB=1200000`.
- Fail loudly if memory crosses the cap, quota text is missing, or `quota unavailable` appears when Codex credentials are expected to work.

Suggested output:

```text
OpenCode quota keeper
- installed binary: /home/victo/.opencode/bin/opencode
- quota endpoint: present
- native prompt quota: present
- duplicate TUI plugin: absent
- visual smoke: passed
- max RSS: 881428 KB / 1200000 KB
```

## Error handling

- Adapter failures must not block OpenCode startup.
- Each adapter returns `status: unavailable` with a short reason instead of throwing through the route.
- Network calls use short timeouts and cache successful snapshots for a bounded period.
- Auth-missing and permission-missing states are normal degraded states, not crashes.
- The prompt line hides unavailable providers; the detail dialog shows them.

## Security and privacy

- Never print API keys, OAuth tokens, account emails, or raw provider responses in QA artifacts.
- Keeper logs should redact home paths and account identifiers in public artifacts.
- Experimental Copilot probing must be opt-in and must not exfiltrate local auth tokens to third-party services.
- Provider adapters should prefer OpenCode's existing auth abstractions over reading credential files directly.

## Testing strategy

### Unit tests

- Adapter response parsing for each provider.
- Normalized quota model validation.
- Prompt formatting and priority selection.
- Failure handling for missing auth, unsupported provider, 429, malformed payload, and timeout.

### Integration tests

- OpenCode route returns Codex quota without blocking console bootstrap.
- Sync hydrates quota asynchronously and refreshes on workspace/session changes.
- Keeper detects a stock binary missing quota endpoints.
- Keeper backs up and installs patched binary.

### Visual/runtime tests

Use the existing tmux capture harness to verify:

- Initial home prompt shows native quota line.
- Prompted session still shows native quota line after submitting a small prompt.
- `codex quota unavailable` is absent when Codex quota is available.
- Vault-Tec UI text is absent.
- RSS stays below the configured cap.
- No live `opencode` process remains after capture.

## Rollout plan

1. Stabilize the standalone plugin data model and confidence labeling.
2. Add plugin adapter registry and detail UI while keeping compact slot output non-duplicative.
3. Preserve current working Codex native path in the local OpenCode branch.
4. Add `ProviderQuotaSnapshot` model and formatting tests to OpenCode.
5. Generalize the Codex route/service into the native provider quota service.
6. Add native TUI sync and prompt metrics formatting.
7. Add Anthropic adapter using headers first, Admin API second when configured.
8. Add Gemini adapter with conservative labeling.
9. Add Copilot adapter as official metrics first, experimental individual quota later only if verified.
10. Add keeper `doctor` and `capture`.
11. Add keeper `repair` with binary backup and local patched-branch rebuild.
12. Open the official OpenCode PR; keep local keeper as a temporary safety net until the PR ships in a release.

## Open questions to resolve during implementation planning

- Where should provider-specific config live: OpenCode config, this repo's keeper config, or both?
- Which providers already have credentials represented in OpenCode's current auth abstractions?
- Can Copilot individual remaining quota be read from a stable official or client-local source?
- Should keeper be invoked manually, via shell alias wrapping `opencode`, or via an optional login-shell health check?

## References

- GitHub Copilot usage limits: https://docs.github.com/copilot/concepts/rate-limits
- GitHub Copilot usage metrics: https://docs.github.com/copilot/concepts/copilot-metrics
- Anthropic rate limits: https://docs.anthropic.com/en/api/rate-limits
- Anthropic Rate Limits API: https://platform.claude.com/docs/en/build-with-claude/rate-limits-api
- Gemini API quota docs: https://ai.google.dev/gemini-api/docs/quota
