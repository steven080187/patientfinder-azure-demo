import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { auditLog, getRequestId, hipaaHash } from "../audit.js";
import { deleteBlobIfExists, downloadBlobStream, uploadPatientDocumentPdf } from "../blobStorage.js";
import { query } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";
import type { PatientDocumentRow } from "../types.js";

export const patientDocumentsRouter = Router();

const uploadSchema = z.object({
  // Demo/sandbox datasets use deterministic IDs that are not RFC UUIDs.
  // Accept any non-empty identifier and validate existence in DB below.
  patientId: z.string().min(1).max(128),
  documentType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255).optional(),
  pdfBase64: z.string().min(1),
});

const renameSchema = z.object({
  originalFileName: z.string().min(1).max(255),
});

function normalizePdfFileName(fileName?: string) {
  const fallback = `scan_${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
  if (!fileName) return fallback;
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function normalizePathFileName(fileName: string) {
  const withForwardSlashes = fileName.replace(/\\/g, "/");
  const rawSegments = withForwardSlashes
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!rawSegments.length) {
    return normalizePdfFileName(fileName);
  }
  const sanitized = rawSegments.map((segment) =>
    segment
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/^\.+/, "")
      .trim()
  );
  const finalName = sanitized[sanitized.length - 1] || "document.pdf";
  sanitized[sanitized.length - 1] = normalizePdfFileName(finalName);
  return sanitized.join("/");
}

function getDownloadSafeFileName(fileName: string) {
  const basename = fileName
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.trim();
  const fallback = normalizePdfFileName("document.pdf");
  return normalizePdfFileName(basename || fallback);
}

patientDocumentsRouter.post(
  "/api/patient-documents/upload",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      auditLog("patient_document_upload_rejected", {
        requestId,
        route: "/api/patient-documents/upload",
        reason: "invalid_payload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
      });
      res.status(400).json({ ok: false, error: "Invalid upload payload." });
      return;
    }

    try {
      const { patientId, documentType, fileName, pdfBase64 } = parsed.data;
      const originalFileName = normalizePdfFileName(fileName);
      const fileBuffer = Buffer.from(pdfBase64, "base64");

      if (!fileBuffer.length) {
        res.status(400).json({ ok: false, error: "PDF data is empty." });
        return;
      }

      const patientCheckStartedAt = Date.now();
      const patientExists = await query<{ id: string }>(
        `select id from public.patients where id = $1 limit 1`,
        [patientId]
      );
      const patientCheckMs = Date.now() - patientCheckStartedAt;
      if (!patientExists[0]) {
        auditLog("patient_document_upload_patient_not_found", {
          requestId,
          route: "/api/patient-documents/upload",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          patientHash: hipaaHash(patientId),
          patientCheckMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Patient not found." });
        return;
      }

      const blobUploadStartedAt = Date.now();
      const blob = await uploadPatientDocumentPdf({
        patientId,
        documentType,
        originalFileName,
        fileBuffer,
      });
      const blobUploadMs = Date.now() - blobUploadStartedAt;

      const requestUser = getRequestUser(req);
      const documentId = randomUUID();
      const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

      const insertStartedAt = Date.now();
      const rows = await query<PatientDocumentRow>(
        `insert into public.patient_documents (
          id,
          patient_id,
          document_type,
          original_filename,
          content_type,
          byte_size,
          sha256,
          storage_provider,
          storage_container,
          storage_blob_path,
          storage_url,
          uploaded_by_user_id,
          uploaded_by_email
        ) values ($1,$2,$3,$4,$5,$6,$7,'azure_blob',$8,$9,$10,$11,$12)
        returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url,
          uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [
          documentId,
          patientId,
          documentType,
          originalFileName,
          "application/pdf",
          String(fileBuffer.byteLength),
          sha256,
          blob.containerName,
          blob.blobName,
          blob.blobUrl,
          requestUser?.id ?? null,
          requestUser?.email ?? null,
        ]
      );
      const insertMs = Date.now() - insertStartedAt;

      auditLog("patient_document_upload_ok", {
        requestId,
        route: "/api/patient-documents/upload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(patientId),
        documentHash: hipaaHash(rows[0]?.id ?? null),
        byteSize: fileBuffer.byteLength,
        patientCheckMs,
        blobUploadMs,
        insertMs,
        totalMs: Date.now() - startedAt,
      });

      res.status(201).json({
        ok: true,
        document: rows[0],
      });
    } catch (error) {
      auditLog("patient_document_upload_error", {
        requestId,
        route: "/api/patient-documents/upload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patients/:id/documents",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
          order by created_at desc`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;
      auditLog("patient_document_list_ok", {
        requestId,
        route: "/api/patients/:id/documents",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(req.params.id),
        count: rows.length,
        dbMs,
        totalMs: Date.now() - startedAt,
      });

      res.json({ ok: true, documents: rows });
    } catch (error) {
      auditLog("patient_document_list_error", {
        requestId,
        route: "/api/patients/:id/documents",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.patch(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      auditLog("patient_document_rename_rejected", {
        requestId,
        route: "/api/patient-documents/:id",
        reason: "invalid_payload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
      });
      res.status(400).json({ ok: false, error: "Invalid rename payload." });
      return;
    }
    try {
      const dbStartedAt = Date.now();
      const nextName = normalizePathFileName(parsed.data.originalFileName);
      const rows = await query<PatientDocumentRow>(
        `update public.patient_documents
            set original_filename = $2,
                updated_at = timezone('utc', now())
          where id = $1
          returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                    storage_provider, storage_container, storage_blob_path, storage_url,
                    uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [req.params.id, nextName]
      );
      const dbMs = Date.now() - dbStartedAt;
      if (!rows[0]) {
        auditLog("patient_document_rename_not_found", {
          requestId,
          route: "/api/patient-documents/:id",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }
      auditLog("patient_document_rename_ok", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(rows[0].id),
        patientHash: hipaaHash(rows[0].patient_id),
        dbMs,
        totalMs: Date.now() - startedAt,
      });
      res.json({ ok: true, document: rows[0] });
    } catch (error) {
      auditLog("patient_document_rename_error", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.delete(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "storage_container" | "storage_blob_path">
      >(
        `delete from public.patient_documents
          where id = $1
          returning id, storage_container, storage_blob_path`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;
      const deleted = rows[0];
      if (!deleted) {
        auditLog("patient_document_delete_not_found", {
          requestId,
          route: "/api/patient-documents/:id",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      const blobStartedAt = Date.now();
      await deleteBlobIfExists({
        containerName: deleted.storage_container,
        blobName: deleted.storage_blob_path,
      });
      const blobMs = Date.now() - blobStartedAt;

      auditLog("patient_document_delete_ok", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(deleted.id),
        dbMs,
        blobMs,
        totalMs: Date.now() - startedAt,
      });

      res.json({ ok: true, deletedId: deleted.id });
    } catch (error) {
      auditLog("patient_document_delete_error", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patient-documents/:id/download",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "original_filename" | "content_type" | "storage_container" | "storage_blob_path">
      >(
        `select id, original_filename, content_type, storage_container, storage_blob_path
           from public.patient_documents
          where id = $1
          limit 1`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;

      const document = rows[0];
      if (!document) {
        auditLog("patient_document_download_not_found", {
          requestId,
          route: "/api/patient-documents/:id/download",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      const blobStartedAt = Date.now();
      const file = await downloadBlobStream({
        containerName: document.storage_container,
        blobName: document.storage_blob_path,
      });
      const blobMs = Date.now() - blobStartedAt;

      res.setHeader("Content-Type", document.content_type || file.contentType || "application/pdf");
      const downloadName = getDownloadSafeFileName(document.original_filename);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${downloadName.replace(/"/g, "")}"`
      );
      if (typeof file.contentLength === "number" && Number.isFinite(file.contentLength)) {
        res.setHeader("Content-Length", String(file.contentLength));
      }
      auditLog("patient_document_download_stream_start", {
        requestId,
        route: "/api/patient-documents/:id/download",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(document.id),
        dbMs,
        blobMs,
        contentLength: file.contentLength,
        totalMsBeforeStream: Date.now() - startedAt,
      });
      file.readableStreamBody.pipe(res);
    } catch (error) {
      auditLog("patient_document_download_error", {
        requestId,
        route: "/api/patient-documents/:id/download",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);
