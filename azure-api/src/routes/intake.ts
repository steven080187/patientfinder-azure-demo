import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { query } from "../db.js";
import { requireAnyRole, requireAuth } from "../entraAuth.js";
import type { IntakeSubmissionRow } from "../types.js";
import { writeVaultArtifact } from "../vaultStorage.js";

export const intakeRouter = Router();

async function ensureVaultArtifactForIntake(input: {
  patientId: string;
  submissionId: string;
  artifactType: "intake" | "snap";
  payload: unknown;
}) {
  const originalFileName = `${input.artifactType}_${input.submissionId}.json`;
  const existing = await query<{ id: string }>(
    `select id
       from public.patient_documents
      where patient_id = $1
        and document_type = $2
        and original_filename = $3
      limit 1`,
    [input.patientId, `vault:${input.artifactType}`, originalFileName]
  );
  if (existing[0]) {
    return;
  }

  const fileBuffer = Buffer.from(JSON.stringify(input.payload, null, 2), "utf8");
  const stored = await writeVaultArtifact({
    patientId: input.patientId,
    artifactType: input.artifactType,
    fileName: originalFileName,
    buffer: fileBuffer,
  });

  await query(
    `insert into public.patient_documents (
      id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
      storage_provider, storage_container, storage_blob_path, storage_url, uploaded_by_user_id, uploaded_by_email
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      randomUUID(),
      input.patientId,
      `vault:${input.artifactType}`,
      originalFileName,
      "application/json; charset=utf-8",
      String(stored.byteSize),
      createHash("sha256").update(fileBuffer).digest("hex"),
      stored.storageProvider,
      stored.storageContainer,
      stored.storageBlobPath,
      null,
      null,
      null,
    ]
  );
}

async function bootstrapVaultForSubmission(row: IntakeSubmissionRow) {
  if (!row.patient_id) return;
  const rawJson = (row.raw_json ?? {}) as Record<string, unknown>;
  const sections = (rawJson.sections ?? {}) as Record<string, unknown>;
  const snapPayload = sections.snap ?? {};

  await ensureVaultArtifactForIntake({
    patientId: row.patient_id,
    submissionId: row.id,
    artifactType: "intake",
    payload: rawJson,
  });

  await ensureVaultArtifactForIntake({
    patientId: row.patient_id,
    submissionId: row.id,
    artifactType: "snap",
    payload: snapPayload,
  });
}

intakeRouter.post("/api/intake-submissions", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const patientId = req.body.patient_id || randomUUID();
    const intakeSubmissionId = req.body.id || randomUUID();
    const submissionId = req.body.submission_id || randomUUID();

    await query(
      `insert into public.patients (
          id, full_name, date_of_birth, status, location, intake_date, flags
        ) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (id) do update
          set full_name = coalesce(excluded.full_name, public.patients.full_name),
              date_of_birth = coalesce(excluded.date_of_birth, public.patients.date_of_birth),
              status = coalesce(excluded.status, public.patients.status),
              location = coalesce(excluded.location, public.patients.location),
              intake_date = coalesce(excluded.intake_date, public.patients.intake_date),
              flags = case
                when cardinality(excluded.flags) > 0 then excluded.flags
                else public.patients.flags
              end,
              updated_at = timezone('utc', now())`,
      [
        patientId,
        req.body.submitted_full_name ?? null,
        req.body.submitted_dob ?? null,
        "new",
        req.body.submitted_location ?? null,
        req.body.intake_date ?? null,
        [],
      ]
    );

    const rows = await query<IntakeSubmissionRow>(
      `insert into public.intake_submissions (
          id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
          submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        returning id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
                  submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location,
                  created_at, updated_at`,
      [
        intakeSubmissionId,
        patientId,
        submissionId,
        req.body.status ?? "received",
        req.body.raw_json ?? null,
        req.body.raw_json_path ?? null,
        req.body.pdf_path ?? null,
        req.body.submitted_full_name ?? null,
        req.body.submitted_dob ?? null,
        req.body.submitted_phone ?? null,
        req.body.submitted_email ?? null,
        req.body.submitted_location ?? null,
      ]
    );

    if (rows[0]) {
      await bootstrapVaultForSubmission(rows[0]);
    }

    res.status(201).json({ ok: true, intakeSubmission: rows[0] });
  } catch (error) {
    next(error);
  }
});

intakeRouter.post("/api/intake-submissions/:id/bootstrap-vault", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query<IntakeSubmissionRow>(
      `select id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
              submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location,
              created_at, updated_at
         from public.intake_submissions
        where id = $1
        limit 1`,
      [req.params.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Intake submission not found" });
    }

    await bootstrapVaultForSubmission(rows[0]);
    res.json({ ok: true, intakeSubmissionId: rows[0].id, patientId: rows[0].patient_id });
  } catch (error) {
    next(error);
  }
});

intakeRouter.patch("/api/intake-submissions/:id", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query<IntakeSubmissionRow>(
      `update public.intake_submissions
          set raw_json = coalesce($2, raw_json),
              raw_json_path = coalesce($3, raw_json_path),
              pdf_path = coalesce($4, pdf_path),
              status = coalesce($5, status),
              updated_at = timezone('utc', now())
        where id = $1
        returning id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
                  submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location,
                  created_at, updated_at`,
      [
        req.params.id,
        req.body.raw_json,
        req.body.raw_json_path,
        req.body.pdf_path,
        req.body.status,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Intake submission not found" });
    }

    res.json({ ok: true, intakeSubmission: rows[0] });
  } catch (error) {
    next(error);
  }
});
