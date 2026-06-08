import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { requireAnyRole, requireAuth } from "../entraAuth.js";
import type { PatientRow } from "../types.js";

export const adminWorkbooksRouter = Router();

const patientFieldSchema = z.enum([
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
] as const);

const workbookSchema = z.object({
  name: z.string().trim().min(1),
  original_file_name: z.string().trim().min(1),
  apply_patient_field_updates: z.boolean().optional(),
  tabs: z.array(
    z.object({
      id: z.string().trim().min(1).optional(),
      tab_name: z.string().trim().min(1),
      columns: z.array(
        z.object({
          id: z.string().trim().min(1).optional(),
          column_name: z.string().trim().min(1),
          mapped_patient_field: patientFieldSchema.nullable().optional(),
          column_type: z.string().trim().min(1).nullable().optional(),
          sort_order: z.number().int().nonnegative(),
        })
      ),
      rows: z.array(
        z.object({
          id: z.string().trim().min(1).optional(),
          row_order: z.number().int().nonnegative(),
          linked_patient_id: z.string().trim().min(1).nullable().optional(),
          values: z.record(z.string(), z.string().nullable()),
        })
      ),
    })
  ),
});

const workbookUpdateSchema = workbookSchema;

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

function normalizeLookupName(value: unknown) {
  return normalizeText(value)?.toLowerCase() ?? "";
}

function normalizeWorkbookPatientField(value: unknown) {
  const text = normalizeText(value);
  return text && patientFieldSchema.safeParse(text).success ? text : null;
}

async function loadPatientsIndex() {
  const patients = await query<PatientRow>(
    `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
            primary_program, counselor_name, flags, created_at, updated_at
       from public.patients`
  );

  const exact = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const patient of patients) {
    const nameKey = normalizeLookupName(patient.full_name);
    if (!nameKey) continue;
    const nameList = byName.get(nameKey) ?? [];
    nameList.push(patient.id);
    byName.set(nameKey, nameList);
    if (patient.full_name && patient.date_of_birth) {
      exact.set(`${nameKey}::${patient.date_of_birth}`, patient.id);
    }
  }

  return { patients, exact, byName };
}

async function loadWorkbookSummaries() {
  return query<{
    id: string;
    name: string;
    original_file_name: string;
    created_at: string;
    updated_at: string;
    tab_count: string;
    row_count: string;
    linked_patient_count: string;
    unmatched_row_count: string;
  }>(
    `select w.id, w.name, w.original_file_name, w.created_at, w.updated_at,
            count(s.id)::text as tab_count,
            count(r.id)::text as row_count,
            count(r.linked_patient_id)::text as linked_patient_count,
            count(r.id) filter (where r.linked_patient_id is null)::text as unmatched_row_count
       from public.admin_workbooks w
       left join public.admin_sheets s on s.workbook_id = w.id
       left join public.admin_sheet_rows r on r.sheet_id = s.id
      group by w.id
      order by w.created_at desc`
  );
}

