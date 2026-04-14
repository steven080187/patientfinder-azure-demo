import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  AZURE_API_ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  PUBLIC_GROUP_SIGN_ORIGIN: z.string().optional(),
  FRONTEND_DIST_DIR: z.string().optional(),
  GROUP_PDF_UPLOAD_DIR: z.string().default("./uploads/group-pdfs"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_CLIENT_ID: z.string().optional(),
  ENTRA_API_AUDIENCES: z.string().optional(),
  DEMO_AUTH_SECRET: z.string().default("patientfinder-azure-demo-secret"),
  DEMO_AUTH_USERS_JSON: z.string().optional(),
  DEMO_STAFF_EMAIL: z.string().email().default("steven@ncadd-sfv.org"),
  DEMO_STAFF_PASSWORD: z.string().min(1).default("AzureDemo!2026"),
  DEMO_STAFF_USER_ID: z.string().default("11111111-1111-1111-1111-111111111111"),
  DEMO_MOBILE_TOKEN: z.string().min(1).default("azure-demo-mobile-token"),
});

export const env = envSchema.parse(process.env);
