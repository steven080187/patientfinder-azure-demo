import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "./config.js";

type AuditDetails = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

export function hipaaHash(value: unknown) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return createHash("sha256")
    .update(`${env.AUDIT_LOG_SALT}:${raw}`)
    .digest("hex")
    .slice(0, 16);
}

export function sanitizeRoutePath(pathname: string) {
  const staticSegments = new Set([
    "api",
    "health",
    "auth",
    "dashboard",
    "patients",
    "patient-documents",
    "documents",
    "groups",
    "live",
    "public",
    "notifications",
    "intake-submissions",
    "mobile",
    "download",
    "upload",
    "start",
    "finalize",
    "reply",
    "read",
    "case-assignment",
    "compliance",
    "roster-details",
    "drug-tests",
    "billing-entries",
    "bulk-upsert",
    "participant",
    "group-sign",
    "submit",
    "match",
    "entry",
    "pdf",
    "options",
    "me",
  ]);

  const parts = pathname.split("/").filter(Boolean);
  const sanitized = parts.map((segment) => {
    if (staticSegments.has(segment)) return segment;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return ":id";
    if (/^\d{4,}$/.test(segment)) return ":id";
    if (segment.length > 24) return ":id";
    return ":param";
  });
  return `/${sanitized.join("/")}`;
}

export function ensureRequestId(request: Request, response: Response) {
  const existing = request.header("x-request-id")?.trim();
  const requestId = existing || randomUUID();
  response.setHeader("x-request-id", requestId);
  return requestId;
}

export function getRequestId(request: Request, response?: Response) {
  const fromHeader = request.header("x-request-id")?.trim();
  if (fromHeader) return fromHeader;
  if (response) return ensureRequestId(request, response);
  return randomUUID();
}

export function auditLog(event: string, details: AuditDetails) {
  console.info("[hipaa-audit]", {
    ts: nowIso(),
    event,
    ...details,
  });
}
