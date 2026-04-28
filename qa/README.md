# QA artifacts

This directory stores isolated before/after OpenCode TUI captures for `opencode-usage-quota`.

- `tui.before.json` — empty TUI config baseline.
- `tui.after.json` — TUI config that loads the local plugin source file.
- `before.txt` / `after.txt` — plain tmux pane captures.
- `before.png` / `opencode-pr-24826-after.png` / `opencode-pr-24826-session.png` — generated terminal screenshots from sanitized pane captures.
- `metadata.md` — exact commands, environment, and observations.

The PR screenshots are PNG terminal captures rendered from sanitized text sources. Local filesystem paths and personal email addresses are redacted from public artifacts.
