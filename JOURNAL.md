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
- Completed the first before/after OpenCode QA pass. `qa/before.svg` shows no plugin text; `qa/after.svg` shows `quota unavailable` next to the model/provider row. This is the expected isolated fallback because the QA run uses fresh XDG/OpenCode state without Codex OAuth credentials or local assistant usage history.
- Fresh after-run logs confirm `src/tui.tsx` loaded as a TUI plugin and that `/experimental/console/codex-quota` was requested. No `failed`, `ERROR`, `Error`, or `exception` matches appeared in the fresh after-run logs.
