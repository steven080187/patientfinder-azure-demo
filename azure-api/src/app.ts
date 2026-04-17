import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import { env } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { groupsRouter } from "./routes/groups.js";
import { healthRouter } from "./routes/health.js";
import { intakeRouter } from "./routes/intake.js";
import { mobileSyncRouter } from "./routes/mobileSync.js";
import { notificationsRouter } from "./routes/notifications.js";
import { patientDocumentsRouter } from "./routes/patientDocuments.js";
import { patientsRouter } from "./routes/patients.js";

export function createApp() {
  const app = express();
  const allowedOrigins = env.AZURE_API_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "20mb" }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(dashboardRouter);
  app.use(groupsRouter);
  app.use(notificationsRouter);
  app.use(patientsRouter);
  app.use(patientDocumentsRouter);
  app.use(intakeRouter);
  app.use(mobileSyncRouter);

  const frontendDistDir = env.FRONTEND_DIST_DIR ? path.resolve(env.FRONTEND_DIST_DIR) : null;

  if (frontendDistDir && existsSync(frontendDistDir)) {
    app.use(express.static(frontendDistDir, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }

      res.sendFile(path.join(frontendDistDir, "index.html"));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  });

  return app;
}
