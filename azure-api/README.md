# Patient Finder Azure API

This is the parallel Azure-native backend scaffold.

It is intentionally separate from the current Vercel and Supabase runtime.

## Goals

- provide an Azure-native API surface for `patientfinder`
- talk directly to PostgreSQL instead of Supabase REST
- preserve the current app as-is during migration

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Local Azure-side sandbox loop

This lets you stand up the new world locally without touching the current test bay.

```bash
npm install
cp .env.example .env.local
# point DATABASE_URL at a PostgreSQL database
npm run db:bootstrap
npm run db:import:sandbox ../exports/sandbox-dataset-2026-04-09T02-53-38-959Z.json
npm run dev
```

Then in the existing `patientfinder` frontend, opt into Azure mode only when you want it:

```bash
VITE_BACKEND_PROVIDER=azure-api
VITE_AZURE_API_BASE_URL=http://localhost:3001
```

If both frontend variables are not set, the app stays on the current Supabase path.

## Current routes

- `GET /health`
- `GET /api/patients`
- `GET /api/patients/:id`
- `POST /api/patients`
- `PATCH /api/patients/:id`
- `DELETE /api/patients/:id`
- `GET /api/patients/:id/intake`
- `GET /api/dashboard`
- `POST /api/intake-submissions`
- `POST /api/auth/login` (placeholder)

## Notes

- This scaffold does not alter the current Vercel/Supabase apps.
- Auth is still a placeholder in Phase 1.
