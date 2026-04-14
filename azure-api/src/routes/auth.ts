import { Router } from "express";
import { findDemoUser, getDemoUsers, signDemoToken } from "../demoAuth.js";
import { entraAuthEnabled, getRequestUser, requireAuth } from "../entraAuth.js";

export const authRouter = Router();

authRouter.get("/api/auth/options", (_req, res) => {
  res.json({
    ok: true,
    authMode: entraAuthEnabled ? "entra" : "demo",
    demoUsers: entraAuthEnabled ? [] : getDemoUsers().map(({ id, email, name, roles }) => ({ id, email, name, roles })),
  });
});

authRouter.post("/api/auth/login", async (req, res) => {
  if (entraAuthEnabled) {
    res.status(501).json({
      ok: false,
      error: "Use Microsoft Entra sign-in from the web or iPad client. Direct password login is disabled here.",
    });
    return;
  }

  const email = String(req.body?.email ?? "").trim();
  const password = String(req.body?.password ?? "");
  const user = findDemoUser(email, password);

  if (!user) {
    res.status(401).json({ ok: false, error: "Invalid demo credentials." });
    return;
  }

  const accessToken = await signDemoToken(user);

  res.json({
    ok: true,
    authMode: "demo",
    accessToken,
    user,
  });
});

authRouter.post("/api/auth/logout", (_req, res) => {
  if (entraAuthEnabled) {
    res.status(501).json({
      ok: false,
      error: "Use Microsoft Entra sign-out from the client.",
    });
    return;
  }

  res.json({
    ok: true,
  });
});

authRouter.get("/api/auth/me", requireAuth, (req, res) => {
  const user = getRequestUser(req);
  res.json({
    ok: true,
    authMode: entraAuthEnabled ? "entra" : "demo",
    user,
  });
});
