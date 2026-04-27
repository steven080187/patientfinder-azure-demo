import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";
import type { IntakeSubmissionRow, PatientRow } from "../types.js";

export const patientsRouter = Router();

function normalizePatientId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function logPatientFlow(event: string, details: Record<string, unknown>) {
  console.info(`[patient-flow][api][${event}]`, {
    dataSource: "postgresql",
    ...details,
  });
}

patientsRouter.get("/api/patients", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const requestStartedAt = Date.now();
    const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    logPatientFlow("patients-list-request", {
      requestUrl,
      hasAuthToken: Boolean(req.headers.authorization),
      requester: getRequestUser(req)?.email ?? "unknown",
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
      `select p.id, p.full_name, p.mrn, p.external_id, p.status, p.location, p.intake_date, p.last_visit_date, p.next_appt_date,
              p.primary_program, p.counselor_name, p.flags, p.created_at, p.updated_at
         ${fromSql}
         ${whereSql}
        order by ${sortColumn} ${sortDir} nulls last, p.id asc
        limit $${dataParams.length - 1}
       offset $${dataParams.length}`,
      dataParams
    );

    logPatientFlow("patients-list-response", {
      requestUrl,
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
    const requestStartedAt = Date.now();
    const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const patientId = normalizePatientId(req.params.id);
    logPatientFlow("patient-detail-request", {
      requestUrl,
      patientId,
      hasAuthToken: Boolean(req.headers.authorization),
      requester: getRequestUser(req)?.email ?? "unknown",
    });

    const rows = await query<PatientRow>(
      `select id, full_name, mrn, external_id, status, location, intake_date, last_visit_date, next_appt_date,
              primary_program, counselor_name, flags, created_at, updated_at
         from public.patients
        where id = $1`,
      [patientId]
    );

    if (!rows[0]) {
      logPatientFlow("patient-detail-response", {
        requestUrl,
        patientId,
        selectedPatientFound: false,
        status: 404,
        durationMs: Date.now() - requestStartedAt,
      });
      return res.status(404).json({ ok: false, error: "Patient not found" });
    }

    logPatientFlow("patient-detail-response", {
      requestUrl,
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
    const rows = await query<PatientRow>(
      `insert into public.patients (
          id, full_name, mrn, external_id, status, location, intake_date, last_visit_date, next_appt_date,
          primary_program, counselor_name, flags
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        returning id, full_name, mrn, external_id, status, location, intake_date, last_visit_date, next_appt_date,
                  primary_program, counselor_name, flags, created_at, updated_at`,
      [
        id,
        req.body.full_name ?? null,
        req.body.mrn ?? null,
        req.body.external_id ?? null,
        req.body.status ?? "new",
        req.body.location ?? null,
        req.body.intake_date ?? null,
        req.body.last_visit_date ?? null,
        req.body.next_appt_date ?? null,
        req.body.primary_program ?? null,
        req.body.counselor_name ?? null,
        req.body.flags ?? [],
      ]
    );
    res.status(201).json({ ok: true, patient: rows[0] });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/bulk-upsert", requireAuth, requireAnyRole("Admin", "Intake"), async (req, res, next) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];

    await withTransaction(async (client) => {
      for (const record of records) {
        await client.query(
          `insert into public.patients (
              id, full_name, mrn, external_id, status, location, intake_date, last_visit_date, next_appt_date,
              primary_program, counselor_name, flags, created_at, updated_at
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13, timezone('utc', now())), coalesce($14, timezone('utc', now())))
            on conflict (id) do update
              set full_name = excluded.full_name,
                  mrn = excluded.mrn,
                  external_id = excluded.external_id,
                  status = excluded.status,
                  location = excluded.location,
                  intake_date = excluded.intake_date,
                  last_visit_date = excluded.last_visit_date,
                  next_appt_date = excluded.next_appt_date,
                  primary_program = excluded.primary_program,
                  counselor_name = excluded.counselor_name,
                  flags = excluded.flags,
                  updated_at = timezone('utc', now())`,
          [
            record.id ?? randomUUID(),
            record.full_name ?? null,
            record.mrn ?? null,
            record.external_id ?? null,
            record.status ?? "new",
            record.location ?? null,
            record.intake_date ?? null,
            record.last_visit_date ?? null,
            record.next_appt_date ?? null,
            record.primary_program ?? null,
            record.counselor_name ?? null,
            record.flags ?? [],
            record.created_at ?? null,
            record.updated_at ?? null,
          ]
        );
      }
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

patientsRouter.patch("/api/patients/:id", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query<PatientRow>(
      `update public.patients
          set full_name = coalesce($2, full_name),
              mrn = coalesce($3, mrn),
              external_id = coalesce($4, external_id),
              status = coalesce($5, status),
              location = coalesce($6, location),
              intake_date = coalesce($7, intake_date),
              last_visit_date = coalesce($8, last_visit_date),
              next_appt_date = coalesce($9, next_appt_date),
              primary_program = coalesce($10, primary_program),
              counselor_name = coalesce($11, counselor_name),
              flags = coalesce($12, flags),
              updated_at = timezone('utc', now())
        where id = $1
        returning id, full_name, mrn, external_id, status, location, intake_date, last_visit_date, next_appt_date,
                  primary_program, counselor_name, flags, created_at, updated_at`,
      [
        req.params.id,
        req.body.full_name,
        req.body.mrn,
        req.body.external_id,
        req.body.status,
        req.body.location,
        req.body.intake_date,
        req.body.last_visit_date,
        req.body.next_appt_date,
        req.body.primary_program,
        req.body.counselor_name,
        req.body.flags,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Patient not found" });
    }

    res.json({ ok: true, patient: rows[0] });
  } catch (error) {
    next(error);
  }
});

patientsRouter.delete("/api/patients/:id", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const rows = await query<{ id: string }>(
      `delete from public.patients where id = $1 returning id`,
      [req.params.id]
    );

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
    const rows = await query(
      `insert into public.patient_compliance (
          patient_id, drug_test_mode, drug_tests_per_week, drug_test_weekday,
          problem_list_date, last_problem_list_review, last_problem_list_update,
          treatment_plan_date, treatment_plan_update, updated_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (patient_id) do update
          set drug_test_mode = excluded.drug_test_mode,
              drug_tests_per_week = excluded.drug_tests_per_week,
              drug_test_weekday = excluded.drug_test_weekday,
              problem_list_date = excluded.problem_list_date,
              last_problem_list_review = excluded.last_problem_list_review,
              last_problem_list_update = excluded.last_problem_list_update,
              treatment_plan_date = excluded.treatment_plan_date,
              treatment_plan_update = excluded.treatment_plan_update,
              updated_by = excluded.updated_by,
              updated_at = timezone('utc', now())
        returning *`,
      [
        req.params.id,
        req.body.drug_test_mode ?? "none",
        req.body.drug_tests_per_week ?? null,
        req.body.drug_test_weekday ?? null,
        req.body.problem_list_date ?? null,
        req.body.last_problem_list_review ?? null,
        req.body.last_problem_list_update ?? null,
        req.body.treatment_plan_date ?? null,
        req.body.treatment_plan_update ?? null,
        req.body.updated_by ?? getRequestUser(req)?.id ?? null,
      ]
    );
    res.json({ ok: true, compliance: rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/api/patients/:id/roster-details", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query(
      `insert into public.patient_roster_details (
          patient_id, drug_of_choice, medical_phys_apt, med_form_status, notes,
          referring_agency, reauth_sapc_date, medical_eligibility, mat_status, therapy_track, updated_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (patient_id) do update
          set drug_of_choice = excluded.drug_of_choice,
              medical_phys_apt = excluded.medical_phys_apt,
              med_form_status = excluded.med_form_status,
              notes = excluded.notes,
              referring_agency = excluded.referring_agency,
              reauth_sapc_date = excluded.reauth_sapc_date,
              medical_eligibility = excluded.medical_eligibility,
              mat_status = excluded.mat_status,
              therapy_track = excluded.therapy_track,
              updated_by = excluded.updated_by,
              updated_at = timezone('utc', now())
        returning *`,
      [
        req.params.id,
        req.body.drug_of_choice ?? null,
        req.body.medical_phys_apt ?? null,
        req.body.med_form_status ?? null,
        req.body.notes ?? null,
        req.body.referring_agency ?? null,
        req.body.reauth_sapc_date ?? null,
        req.body.medical_eligibility ?? null,
        req.body.mat_status ?? null,
        req.body.therapy_track ?? null,
        req.body.updated_by ?? getRequestUser(req)?.id ?? null,
      ]
    );
    res.json({ ok: true, rosterDetails: rows[0] ?? null });
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
