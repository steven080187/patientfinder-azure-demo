import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { hipaaHash, sanitizeRoutePath } from "../audit.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";
import type { IntakeSubmissionRow, PatientRow } from "../types.js";
import { backfillRosterDrugOfChoiceFromLatestIntake } from "../rosterSync.js";
import {
  deletePatientById,
  patchLatestIntakeJsonFromPatient,
  upsertPatientCompliance,
  upsertPatientCore,
  upsertPatientRosterDetails,
  resetProblemListForLevelOfCareChange,
} from "../patientWrites.js";

export const patientsRouter = Router();

type PatientStatusEnum = "new" | "current" | "rss_plus" | "rss" | "former" | "active" | "past";

function normalizePatientId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePatientStatus(value: unknown, fallback: PatientStatusEnum = "new"): PatientStatusEnum {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "new" || normalized === "new patient" || normalized === "new enrollee") return "new";
  if (normalized === "rss+" || normalized === "rss_plus" || normalized === "rss plus") return "rss_plus";
  if (normalized === "rss") return "rss";
  if (normalized === "current" || normalized === "current patient" || normalized === "active" || normalized === "active patient") return "current";
  if (normalized === "past" || normalized === "former" || normalized === "former patient" || normalized === "inactive") return "former";
  return fallback;
}

function logPatientFlow(event: string, details: Record<string, unknown>) {
  console.info(`[patient-flow][api][${event}]`, {
    dataSource: "postgresql",
    ...details,
  });
}

patientsRouter.get("/api/patients", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    await backfillRosterDrugOfChoiceFromLatestIntake();
    const requestStartedAt = Date.now();
    const requestPath = sanitizeRoutePath(req.path);
    logPatientFlow("patients-list-request", {
      requestPath,
      queryHash: hipaaHash(req.query.q ?? null),
      hasAuthToken: Boolean(req.headers.authorization),
      requesterHash: hipaaHash(getRequestUser(req)?.email ?? null),
    });

    const q = String(req.query.q ?? "").trim();
    const statusParam = String(req.query.status ?? "").trim().toLowerCase();
    const sortKeyParam = String(req.query.sort_key ?? "name").trim().toLowerCase();
    const sortDirParam = String(req.query.sort_dir ?? "asc").trim().toLowerCase();
    const pastTierParam = String(req.query.past_tier ?? "").trim().toLowerCase();
    const assignedToUserId = String(req.query.assigned_to_user_id ?? "").trim().toLowerCase();
    const assignedToEmail = String(req.query.assigned_to_email ?? "").trim().toLowerCase();
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const limit = Math.min(200, Math.max(1, requestedLimit));

    const statuses = new Set(["new", "current", "rss_plus", "rss", "former", "active", "past", "inactive"]);
    const statusFilter = statuses.has(statusParam) ? statusParam : null;

    const sortColumnByKey: Record<string, string> = {
      name: "p.full_name",
      intake: "p.intake_date",
      lastvisit: "p.last_visit_date",
      kind: "p.status",
    };
    const sortColumn = sortColumnByKey[sortKeyParam] ?? "p.full_name";
    const sortDir = sortDirParam === "desc" ? "desc" : "asc";

    const needsAssignmentJoin = Boolean(assignedToUserId || assignedToEmail);
    const fromSql = needsAssignmentJoin
      ? `from public.patients p
         left join public.patient_case_assignments a on a.patient_id = p.id`
      : `from public.patients p`;

    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      whereParts.push(
        `(p.full_name ilike $${i}
          or coalesce(p.mrn, '') ilike $${i}
          or coalesce(p.external_id, '') ilike $${i}
          or coalesce(p.primary_program, '') ilike $${i}
          or coalesce(p.counselor_name, '') ilike $${i})`
      );
    }

    if (statusFilter) {
      if (statusFilter === "new") {
        whereParts.push(`lower(coalesce(p.status, '')) in ('new', 'new patient', 'new enrollee')`);
        whereParts.push(`coalesce(p.intake_date, p.created_at::date) >= (timezone('utc', now())::date - interval '20 days')::date`);
      } else if (statusFilter === "current") {
        whereParts.push(`(
          lower(coalesce(p.status, '')) in ('current', 'current patient', 'active', 'active patient')
          or (
            lower(coalesce(p.status, '')) in ('new', 'new patient', 'new enrollee')
            and coalesce(p.intake_date, p.created_at::date) < (timezone('utc', now())::date - interval '20 days')::date
          )
        )`);
      } else if (statusFilter === "rss_plus") {
        whereParts.push(`lower(coalesce(p.status, '')) in ('rss+', 'rss_plus', 'rss plus')`);
      } else if (statusFilter === "rss") {
        whereParts.push(`lower(coalesce(p.status, '')) = 'rss'`);
      } else if (statusFilter === "former" || statusFilter === "past" || statusFilter === "inactive") {
        whereParts.push(`lower(coalesce(p.status, '')) in ('former', 'former patient', 'past', 'past patient', 'inactive')`);
      } else {
        params.push(statusFilter);
        whereParts.push(`lower(coalesce(p.status, '')) = $${params.length}`);
      }
    }

    if (pastTierParam === "recent" || pastTierParam === "archived") {
      whereParts.push(`lower(coalesce(p.status, '')) in ('former', 'past', 'past patient', 'inactive')`);
      const comparison = pastTierParam === "recent" ? ">=" : "<";
      whereParts.push(
        `coalesce(p.last_visit_date, p.updated_at::date, p.intake_date, p.created_at::date) ${comparison} (timezone('utc', now())::date - interval '90 days')::date`
      );
    }

    if (assignedToUserId || assignedToEmail) {
      const assignmentParts: string[] = [];
      if (assignedToUserId) {
        params.push(assignedToUserId);
        assignmentParts.push(`lower(coalesce(a.counselor_user_id::text, '')) = $${params.length}`);
      }
      if (assignedToEmail) {
        params.push(assignedToEmail);
        assignmentParts.push(`lower(coalesce(a.counselor_email, '')) = $${params.length}`);
      }
      whereParts.push(`(${assignmentParts.join(" or ")})`);
    }

    const whereSql = whereParts.length ? `where ${whereParts.join(" and ")}` : "";

    const countRows = await query<{ count: string }>(`select count(*)::text as count ${fromSql} ${whereSql}`, params);
    const total = Number.parseInt(countRows[0]?.count ?? "0", 10) || 0;

    const dataParams = [...params, limit, offset];
    const rows = await query<PatientRow>(
      `select p.id, p.full_name, p.mrn, p.external_id, p.date_of_birth, p.status, p.location, p.intake_date, p.last_visit_date, p.next_appt_date,
              p.primary_program, p.counselor_name, p.flags, p.created_at, p.updated_at
         ${fromSql}
         ${whereSql}
        order by ${sortColumn} ${sortDir} nulls last, p.id asc
        limit $${dataParams.length - 1}
       offset $${dataParams.length}`,
      dataParams
    );

    logPatientFlow("patients-list-response", {
      requestPath,
      status: 200,
      count: rows.length,
      total,
      durationMs: Date.now() - requestStartedAt,
    });
    res.json({ ok: true, patients: rows, total, limit, offset });
  } catch (error) {
    next(error);
  }
});

