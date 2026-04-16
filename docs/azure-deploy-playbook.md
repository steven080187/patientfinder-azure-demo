# Azure Deploy Playbook (Sandbox)

This repo deploys to Azure App Service web apps:

- Frontend: `pfsbx-front-0412346`
- API: `pfsbx-api-0412346`
- Resource group: `patientfinder-sbx-westus3`

## One-command deploy

From repo root:

```bash
./scripts/azure-deploy-sbx.sh
```

## Prerequisites

- Azure CLI installed (`az`)
- Logged in to the NCADD-SFV tenant:

```bash
az login
az account show
```

## Optional overrides

You can target different apps without editing the script:

```bash
AZURE_RESOURCE_GROUP=my-rg \
AZURE_FRONT_WEBAPP_NAME=my-front-app \
AZURE_API_WEBAPP_NAME=my-api-app \
./scripts/azure-deploy-sbx.sh
```

## Notes

- The script deploys both frontend and API together.
- It packages source with `rsync` + zip, excluding `node_modules` and local build artifacts.
- If a deployment fails, run again after checking Azure App Service logs.
