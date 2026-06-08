import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { Client } from "pg";

type WorkbookRow = {
  Patient: string;
  MRN: string;
  DOB: string;
  Status: string;
  Counselor: string;
  Location: string;
  Program: string;
  DOC: string;
  "Last Visit": string;
  "Next Appt": string;
  "Problem List": string;
  "Treatment Plan": string;
  "Reauth SAPC": string;
  Notes: string;
  Flags: string;
  "Compliance Snapshot": string;
  "Assessment Document": string;
};

type AssessmentSection = {
  index: number;
  code: string;
  patientName: string;
  mrn: string;
  doc: string;
  program: string;
  text: string;
};

type SeedPatient = {
  id: string;
  full_name: string;
  mrn: string | null;
  external_id: string | null;
  date_of_birth: string | null;
  status: string;
  location: string | null;
  intake_date: string | null;
  last_visit_date: string | null;
  next_appt_date: string | null;
  primary_program: string | null;
  counselor_name: string | null;
  flags: string[];
  roster_drug_of_choice: string[];
  workbook_row: WorkbookRow;
  assessment: AssessmentSection;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const defaultRosterPath = process.env.PATIENTBRIDGE_ROSTER_PATH ?? path.join(
  process.env.HOME ?? "",
  "Downloads",
  "patientbridge-live-roster-3-DOC-fixed.xlsx"
);
const defaultAssessmentPath = process.env.PATIENTBRIDGE_ASSESSMENT_PATH ?? path.join(
  process.env.HOME ?? "",
  "Downloads",
  "patientbridge_fake_asam_assessments_clean.docx"
);

const apiBaseUrl = (process.env.PATIENTBRIDGE_API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const dbUrl = process.env.DATABASE_URL ?? "postgresql://steven@localhost:5432/patientfinder";
const demoEmail = process.env.PATIENTBRIDGE_DEMO_EMAIL ?? "steven@ncadd-sfv.org";
const demoPassword = process.env.PATIENTBRIDGE_DEMO_PASSWORD ?? "Demo123!";

function decodeXmlEntities(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocxParagraphs(docxPath: string) {
  const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], { encoding: "utf8" });
  const paragraphMatches = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];

  return paragraphMatches
    .map((paragraph) => {
      const texts = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXmlEntities(match[1] ?? ""));
      return texts.join("").trim();
    })
    .filter(Boolean);
}

function splitAssessments(paragraphs: string[]): AssessmentSection[] {
  const sections: AssessmentSection[] = [];
  let current: string[] = [];
  let currentHeader: string | null = null;

  for (const line of paragraphs) {
    const headerMatch = line.match(/^(ASAM-\d{3}) - (.+)$/);
    if (headerMatch) {
      if (currentHeader && current.length) {
        const [code, patientName] = currentHeader.split(" - ");
        const sectionText = current.join("\n").trim();
        const fields = extractAssessmentMeta(sectionText);
        sections.push({
          index: sections.length + 1,
          code,
          patientName,
          mrn: fields.mrn,
          doc: fields.doc,
          program: fields.program,
          text: sectionText,
        });
      }
      currentHeader = line;
      current = [line];
      continue;
    }

    if (currentHeader) {
      current.push(line);
    }
  }

  if (currentHeader && current.length) {
    const [code, patientName] = currentHeader.split(" - ");
    const sectionText = current.join("\n").trim();
    const fields = extractAssessmentMeta(sectionText);
    sections.push({
      index: sections.length + 1,
      code,
      patientName,
      mrn: fields.mrn,
      doc: fields.doc,
      program: fields.program,
      text: sectionText,
    });
  }

  return sections;
}

