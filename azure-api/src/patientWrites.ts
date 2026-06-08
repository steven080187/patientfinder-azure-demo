import type { QueryResultRow } from "pg";
import type { PatientComplianceRow, PatientRosterDetailsRow, PatientRow } from "./types.js";

export type QueryRunner = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
};

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null | undefined)?.rows ?? []) as T[];
}

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
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

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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

function normalizeDrugTestMode(value: unknown) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return null;
  if (["none", "n/a", "na", "off", "no"].includes(text)) return "none";
  if (["weekly", "weekly count", "weekly_count"].includes(text)) return "weekly_count";
  if (["weekday", "day of week"].includes(text)) return "weekday";
  return null;
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

export function extractPatientSubstances(rawJson: unknown) {
  const substances = (rawJson as { sections?: { intake?: { multi?: { substances?: unknown } } } } | null | undefined)?.sections?.intake?.multi?.substances;
  if (!Array.isArray(substances)) return null;
  const values = substances.map((value) => String(value).trim()).filter(Boolean);
  return values.length ? values : null;
}

export function extractPatientPrimaryProgram(rawJson: unknown) {
  const intake = (rawJson as {
    sections?: {
      intake?: {
        fields?: Record<string, unknown>;
        radios?: Record<string, unknown>;
      };
    };
  } | null | undefined)?.sections?.intake;
  const root = (rawJson as Record<string, unknown> | null | undefined) ?? {};
  const fields = intake?.fields ?? {};
  const radios = intake?.radios ?? {};
  const value = normalizeText(
    fields.primary_program ??
      fields.primaryProgram ??
      fields.program ??
      fields.level_of_care ??
      fields.levelOfCare ??
      radios.primary_program ??
      radios.primaryProgram ??
      radios.program ??
      radios.level_of_care ??
      radios.levelOfCare ??
      root.primary_program ??
      root.primaryProgram ??
      root.program ??
      root.level_of_care ??
      root.levelOfCare
  );
  return value;
}

export async function upsertPatientRosterDrugOfChoice(
  runner: QueryRunner,
  patientId: string,
  drugOfChoice: string[]
) {
  if (!drugOfChoice.length) return null;

  const result = await runner.query(
    `insert into public.patient_roster_details (patient_id, drug_of_choice, updated_by)
     values ($1, $2, null)
     on conflict (patient_id) do update
       set drug_of_choice = excluded.drug_of_choice,
           updated_at = timezone('utc', now())
     where coalesce(cardinality(public.patient_roster_details.drug_of_choice), 0) = 0`,
    [patientId, drugOfChoice]
  );
  return getRows(result)[0] ?? null;
}

export async function seedPatientRosterDrugOfChoiceFromRawJson(
  runner: QueryRunner,
  patientId: string,
  rawJson: unknown
) {
  const substances = extractPatientSubstances(rawJson);
  if (!substances) return null;
  return upsertPatientRosterDrugOfChoice(runner, patientId, substances);
}

export async function seedPatientPrimaryProgramFromRawJson(
  runner: QueryRunner,
  patientId: string,
  rawJson: unknown
) {
  const primaryProgram = extractPatientPrimaryProgram(rawJson);
  if (!primaryProgram) return null;
  return upsertPatientCore(runner, patientId, { primary_program: primaryProgram });
}

export async function patchLatestIntakeJsonFromPatient(
  runner: QueryRunner,
  patientId: string,
  patch: {
    fullName?: string | null;
    dob?: string | null;
    location?: string | null;
    status?: string | null;
    primaryProgram?: string | null;
    counselorName?: string | null;
    substances?: string[] | null;
    referringAgency?: string | null;
    medicalEligibility?: string | null;
    matStatus?: string | null;
    therapyTrack?: string | null;
    medicalPhysApt?: string | null;
    medFormStatus?: string | null;
    notes?: string | null;
  }
) {
  const result = await runner.query<{ id: string; raw_json: unknown }>(
    `select id, raw_json
       from public.intake_submissions
      where patient_id = $1
      order by created_at desc
      limit 1`,
    [patientId]
  );
  const rows = getRows<{ id: string; raw_json: unknown }>(result);
  const latest = rows[0];
  if (!latest) return;

  const raw = (latest.raw_json ?? {}) as Record<string, any>;
  const sections = { ...(raw.sections ?? {}) };
  const intake = { ...(sections.intake ?? {}) };
  const fields = { ...(intake.fields ?? {}) };
  const radios = { ...(intake.radios ?? {}) };
  const multi = { ...(intake.multi ?? {}) };

  if (patch.fullName != null) fields["s5::Full legal name"] = patch.fullName ?? "";
  if (patch.dob != null) fields["s5::Date of birth"] = patch.dob ?? "";
  if (patch.location != null) radios.location = patch.location ?? "";
  if (patch.status != null) radios.patient_status = patch.status ?? "";
  if (patch.primaryProgram != null) radios.primary_program = patch.primaryProgram ?? "";
  if (patch.counselorName != null) fields["s5::Counselor"] = patch.counselorName ?? "";
  if (patch.substances != null) multi.substances = patch.substances ?? [];
  if (patch.referringAgency != null) radios.referring_agency = patch.referringAgency ?? "";
  if (patch.medicalEligibility != null) radios.medical_eligibility = patch.medicalEligibility ?? "";
  if (patch.matStatus != null) radios.mat = patch.matStatus ?? "";
  if (patch.therapyTrack != null) radios.therapy_track = patch.therapyTrack ?? "";
  if (patch.medicalPhysApt != null) radios.medical_phys_apt = patch.medicalPhysApt ?? "";
  if (patch.medFormStatus != null) radios.med_form_status = patch.medFormStatus ?? "";
  if (patch.notes != null) fields["s5::Notes"] = patch.notes ?? "";

  const nextRaw = {
    ...raw,
    sections: {
      ...sections,
      intake: {
        ...intake,
        fields,
        radios,
        multi,
      },
    },
  };

  await runner.query(
    `update public.intake_submissions
        set raw_json = $2,
            updated_at = timezone('utc', now())
      where id = $1`,
    [latest.id, nextRaw]
  );
}

