import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import { auditLog, ensureRequestId, hipaaHash, sanitizeRoutePath } from "./audit.js";
import { env } from "./config.js";
import { getRequestUser } from "./entraAuth.js";
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
  const allowAnyLocalDevOrigin = process.env.NODE_ENV !== "production";

  function isAllowedOrigin(origin: string) {
    if (allowedOrigins.includes(origin)) {
      return true;
    }
    if (!allowAnyLocalDevOrigin) {
      return false;
    }
    try {
      const parsed = new URL(origin);
      const isCloudflareQuickTunnel = parsed.hostname.endsWith(".trycloudflare.com");
      const isNgrokTunnel = parsed.hostname.endsWith(".ngrok-free.dev");
      const isTailscaleMagicDns = parsed.hostname.endsWith(".ts.net");
      const isPrivateLanIpv4 =
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
      return (
        (parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          isPrivateLanIpv4 ||
          isCloudflareQuickTunnel ||
          isNgrokTunnel ||
          isTailscaleMagicDns) &&
        (parsed.protocol === "http:" || parsed.protocol === "https:")
      );
    } catch {
      return false;
    }
  }

  console.info("[patient-flow][api][config]", {
    port: env.PORT,
    allowedOrigins,
    allowAnyLocalDevOrigin,
    entraAuthEnabled: Boolean(env.ENTRA_TENANT_ID && (env.ENTRA_API_AUDIENCES || env.ENTRA_API_CLIENT_ID)),
    dataSource: "postgresql",
    hasDatabaseUrl: Boolean(env.DATABASE_URL),
  });

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "20mb" }));

  app.use((req, res, next) => {
    const startedAt = Date.now();
    const requestId = ensureRequestId(req, res);

    res.on("finish", () => {
      if (!req.path.startsWith("/api/") && req.path !== "/health") return;
      const actor = getRequestUser(req);
      auditLog("http_request", {
        requestId,
        method: req.method,
        route: sanitizeRoutePath(req.path),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        actorHash: hipaaHash(actor?.email ?? actor?.id ?? null),
        hasAuthHeader: Boolean(req.headers.authorization),
        originHash: hipaaHash(req.headers.origin ?? null),
      });
    });

    next();
  });

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
