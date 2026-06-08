import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  AZURE_API_ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  PUBLIC_GROUP_SIGN_ORIGIN: z.string().optional(),
  FRONTEND_DIST_DIR: z.string().optional(),
  GROUP_PDF_UPLOAD_DIR: z.string().default(path.join(os.tmpdir(), "patientfinder", "group-pdfs")),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_CLIENT_ID: z.string().optional(),
  ENTRA_API_AUDIENCES: z.string().optional(),
  M365_GRAPH_TENANT_ID: z.string().optional(),
  M365_GRAPH_CLIENT_ID: z.string().optional(),
  M365_GRAPH_CLIENT_SECRET: z.string().optional(),
  M365_GRAPH_DRIVE_ID: z.string().optional(),
  M365_GRAPH_SITE_ID: z.string().optional(),
  M365_GRAPH_FOLDER_PATH: z.string().default("PatientBridge"),
  DEMO_AUTH_SECRET: z.string().default("patientfinder-azure-demo-secret"),
  DEMO_AUTH_USERS_JSON: z.string().optional(),
  DEMO_STAFF_EMAIL: z.string().email().default("steven@ncadd-sfv.org"),
  DEMO_STAFF_PASSWORD: z.string().min(1).default("Demo123!"),
  DEMO_STAFF_USER_ID: z.string().default("11111111-1111-1111-1111-111111111111"),
  DEMO_MOBILE_TOKEN: z.string().min(1).default("azure-demo-mobile-token"),
  AZURE_BLOB_CONNECTION_STRING: z.string().optional(),
  AZURE_BLOB_CONTAINER_NAME: z.string().default("patientfinder-documents"),
  AZURE_BLOB_BASE_PATH: z.string().default("patient-documents"),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  AUDIT_LOG_SALT: z.string().default("patientfinder-audit-salt"),
});

export const env = envSchema.parse(process.env);
