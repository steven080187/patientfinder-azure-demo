#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTAKE_ROOT="$(cd "$ROOT/../Intake-App-Testing" && pwd)"

failures=0

check_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo "[ok] $file"
  else
    echo "[missing] $file"
    failures=$((failures + 1))
  fi
}

check_contains() {
  local file="$1"
  local pattern="$2"
  if grep -q "$pattern" "$file"; then
    echo "[ok] $file contains $pattern"
  else
    echo "[missing] $file does not contain $pattern"
    failures=$((failures + 1))
  fi
}

echo "Checking Azure prep artifacts..."
check_file "$ROOT/.github/workflows/azure-patientfinder-webapp.yml"
check_file "$INTAKE_ROOT/.github/workflows/azure-intake-webapp.yml"
check_file "$ROOT/.env.azure.example"
check_file "$INTAKE_ROOT/.env.azure.example"
check_file "$ROOT/infra/azure/patientfinder-appsettings.json"
check_file "$ROOT/infra/azure/intake-appsettings.json"
check_file "$ROOT/docs/azure-parallel-sandbox.md"
check_file "$ROOT/docs/github-secrets-checklist.md"
check_file "$ROOT/scripts/export-sandbox-dataset.mjs"
check_file "$ROOT/scripts/import-sandbox-dataset.mjs"
check_file "$ROOT/server.js"
check_file "$INTAKE_ROOT/server.js"

echo
echo "Checking workflow secret placeholders..."
check_contains "$ROOT/.github/workflows/azure-patientfinder-webapp.yml" "AZURE_CREDENTIALS"
check_contains "$ROOT/.github/workflows/azure-patientfinder-webapp.yml" "AZURE_PATIENTFINDER_WEBAPP_NAME"
check_contains "$INTAKE_ROOT/.github/workflows/azure-intake-webapp.yml" "AZURE_CREDENTIALS"
check_contains "$INTAKE_ROOT/.github/workflows/azure-intake-webapp.yml" "AZURE_INTAKE_WEBAPP_NAME"

echo
echo "Checking runtime scripts..."
node --check "$ROOT/server.js"
echo "[ok] patientfinder/server.js syntax"
node --check "$INTAKE_ROOT/server.js"
echo "[ok] Intake-App-Testing/server.js syntax"
node --check "$ROOT/scripts/export-sandbox-dataset.mjs"
echo "[ok] export-sandbox-dataset.mjs syntax"
node --check "$ROOT/scripts/import-sandbox-dataset.mjs"
echo "[ok] import-sandbox-dataset.mjs syntax"

echo
echo "Checking latest sandbox export..."
LATEST_EXPORT="$(ls -1 "$ROOT"/exports/sandbox-dataset-*.json 2>/dev/null | tail -n 1 || true)"
if [[ -n "$LATEST_EXPORT" ]]; then
  echo "[ok] found export $LATEST_EXPORT"
else
  echo "[missing] no sandbox export found under $ROOT/exports"
  failures=$((failures + 1))
fi

echo
if [[ "$failures" -gt 0 ]]; then
  echo "Dry run found $failures issue(s)."
  exit 1
fi

echo "Azure dry run passed. No Azure resources were created by this check."
