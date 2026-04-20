import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { deleteBlobIfExists, downloadBlobToBuffer, uploadPatientDocumentPdf } from "../blobStorage.js";
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

patientDocumentsRouter.post(
  "/api/patient-documents/upload",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
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

      const patientExists = await query<{ id: string }>(
        `select id from public.patients where id = $1 limit 1`,
        [patientId]
      );
      if (!patientExists[0]) {
        res.status(404).json({ ok: false, error: "Patient not found." });
        return;
      }

      const blob = await uploadPatientDocumentPdf({
        patientId,
        documentType,
        originalFileName,
        fileBuffer,
      });

      const requestUser = getRequestUser(req);
      const documentId = randomUUID();
      const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

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

      res.status(201).json({
        ok: true,
        document: rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patients/:id/documents",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    try {
      const rows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
          order by created_at desc`,
        [req.params.id]
      );

      res.json({ ok: true, documents: rows });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.patch(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid rename payload." });
      return;
    }
    try {
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
      if (!rows[0]) {
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }
      res.json({ ok: true, document: rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.delete(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    try {
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "storage_container" | "storage_blob_path">
      >(
        `delete from public.patient_documents
          where id = $1
          returning id, storage_container, storage_blob_path`,
        [req.params.id]
      );
      const deleted = rows[0];
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      await deleteBlobIfExists({
        containerName: deleted.storage_container,
        blobName: deleted.storage_blob_path,
      });

      res.json({ ok: true, deletedId: deleted.id });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patient-documents/:id/download",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    try {
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "original_filename" | "content_type" | "storage_container" | "storage_blob_path">
      >(
        `select id, original_filename, content_type, storage_container, storage_blob_path
           from public.patient_documents
          where id = $1
          limit 1`,
        [req.params.id]
      );

      const document = rows[0];
      if (!document) {
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      const fileBuffer = await downloadBlobToBuffer({
        containerName: document.storage_container,
        blobName: document.storage_blob_path,
      });

      res.setHeader("Content-Type", document.content_type || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.original_filename.replace(/"/g, "")}"`
      );
      res.send(fileBuffer);
    } catch (error) {
      next(error);
    }
  }
);