patientsRouter.get("/api/patients/:id", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    await backfillRosterDrugOfChoiceFromLatestIntake();
    const requestStartedAt = Date.now();
    const requestPath = sanitizeRoutePath(req.path);
    const patientId = normalizePatientId(req.params.id);
    logPatientFlow("patient-detail-request", {
      requestPath,
      patientId,
      hasAuthToken: Boolean(req.headers.authorization),
      requesterHash: hipaaHash(getRequestUser(req)?.email ?? null),
    });

    const rows = await query<PatientRow>(
      `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
              primary_program, counselor_name, flags, created_at, updated_at
         from public.patients
        where id = $1`,
      [patientId]
    );

    if (!rows[0]) {
      logPatientFlow("patient-detail-response", {
        requestPath,
        patientId,
        selectedPatientFound: false,
        status: 404,
        durationMs: Date.now() - requestStartedAt,
      });
      return res.status(404).json({ ok: false, error: "Patient not found" });
    }

    logPatientFlow("patient-detail-response", {
      requestPath,
      patientId,
      selectedPatientFound: true,
      status: 200,
      durationMs: Date.now() - requestStartedAt,
    });
    res.json({ ok: true, patient: rows[0] });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients", requireAuth, requireAnyRole("Admin", "Intake"), async (req, res, next) => {
  try {
    const id = req.body.id || randomUUID();
    const patient = await upsertPatientCore({ query }, id, {
      full_name: req.body.full_name ?? null,
      mrn: req.body.mrn ?? null,
      external_id: req.body.external_id ?? null,
      date_of_birth: req.body.date_of_birth ?? null,
      status: normalizePatientStatus(req.body.status, "new"),
      location: req.body.location ?? null,
      intake_date: req.body.intake_date ?? null,
      last_visit_date: req.body.last_visit_date ?? null,
      next_appt_date: req.body.next_appt_date ?? null,
      primary_program: req.body.primary_program ?? null,
      counselor_name: req.body.counselor_name ?? null,
      flags: req.body.flags ?? [],
    });
    res.status(201).json({ ok: true, patient });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/bulk-upsert", requireAuth, requireAnyRole("Admin", "Intake"), async (req, res, next) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];

    await withTransaction(async (client) => {
      for (const record of records) {
        await upsertPatientCore(client, record.id ?? randomUUID(), {
          ...record,
          status: normalizePatientStatus(record.status, "new"),
        });
      }
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

patientsRouter.patch("/api/patients/:id", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const existingRows = await query<Pick<PatientRow, "primary_program">>(
      `select primary_program
         from public.patients
        where id = $1
        limit 1`,
      [req.params.id]
    );
    const previousPrimaryProgram = existingRows[0]?.primary_program ?? null;
    const nextPrimaryProgram = req.body.primary_program ?? null;
    const patient = await upsertPatientCore({ query }, req.params.id, {
      full_name: req.body.full_name ?? null,
      mrn: req.body.mrn ?? null,
      external_id: req.body.external_id ?? null,
      date_of_birth: req.body.date_of_birth ?? null,
      status: req.body.status == null ? null : normalizePatientStatus(req.body.status),
      location: req.body.location ?? null,
      intake_date: req.body.intake_date ?? null,
      last_visit_date: req.body.last_visit_date ?? null,
      next_appt_date: req.body.next_appt_date ?? null,
      primary_program: req.body.primary_program ?? null,
      counselor_name: req.body.counselor_name ?? null,
      flags: req.body.flags ?? [],
    });

    if (!patient) {
      return res.status(404).json({ ok: false, error: "Patient not found" });
    }

    await patchLatestIntakeJsonFromPatient({ query }, patient.id, {
      fullName: patient.full_name,
      dob: patient.date_of_birth,
      location: patient.location,
      status: patient.status,
      primaryProgram: patient.primary_program,
      counselorName: patient.counselor_name,
    });

    const hadProgram = Boolean(String(previousPrimaryProgram ?? "").trim());
    const hasProgram = Boolean(String(nextPrimaryProgram ?? "").trim());
    const programChanged =
      hadProgram &&
      hasProgram &&
      String(previousPrimaryProgram ?? "").trim().toLowerCase() !== String(nextPrimaryProgram ?? "").trim().toLowerCase();
    if (programChanged) {
      await resetProblemListForLevelOfCareChange({ query }, patient.id, req.body.updated_by ?? getRequestUser(req)?.id ?? null);
    }

    res.json({ ok: true, patient });
  } catch (error) {
    next(error);
  }
});

patientsRouter.delete("/api/patients/:id", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const rows = [await deletePatientById({ query }, req.params.id)];

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Patient not found" });
    }

    res.json({ ok: true, deletedId: rows[0].id });
  } catch (error) {
    next(error);
  }
});

