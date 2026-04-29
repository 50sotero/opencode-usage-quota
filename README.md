# opencode-usage-quota

OpenCode TUI plugin for provider quota visibility. It shows compact provider quota below the chat prompt on stock OpenCode, keeps `/quota` available for detail views, and automatically avoids duplicate compact rows when a native OpenCode provider-quota UI is detectable.

## What it reports

Provider data is normalized with explicit confidence labels:

- `exact` — current remaining quota from a provider-owned or OpenCode-owned quota source.
- `reported` — official limits or response/header values that are current but may not cover every provider window.
- `estimated` — local usage or heuristics only; never shown as enforced remaining quota in the compact prompt.

Compact prompt output only includes `exact` and `reported` windows. Estimated local usage is available in details so it cannot be mistaken for real provider quota.

## Install from this repo

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["github:50sotero/opencode-usage-quota"]
}
```

For local development:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["/absolute/path/to/opencode-usage-quota/src/tui.tsx", { "refreshMs": 60000 }]]
}
```

## UI surfaces

- Compact status below the session prompt and home prompt when native OpenCode provider quota is absent.
- Command palette entry and slash command: `/quota`.
- Native-aware guard: if OpenCode exposes generated native provider-quota helpers, this plugin keeps the detail command but does not render a duplicate compact prompt row.

Example compact status:

```text
codex 5h 88% · wk 94%
```

If only estimated local usage exists, the compact prompt stays empty and `/quota` labels the data as estimated usage.

## Provider support matrix

| Provider/source | Compact quota | Detail view | Confidence |
| --- | --- | --- | --- |
| Codex / ChatGPT OAuth via OpenCode quota endpoint | Yes | Yes | `exact` |
| Native OpenCode `/experimental/provider-quota` when present | Native UI owns compact row | Yes | Source-provided |
| Local OpenCode assistant token usage | No | Yes | `estimated` |
| Anthropic, Gemini, Copilot, OpenRouter, custom providers | Adapter framework ready; exact quota requires provider-specific adapter/native source | Yes when adapter data exists | `reported` or `estimated` unless exact source exists |

## Keeper utility

This repo includes `opencode-quota-keeper` for local patched-binary guardrails and memory-caged visual checks:

```bash
bun run keeper -- doctor
bun run keeper -- repair
OPENCODE_MEMORY_CAP_KB=1200000 bun run keeper -- capture local-home
```

`doctor` checks whether the installed OpenCode binary contains a provider quota endpoint and whether duplicate quota plugins are configured. `capture` runs the tmux visual harness with a memory cap so a bad OpenCode session cannot consume the machine.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```
