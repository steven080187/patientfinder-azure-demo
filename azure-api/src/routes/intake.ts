import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../db.js";
import { requireAnyRole, requireAuth } from "../entraAuth.js";
import type { IntakeSubmissionRow } from "../types.js";

export const intakeRouter = Router();

intakeRouter.post("/api/intake-submissions", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const patientId = req.body.patient_id || randomUUID();
    const intakeSubmissionId = req.body.id || randomUUID();
    const submissionId = req.body.submission_id || randomUUID();

    await query(
      `insert into public.patients (
          id, full_name, status, location, intake_date, flags
        ) values ($1,$2,$3,$4,$5,$6)
        on conflict (id) do update
          set full_name = excluded.full_name,
              status = excluded.status,
              location = excluded.location,
              intake_date = excluded.intake_date,
              flags = excluded.flags,
              updated_at = timezone('utc', now())`,
      [
        patientId,
        req.body.submitted_full_name ?? null,
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

    res.status(201).json({ ok: true, intakeSubmission: rows[0] });
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
