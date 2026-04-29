# Development journal

## 2026-04-28

- Created the standalone `opencode-usage-quota` repo from the empty public GitHub repository at `https://github.com/50sotero/opencode-usage-quota`.
- Implemented a TUI-first OpenCode plugin because the current public plugin surface can render in `session_prompt_right` and `home_prompt_right`, while exact prompt metrics row placement still belongs in the core OpenCode PR.
- Evidence from OpenCode plugin docs/source: TUI plugins are configured through `tui.json`, file plugin paths resolve relative to the declaring config file, and `OPENCODE_TUI_CONFIG` can isolate a custom TUI config for QA runs.
- Provider quota finding: Codex can expose real five-hour and weekly quota through the patched safe OpenCode endpoint `experimental.console.codexQuota`; other providers are currently represented as local OpenCode token usage only, not provider-enforced quota.
- Built core OpenCode prompt metrics UI first and manually smoke-tested it in tmux. Initial wide timestamp clipped into `ctrl+p commands`; thresholds were tightened so a 160-column terminal uses compact bars plus short timestamp.
- Plugin QA requirement from Oracle: before/after evidence must prove config isolation, plugin load, comparable terminal dimensions/state, and no runtime plugin errors. Screenshots/captures alone are not sufficient.
- Plugin QA scout found the biggest runtime risks: entrypoint/export loading, plugin config path resolution, missing command cleanup on plugin disposal, and silent fallback if `experimental.console.codexQuota` is unavailable. Added lifecycle cleanup for the registered command.
- Screenshot plan: run baseline and plugin OpenCode in separate fixed-size tmux sessions, both with `OPENCODE_DISABLE_PROJECT_CONFIG=1`, disposable `OPENCODE_CONFIG_DIR`, and explicit `OPENCODE_TUI_CONFIG`; differ only by the plugin config file.
- Evidence plan: save terminal pane text plus generated PNG images under `qa/`, include exact launch metadata, and check that the footer/version line remains separate from plugin output.
- Completed the first before/after OpenCode QA pass. The initial placeholder text was removed after review: the plugin should render nothing when no quota or local usage is available.
- Fresh after-run logs confirm `src/tui.tsx` loaded as a TUI plugin and that `/experimental/console/codex-quota` was requested. No `failed`, `ERROR`, `Error`, or `exception` matches appeared in the fresh after-run logs.
- Installed the plugin for local checking through both the user-level `~/.config/opencode/tui.json` and the local OpenCode checkout's `.opencode/tui.json`. The checkout entry uses a relative path to this repo's `src/tui.tsx`; both entries use `{ "refreshMs": 60000, "showLocalUsageFallback": true }`.
- Local install verification passed with `bun install`, `bun run typecheck`, `bun run build`, and `bun test`. OpenCode TUI smoke testing on `1.14.29` logged `opencode-usage-quota/src/tui.tsx` as a loaded TUI plugin.
- Installation finding: keep local TUI config pointed at `src/tui.tsx`, not `dist/tui.js`. OpenCode imports `@opentui/solid/runtime-plugin-support` before loading TUI source plugins; direct compiled JS imports still reference the declaration-only `@opentui/solid/jsx-runtime` path and are not suitable for this local smoke path.