async function loadWorkbookDetail(workbookId: string) {
  const workbooks = await query<{
    id: string;
    name: string;
    original_file_name: string;
    created_at: string;
    updated_at: string;
    tab_count: string;
    row_count: string;
    linked_patient_count: string;
    unmatched_row_count: string;
  }>(
    `select w.id, w.name, w.original_file_name, w.created_at, w.updated_at,
            count(s.id)::text as tab_count,
            count(r.id)::text as row_count,
            count(r.linked_patient_id)::text as linked_patient_count,
            count(r.id) filter (where r.linked_patient_id is null)::text as unmatched_row_count
       from public.admin_workbooks w
       left join public.admin_sheets s on s.workbook_id = w.id
       left join public.admin_sheet_rows r on r.sheet_id = s.id
      where w.id = $1
      group by w.id`,
    [workbookId]
  );
  const workbook = workbooks[0];
  if (!workbook) return null;

  const tabs = await query<{
    id: string;
    workbook_id: string;
    tab_name: string;
    row_count: string;
    linked_patient_count: string;
    unmatched_row_count: string;
    created_at: string;
    updated_at: string;
  }>(
    `select s.id, s.workbook_id, s.tab_name, s.created_at, s.updated_at,
            count(r.id)::text as row_count,
            count(r.linked_patient_id)::text as linked_patient_count,
            count(r.id) filter (where r.linked_patient_id is null)::text as unmatched_row_count
       from public.admin_sheets s
       left join public.admin_sheet_rows r on r.sheet_id = s.id
      where s.workbook_id = $1
      group by s.id
      order by s.created_at asc, s.tab_name asc`,
    [workbookId]
  );

  const tabIds = tabs.map((tab) => tab.id);
  const columns = tabIds.length
    ? await query<{
        id: string;
        sheet_id: string;
        column_name: string;
        mapped_patient_field: string | null;
        column_type: string | null;
        sort_order: number;
      }>(
        `select id, sheet_id, column_name, mapped_patient_field, column_type, sort_order
           from public.admin_sheet_columns
          where sheet_id = any($1::uuid[])
          order by sort_order asc, column_name asc`,
        [tabIds]
      )
    : [];

  const rows = tabIds.length
    ? await query<{
        id: string;
        sheet_id: string;
        linked_patient_id: string | null;
        row_order: number;
        created_at: string;
        updated_at: string;
        linked_patient_name: string | null;
      }>(
        `select r.id, r.sheet_id, r.linked_patient_id, r.row_order, r.created_at, r.updated_at, p.full_name as linked_patient_name
           from public.admin_sheet_rows r
           left join public.patients p on p.id = r.linked_patient_id
          where r.sheet_id = any($1::uuid[])
          order by r.row_order asc, r.created_at asc`,
        [tabIds]
      )
    : [];

  const rowIds = rows.map((row) => row.id);
  const cellRows = rowIds.length
    ? await query<{
        id: string;
        row_id: string;
        column_id: string;
        value: string | null;
      }>(
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
    id: workbook.id,
    name: workbook.name,
    original_file_name: workbook.original_file_name,
    created_at: workbook.created_at,
    updated_at: workbook.updated_at,
    tab_count: Number(workbook.tab_count) || 0,
    row_count: Number(workbook.row_count) || 0,
    linked_patient_count: Number(workbook.linked_patient_count) || 0,
    unmatched_row_count: Number(workbook.unmatched_row_count) || 0,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      workbook_id: tab.workbook_id,
      tab_name: tab.tab_name,
      row_count: Number(tab.row_count) || 0,
      linked_patient_count: Number(tab.linked_patient_count) || 0,
      unmatched_row_count: Number(tab.unmatched_row_count) || 0,
      columns: columns
        .filter((column) => column.sheet_id === tab.id)
        .map((column) => ({
          id: column.id,
          sheet_id: column.sheet_id,
          column_name: column.column_name,
          mapped_patient_field: normalizeWorkbookPatientField(column.mapped_patient_field),
          column_type: column.column_type,
          sort_order: column.sort_order,
        })),
      rows: rows
        .filter((row) => row.sheet_id === tab.id)
        .map((row) => ({
          id: row.id,
          sheet_id: row.sheet_id,
          linked_patient_id: row.linked_patient_id,
          linked_patient_name: row.linked_patient_name,
          row_order: row.row_order,
          created_at: row.created_at,
          updated_at: row.updated_at,
          cells: cellsByRow.get(row.id) ?? {},
        })),
    })),
  };
}

function exactLinkRow(
  rowValues: Record<string, string | null>,
  mappedNameColumn: string | undefined,
  mappedDobColumn: string | undefined,
  exactMatches: Map<string, string>,
  nameMatches: Map<string, string[]>
) {
  const rowName = mappedNameColumn ? normalizeText(rowValues[mappedNameColumn]) : null;
  const rowDob = mappedDobColumn ? normalizeDate(rowValues[mappedDobColumn]) : null;
  const exactMatchId = rowName && rowDob ? exactMatches.get(`${normalizeLookupName(rowName)}::${rowDob}`) ?? null : null;
  const suggestedMatchId =
    !exactMatchId && rowName && !rowDob && (nameMatches.get(normalizeLookupName(rowName))?.length === 1
      ? nameMatches.get(normalizeLookupName(rowName))?.[0] ?? null
      : null);
  return exactMatchId ?? suggestedMatchId ?? null;
}

