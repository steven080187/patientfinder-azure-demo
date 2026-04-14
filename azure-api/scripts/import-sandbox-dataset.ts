import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultDatasetDir = path.resolve(repoRoot, "..", "exports");

const IMPORT_TABLES = [
  "patients",
  "attendance_sessions",
  "patient_case_assignments",
  "patient_compliance",
  "patient_roster_details",
  "patient_drug_tests",
  "patient_billing_entries",
  "intake_submissions",
  "attendance_session_patients",
  "group_signin_sessions",
  "group_signin_entries",
] as const;

const CONFLICT_TARGETS: Record<string, string> = {
  attendance_session_patients: "(session_id, patient_id)",
  patient_case_assignments: "(patient_id)",
  patient_compliance: "(patient_id)",
  patient_roster_details: "(patient_id)",
};

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function transformRowForTable(
  table: string,
  row: Record<string, unknown>,
  context: { patientIds: Set<string> }
) {
  if (table === "group_signin_entries") {
    const patientId = row.patient_id;
    if (typeof patientId === "string" && !context.patientIds.has(patientId)) {
      return {
        ...row,
        patient_id: null,
      };
    }
  }

  return row;
}

async function findNewestDatasetFile(dirPath: string) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("sandbox-dataset-") && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();

  return candidates.at(-1) ?? null;
}

async function resolveDatasetPath() {
  const explicitPath = process.argv[2];
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return findNewestDatasetFile(defaultDatasetDir);
}

async function getTableColumns(client: PoolClient, table: string) {
  const result = await client.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function upsertRows(
  client: PoolClient,
  table: string,
  rows: Record<string, unknown>[],
  context: { patientIds: Set<string> }
) {
  if (rows.length === 0) {
    return 0;
  }

  const allowedColumns = await getTableColumns(client, table);
  const columns = Object.keys(rows[0]).filter((column) => allowedColumns.has(column));

  if (columns.length === 0) {
    throw new Error(`Table ${table} does not appear to exist or has no matching import columns.`);
  }

  const columnList = columns.map(quoteIdentifier).join(", ");
  const conflictTarget = CONFLICT_TARGETS[table] ?? "(id)";

  for (const sourceRow of rows) {
    const row = transformRowForTable(table, sourceRow, context);
    const values = columns.map((column) => normalizeValue(row[column]));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const updateAssignments = columns
      .filter((column) => !["id", "session_id", "patient_id", "created_at"].includes(column))
      .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
      .join(", ");

    const sql = updateAssignments
      ? `insert into public.${quoteIdentifier(table)} (${columnList})
         values (${placeholders})
         on conflict ${conflictTarget} do update
         set ${updateAssignments}`
      : `insert into public.${quoteIdentifier(table)} (${columnList})
         values (${placeholders})
         on conflict ${conflictTarget} do nothing`;

    await client.query(sql, values);
  }

  return rows.length;
}

async function main() {
  const datasetPath = await resolveDatasetPath();

  if (!datasetPath) {
    throw new Error(`Could not find a sandbox dataset file in ${defaultDatasetDir}`);
  }

  const dataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
  const tableMap = dataset?.tables ?? {};
  const patientIds = new Set(
    Array.isArray(tableMap.patients) ? tableMap.patients.map((row: { id: string }) => row.id) : []
  );

  await withTransaction(async (client) => {
    for (const table of IMPORT_TABLES) {
      const rows = tableMap[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        continue;
      }

      const importedCount = await upsertRows(client, table, rows, { patientIds });
      console.log(`Imported ${importedCount} rows into ${table}`);
    }
  });

  console.log(`Imported sandbox dataset from ${datasetPath}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
