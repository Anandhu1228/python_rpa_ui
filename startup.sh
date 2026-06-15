#!/usr/bin/env bash
# ── RPA Studio local dev startup ────────────────────────────
# Runs the backend directly (no Docker) — useful during development
# Prerequisites: pip install -r requirements.txt && playwright install chromium

set -e
cd "$(dirname "$0")"

echo "🔧 RPA Studio — starting dev server on http://localhost:10090"
echo "   Press Ctrl+C to stop."
echo ""

export PYTHONPATH="$(pwd)"
uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port 10090 \
  --reload \
  --reload-dir backend
