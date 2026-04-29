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

Run an isolated home-state capture with the memory cage used by the two-track provider quota plan:

```bash
OPENCODE_MEMORY_CAP_KB=1200000 OPENCODE_CAPTURE_SECONDS=10 qa/capture-opencode-tui.sh local-home
```

Run against the real user OpenCode config and also capture an existing session:

```bash
OPENCODE_USE_REAL_HOME=1 \
OPENCODE_SESSION_ID=ses_... \
OPENCODE_CAPTURE_SECONDS=8 \
qa/capture-opencode-tui.sh real-home-session
```

Run a real-config prompted-session capture when provider contact is intentional:

```bash
OPENCODE_USE_REAL_HOME=1 \
OPENCODE_SESSION_ID=ses_... \
OPENCODE_SEND_PROMPT="Reply with one short quota smoke-test sentence." \
OPENCODE_MEMORY_CAP_KB=1200000 \
OPENCODE_BEFORE_PROMPT_SECONDS=7 \
OPENCODE_AFTER_PROMPT_SECONDS=8 \
OPENCODE_CAPTURE_SECONDS=10 \
qa/capture-opencode-tui.sh real-prompted-session
```

Prompt injection can contact a provider and should only be used when that side effect is intended. Do not publish raw provider responses, account identifiers, or credential-bearing logs.

Useful safety/timing knobs:

- `OPENCODE_MEMORY_CAP_KB=1200000` kills the tmux pane process tree if RSS crosses the cap.
- `OPENCODE_BEFORE_PROMPT_SECONDS=7` waits for the prompt to be ready before sending `OPENCODE_SEND_PROMPT`.
- `OPENCODE_AFTER_PROMPT_SECONDS=8` controls how long to observe after the prompt is submitted.
- `OPENCODE_PRINT_LOGS=1` opts into OpenCode INFO logs; logs are off by default so captures stay visually clean.

## Provider quota visual expectations

For stock OpenCode plugin mode, captures should show the plugin's compact Codex status when Codex quota is available through the safe OpenCode helper/route. When Codex quota is unavailable, the compact line may say `codex quota unavailable`; local provider usage should appear only in the `/quota` detail dialog and must be labeled as usage/estimated data.

For native OpenCode provider-quota mode, captures should prove the native prompt metrics line owns compact quota placement and that the plugin does not add a duplicate compact quota row. Keep a memory-caged home capture and a prompted-session capture whenever changing prompt rendering, quota sync, or provider adapter code.
