create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'patient_status'
  ) then
    create type public.patient_status as enum ('new', 'active', 'past');
  end if;
end
$$;

alter type public.patient_status add value if not exists 'current';
alter type public.patient_status add value if not exists 'rss_plus';
alter type public.patient_status add value if not exists 'rss';
alter type public.patient_status add value if not exists 'former';

create table if not exists public.patients (
  id uuid primary key,
  full_name text,
  mrn text,
  external_id text,
  date_of_birth date,
  status public.patient_status not null default 'new',
  location text,
  intake_date date,
  last_visit_date date,
  next_appt_date date,
  primary_program text,
  counselor_name text,
  flags text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.patients
  add column if not exists date_of_birth date;

create index if not exists patients_full_name_idx on public.patients(full_name);
create index if not exists patients_status_idx on public.patients(status);
create index if not exists patients_intake_date_idx on public.patients(intake_date);
create index if not exists patients_last_visit_date_idx on public.patients(last_visit_date);
create index if not exists patients_updated_at_idx on public.patients(updated_at);

drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

create table if not exists public.patient_case_assignments (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  counselor_user_id uuid not null,
  counselor_email text,
  assigned_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists patient_case_assignments_counselor_user_id_idx on public.patient_case_assignments(counselor_user_id);
create index if not exists patient_case_assignments_counselor_email_idx on public.patient_case_assignments(counselor_email);

create table if not exists public.patient_compliance (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  drug_test_mode text not null default 'none' check (drug_test_mode in ('none', 'weekly_count', 'weekday')),
  drug_tests_per_week integer check (drug_tests_per_week is null or drug_tests_per_week > 0),
  drug_test_weekday integer check (drug_test_weekday is null or drug_test_weekday between 0 and 6),
  problem_list_date date,
  last_problem_list_review date,
  last_problem_list_update date,
  treatment_plan_date date,
  treatment_plan_update date,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_drug_tests (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  date date not null,
  test_type text not null,
  result text not null check (result in ('Negative', 'Positive', 'Inconclusive')),
  substances text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('Group', 'Individual')),
  title text not null,
  date date not null,
  duration_hours numeric(6,2) not null default 1.0,
  location text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.attendance_session_patients (
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  status text not null default 'Present' check (status in ('Present', 'Absent', 'Excused')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, patient_id)
);

create table if not exists public.patient_roster_details (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  drug_of_choice text[],
  medical_phys_apt text check (medical_phys_apt in ('Needed', 'Scheduled', 'Completed')),
  med_form_status text check (med_form_status in ('Pending', 'Turned in', 'Not needed')),
  notes text,
  referring_agency text check (referring_agency in ('Self', 'DCFS', 'Court', 'Other')),
  reauth_sapc_date date,
  medical_eligibility text check (medical_eligibility in ('Yes', 'No', 'Pending')),
  mat_status text check (mat_status in ('Yes', 'No')),
  therapy_track text check (therapy_track in ('Sandy', 'Becky')),
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.in_app_notifications (
  id uuid primary key,
  thread_id uuid not null,
  parent_notification_id uuid,
  recipient_user_id uuid,
  recipient_email text,
  sender_user_id uuid,
  sender_email text,
  patient_id uuid references public.patients(id) on delete set null,
  title text not null,
  message text not null,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists in_app_notifications_created_at_idx on public.in_app_notifications(created_at desc);
create index if not exists in_app_notifications_recipient_email_idx on public.in_app_notifications(recipient_email);
create index if not exists in_app_notifications_recipient_user_id_idx on public.in_app_notifications(recipient_user_id);
create index if not exists in_app_notifications_thread_id_idx on public.in_app_notifications(thread_id);

create table if not exists public.group_signin_sessions (
  id uuid primary key,
  attendance_session_id uuid unique references public.attendance_sessions(id) on delete cascade,
  counselor_user_id uuid,
  counselor_email text,
  counselor_name text not null,
  location text,
  group_date date not null,
  start_time time not null,
  end_time time,
  topic text not null,
  pdf_storage_path text,
  pdf_original_filename text,
  pdf_uploaded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.group_signin_sessions
  add column if not exists pdf_storage_path text;

alter table if exists public.group_signin_sessions
  add column if not exists pdf_original_filename text;

alter table if exists public.group_signin_sessions
  add column if not exists pdf_uploaded_at timestamptz;

create table if not exists public.group_signin_entries (
  id uuid primary key,
  session_id uuid not null references public.group_signin_sessions(id) on delete cascade,
  attendance_session_id uuid references public.attendance_sessions(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  participant_name text not null,
  sage_number text,
  signature_payload text,
  signed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_billing_entries (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id uuid references public.attendance_sessions(id) on delete cascade,
  billing_type text not null check (
    billing_type in (
      'CalOMS Discharge',
      'CalOms Completion',
      'Care Coordination',
      'Crisis',
      'Naloxone',
      'MAT ED',
      'Co Triage',
      'Same Day Screening',
      'Assessment',
      'Intake',
      'Problem List',
      'Problem List Review',
      'Problem List Update',
      'Treatment Plan',
      'Treatment Plan Update',
      'Individual'
    )
  ),
  service_date date not null,
  start_time text,
  end_time text,
  total_minutes integer not null check (total_minutes > 0),
  modality text check (modality in ('FF', 'Z', 'Z(O)', 'T', 'NA')),
  naloxone_training boolean not null default false,
  mat_education boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.intake_submissions (
  id uuid primary key,
  patient_id uuid references public.patients(id) on delete cascade,
  submission_id uuid,
  status text not null default 'received',
  raw_json_path text,
  pdf_path text,
  raw_json jsonb,
  submitted_full_name text,
  submitted_dob text,
  submitted_phone text,
  submitted_email text,
  submitted_location text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_documents (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type text not null,
  original_filename text not null,
  content_type text not null default 'application/pdf',
  byte_size bigint not null check (byte_size > 0),
  sha256 text,
  storage_provider text not null default 'azure_blob',
  storage_container text not null,
  storage_blob_path text not null,
  storage_url text,
  uploaded_by_user_id uuid,
  uploaded_by_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists patient_documents_patient_id_created_at_idx
  on public.patient_documents(patient_id, created_at desc);

create index if not exists patient_documents_storage_blob_path_idx
  on public.patient_documents(storage_blob_path);

drop trigger if exists patient_documents_set_updated_at on public.patient_documents;
create trigger patient_documents_set_updated_at
before update on public.patient_documents
for each row execute function public.set_updated_at();

create table if not exists public.patient_bridge_workbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  original_file_name text not null,
  storage_mode text not null default 'demo',
  graph_site_id text,
  graph_drive_id text,
  graph_item_id text,
  graph_path text,
  graph_web_url text,
  graph_embed_url text,
  file_size_bytes bigint,
  uploaded_by_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists patient_bridge_workbooks_created_at_idx
  on public.patient_bridge_workbooks(created_at desc);

create table if not exists public.patient_bridge_workbook_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid references public.patient_bridge_workbooks(id) on delete cascade,
  action text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_email text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists patient_bridge_workbook_audit_logs_workbook_id_created_at_idx
  on public.patient_bridge_workbook_audit_logs(workbook_id, created_at desc);

drop trigger if exists patient_bridge_workbooks_set_updated_at on public.patient_bridge_workbooks;
create trigger patient_bridge_workbooks_set_updated_at
before update on public.patient_bridge_workbooks
for each row execute function public.set_updated_at();

create table if not exists public.admin_workbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  original_file_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_sheets (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid references public.admin_workbooks(id) on delete cascade,
  name text not null,
  tab_name text not null default 'Sheet1',
  original_file_name text not null,
  source_sheet_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.admin_sheets
  add column if not exists workbook_id uuid references public.admin_workbooks(id) on delete cascade;

alter table if exists public.admin_sheets
  add column if not exists tab_name text not null default 'Sheet1';

create index if not exists admin_sheets_workbook_id_idx
  on public.admin_sheets(workbook_id);

create table if not exists public.admin_sheet_columns (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.admin_sheets(id) on delete cascade,
  column_name text not null,
  mapped_patient_field text,
  column_type text,
  sort_order integer not null
);

create index if not exists admin_sheet_columns_sheet_id_sort_order_idx
  on public.admin_sheet_columns(sheet_id, sort_order);

create table if not exists public.admin_sheet_rows (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.admin_sheets(id) on delete cascade,
  linked_patient_id uuid references public.patients(id) on delete set null,
  row_order integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_sheet_rows_sheet_id_row_order_idx
  on public.admin_sheet_rows(sheet_id, row_order);

create index if not exists admin_sheet_rows_linked_patient_id_idx
  on public.admin_sheet_rows(linked_patient_id);

create table if not exists public.admin_sheet_cell_values (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.admin_sheet_rows(id) on delete cascade,
  column_id uuid not null references public.admin_sheet_columns(id) on delete cascade,
  value text
);

create unique index if not exists admin_sheet_cell_values_row_column_idx
  on public.admin_sheet_cell_values(row_id, column_id);

drop trigger if exists admin_sheets_set_updated_at on public.admin_sheets;
create trigger admin_sheets_set_updated_at
before update on public.admin_sheets
for each row execute function public.set_updated_at();

drop trigger if exists admin_sheet_rows_set_updated_at on public.admin_sheet_rows;
create trigger admin_sheet_rows_set_updated_at
before update on public.admin_sheet_rows
for each row execute function public.set_updated_at();
