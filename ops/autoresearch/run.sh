#!/usr/bin/env bash
# Signal-first prospect discovery engine
#
# Usage:
#   ./run.sh --config configs/milo.yaml --once           # single cycle
#   ./run.sh --config configs/milo.yaml --once --dry-run  # Exa + engagement only
#   ./run.sh --config configs/milo.yaml --cycles 50       # 50 cycles
#   ./run.sh --config configs/milo.yaml --bg --cycles 50  # background

set -euo pipefail
cd "$(dirname "$0")"

# Load API keys
if [ -f ~/.config/pathos/secrets.env ]; then
    set -a
    source ~/.config/pathos/secrets.env
    set +a
fi

# Extract --bg flag (handled by this script, not passed to Python)
BG=false
ARGS=()
for arg in "$@"; do
    if [ "$arg" = "--bg" ]; then
        BG=true
    else
        ARGS+=("$arg")
    fi
done

if [ ! -d .venv ]; then
    echo "Creating venv..."
    python3 -m venv .venv
    .venv/bin/pip install -q apify-client exa-py pyyaml
fi

if [ "$BG" = true ]; then
    mkdir -p outputs
    nohup .venv/bin/python -u autoresearch.py "${ARGS[@]}" \
        > outputs/autoresearch.log 2>&1 &
    echo $! > outputs/autoresearch.pid
    echo "Started in background (PID: $!)"
    echo "  Log:        tail -f outputs/autoresearch.log"
    echo "  Scoreboard: cat outputs/scoreboard.md"
    echo "  Kill:       kill \$(cat outputs/autoresearch.pid)"
else
    exec .venv/bin/python -u autoresearch.py "${ARGS[@]}"
fi
