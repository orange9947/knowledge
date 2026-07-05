#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .venv/bin/activate ]; then
  # The root backend npm script expects the active Python environment on PATH.
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

run_step() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

run_step "Backend tests" npm run test:backend
run_step "Frontend tests" npm run test:frontend
run_step "Frontend build" npm run build:frontend

if [ -d desktop ]; then
  if [ -d desktop/node_modules ]; then
    run_step "Desktop tests" npm --prefix desktop test
    run_step "Desktop build" npm --prefix desktop run build
  else
    printf '\n==> Skipping desktop verification: desktop/node_modules is missing\n'
  fi
else
  printf '\n==> Skipping desktop verification: desktop project is missing\n'
fi

if [ -d frontend/android ]; then
  if npm --prefix frontend run | grep -qE '(^|[[:space:]])cap:sync($|[[:space:]])'; then
    run_step "Capacitor sync" npm --prefix frontend run cap:sync
  else
    printf '\n==> Skipping Capacitor sync: frontend package has no cap:sync script\n'
  fi

  if [ -x frontend/android/gradlew ]; then
    run_step "Android debug build" bash -lc "cd frontend/android && ./gradlew assembleDebug"
  else
    printf '\n==> Skipping Android Gradle build: frontend/android/gradlew is missing or not executable\n'
  fi
else
  printf '\n==> Skipping Android verification: frontend/android is missing\n'
fi

cat <<'CHECKLIST'

==> Standalone function retention checklist
- Model config and connection test
- Knowledge base create/delete/switch isolation
- Source configuration and custom sources
- Learning run
- AI analysis and run summarization
- Card approval into graph
- History retention, text clearing, and deletion
- Graph assistant
- Import/export

Automated coverage is provided by backend and frontend tests. Network-dependent model/source behavior still needs real API keys and reachable sources for release smoke testing.
CHECKLIST
