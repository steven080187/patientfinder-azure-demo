import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { invalidateDashboardCache } from "./dashboard.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";
import {
  patchLatestIntakeJsonFromPatient,
  resetProblemListForLevelOfCareChange,
  upsertPatientCompliance,
  upsertPatientCore,
  upsertPatientRosterDetails,
} from "../patientWrites.js";
import type {
  AdminSheetCellValueRow,
  AdminSheetColumnRow,
  AdminSheetDataRow,
  PatientRow,
} from "../types.js";

export const adminPatientBridgeRouter = Router();

const ADMIN_SHEET_PATIENT_FIELDS = [
  "full_name",
  "date_of_birth",
  "mrn",
  "external_id",
  "status",
  "location",
  "intake_date",
  "last_visit_date",
  "next_appt_date",
  "primary_program",
  "counselor_name",
  "drug_of_choice",
  "medical_phys_apt",
  "med_form_status",
  "notes",
  "referring_agency",
  "reauth_sapc_date",
  "medical_eligibility",
  "mat_status",
  "therapy_track",
  "drug_test_mode",
  "drug_tests_per_week",
  "drug_test_weekday",
  "problem_list_date",
  "last_problem_list_review",
  "last_problem_list_update",
  "treatment_plan_date",
  "treatment_plan_update",
] as const;

type PatientFieldKey = (typeof ADMIN_SHEET_PATIENT_FIELDS)[number];

const patientFieldSchema = z.enum(ADMIN_SHEET_PATIENT_FIELDS);

const patientFieldDefinitions: Record<
  PatientFieldKey,
  {
    target: "patients" | "roster" | "compliance";
    column: string;
  }
> = {
  full_name: { target: "patients", column: "full_name" },
  date_of_birth: { target: "patients", column: "date_of_birth" },
  mrn: { target: "patients", column: "mrn" },
  external_id: { target: "patients", column: "external_id" },
  status: { target: "patients", column: "status" },
  location: { target: "patients", column: "location" },
  intake_date: { target: "patients", column: "intake_date" },
  last_visit_date: { target: "patients", column: "last_visit_date" },
  next_appt_date: { target: "patients", column: "next_appt_date" },
  primary_program: { target: "patients", column: "primary_program" },
  counselor_name: { target: "patients", column: "counselor_name" },
  drug_of_choice: { target: "roster", column: "drug_of_choice" },
  medical_phys_apt: { target: "roster", column: "medical_phys_apt" },
  med_form_status: { target: "roster", column: "med_form_status" },
  notes: { target: "roster", column: "notes" },
  referring_agency: { target: "roster", column: "referring_agency" },
  reauth_sapc_date: { target: "roster", column: "reauth_sapc_date" },
  medical_eligibility: { target: "roster", column: "medical_eligibility" },
  mat_status: { target: "roster", column: "mat_status" },
  therapy_track: { target: "roster", column: "therapy_track" },
  drug_test_mode: { target: "compliance", column: "drug_test_mode" },
  drug_tests_per_week: { target: "compliance", column: "drug_tests_per_week" },
  drug_test_weekday: { target: "compliance", column: "drug_test_weekday" },
  problem_list_date: { target: "compliance", column: "problem_list_date" },
  last_problem_list_review: { target: "compliance", column: "last_problem_list_review" },
  last_problem_list_update: { target: "compliance", column: "last_problem_list_update" },
  treatment_plan_date: { target: "compliance", column: "treatment_plan_date" },
  treatment_plan_update: { target: "compliance", column: "treatment_plan_update" },
};

const createSheetSchema = z.object({
  name: z.string().trim().min(1),
  original_file_name: z.string().trim().min(1),
  source_sheet_name: z.string().trim().min(1).nullable().optional(),
  apply_patient_field_updates: z.boolean().optional(),
  columns: z.array(
    z.object({
      column_name: z.string().trim().min(1),
      mapped_patient_field: patientFieldSchema.nullable().optional(),
      column_type: z.string().trim().min(1).nullable().optional(),
      sort_order: z.number().int().nonnegative(),
    })
  ),
  rows: z.array(
    z.object({
      row_order: z.number().int().nonnegative(),
      linked_patient_id: z.string().trim().min(1).nullable().optional(),
      values: z.record(z.string(), z.string().nullable()),
    })
  ),
});

