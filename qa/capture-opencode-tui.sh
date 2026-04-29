#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
label=${1:-visual-$(date -u +%Y%m%dT%H%M%SZ)}
out_dir=${OPENCODE_CAPTURE_DIR:-$repo_root/qa/$label}
cols=${OPENCODE_CAPTURE_COLS:-160}
rows=${OPENCODE_CAPTURE_ROWS:-42}
settle_sec=${OPENCODE_CAPTURE_SECONDS:-6}
before_prompt_sec=${OPENCODE_BEFORE_PROMPT_SECONDS:-$settle_sec}
after_prompt_sec=${OPENCODE_AFTER_PROMPT_SECONDS:-12}
rss_cap_kb=${OPENCODE_MEMORY_CAP_KB:-1500000}
opencode_bin=${OPENCODE_BIN:-opencode}
session_id=${OPENCODE_SESSION_ID:-}
send_prompt=${OPENCODE_SEND_PROMPT:-}
use_real_home=${OPENCODE_USE_REAL_HOME:-0}
print_logs=${OPENCODE_PRINT_LOGS:-0}

mkdir -p "$out_dir"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 127
  }
}

require tmux
require "$opencode_bin"

if [ "$use_real_home" = "1" ] || [ "$use_real_home" = "true" ]; then
  home_dir=${HOME:-/home/victo}
  xdg_config=${XDG_CONFIG_HOME:-$home_dir/.config}
  xdg_data=${XDG_DATA_HOME:-$home_dir/.local/share}
  xdg_cache=${XDG_CACHE_HOME:-$home_dir/.cache}
  xdg_state=${XDG_STATE_HOME:-$home_dir/.local/state}
  opencode_config_dir=${OPENCODE_CONFIG_DIR:-$xdg_config/opencode}
else
  home_dir="$out_dir/home"
  xdg_config="$out_dir/config"
  xdg_data="$out_dir/data"
  xdg_cache="$out_dir/cache"
  xdg_state="$out_dir/state"
  opencode_config_dir="$xdg_config/opencode"
  mkdir -p "$opencode_config_dir"
  cat > "$opencode_config_dir/opencode.json" <<'JSON'
{"$schema":"https://opencode.ai/config.json"}
JSON
  cat > "$opencode_config_dir/tui.json" <<JSON
{
  "\$schema": "https://opencode.ai/tui.json",
  "plugin": [["file://$repo_root/src/tui.tsx", {"refreshMs": 60000}]]
}
JSON
fi
mkdir -p "$home_dir" "$xdg_config" "$xdg_data" "$xdg_cache" "$xdg_state" "$opencode_config_dir"

get_descendants() {
  local root=$1
  local frontier="$root" all="$root" next p ppid
  while [ -n "$frontier" ]; do
    next=""
    while read -r p ppid; do
      for f in $frontier; do
        if [ "$ppid" = "$f" ]; then
          next="$next $p"
          all="$all $p"
          break
        fi
      done
    done < <(ps -eo pid=,ppid=)
    frontier=$(echo "$next" | xargs 2>/dev/null || true)
  done
  echo "$all" | xargs 2>/dev/null || true
}

sample_rss() {
  local root=$1 rss=0 count=0 p r
  for p in $(get_descendants "$root"); do
    r=$(ps -o rss= -p "$p" 2>/dev/null | awk '{print $1}' || true)
    if [ -n "${r:-}" ]; then
      rss=$((rss + r))
      count=$((count + 1))
    fi
  done
  printf '%s %s\n' "$rss" "$count"
}

terminate_process_tree() {
  local root=$1 pids remaining
  pids=$(get_descendants "$root")
  if [ -z "$pids" ]; then
    return
  fi

  kill -TERM $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8; do
    remaining=""
    for p in $pids; do
      if kill -0 "$p" 2>/dev/null; then
        remaining="$remaining $p"
      fi
    done
    [ -z "$remaining" ] && return
    sleep 0.25
  done

  kill -KILL $remaining 2>/dev/null || true
}

write_runner() {
  local phase=$1
  shift
  local runner="$out_dir/run-$phase.sh"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -euo pipefail'
    printf 'cd %q\n' "$repo_root"
    printf 'export HOME=%q\n' "$home_dir"
    printf 'export XDG_CONFIG_HOME=%q\n' "$xdg_config"
    printf 'export XDG_DATA_HOME=%q\n' "$xdg_data"
    printf 'export XDG_CACHE_HOME=%q\n' "$xdg_cache"
    printf 'export XDG_STATE_HOME=%q\n' "$xdg_state"
    printf 'export OPENCODE_CONFIG_DIR=%q\n' "$opencode_config_dir"
    echo 'export OPENCODE_DISABLE_PROJECT_CONFIG=1'
    echo 'export OPENCODE_DISABLE_AUTOUPDATE=1'
    echo 'export OPENCODE_DISABLE_TERMINAL_TITLE=1'
    printf 'exec %q' "$opencode_bin"
    if [ "$print_logs" = "1" ] || [ "$print_logs" = "true" ]; then
      printf ' %q %q %q' "--print-logs" "--log-level" "INFO"
    fi
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
  } > "$runner"
  chmod +x "$runner"
  printf '%s\n' "$runner"
}

