import { Router } from "express";
import { env } from "../config.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const databaseName = (() => {
    try {
      return new URL(env.DATABASE_URL).pathname.replace(/^\/+/, "") || null;
    } catch {
      return null;
    }
  })();

  res.json({
    ok: true,
    service: "patientfinder-azure-api",
    phase: "phase-1-scaffold",
    dataSource: "postgresql",
    databaseName,
    hasDatabaseUrl: Boolean(env.DATABASE_URL),
    databaseRole: databaseName === "patientfinder" ? "local-phi" : databaseName === "patientfinder_demo" ? "demo" : null,
  });
});
