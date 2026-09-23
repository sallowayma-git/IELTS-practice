#!/bin/sh
# Synchronize only generated question-bank assets from a Git remote.
# This script is intended for a dedicated deployment checkout. It never pulls
# application code, changes Docker containers, or touches PostgreSQL data.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
remote=${QUESTION_BANK_REMOTE:-upstream}
branch=${QUESTION_BANK_BRANCH:-main}
interval=${QUESTION_BANK_CHECK_INTERVAL_SECONDS:-900}
asset_paths='assets/generated/reading-exams assets/generated/reading-explanations assets/generated/listening-exams'

case "${1:-}" in
    '') run_once=false ;;
    --once) run_once=true ;;
    *)
        echo "Usage: $0 [--once]" >&2
        exit 64
        ;;
esac

case "$interval" in
    ''|*[!0-9]*)
        echo "QUESTION_BANK_CHECK_INTERVAL_SECONDS must be a positive integer" >&2
        exit 64
        ;;
esac

if [ "$interval" -le 0 ]; then
    echo "QUESTION_BANK_CHECK_INTERVAL_SECONDS must be a positive integer" >&2
    exit 64
fi

if ! command -v git >/dev/null 2>&1; then
    echo "git is required to update the question bank" >&2
    exit 69
fi

if [ ! -d "$repo_root/.git" ]; then
    echo "Expected a Git checkout at $repo_root" >&2
    exit 69
fi

if ! git -C "$repo_root" remote get-url "$remote" >/dev/null 2>&1; then
    echo "Git remote '$remote' is required; set QUESTION_BANK_REMOTE to a configured official upstream remote" >&2
    exit 69
fi

update_once() {
    cd "$repo_root"
    git fetch --quiet "$remote" "$branch"

    if git diff --quiet FETCH_HEAD -- $asset_paths; then
        echo "Question bank is already current ($(git rev-parse --short FETCH_HEAD))."
        return 0
    fi

    git restore --worktree --source=FETCH_HEAD -- $asset_paths
    echo "Question bank updated from $remote/$branch ($(git rev-parse --short FETCH_HEAD))."
}

if [ "$run_once" = true ]; then
    update_once
    exit $?
fi

while true; do
    if ! update_once; then
        echo "Question-bank update check failed; retrying in $interval seconds." >&2
    fi
    sleep "$interval"
done
