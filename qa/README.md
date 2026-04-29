# QA artifacts

This directory stores isolated and real-config OpenCode TUI captures for `opencode-usage-quota`.

- `capture-opencode-tui.sh` — repeatable tmux capture harness for visually inspecting the OpenCode TUI home state, an existing active session, and an optional prompted session.
- `tui.before.json` — empty TUI config baseline.
- `tui.after.json` — TUI config that loads the local plugin source file.
- `before.txt` / `after.txt` — plain tmux pane captures.
- `before.png` / `opencode-pr-24826-after.png` / `opencode-pr-24826-session.png` — generated terminal screenshots from sanitized pane captures.
- `metadata.md` — exact commands, environment, and observations.

The PR screenshots are PNG terminal captures rendered from sanitized text sources. Local filesystem paths and personal email addresses are redacted from public artifacts.

## Fresh visual inspection

Run an isolated home-state capture:

```bash
OPENCODE_CAPTURE_SECONDS=8 qa/capture-opencode-tui.sh local-home
```

Run against the real user OpenCode config and also capture an existing session:

```bash
OPENCODE_USE_REAL_HOME=1 \
OPENCODE_SESSION_ID=ses_... \
OPENCODE_CAPTURE_SECONDS=8 \
qa/capture-opencode-tui.sh real-home-session
```

Optional prompt injection is supported with `OPENCODE_SEND_PROMPT`, but it can contact a provider and should only be used when that side effect is intended.

Useful safety/timing knobs:

- `OPENCODE_MEMORY_CAP_KB=1200000` kills the tmux pane process tree if RSS crosses the cap.
- `OPENCODE_BEFORE_PROMPT_SECONDS=7` waits for the prompt to be ready before sending `OPENCODE_SEND_PROMPT`.
- `OPENCODE_AFTER_PROMPT_SECONDS=8` controls how long to observe after the prompt is submitted.
- `OPENCODE_PRINT_LOGS=1` opts into OpenCode INFO logs; logs are off by default so captures stay visually clean.
