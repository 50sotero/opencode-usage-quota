# opencode-usage-quota

OpenCode TUI plugin for Codex quota and clearly labeled provider-usage visibility.

## What it reports

- **Codex remote quota**: five-hour and weekly windows when the running OpenCode build exposes `experimental.console.codexQuota`.
- **Other providers**: rolling five-hour and weekly local token usage observed from OpenCode assistant messages.
- **Provider-quota framework handoff**: the standalone plugin track can show stock-OpenCode detail views today; the native OpenCode PR track owns exact prompt-metrics placement and server-side provider auth access.

- `exact` — current remaining quota from a provider-owned or OpenCode-owned quota source.
- `reported` — official limits or response/header values that are current but may not cover every provider window.
- `estimated` — local usage or heuristics only; never shown as enforced remaining quota in the compact prompt.

Compact prompt output only includes `exact` and `reported` windows. Estimated local usage is available in details so it cannot be mistaken for real provider quota.

## Two install modes

### Stock OpenCode plugin mode

Use this mode for released OpenCode builds that do not include native provider quota support. The plugin:

- fetches Codex quota through OpenCode's safe experimental Codex quota helper/route when available;
- renders its own compact Codex status under the prompt rows;
- keeps local provider token/cost windows in the `/quota` detail view only; and
- labels local provider data as usage, not exact quota.

### Native OpenCode provider-quota mode

Use this mode for a locally patched or future upstream OpenCode build that exposes native provider quota state, such as `GET /experimental/provider-quota` and prompt metrics beside the built-in context/cost line.

The native OpenCode track should own compact prompt placement. In that mode, this plugin should remain useful for `/quota` details and QA, but avoid rendering a duplicate compact quota row when native provider quota is visibly present.

## Two install modes

### Stock OpenCode plugin mode

Use this mode for released OpenCode builds that do not include native provider quota support. The plugin:

- fetches Codex quota through OpenCode's safe experimental Codex quota helper/route when available;
- renders its own compact Codex status under the prompt rows;
- keeps local provider token/cost windows in the `/quota` detail view only; and
- labels local provider data as usage, not exact quota.

### Native OpenCode provider-quota mode

Use this mode for a locally patched or future upstream OpenCode build that exposes native provider quota state, such as `GET /experimental/provider-quota` and prompt metrics beside the built-in context/cost line.

The native OpenCode track should own compact prompt placement. In that mode, this plugin should remain useful for `/quota` details and QA, but avoid rendering a duplicate compact quota row when native provider quota is visibly present.

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

- Compact Codex status below `session_prompt` and in `home_bottom` for stock OpenCode plugin mode.
- Command palette entry and slash command: `/quota`.
- Native-aware guard: if OpenCode exposes generated native provider-quota helpers, this plugin keeps the detail command but does not render a duplicate compact prompt row.

Example compact status:

```text
codex quota 5h 88% left · wk 94% left
```

Fallback when Codex remote quota is unavailable:

```text
codex quota unavailable
```

The `/quota` dialog is where local provider usage appears:

```text
Local OpenCode usage, not provider-enforced quota:
- anthropic/claude-sonnet: 5h 1,250,000 tokens, wk 9,500,000 tokens
```

## Provider support and confidence labels

Quota data must carry one of these confidence labels:

- `exact` — the provider or OpenCode reports current remaining quota and reset windows.
- `reported` — an official API, configured limit, or response header reports limits/remaining values, but not necessarily the full long-window quota picture.
- `estimated` — inferred from local counters, warnings, or heuristics. Estimated data belongs in detail views and must not be presented as exact remaining quota.

| Provider | Current plugin data | Confidence | Compact stock-plugin prompt |
| --- | --- | --- | --- |
| Codex / ChatGPT OAuth | Five-hour and weekly remote quota when OpenCode exposes the safe Codex endpoint | `exact` | Yes |
| OpenAI API key | Local OpenCode token/cost usage only; not the same quota pool as ChatGPT Codex | `estimated` | No |
| Anthropic | Local usage today; future adapters may consume official rate-limit headers | `estimated` today, `reported` when header-backed | No for estimated-only data |
| Gemini / Google | Local usage today; future adapters may report documented project/model limits | `estimated` today, `reported` for documented limits | No for estimated-only data |
| GitHub Copilot | Local usage today; organization/team metrics are usage visibility, not per-user remaining quota | `estimated` unless an official current source exists | No |
| OpenRouter / compatible providers | Local usage today; provider-specific APIs or response headers may be added later | `estimated` today, provider-specific later | No for estimated-only data |

The official OpenCode PR track should reuse the same `exact | reported | estimated` vocabulary so native prompt metrics and plugin detail views tell the same truth.

See [`docs/provider-quota-evidence.md`](docs/provider-quota-evidence.md) for the official-source evidence matrix that gates future provider adapters and upstream PR language.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```
