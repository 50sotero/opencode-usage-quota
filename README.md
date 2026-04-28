# opencode-usage-quota

OpenCode TUI plugin for Codex quota and local provider usage visibility.

## What it shows

- **Codex remote quota**: five-hour and weekly windows when the running OpenCode build exposes `experimental.console.codexQuota`.
- **Other providers**: rolling five-hour and weekly local token usage observed from OpenCode assistant messages.

Other provider rows are intentionally labeled as local usage, not provider-enforced quota. Anthropic, Gemini, Copilot, OpenRouter, and custom OpenAI-compatible providers do not expose a shared OpenCode quota endpoint today.

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

This repository includes `examples/tui.local.json`, which loads `../src/tui.tsx` directly for local smoke testing.

## UI surfaces

- Compact status in `session_prompt_right` and `home_prompt_right`.
- Command palette entry and slash command: `/quota`.

Example compact status:

```text
codex 5h ████░ 88% · wk █████ 94%
```

Fallback when Codex remote quota is unavailable:

```text
openai local 5h 300t · wk 500t
```

## Provider support matrix

| Provider | Remote quota | Local usage windows |
| --- | --- | --- |
| Codex / ChatGPT OAuth | Supported when OpenCode exposes the safe quota endpoint | Yes |
| OpenAI API key | Not the same quota pool as ChatGPT Codex | Yes |
| Anthropic | No shared quota endpoint in OpenCode | Yes |
| Gemini / Google | No shared quota endpoint in OpenCode | Yes |
| GitHub Copilot | No shared quota endpoint in OpenCode | Yes |
| OpenRouter / compatible providers | Provider-specific; unavailable by default | Yes |

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

Vault-Tec disclaimer: undocumented quota endpoints may mutate without warning due to provider policy changes, cosmic rays, or routine API entropy.
