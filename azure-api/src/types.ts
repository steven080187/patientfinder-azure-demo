export type PatientRow = {
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

export type PatientRosterDetailsRow = {
  patient_id: string;
  drug_of_choice: string[] | null;
  medical_phys_apt: string | null;
  med_form_status: string | null;
  notes: string | null;
  referring_agency: string | null;
  reauth_sapc_date: string | null;
  medical_eligibility: string | null;
  mat_status: string | null;
  therapy_track: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientComplianceRow = {
  patient_id: string;
  drug_test_mode: string | null;
  drug_tests_per_week: number | null;
  drug_test_weekday: number | null;
  problem_list_date: string | null;
  last_problem_list_review: string | null;
  last_problem_list_update: string | null;
  treatment_plan_date: string | null;
  treatment_plan_update: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientDrugTestRow = {
  id: string;
  patient_id: string;
  date: string;
  test_type: string;
  result: string;
  substances: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientAggregateRow = PatientRow & {
  roster_details: PatientRosterDetailsRow | null;
  compliance: PatientComplianceRow | null;
  drug_tests: PatientDrugTestRow[];
  latest_intake_submission: IntakeSubmissionRow | null;
};

export type AdminSheetRow = {
  id: string;
  name: string;
  original_file_name: string;
  source_sheet_name: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminWorkbookRow = {
  id: string;
  name: string;
  original_file_name: string;
  created_at: string;
  updated_at: string;
};

export type AdminSheetColumnRow = {
  id: string;
  sheet_id: string;
  column_name: string;
  mapped_patient_field: string | null;
  column_type: string | null;
  sort_order: number;
};

export type AdminSheetDataRow = {
  id: string;
  sheet_id: string;
  linked_patient_id: string | null;
  row_order: number;
  created_at: string;
  updated_at: string;
};

export type AdminSheetCellValueRow = {
  id: string;
  row_id: string;
  column_id: string;
  value: string | null;
};

export type IntakeSubmissionRow = {
  id: string;
  patient_id: string | null;
  submission_id: string | null;
  status: string;
  raw_json: unknown;
  raw_json_path: string | null;
  pdf_path: string | null;
  submitted_full_name: string | null;
  submitted_dob: string | null;
  submitted_phone: string | null;
  submitted_email: string | null;
  submitted_location: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupSessionRow = {
  id: string;
  attendance_session_id: string | null;
  counselor_user_id: string | null;
  counselor_email: string | null;
  counselor_name: string;
  location: string | null;
  group_date: string;
  start_time: string;
  end_time: string | null;
  topic: string;
  pdf_storage_path: string | null;
  pdf_original_filename: string | null;
  pdf_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientDocumentRow = {
  id: string;
  patient_id: string;
  document_type: string;
  original_filename: string;
  content_type: string;
  byte_size: string;
  sha256: string | null;
  storage_provider: string;
  storage_container: string;
  storage_blob_path: string;
  storage_url: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_email: string | null;
  created_at: string;
  updated_at: string;
};
