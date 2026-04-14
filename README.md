# Patient Finder Azure Demo

This is a dedicated Azure-demo copy of the `patientfinder` web app.

It exists so Azure work can move forward without changing the old-world `patientfinder` app that still runs on Vercel and Supabase.

Scope guardrail: see `PROJECT_SCOPE.md` for the strict repo boundary and safety rules.

## What this copy is for

- Azure-only demo and deployment work
- Safe frontend changes that should not affect the original app
- A cleaner path if you later want a separate Azure repo

## What this copy is not for

- Replacing the original `patientfinder` project
- Serving as the iOS wrapper app
- Pointing back at old-world Supabase by default

## Local development

```bash
npm install
npm run dev
```

## Azure-demo environment

Copy `.env.azure.example` to `.env.local` and fill in the Azure API base URL when you want local frontend-to-API testing.

```bash
npm install
npm run build
npm start
```