function extractAssessmentMeta(sectionText: string) {
  const mrn = sectionText.match(/\bMRN:\s*([^\n]+)/)?.[1]?.trim() ?? "";
  const doc = sectionText.match(/\bDrug of Choice \(DOC\):\s*([^\n]+)/)?.[1]?.trim() ?? "";
  const program = sectionText.match(/\bProgram:\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { mrn, doc, program };
}

function parseWorkbookRows(filePath: string) {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`Workbook ${filePath} does not contain a usable sheet.`);
  return xlsx.utils.sheet_to_json<WorkbookRow>(sheet as any, {
    defval: "",
    raw: false,
  }) as WorkbookRow[];
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseDueLabel(text: string) {
  const match = text.match(/Due\s+(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function parseFlags(text: string) {
  return text
    .split(/[,;]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitDocOfChoice(text: string) {
  return text
    .split(/\s*\/\s*/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeStatus(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return "new";
  if (text === "past" || text === "former") return "past";
  return "active";
}

function uuidFromSeed(seed: string) {
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function patientSeedId(index: number, row: WorkbookRow) {
  return uuidFromSeed(`patientbridge:${index + 1}:${row.Patient}:${row.MRN}:${row.DOB}`);
}

function workbookSeedId(fileName: string) {
  return uuidFromSeed(`patientbridge-workbook:${fileName}`);
}

async function getAccessToken() {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: demoEmail,
      password: demoPassword,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to log into the API (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { accessToken?: string };
  if (!payload.accessToken) {
    throw new Error("Demo login did not return an access token.");
  }
  return payload.accessToken;
}

async function apiJson(pathname: string, token: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`API request failed ${pathname} (${response.status}): ${text.slice(0, 300)}`);
  }
  return body;
}

async function main() {
  const rosterRows = parseWorkbookRows(defaultRosterPath);
  const assessmentParagraphs = extractDocxParagraphs(defaultAssessmentPath);
  const assessmentSections = splitAssessments(assessmentParagraphs);
  if (assessmentSections.length !== rosterRows.length) {
    throw new Error(`Assessment count (${assessmentSections.length}) does not match roster row count (${rosterRows.length}).`);
  }

  const patients: SeedPatient[] = rosterRows.map((row, index) => {
    const assessment = assessmentSections[index];
    const problemListDue = parseDueLabel(row["Problem List"]);
    const treatmentPlanDue = parseDueLabel(row["Treatment Plan"]);
    const intakeDate = problemListDue ? addDaysIso(problemListDue, -7) : treatmentPlanDue ? addDaysIso(treatmentPlanDue, -30) : "";
    const lastVisitDate = intakeDate ? addDaysIso(intakeDate, 5) : "";
    const nextApptDate = intakeDate ? addDaysIso(intakeDate, 12) : "";
    return {
      id: patientSeedId(index, row),
      full_name: row.Patient,
      mrn: normalizeText(row.MRN) || null,
      external_id: `patientbridge-${assessment.code}`,
      date_of_birth: normalizeDate(row.DOB) || null,
      status: normalizeStatus(row.Status),
      location: normalizeText(row.Location) || null,
      intake_date: intakeDate || null,
      last_visit_date: lastVisitDate || null,
      next_appt_date: nextApptDate || null,
      primary_program: normalizeText(row.Program) || null,
      counselor_name: normalizeText(row.Counselor) || null,
      flags: parseFlags(row.Flags),
      roster_drug_of_choice: splitDocOfChoice(row.DOC),
      workbook_row: row,
      assessment,
    };
  });

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("begin");
    for (const patient of patients) {
      await client.query(
        `insert into public.patients (
          id, full_name, mrn, external_id, date_of_birth, status, location,
          intake_date, last_visit_date, next_appt_date, primary_program, counselor_name, flags
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict (id) do update set
          full_name = excluded.full_name,
          mrn = excluded.mrn,
          external_id = excluded.external_id,
          date_of_birth = excluded.date_of_birth,
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
          patient.id,
          patient.full_name,
          patient.mrn,
          patient.external_id,
          patient.date_of_birth,
          patient.status,
          patient.location,
          patient.intake_date,
          patient.last_visit_date,
          patient.next_appt_date,
          patient.primary_program,
          patient.counselor_name,
          patient.flags,
        ]
      );

      await client.query(
        `insert into public.patient_roster_details (patient_id, drug_of_choice, updated_by)
         values ($1, $2, null)
         on conflict (patient_id) do update set
           drug_of_choice = excluded.drug_of_choice,
           updated_at = timezone('utc', now())`,
        [patient.id, patient.roster_drug_of_choice]
      );
    }
    const workbookPayload = {
      name: "patientbridge-live-roster-3-DOC-fixed",
      original_file_name: path.basename(defaultRosterPath),
      apply_patient_field_updates: false,
      tabs: [
        {
          tab_name: "Roster",
          columns: [
            { column_name: "Patient", mapped_patient_field: "full_name", column_type: "text", sort_order: 0 },
            { column_name: "MRN", mapped_patient_field: "mrn", column_type: "text", sort_order: 1 },
            { column_name: "DOB", mapped_patient_field: "date_of_birth", column_type: "date", sort_order: 2 },
            { column_name: "Status", mapped_patient_field: "status", column_type: "text", sort_order: 3 },
            { column_name: "Counselor", mapped_patient_field: "counselor_name", column_type: "text", sort_order: 4 },
            { column_name: "Location", mapped_patient_field: "location", column_type: "text", sort_order: 5 },
            { column_name: "Program", mapped_patient_field: "primary_program", column_type: "text", sort_order: 6 },
            { column_name: "DOC", mapped_patient_field: "drug_of_choice", column_type: "text", sort_order: 7 },
            { column_name: "Last Visit", mapped_patient_field: "last_visit_date", column_type: "date", sort_order: 8 },
            { column_name: "Next Appt", mapped_patient_field: "next_appt_date", column_type: "date", sort_order: 9 },
            { column_name: "Problem List", column_type: "text", sort_order: 10 },
            { column_name: "Treatment Plan", column_type: "text", sort_order: 11 },
            { column_name: "Reauth SAPC", column_type: "text", sort_order: 12 },
            { column_name: "Notes", column_type: "text", sort_order: 13 },
            { column_name: "Flags", column_type: "text", sort_order: 14 },
            { column_name: "Compliance Snapshot", column_type: "text", sort_order: 15 },
            { column_name: "Assessment Document", column_type: "text", sort_order: 16 },
          ],
          rows: patients.map((patient, index) => ({
            id: patient.id,
            row_order: index,
            linked_patient_id: patient.id,
            values: {
              Patient: patient.full_name,
              MRN: patient.mrn ?? "",
              DOB: patient.date_of_birth ?? "",
              Status: patient.workbook_row.Status,
              Counselor: patient.counselor_name ?? "",
              Location: patient.location ?? "",
              Program: patient.primary_program ?? "",
              DOC: patient.workbook_row.DOC,
              "Last Visit": patient.last_visit_date ?? "",
              "Next Appt": patient.next_appt_date ?? "",
              "Problem List": patient.workbook_row["Problem List"],
              "Treatment Plan": patient.workbook_row["Treatment Plan"],
              "Reauth SAPC": patient.workbook_row["Reauth SAPC"],
              Notes: patient.workbook_row.Notes,
              Flags: patient.workbook_row.Flags,
              "Compliance Snapshot": patient.workbook_row["Compliance Snapshot"],
              "Assessment Document": patient.workbook_row["Assessment Document"],
            },
          })),
        },
      ],
    };
    const workbookId = workbookSeedId(workbookPayload.original_file_name);
    const existingWorkbook = await client.query(`select id from public.admin_workbooks where id = $1`, [workbookId]);
    if (existingWorkbook.rows[0]) {
      await client.query(
        `update public.admin_workbooks
            set name = $2,
                original_file_name = $3,
                updated_at = timezone('utc', now())
          where id = $1`,
        [workbookId, workbookPayload.name, workbookPayload.original_file_name]
      );
      await client.query(`delete from public.admin_sheets where workbook_id = $1`, [workbookId]);
    } else {
      await client.query(
        `insert into public.admin_workbooks (id, name, original_file_name)
         values ($1, $2, $3)`,
        [workbookId, workbookPayload.name, workbookPayload.original_file_name]
      );
    }

    for (const tab of workbookPayload.tabs) {
      const sheetId = uuidFromSeed(`patientbridge-sheet:${workbookId}:${tab.tab_name}`);
      await client.query(
        `insert into public.admin_sheets (id, workbook_id, name, tab_name, original_file_name, source_sheet_name)
         values ($1, $2, $3, $4, $5, $6)`,
        [sheetId, workbookId, tab.tab_name, tab.tab_name, workbookPayload.original_file_name, tab.tab_name]
      );

      const columnIds = new Map<string, string>();
      for (const column of tab.columns) {
        const columnId = uuidFromSeed(`patientbridge-column:${sheetId}:${column.sort_order}:${column.column_name}`);
        columnIds.set(column.column_name, columnId);
        await client.query(
          `insert into public.admin_sheet_columns (id, sheet_id, column_name, mapped_patient_field, column_type, sort_order)
           values ($1, $2, $3, $4, $5, $6)`,
          [columnId, sheetId, column.column_name, column.mapped_patient_field ?? null, column.column_type ?? null, column.sort_order]
        );
      }

      for (const row of tab.rows) {
        const rowId = row.id ?? uuidFromSeed(`patientbridge-row:${sheetId}:${row.row_order}:${row.linked_patient_id ?? "unlinked"}`);
        await client.query(
          `insert into public.admin_sheet_rows (id, sheet_id, linked_patient_id, row_order)
           values ($1, $2, $3, $4)`,
          [rowId, sheetId, row.linked_patient_id ?? null, row.row_order]
        );

        for (const column of tab.columns) {
          const columnId = columnIds.get(column.column_name);
          if (!columnId) continue;
          await client.query(
            `insert into public.admin_sheet_cell_values (id, row_id, column_id, value)
             values ($1, $2, $3, $4)`,
            [uuidFromSeed(`patientbridge-cell:${rowId}:${columnId}`), rowId, columnId, row.values[column.column_name] ?? null]
          );
        }
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  const token = await getAccessToken();

  for (const patient of patients) {
    await apiJson(`/api/patients/${patient.id}/vault/paste-text`, token, {
      method: "POST",
      body: JSON.stringify({
        documentType: "assessment",
        fileName: `${patient.assessment.code} - ${patient.full_name}.txt`,
        text: patient.assessment.text,
      }),
    });
  }

  console.log(`Seeded ${patients.length} PatientBridge demo patients from ${path.relative(repoRoot, defaultRosterPath)}`);
  console.log(`Uploaded ${patients.length} assessment vault documents to ${apiBaseUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