async function saveWorkbookPayload(
  workbookId: string | null,
  payload: z.infer<typeof workbookSchema>
) {
  const { exact, byName } = await loadPatientsIndex();

  const createdWorkbookId = workbookId ?? randomUUID();
  await withTransaction(async (client) => {
    if (workbookId) {
      const existing = await client.query(`select id from public.admin_workbooks where id = $1`, [workbookId]);
      if (!existing.rows[0]) {
        throw new Error("Workbook not found.");
      }
      await client.query(
        `update public.admin_workbooks
            set name = $2,
                original_file_name = $3,
                updated_at = timezone('utc', now())
          where id = $1`,
        [createdWorkbookId, payload.name, payload.original_file_name]
      );
      await client.query(`delete from public.admin_sheets where workbook_id = $1`, [createdWorkbookId]);
    } else {
      await client.query(
        `insert into public.admin_workbooks (id, name, original_file_name)
         values ($1, $2, $3)`,
        [createdWorkbookId, payload.name, payload.original_file_name]
      );
    }

    for (const tabPayload of payload.tabs) {
      const tabId = tabPayload.id ?? randomUUID();
      await client.query(
        `insert into public.admin_sheets (id, workbook_id, name, tab_name, original_file_name, source_sheet_name)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          tabId,
          createdWorkbookId,
          tabPayload.tab_name,
          tabPayload.tab_name,
          payload.original_file_name,
          tabPayload.tab_name,
        ]
      );

      const insertedColumns: Array<{ id: string; column_name: string; mapped_patient_field: string | null }> = [];
      for (const columnPayload of tabPayload.columns) {
        const columnId = columnPayload.id ?? randomUUID();
        await client.query(
          `insert into public.admin_sheet_columns (id, sheet_id, column_name, mapped_patient_field, column_type, sort_order)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            columnId,
            tabId,
            columnPayload.column_name,
            columnPayload.mapped_patient_field ?? null,
            columnPayload.column_type ?? null,
            columnPayload.sort_order,
          ]
        );
        insertedColumns.push({
          id: columnId,
          column_name: columnPayload.column_name,
          mapped_patient_field: columnPayload.mapped_patient_field ?? null,
        });
      }

      const nameColumn = insertedColumns.find((column) => column.mapped_patient_field === "full_name");
      const dobColumn = insertedColumns.find((column) => column.mapped_patient_field === "date_of_birth");

      for (const rowPayload of tabPayload.rows) {
        const rowId = rowPayload.id ?? randomUUID();
        const linkedPatientId =
          rowPayload.linked_patient_id ??
          exactLinkRow(rowPayload.values, nameColumn?.column_name, dobColumn?.column_name, exact, byName);
        await client.query(
          `insert into public.admin_sheet_rows (id, sheet_id, linked_patient_id, row_order)
           values ($1, $2, $3, $4)`,
          [rowId, tabId, linkedPatientId, rowPayload.row_order]
        );

        for (const column of insertedColumns) {
          await client.query(
            `insert into public.admin_sheet_cell_values (id, row_id, column_id, value)
             values ($1, $2, $3, $4)`,
            [randomUUID(), rowId, column.id, rowPayload.values[column.column_name] ?? null]
          );
        }
      }
    }
  });

  return createdWorkbookId;
}

adminWorkbooksRouter.get("/api/admin/patientbridge/workbooks", requireAuth, requireAnyRole("Admin"), async (_req, res, next) => {
  try {
    const workbooks = await loadWorkbookSummaries();
    res.json({
      ok: true,
      workbooks: workbooks.map((workbook) => ({
        id: workbook.id,
        name: workbook.name,
        original_file_name: workbook.original_file_name,
        tab_count: Number(workbook.tab_count) || 0,
        row_count: Number(workbook.row_count) || 0,
        linked_patient_count: Number(workbook.linked_patient_count) || 0,
        unmatched_row_count: Number(workbook.unmatched_row_count) || 0,
        created_at: workbook.created_at,
        updated_at: workbook.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminWorkbooksRouter.get("/api/admin/patientbridge/workbooks/:workbookId", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const workbook = await loadWorkbookDetail(String(req.params.workbookId));
    if (!workbook) {
      return res.status(404).json({ ok: false, error: "Workbook not found." });
    }
    res.json({ ok: true, workbook });
  } catch (error) {
    next(error);
  }
});

adminWorkbooksRouter.post("/api/admin/patientbridge/workbooks", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = workbookSchema.parse(req.body);
    const workbookId = await saveWorkbookPayload(null, payload);
    const workbook = await loadWorkbookDetail(workbookId);
    if (!workbook) {
      return res.status(500).json({ ok: false, error: "Unable to load the saved workbook." });
    }
    res.status(201).json({ ok: true, workbook });
  } catch (error) {
    next(error);
  }
});

adminWorkbooksRouter.put("/api/admin/patientbridge/workbooks/:workbookId", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = workbookUpdateSchema.parse(req.body);
    const workbookId = await saveWorkbookPayload(String(req.params.workbookId), payload);
    const workbook = await loadWorkbookDetail(workbookId);
    if (!workbook) {
      return res.status(500).json({ ok: false, error: "Unable to load the saved workbook." });
    }
    res.json({ ok: true, workbook });
  } catch (error) {
    next(error);
  }
});