patientsRouter.get("/api/patients/:id/intake", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query<IntakeSubmissionRow>(
      `select id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
              submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location,
              created_at, updated_at
         from public.intake_submissions
        where patient_id = $1
        order by created_at desc
        limit 1`,
      [req.params.id]
    );

    res.json({ ok: true, intakeSubmission: rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/case-assignment", requireAuth, requireAnyRole("Admin", "Intake"), async (req, res, next) => {
  try {
    const rows = await query(
      `insert into public.patient_case_assignments (patient_id, counselor_user_id, counselor_email)
       values ($1, $2, $3)
       on conflict (patient_id) do update
         set counselor_user_id = excluded.counselor_user_id,
             counselor_email = excluded.counselor_email,
             updated_at = timezone('utc', now())
       returning patient_id, counselor_user_id, counselor_email, assigned_at, updated_at`,
      [req.params.id, req.body.counselor_user_id ?? null, req.body.counselor_email ?? null]
    );
    res.json({ ok: true, assignment: rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

patientsRouter.delete("/api/patients/:id/case-assignment", requireAuth, requireAnyRole("Admin", "Intake"), async (req, res, next) => {
  try {
    await query(`delete from public.patient_case_assignments where patient_id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/compliance", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const compliance = await upsertPatientCompliance({ query }, req.params.id, {
      drug_test_mode: req.body.drug_test_mode ?? "none",
      drug_tests_per_week: req.body.drug_tests_per_week ?? null,
      drug_test_weekday: req.body.drug_test_weekday ?? null,
      problem_list_date: req.body.problem_list_date ?? null,
      last_problem_list_review: req.body.last_problem_list_review ?? null,
      last_problem_list_update: req.body.last_problem_list_update ?? null,
      treatment_plan_date: req.body.treatment_plan_date ?? null,
      treatment_plan_update: req.body.treatment_plan_update ?? null,
    }, req.body.updated_by ?? getRequestUser(req)?.id ?? null);
    res.json({ ok: true, compliance });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/roster-details", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rosterDetails = await upsertPatientRosterDetails({ query }, String(req.params.id), {
      drug_of_choice: req.body.drug_of_choice ?? null,
      medical_phys_apt: req.body.medical_phys_apt ?? null,
      med_form_status: req.body.med_form_status ?? null,
      notes: req.body.notes ?? null,
      referring_agency: req.body.referring_agency ?? null,
      reauth_sapc_date: req.body.reauth_sapc_date ?? null,
      medical_eligibility: req.body.medical_eligibility ?? null,
      mat_status: req.body.mat_status ?? null,
      therapy_track: req.body.therapy_track ?? null,
    }, req.body.updated_by ?? getRequestUser(req)?.id ?? null);
    if (rosterDetails) {
      await patchLatestIntakeJsonFromPatient({ query }, String(req.params.id), {
        substances: rosterDetails.drug_of_choice ?? null,
        medicalPhysApt: rosterDetails.medical_phys_apt ?? null,
        medFormStatus: rosterDetails.med_form_status ?? null,
        notes: rosterDetails.notes ?? null,
        referringAgency: rosterDetails.referring_agency ?? null,
        medicalEligibility: rosterDetails.medical_eligibility ?? null,
        matStatus: rosterDetails.mat_status ?? null,
        therapyTrack: rosterDetails.therapy_track ?? null,
      });
    }
    res.json({ ok: true, rosterDetails });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/drug-tests", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query(
      `insert into public.patient_drug_tests (
          id, patient_id, date, test_type, result, substances, notes, created_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        returning id, patient_id, date, test_type, result, substances, notes, created_at, updated_at`,
      [
        req.body.id ?? randomUUID(),
        req.params.id,
        req.body.date,
        req.body.test_type,
        req.body.result,
        req.body.substances ?? null,
        req.body.notes ?? null,
        req.body.created_by ?? getRequestUser(req)?.id ?? null,
      ]
    );
    res.status(201).json({ ok: true, drugTest: rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/billing-entries", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const sessionId = req.body.session_id ?? randomUUID();
      const billingId = req.body.id ?? randomUUID();
      const userId = req.body.created_by ?? getRequestUser(req)?.id ?? null;

      const sessionRows = await client.query(
        `insert into public.attendance_sessions (
            id, kind, title, date, duration_hours, location, created_by
          ) values ($1,$2,$3,$4,$5,$6,$7)
          returning id, kind, title, date, duration_hours, location, created_at, updated_at`,
        [
          sessionId,
          "Individual",
          req.body.title ?? req.body.billing_type,
          req.body.service_date,
          req.body.duration_hours,
          req.body.location ?? null,
          userId,
        ]
      );

      await client.query(
        `insert into public.attendance_session_patients (session_id, patient_id, status)
         values ($1, $2, $3)
         on conflict (session_id, patient_id) do update set status = excluded.status`,
        [sessionId, req.params.id, "Present"]
      );

      const billingRows = await client.query(
        `insert into public.patient_billing_entries (
            id, patient_id, session_id, billing_type, service_date, start_time, end_time,
            total_minutes, modality, naloxone_training, mat_education, created_by
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          returning id, patient_id, session_id, billing_type, service_date, start_time, end_time,
                    total_minutes, modality, naloxone_training, mat_education, created_at, updated_at`,
        [
          billingId,
          req.params.id,
          sessionId,
          req.body.billing_type,
          req.body.service_date,
          req.body.start_time ?? null,
          req.body.end_time ?? null,
          req.body.total_minutes,
          req.body.modality ?? null,
          req.body.naloxone_training ?? false,
          req.body.mat_education ?? false,
          userId,
        ]
      );

      return {
        session: sessionRows.rows[0] ?? null,
        billingEntry: billingRows.rows[0] ?? null,
      };
    });

    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
