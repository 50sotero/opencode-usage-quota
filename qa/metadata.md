# Before/after OpenCode plugin QA metadata

## Environment

- Date: 2026-04-28
- OpenCode binary: `<opencode>/packages/opencode/dist/opencode-linux-x64/bin/opencode`
- OpenCode version shown in both captures: `1.14.28`
- Working directory: `~/projects/opencode-usage-quota`
- tmux geometry: `160x42`
- Baseline config: `<repo>/qa/tui.before.json`
- Plugin config: `<repo>/qa/tui.after.json`
- Plugin path loaded by after config: `<repo>/src/tui.tsx`

## Isolation knobs

Both runs used:

```text
OPENCODE_DISABLE_PROJECT_CONFIG=1
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DISABLE_TERMINAL_TITLE=1
```

Each run also used separate disposable directories for:

```text
HOME
XDG_CONFIG_HOME
XDG_DATA_HOME
XDG_CACHE_HOME
XDG_STATE_HOME
OPENCODE_CONFIG_DIR
```

This prevents global/user/project OpenCode config from being the reason the after screenshot differs from the baseline.

## Artifacts

- Baseline text capture: `qa/before.txt`
- Plugin text capture: `qa/after.txt`
- Baseline terminal screenshot: `qa/before.svg`
- Plugin terminal screenshot: `qa/after.svg`
- Baseline ANSI capture: `qa/before.ansi`
- Plugin ANSI capture: `qa/after.ansi`

PNG screenshots are generated from sanitized tmux pane text using Pillow.

## Observations

Baseline relevant lines:

```text
┃  Build  Big Pickle OpenCode Zen
tab agents  ctrl+p commands
~/projects/opencode-usage-quota:main                                                                                                                 1.14.28
```

Plugin relevant lines when no quota or local usage is available:

```text
┃  Build  Big Pickle OpenCode Zen
tab agents  ctrl+p commands
~/projects/opencode-usage-quota:main                                                                                                                 1.14.28
```

The plugin intentionally renders nothing in the prompt row when the disposable QA state has no OpenAI/Codex OAuth credentials and no assistant-token history.

## Load/error evidence

After log proof:

```text
INFO service=tui.plugin path=file://<repo>/src/tui.tsx retry=false loading tui plugin
INFO service=tui.plugin path=file://<repo>/src/tui.tsx retry=false state=first source=file ... tui plugin metadata updated
INFO service=server method=GET path=/experimental/console/codex-quota request
INFO service=server status=completed ... path=/experimental/console/codex-quota request
```

Searches for `failed`, `ERROR`, `Error`, and `exception` in the fresh after-run logs returned no plugin/runtime failure matches.

## Verdict

PASS for isolated TUI load and visual before/after proof:

- Same working directory and terminal size.
- Same baseline UI state.
- Plugin run differs only by explicit `OPENCODE_TUI_CONFIG` and disposable state dirs.
- Plugin loads without rendering placeholder text when quota is unavailable.
- Footer/version remains separate and unchanged.
- Plugin load is confirmed by logs.
