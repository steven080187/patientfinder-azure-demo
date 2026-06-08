export type BackendProvider = "azure-api";

export type DashboardPayload = {
  patients: unknown[];
  patientAggregates: unknown[];
  assignments: unknown[];
  compliance: unknown[];
  drugTests: unknown[];
  sessions: unknown[];
  attendanceSessionPatients: unknown[];
  rosterDetails: unknown[];
  notifications: unknown[];
  billingEntries: unknown[];
};

export type PatientsPagePayload = {
  patients: unknown[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminSheetPatientField =
  | "full_name"
  | "date_of_birth"
  | "mrn"
  | "external_id"
  | "status"
  | "location"
  | "intake_date"
  | "last_visit_date"
  | "next_appt_date"
  | "primary_program"
  | "counselor_name"
  | "drug_of_choice"
  | "medical_phys_apt"
  | "med_form_status"
  | "notes"
  | "referring_agency"
  | "reauth_sapc_date"
  | "medical_eligibility"
  | "mat_status"
  | "therapy_track"
  | "drug_test_mode"
  | "drug_tests_per_week"
  | "drug_test_weekday"
  | "problem_list_date"
  | "last_problem_list_review"
  | "last_problem_list_update"
  | "treatment_plan_date"
  | "treatment_plan_update";

export type AdminSheetSummary = {
  id: string;
  name: string;
  original_file_name: string;
  source_sheet_name?: string | null;
  row_count: number;
  linked_patient_count: number;
  unmatched_row_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminSheetColumn = {
  id: string;
  sheet_id: string;
  column_name: string;
  mapped_patient_field?: AdminSheetPatientField | null;
  column_type?: string | null;
  sort_order: number;
};

export type AdminSheetRow = {
  id: string;
  sheet_id: string;
  linked_patient_id?: string | null;
  linked_patient_name?: string | null;
  row_order: number;
  created_at: string;
  updated_at: string;
  cells: Record<string, string | null>;
};

export type AdminSheetDetail = AdminSheetSummary & {
  columns: AdminSheetColumn[];
  rows: AdminSheetRow[];
};

export type AdminSheetCreateColumnInput = {
  column_name: string;
  mapped_patient_field?: AdminSheetPatientField | null;
  column_type?: string | null;
  sort_order: number;
};

export type AdminSheetCreateRowInput = {
  row_order: number;
  linked_patient_id?: string | null;
  values: Record<string, string | null>;
};

export type AdminSheetCreatePayload = {
  name: string;
  original_file_name: string;
  source_sheet_name?: string | null;
  columns: AdminSheetCreateColumnInput[];
  rows: AdminSheetCreateRowInput[];
  apply_patient_field_updates?: boolean;
};

export type AdminWorkbookPatientField = AdminSheetPatientField;

export type AdminWorkbookSummary = {
  id: string;
  name: string;
  original_file_name: string;
  tab_count: number;
  row_count: number;
  linked_patient_count: number;
  unmatched_row_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminWorkbookColumn = {
  id: string;
  sheet_id: string;
  column_name: string;
  mapped_patient_field?: AdminWorkbookPatientField | null;
  column_type?: string | null;
  sort_order: number;
};

export type AdminWorkbookRow = {
  id: string;
  sheet_id: string;
  linked_patient_id?: string | null;
  linked_patient_name?: string | null;
  row_order: number;
  created_at: string;
  updated_at: string;
  cells: Record<string, string | null>;
};

export type AdminWorkbookTab = {
  id: string;
  workbook_id: string;
  tab_name: string;
  row_count: number;
  linked_patient_count: number;
  unmatched_row_count: number;
  columns: AdminWorkbookColumn[];
  rows: AdminWorkbookRow[];
};

export type AdminWorkbookDetail = AdminWorkbookSummary & {
  tabs: AdminWorkbookTab[];
};

export type AdminWorkbookCreateColumnInput = {
  id?: string;
  column_name: string;
  mapped_patient_field?: AdminWorkbookPatientField | null;
  column_type?: string | null;
  sort_order: number;
};

export type AdminWorkbookCreateRowInput = {
  id?: string;
  row_order: number;
  linked_patient_id?: string | null;
  values: Record<string, string | null>;
};

export type AdminWorkbookCreateTabInput = {
  id?: string;
  tab_name: string;
  columns: AdminWorkbookCreateColumnInput[];
  rows: AdminWorkbookCreateRowInput[];
};

export type AdminWorkbookCreatePayload = {
  name: string;
  original_file_name: string;
  tabs: AdminWorkbookCreateTabInput[];
  apply_patient_field_updates?: boolean;
};

export type AdminWorkbookUpdatePayload = AdminWorkbookCreatePayload;

export type PatientBridgeWorkbookStorageMode = "m365" | "demo";

export type PatientBridgeWorkbookSummary = {
  id: string;
  name: string;
  original_file_name: string;
  storage_mode: PatientBridgeWorkbookStorageMode;
  graph_site_id?: string | null;
  graph_drive_id?: string | null;
  graph_item_id?: string | null;
  graph_path?: string | null;
  graph_web_url?: string | null;
  graph_embed_url?: string | null;
  file_size_bytes?: number | null;
  uploaded_by_email?: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientBridgeWorkbookAuditEntry = {
  id: string;
  workbook_id: string | null;
  action: string;
  summary: string;
  details: Record<string, unknown>;
  actor_email: string | null;
  created_at: string;
};

export type PatientBridgeWorkbookTablePreview = {
  name: string;
  range_address?: string | null;
  values?: string[][] | null;
};

export type PatientBridgeWorkbookSheetPreview = {
  name: string;
  used_range?: string | null;
};

export type PatientBridgeWorkbookDetail = PatientBridgeWorkbookSummary & {
  audit_logs: PatientBridgeWorkbookAuditEntry[];
  preview?: {
    sheets: PatientBridgeWorkbookSheetPreview[];
    tables: PatientBridgeWorkbookTablePreview[];
  } | null;
};

export type PatientBridgeWorkbookUploadPayload = {
  fileName: string;
  displayName?: string;
  folderPath?: string;
  fileBase64: string;
  contentType?: string;
  source?: "upload" | "sample";
};

export type GroupSessionSummary = {
  id: string;
  counselor_name: string;
  counselor_email?: string | null;
  location?: string | null;
  group_date: string;
  start_time: string;
  end_time?: string | null;
  topic: string;
  pdf_original_filename?: string | null;
  pdf_uploaded_at?: string | null;
  participant_count: number;
  created_at: string;
  updated_at: string;
  is_live_session?: boolean;
};

export type LiveGroupTimeSlot = "17:30-19:00" | "19:15-20:45";

export type LiveGroupSessionSnapshot = {
  id: string;
  attendance_session_id: string;
  counselor_name: string;
  location?: string | null;
  group_date: string;
  start_time: string;
  end_time?: string | null;
  topic: string;
  finalized: boolean;
  participant_count: number;
  created_at: string;
  updated_at: string;
};

export type LiveGroupEntry = {
  id: string;
  participant_name: string;
  signed_at: string;
  patient_id?: string | null;
  patient_name?: string | null;
};

export type LiveGroupStartResponse = {
  session: LiveGroupSessionSnapshot;
  joinUrl: string;
  tokenExpiresAt: string;
};

export type LiveGroupDetailResponse = {
  session: LiveGroupSessionSnapshot;
  entries: LiveGroupEntry[];
};

export type PublicGroupSessionInfo = {
  sessionId: string;
  topic: string;
  groupDate: string;
  startTime: string;
  endTime?: string | null;
  counselorName: string;
  location?: string | null;
};

export type PatientDocumentSummary = {
  id: string;
  patient_id: string;
  document_type: string;
  original_filename: string;
  content_type: string;
  byte_size: number | string;
  storage_blob_path: string;
  created_at: string;
  uploaded_by_email?: string | null;
};

export type PatientVaultDocumentSummary = PatientDocumentSummary;
export type AiNoteType = "problem_list" | "problem_list_review" | "problem_list_note" | "treatment_plan" | "medical_necessity_note" | "discharge_summary" | "discharge_note";
export type AiGeneratedNote = {
  noteType: AiNoteType;
  note: string;
  templateName: string;
};

export interface DataClient {
  getDashboard(options?: { includePatients?: boolean }): Promise<DashboardPayload>;
  getPatientsPage(params: {
    q?: string;
    status?: "new" | "current" | "rss_plus" | "rss" | "former";
    pastTier?: "recent" | "archived";
    assignedToUserId?: string;
    assignedToEmail?: string;
    sortKey?: "name" | "intake" | "lastVisit" | "kind";
    sortDir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<PatientsPagePayload>;
  getPatients(): Promise<unknown[]>;
  getPatient(patientId: string): Promise<unknown | null>;
  getLatestIntakeSubmission(patientId: string): Promise<unknown | null>;
  getPatientDocuments(patientId: string): Promise<PatientDocumentSummary[]>;
  getPatientVaultDocuments(patientId: string): Promise<PatientVaultDocumentSummary[]>;
  downloadPatientDocument(documentId: string): Promise<Blob>;
  uploadVaultPdf(patientId: string, payload: { documentType: string; fileName?: string; pdfBase64: string }): Promise<PatientVaultDocumentSummary>;
  uploadVaultText(patientId: string, payload: { documentType: string; text: string; fileName?: string }): Promise<PatientVaultDocumentSummary>;
  listAdminSheets(): Promise<AdminSheetSummary[]>;
  getAdminSheet(sheetId: string): Promise<AdminSheetDetail>;
  createAdminSheet(payload: AdminSheetCreatePayload): Promise<AdminSheetDetail>;
  updateAdminSheetCell(sheetId: string, payload: { rowId: string; columnId: string; value: string | null }): Promise<void>;
  updateAdminSheetRowLink(sheetId: string, payload: { rowId: string; linkedPatientId: string | null }): Promise<void>;
  listAdminWorkbooks(): Promise<AdminWorkbookSummary[]>;
  getAdminWorkbook(workbookId: string): Promise<AdminWorkbookDetail>;
  createAdminWorkbook(payload: AdminWorkbookCreatePayload): Promise<AdminWorkbookDetail>;
  updateAdminWorkbook(workbookId: string, payload: AdminWorkbookUpdatePayload): Promise<AdminWorkbookDetail>;
  listPatientBridgeWorkbooks(): Promise<PatientBridgeWorkbookSummary[]>;
  getPatientBridgeWorkbook(workbookId: string): Promise<PatientBridgeWorkbookDetail>;
  getPatientBridgeWorkbookPreview(workbookId: string): Promise<PatientBridgeWorkbookDetail["preview"]>;
  uploadPatientBridgeWorkbook(payload: PatientBridgeWorkbookUploadPayload): Promise<PatientBridgeWorkbookDetail>;
  generateAiPatientNote(
    patientId: string,
    payload: { noteType: AiNoteType; reviewContext?: { additions?: string; completions?: string } }
  ): Promise<AiGeneratedNote>;
  renamePatientDocument(documentId: string, payload: { originalFileName: string }): Promise<PatientDocumentSummary>;
  deletePatientDocument(documentId: string): Promise<void>;
  createPatient(payload: unknown): Promise<unknown>;
  updatePatient(patientId: string, payload: unknown): Promise<unknown>;
  deletePatient(patientId: string): Promise<void>;
  saveCaseAssignment(patientId: string, payload: unknown): Promise<void>;
  clearCaseAssignment(patientId: string): Promise<void>;
  saveCompliance(patientId: string, payload: unknown): Promise<unknown>;
  saveRosterDetails(patientId: string, payload: unknown): Promise<void>;
  createDrugTest(patientId: string, payload: unknown): Promise<unknown>;
  commitBilling(patientId: string, payload: unknown): Promise<{ session: unknown; billingEntry: unknown }>;
  createIntakeSubmission(payload: unknown): Promise<unknown>;
  updateIntakeSubmission(submissionId: string, payload: unknown): Promise<unknown>;
  createNotification(payload: unknown): Promise<void>;
  markNotificationRead(notificationId: string): Promise<void>;
  replyToNotification(notificationId: string, payload: unknown): Promise<void>;
  deleteNotificationThread(notificationId: string): Promise<void>;
  bulkUpsertPatients(payload: unknown): Promise<void>;
  getGroupSessions(): Promise<GroupSessionSummary[]>;
  clearGroupSessions(): Promise<void>;
  downloadGroupPdf(groupSessionId: string): Promise<Blob>;
  startLiveGroupSession(payload: { topic: string; timeSlot: LiveGroupTimeSlot }): Promise<LiveGroupStartResponse>;
  getLiveGroupSession(sessionId: string): Promise<LiveGroupDetailResponse>;
  setLiveGroupEntryMatch(sessionId: string, entryId: string, patientId: string | null): Promise<void>;
  removeLiveGroupEntry(sessionId: string, entryId: string): Promise<void>;
  finalizeLiveGroupSession(sessionId: string, payload: { counselorSignName: string; counselorSignatureDataUrl: string }): Promise<void>;
  getPublicGroupSession(token: string): Promise<PublicGroupSessionInfo>;
  submitPublicGroupSign(payload: { token: string; participantName: string; signatureDataUrl: string }): Promise<void>;
}

export type AzureDemoUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
};