const updateCellSchema = z.object({
  rowId: z.string().trim().min(1),
  columnId: z.string().trim().min(1),
  value: z.string().nullable(),
});

const updateRowLinkSchema = z.object({
  rowId: z.string().trim().min(1),
  linkedPatientId: z.string().trim().min(1).nullable(),
});

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value: unknown) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return null;
  if (["new", "new patient", "new enrollee"].includes(text)) return "new";
  if (["current", "current patient", "active", "active patient"].includes(text)) return "current";
  if (["rss+", "rss_plus", "rss plus"].includes(text)) return "rss_plus";
  if (text === "rss") return "rss";
  if (["past", "former", "former patient", "inactive"].includes(text)) return "former";
  return null;
}

function normalizeLookupName(value: unknown) {
  return normalizeText(value)?.toLowerCase() ?? "";
}

function normalizeDrugTestMode(value: unknown) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return null;
  if (["none", "n/a", "na", "off", "no"].includes(text)) return "none";
  if (["weekly", "weekly count", "weekly_count"].includes(text)) return "weekly_count";
  if (["weekday", "day of week"].includes(text)) return "weekday";
  return null;
}

function normalizeEnumValue(value: unknown, allowed: readonly string[]) {
  const text = normalizeText(value);
  if (!text) return null;
  return allowed.find((entry) => entry.toLowerCase() === text.toLowerCase()) ?? null;
}

function normalizeWeekdayValue(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    return parsed >= 0 && parsed <= 6 ? parsed : null;
  }
  const weekdays = new Map([
    ["sun", 0], ["sunday", 0],
    ["mon", 1], ["monday", 1],
    ["tue", 2], ["tues", 2], ["tuesday", 2],
    ["wed", 3], ["wednesday", 3],
    ["thu", 4], ["thur", 4], ["thurs", 4], ["thursday", 4],
    ["fri", 5], ["friday", 5],
    ["sat", 6], ["saturday", 6],
  ]);
  return weekdays.get(text.toLowerCase()) ?? null;
}

