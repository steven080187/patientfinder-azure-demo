import { query } from "./db.js";
import type {
  IntakeSubmissionRow,
  PatientAggregateRow,
  PatientComplianceRow,
  PatientDrugTestRow,
  PatientRosterDetailsRow,
  PatientRow,
} from "./types.js";

function normalizePatientId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function loadPatientAggregates(includePatients = true) {
  const [patients, complianceRows, rosterRows, drugTestRows, intakeRows] = await Promise.all([
    includePatients
      ? query<PatientRow>(
          `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
                  primary_program, counselor_name, flags, created_at, updated_at
             from public.patients
            order by full_name asc nulls last`
        )
      : Promise.resolve([] as PatientRow[]),
    query<PatientComplianceRow>(`select * from public.patient_compliance`),
    query<PatientRosterDetailsRow>(`select * from public.patient_roster_details`),
    query<PatientDrugTestRow>(`select * from public.patient_drug_tests order by date desc, created_at desc`),
    query<IntakeSubmissionRow>(
      `select distinct on (patient_id)
              id, patient_id, submission_id, status, raw_json, raw_json_path, pdf_path,
              submitted_full_name, submitted_dob, submitted_phone, submitted_email, submitted_location,
              created_at, updated_at
         from public.intake_submissions
        where patient_id is not null
        order by patient_id, created_at desc`
    ),
  ]);

  const complianceByPatient = new Map<string, PatientComplianceRow>();
  complianceRows.forEach((row) => {
    complianceByPatient.set(normalizePatientId(row.patient_id), row);
  });

  const rosterByPatient = new Map<string, PatientRosterDetailsRow>();
  rosterRows.forEach((row) => {
    rosterByPatient.set(normalizePatientId(row.patient_id), row);
  });

  const intakeByPatient = new Map<string, IntakeSubmissionRow>();
  intakeRows.forEach((row) => {
    if (!row.patient_id) return;
    intakeByPatient.set(normalizePatientId(row.patient_id), row);
  });

  const drugTestsByPatient = new Map<string, PatientDrugTestRow[]>();
  drugTestRows.forEach((row) => {
    const patientId = normalizePatientId(row.patient_id);
    const existing = drugTestsByPatient.get(patientId) ?? [];
    existing.push(row);
    drugTestsByPatient.set(patientId, existing);
  });

  const aggregates: PatientAggregateRow[] = patients.map((patient) => {
    const patientId = normalizePatientId(patient.id);
    return {
      ...patient,
      roster_details: rosterByPatient.get(patientId) ?? null,
      compliance: complianceByPatient.get(patientId) ?? null,
      drug_tests: drugTestsByPatient.get(patientId) ?? [],
      latest_intake_submission: intakeByPatient.get(patientId) ?? null,
    };
  });

  return { aggregates, patients, complianceRows, rosterRows, drugTestRows, intakeRows };
}
