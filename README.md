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

## Cloudflare Quick Tunnel

With the frontend running on `http://localhost:5173` and the API on `http://localhost:3001`, open a quick tunnel with:

```bash
npm run tunnel
```

The frontend is already configured to accept `*.trycloudflare.com` hosts, and the API allows local dev/tunnel origins in development.

## Azure-demo environment

Copy `.env.azure.example` to `.env.local` and fill in the Azure API base URL when you want local frontend-to-API testing.

```bash
npm install
npm run build
npm start
```

## Microsoft Entra Sign-In

Entra login is already implemented in this repo and turns on automatically when both sides are configured.

Frontend (`.env.local`):

```bash
VITE_ENTRA_TENANT_ID=<tenant-guid>
VITE_ENTRA_CLIENT_ID=<spa-app-client-id>
VITE_ENTRA_API_SCOPE=api://<api-app-client-id>/user_impersonation
```

API (`azure-api/.env.local` or App Service settings):

```bash
ENTRA_TENANT_ID=<tenant-guid>
ENTRA_API_CLIENT_ID=<api-app-client-id>
# Optional override for accepted audiences:
# ENTRA_API_AUDIENCES=api://<api-app-client-id>,<api-app-client-id>
```

Important: if your tenant requires admin consent for delegated scopes or app roles, an Entra admin must grant that consent before login/token exchange succeeds.

## PatientBridge Microsoft 365 workbook wrapper

PatientBridge now treats Excel as the source file in Microsoft 365. The app wraps upload, workbook listing, audit logs, and optional workbook table/range reads around SharePoint/OneDrive-hosted `.xlsx` files.

API (`azure-api/.env.local` or App Service settings):

```bash
M365_GRAPH_TENANT_ID=<tenant-guid>
M365_GRAPH_CLIENT_ID=<app-client-id>
M365_GRAPH_CLIENT_SECRET=<app-client-secret>
M365_GRAPH_DRIVE_ID=<target-document-library-drive-id>
# Optional, used as the default folder path inside the drive:
M365_GRAPH_FOLDER_PATH=PatientBridge
# Optional only if you want to pin a site id in metadata:
M365_GRAPH_SITE_ID=<sharepoint-site-id>
```

Microsoft Graph app permissions for the service principal should include write access to files in the target site or library. The implementation uses the workbook URL returned by Graph and can request table/range previews later through the workbook APIs.
