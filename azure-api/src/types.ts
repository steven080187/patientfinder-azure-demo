export type PatientRow = {
  id: string;
  full_name: string | null;
  mrn: string | null;
  external_id: string | null;
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