function normalizeTextArray(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const values = text
    .split(/[,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length ? values : null;
}

function buildPatientFieldPatches(valuesByField: Partial<Record<PatientFieldKey, string | null>>) {
  const patientPatch: Partial<Record<keyof PatientRow, string | null>> = {};
  const rosterPatch: Record<string, unknown> = {};
  const compliancePatch: Record<string, unknown> = {};

  for (const field of ADMIN_SHEET_PATIENT_FIELDS) {
    const rawValue = valuesByField[field];
    if (rawValue == null || rawValue === "") continue;
    const def = patientFieldDefinitions[field];

    if (def.target === "patients") {
      if (field === "status") {
        const normalized = normalizeStatus(rawValue);
        if (normalized) patientPatch[def.column as keyof PatientRow] = normalized;
        continue;
      }
      if (["date_of_birth", "intake_date", "last_visit_date", "next_appt_date"].includes(field)) {
        const normalized = normalizeDate(rawValue);
        if (normalized) patientPatch[def.column as keyof PatientRow] = normalized;
        continue;
      }
      patientPatch[def.column as keyof PatientRow] = normalizeText(rawValue);
      continue;
    }

    if (def.target === "roster") {
      if (field === "drug_of_choice") {
        const normalized = normalizeTextArray(rawValue);
        if (normalized) rosterPatch[def.column] = normalized;
        continue;
      }
      if (["reauth_sapc_date"].includes(field)) {
        const normalized = normalizeDate(rawValue);
        if (normalized) rosterPatch[def.column] = normalized;
        continue;
      }
      const allowedValues: Record<string, readonly string[]> = {
        medical_phys_apt: ["Needed", "Scheduled", "Completed"],
        med_form_status: ["Pending", "Turned in", "Not needed"],
        referring_agency: ["Self", "DCFS", "Court", "Other"],
        medical_eligibility: ["Yes", "No", "Pending"],
        mat_status: ["Yes", "No"],
        therapy_track: ["Sandy", "Becky"],
      };
      const normalized = normalizeEnumValue(rawValue, allowedValues[field] ?? []);
      if (normalized) rosterPatch[def.column] = normalized;
      continue;
    }

    if (field === "drug_test_mode") {
      const normalized = normalizeDrugTestMode(rawValue);
      if (normalized) compliancePatch[def.column] = normalized;
      continue;
    }
    if (field === "drug_tests_per_week") {
      const parsed = Number.parseInt(normalizeText(rawValue) ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) compliancePatch[def.column] = parsed;
      continue;
    }
    if (field === "drug_test_weekday") {
      const normalized = normalizeWeekdayValue(rawValue);
      if (normalized != null) compliancePatch[def.column] = normalized;
      continue;
    }
    const normalized = normalizeDate(rawValue);
    if (normalized) compliancePatch[def.column] = normalized;
  }

  return { patientPatch, rosterPatch, compliancePatch };
}

async function applyFieldPatches(
  client: PoolClient,
  patientId: string,
  valuesByField: Partial<Record<PatientFieldKey, string | null>>,
  updatedBy: string | null
) {
  const { patientPatch, rosterPatch, compliancePatch } = buildPatientFieldPatches(valuesByField);
  const directRunner = { query: client.query.bind(client) };
  const previousPatient = await client.query<{ primary_program: string | null }>(
    `select primary_program
       from public.patients
      where id = $1
      limit 1`,
    [patientId]
  );
  const previousPrimaryProgram = previousPatient.rows[0]?.primary_program ?? null;

  const patient = Object.keys(patientPatch).length
    ? await upsertPatientCore(directRunner, patientId, patientPatch as any)
    : null;
  const rosterDetails = Object.keys(rosterPatch).length
    ? await upsertPatientRosterDetails(directRunner, patientId, rosterPatch as any, updatedBy)
    : null;
  const compliance = Object.keys(compliancePatch).length
    ? await upsertPatientCompliance(directRunner, patientId, compliancePatch as any, updatedBy)
    : null;

  if (patient || rosterDetails || compliance) {
    await patchLatestIntakeJsonFromPatient(directRunner, patientId, {
      fullName: patient?.full_name ?? undefined,
      dob: patient?.date_of_birth ?? undefined,
      location: patient?.location ?? undefined,
      status: patient?.status ?? undefined,
      primaryProgram: patient?.primary_program ?? undefined,
      counselorName: patient?.counselor_name ?? undefined,
      substances: rosterDetails?.drug_of_choice ?? undefined,
      referringAgency: rosterDetails?.referring_agency ?? undefined,
      medicalEligibility: rosterDetails?.medical_eligibility ?? undefined,
      matStatus: rosterDetails?.mat_status ?? undefined,
      therapyTrack: rosterDetails?.therapy_track ?? undefined,
      medicalPhysApt: rosterDetails?.medical_phys_apt ?? undefined,
      medFormStatus: rosterDetails?.med_form_status ?? undefined,
      notes: rosterDetails?.notes ?? undefined,
    });

    const nextPrimaryProgram = patient?.primary_program ?? null;
    const programChanged = Boolean(previousPrimaryProgram && nextPrimaryProgram && previousPrimaryProgram.toLowerCase() !== nextPrimaryProgram.toLowerCase());
    if (programChanged) {
      await resetProblemListForLevelOfCareChange(directRunner, patientId, updatedBy);
    }
  }
}

async function loadAdminSheetSummaries() {
  return query<{
    id: string;
    name: string;
    original_file_name: string;
    source_sheet_name: string | null;
    created_at: string;
    updated_at: string;
    row_count: string;
    linked_patient_count: string;
    unmatched_row_count: string;
  }>(
    `select s.id, s.name, s.original_file_name, s.source_sheet_name, s.created_at, s.updated_at,
            count(r.id)::text as row_count,
            count(r.linked_patient_id)::text as linked_patient_count,
            count(r.id) filter (where r.linked_patient_id is null)::text as unmatched_row_count
       from public.admin_sheets s
       left join public.admin_sheet_rows r on r.sheet_id = s.id
      group by s.id
      order by s.created_at desc`
  );
}

async function loadAdminSheetDetail(sheetId: string) {
  const sheets = await query<{
    id: string;
    name: string;
    original_file_name: string;
    source_sheet_name: string | null;
    created_at: string;
    updated_at: string;
    row_count: string;
    linked_patient_count: string;
    unmatched_row_count: string;
  }>(
    `select s.id, s.name, s.original_file_name, s.source_sheet_name, s.created_at, s.updated_at,
            count(r.id)::text as row_count,
            count(r.linked_patient_id)::text as linked_patient_count,
            count(r.id) filter (where r.linked_patient_id is null)::text as unmatched_row_count
       from public.admin_sheets s
       left join public.admin_sheet_rows r on r.sheet_id = s.id
      where s.id = $1
      group by s.id`,
    [sheetId]
  );
  const sheet = sheets[0];
  if (!sheet) return null;

  const columns = await query<AdminSheetColumnRow>(
    `select id, sheet_id, column_name, mapped_patient_field, column_type, sort_order
       from public.admin_sheet_columns
      where sheet_id = $1
      order by sort_order asc, column_name asc`,
    [sheetId]
  );

  const rows = await query<AdminSheetDataRow & { linked_patient_name: string | null }>(
    `select r.id, r.sheet_id, r.linked_patient_id, r.row_order, r.created_at, r.updated_at, p.full_name as linked_patient_name
       from public.admin_sheet_rows r
       left join public.patients p on p.id = r.linked_patient_id
      where r.sheet_id = $1
      order by r.row_order asc, r.created_at asc`,
    [sheetId]
  );

  const rowIds = rows.map((row) => row.id);
  const cellRows = rowIds.length
    ? await query<AdminSheetCellValueRow>(
        `select id, row_id, column_id, value
           from public.admin_sheet_cell_values
          where row_id = any($1::uuid[])`,
        [rowIds]
      )
    : [];

  const cellsByRow = new Map<string, Record<string, string | null>>();
  for (const row of rows) {
    cellsByRow.set(row.id, {});
  }
  for (const cell of cellRows) {
    const row = cellsByRow.get(cell.row_id);
    if (!row) continue;
    row[cell.column_id] = cell.value;
  }

  return {
    id: sheet.id,
    name: sheet.name,
    original_file_name: sheet.original_file_name,
    source_sheet_name: sheet.source_sheet_name,
    created_at: sheet.created_at,
    updated_at: sheet.updated_at,
    row_count: Number(sheet.row_count) || 0,
    linked_patient_count: Number(sheet.linked_patient_count) || 0,
    unmatched_row_count: Number(sheet.unmatched_row_count) || 0,
    columns,
    rows: rows.map((row) => ({
      id: row.id,
      sheet_id: row.sheet_id,
      linked_patient_id: row.linked_patient_id,
      linked_patient_name: row.linked_patient_name,
      row_order: row.row_order,
      created_at: row.created_at,
      updated_at: row.updated_at,
      cells: cellsByRow.get(row.id) ?? {},
    })),
  };
}

adminPatientBridgeRouter.get("/api/admin/patientbridge/sheets", requireAuth, requireAnyRole("Admin"), async (_req, res, next) => {
  try {
    const sheets = await loadAdminSheetSummaries();
    res.json({
      ok: true,
      sheets: sheets.map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        original_file_name: sheet.original_file_name,
        source_sheet_name: sheet.source_sheet_name,
        row_count: Number(sheet.row_count) || 0,
        linked_patient_count: Number(sheet.linked_patient_count) || 0,
        unmatched_row_count: Number(sheet.unmatched_row_count) || 0,
        created_at: sheet.created_at,
        updated_at: sheet.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminPatientBridgeRouter.get("/api/admin/patientbridge/sheets/:sheetId", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const sheet = await loadAdminSheetDetail(String(req.params.sheetId));
    if (!sheet) {
      return res.status(404).json({ ok: false, error: "Admin sheet not found." });
    }
    res.json({ ok: true, sheet });
  } catch (error) {
    next(error);
  }
});

adminPatientBridgeRouter.post("/api/admin/patientbridge/sheets", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = createSheetSchema.parse(req.body);
    const sheetId = randomUUID();
    const patients = await query<PatientRow>(
      `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
              primary_program, counselor_name, flags, created_at, updated_at
         from public.patients`
    );
    const exactPatientMatches = new Map<string, string>();
    const nameMatches = new Map<string, string[]>();
    for (const patient of patients) {
      const nameKey = normalizeLookupName(patient.full_name);
      if (!nameKey) continue;
      const existing = nameMatches.get(nameKey) ?? [];
      existing.push(patient.id);
      nameMatches.set(nameKey, existing);
      if (patient.full_name && patient.date_of_birth) {
        exactPatientMatches.set(`${nameKey}::${patient.date_of_birth}`, patient.id);
      }
    }

    await withTransaction(async (client) => {
      await client.query(
        `insert into public.admin_sheets (id, name, original_file_name, source_sheet_name)
         values ($1, $2, $3, $4)`,
        [sheetId, payload.name, payload.original_file_name, payload.source_sheet_name ?? null]
      );

      const insertedColumns: Array<AdminSheetColumnRow & { column_name: string }> = [];
      for (const column of payload.columns) {
        const columnId = randomUUID();
        const rows = await client.query<AdminSheetColumnRow>(
          `insert into public.admin_sheet_columns (id, sheet_id, column_name, mapped_patient_field, column_type, sort_order)
           values ($1, $2, $3, $4, $5, $6)
           returning id, sheet_id, column_name, mapped_patient_field, column_type, sort_order`,
          [
            columnId,
            sheetId,
            column.column_name,
            column.mapped_patient_field ?? null,
            column.column_type ?? null,
            column.sort_order,
          ]
        );
        if (rows.rows[0]) {
          insertedColumns.push({ ...rows.rows[0], column_name: column.column_name });
        }
      }

      for (const row of payload.rows) {
        const rowId = randomUUID();
        const nameColumn = insertedColumns.find((column) => column.mapped_patient_field === "full_name");
        const dobColumn = insertedColumns.find((column) => column.mapped_patient_field === "date_of_birth");
        const rowName = nameColumn ? normalizeText(row.values[nameColumn.column_name]) : null;
        const rowDob = dobColumn ? normalizeDate(row.values[dobColumn.column_name]) : null;
        const exactMatchId = rowName && rowDob ? exactPatientMatches.get(`${normalizeLookupName(rowName)}::${rowDob}`) ?? null : null;
        const linkedPatientId = row.linked_patient_id ?? exactMatchId ?? null;
        const linkedPatientExists = linkedPatientId ? patients.some((patient) => patient.id === linkedPatientId) : false;
        const finalLinkedPatientId = linkedPatientExists ? linkedPatientId : exactMatchId;
        await client.query(
          `insert into public.admin_sheet_rows (id, sheet_id, linked_patient_id, row_order)
           values ($1, $2, $3, $4)`,
          [rowId, sheetId, finalLinkedPatientId, row.row_order]
        );

        for (const column of insertedColumns) {
          await client.query(
            `insert into public.admin_sheet_cell_values (id, row_id, column_id, value)
             values ($1, $2, $3, $4)`,
            [randomUUID(), rowId, column.id, row.values[column.column_name] ?? null]
          );
        }

        if (finalLinkedPatientId && payload.apply_patient_field_updates !== false) {
          const valuesByField: Partial<Record<PatientFieldKey, string | null>> = {};
          for (const column of insertedColumns) {
            const mappedField = column.mapped_patient_field as PatientFieldKey | null | undefined;
            if (!mappedField) continue;
            const cellValue = normalizeText(row.values[column.column_name]);
            if (cellValue) valuesByField[mappedField] = cellValue;
          }
          await applyFieldPatches(client, finalLinkedPatientId, valuesByField, getRequestUser(req)?.id ?? null);
        }
      }

      await client.query(`update public.admin_sheets set updated_at = timezone('utc', now()) where id = $1`, [sheetId]);
    });

    invalidateDashboardCache();

    const sheet = await loadAdminSheetDetail(sheetId);
    if (!sheet) {
      return res.status(500).json({ ok: false, error: "Unable to load the saved admin sheet." });
    }

    res.status(201).json({ ok: true, sheet });
  } catch (error) {
    next(error);
  }
});

adminPatientBridgeRouter.patch("/api/admin/patientbridge/sheets/:sheetId/cells", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = updateCellSchema.parse(req.body);
    await withTransaction(async (client) => {
      const rows = await client.query<{
        linked_patient_id: string | null;
        mapped_patient_field: string | null;
      }>(
        `select r.linked_patient_id, c.mapped_patient_field
           from public.admin_sheet_rows r
           join public.admin_sheet_columns c on c.sheet_id = r.sheet_id
          where r.sheet_id = $1
            and r.id = $2
            and c.id = $3
          limit 1`,
        [req.params.sheetId, payload.rowId, payload.columnId]
      );
      const target = rows.rows[0];
      if (!target) {
        throw new Error("Admin sheet cell not found.");
      }

      await client.query(
        `insert into public.admin_sheet_cell_values (id, row_id, column_id, value)
         values ($1, $2, $3, $4)
         on conflict (row_id, column_id) do update
           set value = excluded.value`,
        [randomUUID(), payload.rowId, payload.columnId, payload.value]
      );

      if (target.linked_patient_id && target.mapped_patient_field) {
        const mappedField = target.mapped_patient_field as PatientFieldKey;
        const cellValue = normalizeText(payload.value);
        await applyFieldPatches(
          client,
          target.linked_patient_id,
          { [mappedField]: cellValue } as Partial<Record<PatientFieldKey, string | null>>,
          getRequestUser(req)?.id ?? null
        );
        invalidateDashboardCache();
      }

      await client.query(`update public.admin_sheet_rows set updated_at = timezone('utc', now()) where id = $1`, [payload.rowId]);
      await client.query(`update public.admin_sheets set updated_at = timezone('utc', now()) where id = $1`, [req.params.sheetId]);
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminPatientBridgeRouter.patch("/api/admin/patientbridge/sheets/:sheetId/rows", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = updateRowLinkSchema.parse(req.body);
    await withTransaction(async (client) => {
      const rows = await client.query<{
        id: string;
        linked_patient_id: string | null;
      }>(
        `update public.admin_sheet_rows
            set linked_patient_id = $2,
                updated_at = timezone('utc', now())
          where sheet_id = $1
            and id = $3
          returning id, linked_patient_id`,
        [req.params.sheetId, payload.linkedPatientId, payload.rowId]
      );
      if (!rows.rows[0]) {
        throw new Error("Admin sheet row not found.");
      }

      if (payload.linkedPatientId) {
        const fieldRows = await client.query<{
          column_name: string;
          mapped_patient_field: string | null;
          value: string | null;
        }>(
          `select c.column_name, c.mapped_patient_field, v.value
             from public.admin_sheet_columns c
             left join public.admin_sheet_cell_values v
               on v.column_id = c.id
              and v.row_id = $1
            where c.sheet_id = $2`,
          [payload.rowId, req.params.sheetId]
        );
        const valuesByField: Partial<Record<PatientFieldKey, string | null>> = {};
        for (const fieldRow of fieldRows.rows) {
          const mappedField = fieldRow.mapped_patient_field as PatientFieldKey | null;
          if (!mappedField) continue;
          const cellValue = normalizeText(fieldRow.value);
          if (cellValue) valuesByField[mappedField] = cellValue;
        }
        await applyFieldPatches(client, payload.linkedPatientId, valuesByField, getRequestUser(req)?.id ?? null);
      }

      await client.query(`update public.admin_sheets set updated_at = timezone('utc', now()) where id = $1`, [req.params.sheetId]);
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
