# Agent Guardrails

This repo is `patientfinder-azure-demo` only.

## Hard Scope
- Work only inside this repository.
- Do not open, edit, or reference `/Users/steven/Projects/patientfinder`.
- Do not route this app to local implicit origins. Frontend must use explicit `VITE_AZURE_API_BASE_URL`.

## Deployment Intent
- Source of truth is GitHub for this repo.
- Azure App Service/containers should deploy from this repo artifacts only.
- No secrets in source control.

## If Unsure
- Stop and confirm before touching any sibling project.

