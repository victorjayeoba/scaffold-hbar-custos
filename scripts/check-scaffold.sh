#!/usr/bin/env bash
# Checks a project freshly scaffolded from this template, item by item, the way
# the Scaffold-HBAR bounty gate does: files, install, lint, types, docs, contracts,
# build, and the production app answering on every route.
#
#   scripts/check-scaffold.sh <project dir> <yarn|npm> [port]
#
# Env: LOG_DIR (default <project>/../scaffold-logs-<pm>), E2E=1 to also run the
# Playwright smoke test against the served build (needs `playwright install`).
# Used by .github/workflows/fresh-scaffold.yaml. Needs no Hedera account.
set -u

DIR=$(cd "$1" && pwd) || exit 2
PM=$2
PORT=${3:-3105}
LOGS=${LOG_DIR:-"$(dirname "$DIR")/scaffold-logs-$PM"}
mkdir -p "$LOGS"
cd "$DIR" || exit 2

# The routes the gate opens. Every other static page and API route is discovered below.
GATE_ROUTES="/ /trade /pool /keeper /debug /blockexplorer"

PASS=0
FAIL=0
pass() { echo "PASS $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL $1"; FAIL=$((FAIL + 1)); }

# A root package script with arguments. npm needs `--` to pass them on.
run() {
  local script=$1
  shift
  if [ "$PM" = npm ]; then npm run "$script" ${1+-- "$@"}; else yarn "$script" "$@"; fi
}

# check <name> <command...>: run it with its output in a log, show the tail on failure.
check() {
  local name=$1
  shift
  if "$@" >"$LOGS/$name.log" 2>&1; then
    pass "$name"
  else
    fail "$name (log: $LOGS/$name.log)"
    tail -25 "$LOGS/$name.log" | sed 's/^/    /'
  fi
}

echo "== $PM project: $DIR"

echo "-- files"
[ -f README.md ] && [ -f AGENTS.md ] && pass "README.md and AGENTS.md" || fail "README.md or AGENTS.md missing"
[ -f LICENSE ] && grep -q "MIT License" LICENSE && pass "MIT licence" || fail "MIT LICENSE missing"
[ ! -f template.json ] && pass "template.json consumed by the CLI" || fail "template.json left in the project"
TRACKED_ENV=$(git ls-files | grep -E '(^|/)\.env(\.local)?$' || true)
[ -z "$TRACKED_ENV" ] && pass "no .env committed" || fail ".env committed: $TRACKED_ENV"
LIBS=$(ls packages/foundry/lib 2>/dev/null | tr '\n' ' ')
[ -f packages/foundry/lib/forge-std/src/Test.sol ] && pass "Foundry libraries installed ($LIBS)" ||
  fail "Foundry libraries missing (lib: ${LIBS:-empty})"

echo "-- install and quality gates"
if [ "$PM" = yarn ]; then
  check install-immutable yarn install --immutable
else
  check install npm install --legacy-peer-deps
fi
check lint run lint
# next lint exits 0 on warnings; CI's lint.yaml fails on them, so the scaffold must too.
check next-lint-no-warnings run next:lint --max-warnings=0
check check-types run next:check-types
check doc-drift node scripts/check-docs.mjs
check forge-build bash -c "cd packages/foundry && forge build"
check forge-test bash -c "cd packages/foundry && forge test"
check next-build run next:build

echo "-- the production build, served on :$PORT"
PORT=$PORT run next:serve >"$LOGS/next-serve.log" 2>&1 &
SERVER=$!
stop_server() {
  if [ -n "${WINDIR:-}" ]; then
    # Git Bash on Windows: kill whatever listens on the port, with its tree.
    for pid in $(netstat -ano | grep -E "[:.]$PORT .*LISTENING" | awk '{print $NF}' | sort -u); do
      taskkill //F //T //PID "$pid" >/dev/null 2>&1
    done
  else
    pkill -P "$SERVER" 2>/dev/null
    kill "$SERVER" 2>/dev/null
    command -v fuser >/dev/null && fuser -k "$PORT/tcp" >/dev/null 2>&1
  fi
}
trap stop_server EXIT

up=0
for _ in $(seq 1 120); do
  curl -s -o /dev/null "http://localhost:$PORT/" && up=1 && break
  sleep 1
done
[ $up = 1 ] && pass "app boots" || { fail "app did not answer on :$PORT"; tail -25 "$LOGS/next-serve.log" | sed 's/^/    /'; }

# Static pages (no [param] segments) and API routes, from the app directory.
APP=packages/nextjs/app
PAGES=$(find "$APP" -name 'page.tsx' -not -path '*[[]*' | sed -e "s#^$APP##" -e 's#/page.tsx$##' -e 's#/([^/]*)##g' -e 's#^$#/#')
APIS=$(find "$APP/api" -name 'route.ts' 2>/dev/null | sed -e "s#^$APP##" -e 's#/route.ts$##' | grep -v '\[')

for path in $(printf '%s\n' $GATE_ROUTES $PAGES | awk '!seen[$0]++'); do
  code=$(curl -s -o /dev/null -m 60 -w "%{http_code}" "http://localhost:$PORT$path")
  [ "$code" = 200 ] && pass "GET $path" || fail "GET $path -> $code"
done
# An API route may answer 400 to a bare GET (missing parameters); it must not be missing or crash.
for path in $APIS; do
  code=$(curl -s -o /dev/null -m 60 -w "%{http_code}" "http://localhost:$PORT$path")
  case $code in 2?? | 400 | 405) pass "GET $path -> $code" ;; *) fail "GET $path -> $code" ;; esac
done

if [ "${E2E:-0}" = 1 ]; then
  check e2e env PLAYWRIGHT_BASE_URL="http://localhost:$PORT" bash -c "$(declare -f run); PM=$PM; run next:e2e"
fi

echo "== $PM: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