export async function resetProblemListForLevelOfCareChange(
  runner: QueryRunner,
  patientId: string,
  updatedBy: string | null
) {
  const result = await runner.query<PatientComplianceRow>(
    `select *
       from public.patient_compliance
      where patient_id = $1
      limit 1`,
    [patientId]
  );
  const rows = getRows<PatientComplianceRow>(result);
  const current = rows[0];
  if (!current) return null;

  return upsertPatientCompliance(
    runner,
    patientId,
    {
      drug_test_mode: current.drug_test_mode,
      drug_tests_per_week: current.drug_tests_per_week ?? null,
      drug_test_weekday: current.drug_test_weekday ?? null,
      problem_list_date: null,
      last_problem_list_review: null,
      last_problem_list_update: null,
      treatment_plan_date: current.treatment_plan_date,
      treatment_plan_update: current.treatment_plan_update,
    },
    updatedBy
  );
}

export async function upsertPatientCore(
  runner: QueryRunner,
  patientId: string,
  patch: Partial<PatientRow> & { status?: string | null }
) {
  const result = await runner.query<PatientRow>(
    `insert into public.patients (
        id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
        primary_program, counselor_name, flags
      ) values ($1,$2,$3,$4,$5, coalesce($6, (select status from public.patients where id = $1), 'new'), $7,$8,$9,$10,$11,$12,$13)
      on conflict (id) do update
        set full_name = coalesce(excluded.full_name, public.patients.full_name),
            mrn = coalesce(excluded.mrn, public.patients.mrn),
            external_id = coalesce(excluded.external_id, public.patients.external_id),
            date_of_birth = coalesce(excluded.date_of_birth, public.patients.date_of_birth),
            status = coalesce(excluded.status, public.patients.status),
            location = coalesce(excluded.location, public.patients.location),
            intake_date = coalesce(excluded.intake_date, public.patients.intake_date),
            last_visit_date = coalesce(excluded.last_visit_date, public.patients.last_visit_date),
            next_appt_date = coalesce(excluded.next_appt_date, public.patients.next_appt_date),
            primary_program = coalesce(excluded.primary_program, public.patients.primary_program),
            counselor_name = coalesce(excluded.counselor_name, public.patients.counselor_name),
            flags = case
              when cardinality(excluded.flags) > 0 then excluded.flags
              else public.patients.flags
            end,
            updated_at = timezone('utc', now())
        returning id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
                primary_program, counselor_name, flags, created_at, updated_at`,
    [
      patientId,
      patch.full_name ?? null,
      patch.mrn ?? null,
      patch.external_id ?? null,
      patch.date_of_birth ?? null,
      patch.status == null ? null : normalizeStatus(patch.status) ?? patch.status,
      patch.location ?? null,
      patch.intake_date ?? null,
      patch.last_visit_date ?? null,
      patch.next_appt_date ?? null,
      patch.primary_program ?? null,
      patch.counselor_name ?? null,
      patch.flags ?? [],
    ]
  );
  const rows = getRows<PatientRow>(result);
  return rows[0] ?? null;
}

export async function deletePatientById(runner: QueryRunner, patientId: string) {
  const result = await runner.query<{ id: string }>(
    `delete from public.patients where id = $1 returning id`,
    [patientId]
  );
  const rows = getRows<{ id: string }>(result);
  return rows[0] ?? null;
}

export async function upsertPatientCompliance(
  runner: QueryRunner,
  patientId: string,
  patch: Partial<PatientComplianceRow>,
  updatedBy: string | null
) {
  const result = await runner.query<PatientComplianceRow>(
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
      patientId,
      normalizeDrugTestMode(patch.drug_test_mode),
      patch.drug_tests_per_week ?? null,
      patch.drug_test_weekday ?? null,
      normalizeDate(patch.problem_list_date),
      normalizeDate(patch.last_problem_list_review),
      normalizeDate(patch.last_problem_list_update),
      normalizeDate(patch.treatment_plan_date),
      normalizeDate(patch.treatment_plan_update),
      updatedBy,
    ]
  );
  const rows = getRows<PatientComplianceRow>(result);
  return rows[0] ?? null;
}

export async function upsertPatientRosterDetails(
  runner: QueryRunner,
  patientId: string,
  patch: Partial<PatientRosterDetailsRow>,
  updatedBy: string | null
) {
  const result = await runner.query<PatientRosterDetailsRow>(
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
      patientId,
      patch.drug_of_choice ?? null,
      patch.medical_phys_apt ?? null,
      patch.med_form_status ?? null,
      patch.notes ?? null,
      patch.referring_agency ?? null,
      patch.reauth_sapc_date ?? null,
      patch.medical_eligibility ?? null,
      patch.mat_status ?? null,
      patch.therapy_track ?? null,
      updatedBy,
    ]
  );
  const rows = getRows<PatientRosterDetailsRow>(result);
  return rows[0] ?? null;
}

export function normalizePatientCoreStatus(value: unknown) {
  return normalizeStatus(value);
}

export function normalizePatientCoreDate(value: unknown) {
  return normalizeDate(value);
}

export function normalizePatientCoreTextArray(value: unknown) {
  return normalizeTextArray(value);
}

export function normalizePatientCoreWeekday(value: unknown) {
  return normalizeWeekdayValue(value);
}