capture_phase() {
  local phase=$1
  local prompt_text=${2:-}
  shift 2 || true
  local runner session_name pane_pid metrics status rss count max_rss=0 max_count=0 start now elapsed wait_sec
  runner=$(write_runner "$phase" "$@")
  session_name="oc-${label}-${phase}-$$"
  metrics="$out_dir/$phase.metrics.tsv"
  echo -e "t_ms\trss_kb\tpid_count\tstatus" > "$metrics"

  tmux new-session -d -x "$cols" -y "$rows" -s "$session_name" "$runner"
  pane_pid=$(tmux display-message -p -t "$session_name" '#{pane_pid}')
  start=$(date +%s%3N)
  status=running

  wait_sec=$settle_sec
  if [ -n "$prompt_text" ]; then
    wait_sec=$before_prompt_sec
  fi

  while true; do
    now=$(date +%s%3N); elapsed=$((now - start))
    read -r rss count < <(sample_rss "$pane_pid")
    [ "$rss" -gt "$max_rss" ] && max_rss=$rss
    [ "$count" -gt "$max_count" ] && max_count=$count
    echo -e "${elapsed}\t${rss}\t${count}\t${status}" >> "$metrics"
    if [ "$rss" -gt "$rss_cap_kb" ]; then
      status="killed:rss_cap_${rss}_gt_${rss_cap_kb}"
      terminate_process_tree "$pane_pid"
      tmux kill-session -t "$session_name" 2>/dev/null || true
      echo -e "${elapsed}\t${rss}\t${count}\t${status}" >> "$metrics"
      break
    fi
    if [ "$elapsed" -gt $((wait_sec * 1000)) ]; then
      break
    fi
    sleep 0.25
  done

  if [ -n "$prompt_text" ] && tmux has-session -t "$session_name" 2>/dev/null; then
    tmux send-keys -t "$session_name" -- "$prompt_text" Enter
    start=$(date +%s%3N)
    while true; do
      now=$(date +%s%3N); elapsed=$((now - start))
      read -r rss count < <(sample_rss "$pane_pid")
      [ "$rss" -gt "$max_rss" ] && max_rss=$rss
      [ "$count" -gt "$max_count" ] && max_count=$count
      echo -e "prompt+${elapsed}\t${rss}\t${count}\t${status}" >> "$metrics"
      if [ "$rss" -gt "$rss_cap_kb" ]; then
        status="killed:rss_cap_${rss}_gt_${rss_cap_kb}"
        terminate_process_tree "$pane_pid"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        echo -e "prompt+${elapsed}\t${rss}\t${count}\t${status}" >> "$metrics"
        break
      fi
      if [ "$elapsed" -gt $((after_prompt_sec * 1000)) ]; then
        break
      fi
      sleep 0.25
    done
  fi

  if tmux has-session -t "$session_name" 2>/dev/null; then
    tmux capture-pane -t "$session_name" -p -S - > "$out_dir/$phase.txt"
    tmux capture-pane -t "$session_name" -e -p -S - > "$out_dir/$phase.ansi"
    terminate_process_tree "$pane_pid"
    tmux kill-session -t "$session_name" 2>/dev/null || true
    sleep 0.25
  else
    terminate_process_tree "$pane_pid"
    sleep 0.25
    : > "$out_dir/$phase.txt"
    : > "$out_dir/$phase.ansi"
  fi

  printf '%s\t%s\t%s\t%s\n' "$phase" "$status" "$max_rss" "$max_count" >> "$out_dir/summary.tsv"
}

printf 'phase\tstatus\tmax_rss_kb\tmax_pid_count\n' > "$out_dir/summary.tsv"

capture_phase home ""

if [ -n "$session_id" ]; then
  capture_phase session "" --session "$session_id"
fi

if [ -n "$send_prompt" ]; then
  capture_phase prompted "$send_prompt"
fi

cat > "$out_dir/README.md" <<EOF_README
# OpenCode TUI capture: $label

- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Geometry: ${cols}x${rows}
- Real home/config: ${use_real_home}
- OpenCode logs in capture: ${print_logs}
- Before prompt seconds: ${before_prompt_sec}
- After prompt seconds: ${after_prompt_sec}
- Session ID capture: ${session_id:-none}
- Prompt injection capture: $([ -n "$send_prompt" ] && echo enabled || echo disabled)
- RSS cap KB: $rss_cap_kb

Artifacts:
- home.txt / home.ansi
- session.txt / session.ansi when OPENCODE_SESSION_ID is set
- prompted.txt / prompted.ansi when OPENCODE_SEND_PROMPT is set
- summary.tsv and per-phase metrics
EOF_README

cat "$out_dir/summary.tsv"
printf 'capture_dir=%s\n' "$out_dir"
