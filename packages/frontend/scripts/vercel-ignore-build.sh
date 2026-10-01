#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
#
# Vercel's contract, which is easy to get backwards:
#   exit 0  -> SKIP the build
#   exit 1  -> RUN the build
#
# Policy (stacked PRs, one preview build per submission):
#   - Production always builds.
#   - Preview builds run only when the commit message contains [preview].
#     Tag the commit you want a test build of (e.g. a layout change), and the
#     top commit of a stack when it is submitted. Every other push is skipped,
#     so a stack of N PRs costs one build, not N.
#
# The PR preview pairing workflow (.github/workflows/pr-preview-pairing.yml)
# applies the same marker, so Railway backends are paired only where a Vercel
# preview actually exists.

set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "vercel-ignore-build: production -> build"
  exit 1
fi

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[preview]"*)
    echo "vercel-ignore-build: [preview] marker -> build"
    exit 1
    ;;
esac

echo "vercel-ignore-build: no [preview] marker -> skip (add [preview] to the commit message to build)"
exit 0
