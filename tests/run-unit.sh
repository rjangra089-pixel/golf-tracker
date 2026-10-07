#!/usr/bin/env bash
# Runs every offline unit suite against the repo's index.html.
# No dependencies beyond Node 18+. No network, no database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="${1:-$ROOT/index.html}"
status=0
for suite in tasp home-model home-view sbfetch track; do
  echo "── $suite"
  if ! node "$ROOT/tests/unit/$suite.test.js" "$INDEX" | tail -1; then status=1; fi
  # node exits non-zero on a failed assertion; pipefail carries it through
done
exit $status
