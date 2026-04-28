# QA artifacts

This directory stores isolated before/after OpenCode TUI captures for `opencode-usage-quota`.

- `tui.before.json` — empty TUI config baseline.
- `tui.after.json` — TUI config that loads the local plugin source file.
- `before.txt` / `after.txt` — plain tmux pane captures.
- `before.png` / `after.png` — generated terminal screenshots from the pane captures.
- `metadata.md` — exact commands, environment, and observations.

The committed screenshots are SVG terminal captures because this environment had no native PNG conversion tool or Python PIL package available.
