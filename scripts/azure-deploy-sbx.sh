#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT_STAGE="${TMPDIR:-/tmp}/pf-front-src"
API_STAGE="${TMPDIR:-/tmp}/pf-api-src"
FRONT_ZIP="${TMPDIR:-/tmp}/pf-front.zip"
API_ZIP="${TMPDIR:-/tmp}/pf-api.zip"

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-patientfinder-sbx-westus3}"
FRONT_APP="${AZURE_FRONT_WEBAPP_NAME:-pfsbx-front-0412346}"
API_APP="${AZURE_API_WEBAPP_NAME:-pfsbx-api-0412346}"

echo "Checking Azure login..."
az account show >/dev/null

echo "Building frontend and API locally..."
(cd "$ROOT" && npm run -s build)
(cd "$ROOT/azure-api" && npm run -s build)

echo "Disabling host-side frontend builds on Azure..."
az webapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FRONT_APP" \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false >/dev/null

az webapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP" \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false >/dev/null

echo "Staging deploy packages..."
rm -rf "$FRONT_STAGE" "$API_STAGE" "$FRONT_ZIP" "$API_ZIP"
mkdir -p "$FRONT_STAGE" "$API_STAGE"

# Frontend package (repo root app)
rsync -a "$ROOT"/ "$FRONT_STAGE"/ \
  --exclude .git \
  --exclude .env \
  --exclude '.env.*' \
  --exclude node_modules \
  --exclude .DS_Store \
  --exclude .vercel \
  --exclude tmp \
  --exclude patientfinder-mobile \
  --exclude azure-api/node_modules \
  --exclude azure-api/dist \
  --exclude azure-api/uploads
cp -R "$ROOT/node_modules" "$FRONT_STAGE/node_modules"

# API package (azure-api app only)
rsync -a "$ROOT"/azure-api/ "$API_STAGE"/ \
  --exclude .git \
  --exclude .env \
  --exclude '.env.*' \
  --exclude node_modules \
  --exclude uploads

(cd "$API_STAGE" && npm ci --omit=dev)

(cd "$FRONT_STAGE" && zip -qr "$FRONT_ZIP" .)
(cd "$API_STAGE" && zip -qr "$API_ZIP" .)

ls -lh "$FRONT_ZIP" "$API_ZIP"

echo "Deploying frontend to $FRONT_APP..."
az webapp deployment source config-zip \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FRONT_APP" \
  --src "$FRONT_ZIP"

echo "Deploying API to $API_APP..."
az webapp deployment source config-zip \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP" \
  --src "$API_ZIP"

echo "Restarting Azure apps..."
az webapp restart --resource-group "$RESOURCE_GROUP" --name "$FRONT_APP" >/dev/null
az webapp restart --resource-group "$RESOURCE_GROUP" --name "$API_APP" >/dev/null

echo "Done."
echo "Frontend: https://${FRONT_APP}.azurewebsites.net"
echo "API: https://${API_APP}.azurewebsites.net"
