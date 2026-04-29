# Provider quota evidence and upstream PR readiness

Date: 2026-04-29
Status: implementation support artifact
Scope: standalone plugin provider adapters, native OpenCode PR review notes, and provider confidence labels

This document records official-provider evidence used by the two-track provider quota implementation. It is intentionally conservative: a provider is only eligible for compact prompt display when it can produce `exact` or `reported` current remaining quota/limit data. Local counters, historical metrics, dashboards, or static tier tables remain `estimated` or detail-only unless the source proves current provider-enforced remaining capacity.

## Confidence policy

| Confidence | Prompt eligibility | Evidence required |
| --- | --- | --- |
| `exact` | Yes | Provider/OpenCode reports current remaining quota and reset windows for the current account/session. |
| `reported` | Yes, when current remaining/limit data is present | Official response headers or APIs report current limits, remaining values, or configured limits. Missing windows must be shown in details, not inferred. |
| `estimated` | No compact prompt display by default | Local usage counters, trend metrics, warning text, static tables, or heuristic calculations. |

Adapter failures should return `unavailable`/`degraded` snapshots with short details. They must not block TUI bootstrap or hide other providers that have usable quota data.

## Provider evidence matrix

| Provider | Official source | Adapter implication | Confidence |
| --- | --- | --- | --- |
| Codex / ChatGPT OAuth | Patched/native OpenCode `getCodexQuotaSnapshot()` reads the ChatGPT usage endpoint through existing OpenCode OAuth auth. | Keep Codex as the first exact adapter in both plugin and native OpenCode. Preserve five-hour and weekly windows. | `exact` when windows are returned. |
| Anthropic API | Anthropic documents response headers for request/token limits, remaining values, reset times, and `retry-after`. It also documents an Admin Rate Limits API for configured organization/workspace limits. | Parse response headers opportunistically from real API responses. Use Admin API only when explicitly configured with an admin key. Header-backed current remaining values can be compact; configured limits alone belong in details unless current remaining data is present. | `reported` for headers/configured limits; not `exact` long-window quota. |
| Gemini API | Google documents Gemini API rate limits as tier/project/model-dependent, viewable in AI Studio, and warns that specified rate limits are not guaranteed because actual capacity may vary. | Treat model/tier/project limits as configured or reported limits, not current remaining user quota. Do not claim current remaining quota unless a current usage/remaining API is added and documented. | `reported` for documented limits; `estimated` for local counters. |
| GitHub Copilot | GitHub documents organization and team Copilot metrics endpoints with usage/engagement aggregates. | Use official metrics for detail reporting only. They are usage visibility, not a per-user remaining session/weekly quota source. Individual quota probes must stay experimental until an official current remaining source is verified. | `estimated`/usage detail by default. |
| OpenRouter | OpenRouter documents a key endpoint for current rate limit or credits left on an API key and notes account/key creation does not bypass global capacity controls. | A key-info adapter can report credits/rate-limit data as provider-specific detail. Compact prompt display should require a clear current remaining percentage or current remaining+limit pair. | `reported` when current key data is available. |

## Upstream PR readiness notes

- Keep the upstream OpenCode PR focused on native provider quota state, route schema, async TUI hydration, and prompt metrics. Do not include local keeper scripts or standalone-plugin QA artifacts unless maintainers ask.
- The native route should remain non-blocking for TUI startup. Provider adapter failures should be isolated and represented as unavailable/degraded provider snapshots.
- Generated SDK changes are expected when adding `GET /experimental/provider-quota`; verify generated operation naming and avoid committing unrelated generated/provider snapshot churn.
- Prompt metrics must prefer the active provider when that provider has prompt-visible `exact`/`reported` windows. Estimated-only providers should be hidden from compact prompt output and visible only in detail surfaces.
- PR body should explicitly state the confidence vocabulary, provider support tiers, and verification commands for route tests, sync tests, prompt metrics tests, typecheck, and memory-caged visual QA.

## Official references checked on 2026-04-29

- Anthropic rate-limit headers: https://platform.claude.com/docs/en/api/rate-limits
- Anthropic Admin Rate Limits API: https://platform.claude.com/docs/en/build-with-claude/rate-limits-api
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- GitHub Copilot metrics REST API: https://docs.github.com/en/rest/copilot/copilot-metrics
- OpenRouter rate limits and credits remaining: https://openrouter.ai/docs/api/reference/limits
