# Patient Finder Azure Demo Scope

This repository is the Azure demo application only.

## In Scope
- `/Users/steven/Projects/patientfinder-azure-demo`
- Frontend in `src/`
- Azure API in `azure-api/`
- Azure deployment and environment configuration for this demo stack

## Out of Scope
- `/Users/steven/Projects/patientfinder`
- Any Vercel/Supabase legacy runtime
- Any unrelated local projects

## Safety Rules
- Never default to localhost or implicit origin in production builds.
- Always require explicit `VITE_AZURE_API_BASE_URL` for frontend API calls.
- Keep secrets out of git (`.env.local`, tokens, connection strings).
- Treat this repo as the source of truth for Azure-demo work and GitHub sync.

