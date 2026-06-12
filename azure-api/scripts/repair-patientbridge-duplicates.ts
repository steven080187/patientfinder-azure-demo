import { Client } from "pg";

type PatientRow = {
  id: string;
  full_name: string | null;
  mrn: string | null;
  external_id: string | null;
  date_of_birth: string | null;
  status: string | null;
  location: string | null;
  intake_date: string | null;
  last_visit_date: string | null;
  next_appt_date: string | null;
  primary_program: string | null;
  counselor_name: string | null;
  flags: string[] | null;
  created_at: string;
  updated_at: string;
};

type RosterDetailsRow = {
  patient_id: string;
  drug_of_choice: string[] | null;
};

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL is required.");
}

function makeNameKey(fullName: string | null) {
  return String(fullName ?? "").trim().toLowerCase();
}

function sortByCreatedAtThenId(a: { created_at: string; id: string }, b: { created_at: string; id: string }) {
  const aTime = Date.parse(a.created_at);
  const bTime = Date.parse(b.created_at);
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}

async function main() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const patientRows = await client.query<PatientRow>(
      `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date,
              next_appt_date, primary_program, counselor_name, flags, created_at, updated_at
         from public.patients`
    );
    const rosterRows = await client.query<RosterDetailsRow>(
      `select patient_id, drug_of_choice
         from public.patient_roster_details`
    );
    const rosterByPatientId = new Map(rosterRows.rows.map((row) => [row.patient_id, row]));

    const originalsByKey = new Map<string, PatientRow[]>();
    const importsByKey = new Map<string, PatientRow[]>();

    for (const row of patientRows.rows) {
      const key = makeNameKey(row.full_name);
      const target = row.external_id?.startsWith("patientbridge-") ? importsByKey : originalsByKey;
      const list = target.get(key) ?? [];
      list.push(row);
      target.set(key, list);
    }

    const mappings: Array<{ imported: PatientRow; original: PatientRow }> = [];
    const skippedKeys: string[] = [];

    for (const [key, importedRows] of importsByKey.entries()) {
      const originalRows = (originalsByKey.get(key) ?? []).sort(sortByCreatedAtThenId);
      const orderedImports = [...importedRows].sort(sortByCreatedAtThenId);
      if (originalRows.length !== orderedImports.length) {
        skippedKeys.push(`${key} (${originalRows.length} originals, ${orderedImports.length} imports)`);
        continue;
      }
      for (let index = 0; index < orderedImports.length; index += 1) {
        const imported = orderedImports[index];
        const original = originalRows[index];
        if (!imported || !original) continue;
        mappings.push({ imported, original });
      }
    }

    if (skippedKeys.length) {
      throw new Error(`PatientBridge duplicate groups did not match one-to-one: ${skippedKeys.join("; ")}`);
    }

    await client.query("begin");
    try {
      for (const { imported, original } of mappings) {
        await client.query(
          `update public.patients
              set full_name = $2,
                  mrn = $3,
                  date_of_birth = $4,
                  status = $5,
                  location = $6,
                  intake_date = $7,
                  last_visit_date = $8,
                  next_appt_date = $9,
                  primary_program = $10,
                  counselor_name = $11,
                  flags = $12,
                  updated_at = timezone('utc', now())
            where id = $1`,
          [
            original.id,
            imported.full_name,
            imported.mrn,
            imported.date_of_birth,
            imported.status,
            imported.location,
            imported.intake_date,
            imported.last_visit_date,
            imported.next_appt_date,
            imported.primary_program,
            imported.counselor_name,
            imported.flags,
          ]
        );

        const importedRoster = rosterByPatientId.get(imported.id);
        if (importedRoster?.drug_of_choice) {
          await client.query(
            `insert into public.patient_roster_details (patient_id, drug_of_choice, updated_by)
             values ($1, $2, null)
             on conflict (patient_id) do update set
               drug_of_choice = excluded.drug_of_choice,
               updated_at = timezone('utc', now())`,
            [original.id, importedRoster.drug_of_choice]
          );
        }

        await client.query(
          `update public.patient_documents
              set patient_id = $2
            where patient_id = $1`,
          [imported.id, original.id]
        );

        await client.query(
          `update public.admin_sheet_rows
              set linked_patient_id = $2
            where linked_patient_id = $1`,
          [imported.id, original.id]
        );
      }

      const importedIds = mappings.map((mapping) => mapping.imported.id);
      if (importedIds.length) {
        await client.query(`delete from public.patients where id = any($1::uuid[])`, [importedIds]);
      }

      await client.query("commit");
      console.log(`Merged ${mappings.length} PatientBridge duplicate patients into originals.`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
