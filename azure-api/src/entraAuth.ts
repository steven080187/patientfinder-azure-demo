import { webcrypto } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./config.js";
import { verifyDemoToken } from "./demoAuth.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as typeof globalThis.crypto;
}

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  claims: JWTPayload;
};

type RequestWithUser = Request & {
  authUser?: AuthenticatedUser;
};

const entraAudiences = (env.ENTRA_API_AUDIENCES ?? env.ENTRA_API_CLIENT_ID ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const entraAuthEnabled = Boolean(env.ENTRA_TENANT_ID && entraAudiences.length > 0);

const issuer = entraAuthEnabled
  ? `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`
  : "";

const jwks = entraAuthEnabled
  ? createRemoteJWKSet(new URL(`${issuer}/discovery/v2.0/keys`))
  : null;

function normalizeRoles(payload: JWTPayload) {
  const roles = payload.roles;
  if (Array.isArray(roles)) {
    return roles.filter((value): value is string => typeof value === "string");
  }
  if (typeof roles === "string") {
    return [roles];
  }
  return [];
}

function getBearerToken(request: Request) {
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim();
}

async function resolveUserFromToken(token: string): Promise<AuthenticatedUser> {
  if (!entraAuthEnabled) {
    const user = await verifyDemoToken(token);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      claims: {
        sub: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
    };
  }

  if (!jwks) {
    throw new Error("Microsoft Entra auth is not configured.");
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: entraAudiences,
  });

  const id = String(payload.oid ?? payload.sub ?? "");
  const email = String(payload.preferred_username ?? payload.email ?? "");
  const name = String(payload.name ?? email ?? id);

  if (!id || !email) {
    throw new Error("The Microsoft token is missing required identity claims.");
  }

  return {
    id,
    email,
    name,
    roles: normalizeRoles(payload),
    claims: payload,
  };
}

export function getRequestUser(request: Request) {
  return (request as RequestWithUser).authUser ?? null;
}

export async function optionalEntraAuth(request: Request, _response: Response, next: NextFunction) {
  const token = getBearerToken(request);
  if (!token) {
    next();
    return;
  }

  try {
    (request as RequestWithUser).authUser = await resolveUserFromToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ ok: false, error: entraAuthEnabled ? "Microsoft sign-in is required." : "Demo sign-in is required." });
    return;
  }

  try {
    (request as RequestWithUser).authUser = await resolveUserFromToken(token);
    next();
  } catch {
    response.status(401).json({ ok: false, error: entraAuthEnabled ? "Your Microsoft login could not be verified." : "Your demo login could not be verified." });
  }
}

export function requireAnyRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!entraAuthEnabled) {
      next();
      return;
    }

    const user = getRequestUser(request);
    if (!user) {
      response.status(401).json({ ok: false, error: "Microsoft sign-in is required." });
      return;
    }

    if (roles.some((role) => user.roles.includes(role))) {
      next();
      return;
    }

    response.status(403).json({ ok: false, error: "Your account does not have access to this area." });
  };
}
