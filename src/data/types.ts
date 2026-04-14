export type BackendProvider = "azure-api";

export type DashboardPayload = {
  patients: unknown[];
  assignments: unknown[];
  compliance: unknown[];
  drugTests: unknown[];
  sessions: unknown[];
  attendanceSessionPatients: unknown[];
  rosterDetails: unknown[];
  notifications: unknown[];
  billingEntries: unknown[];
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

export interface DataClient {
  getDashboard(): Promise<DashboardPayload>;
  getPatients(): Promise<unknown[]>;
  getPatient(patientId: string): Promise<unknown | null>;
  getLatestIntakeSubmission(patientId: string): Promise<unknown | null>;
  createPatient(payload: unknown): Promise<unknown>;
  updatePatient(patientId: string, payload: unknown): Promise<unknown>;
  deletePatient(patientId: string): Promise<void>;
  saveCaseAssignment(patientId: string, payload: unknown): Promise<void>;
  clearCaseAssignment(patientId: string): Promise<void>;
  saveCompliance(patientId: string, payload: unknown): Promise<void>;
  saveRosterDetails(patientId: string, payload: unknown): Promise<void>;
  createDrugTest(patientId: string, payload: unknown): Promise<unknown>;
  commitBilling(patientId: string, payload: unknown): Promise<{ session: unknown; billingEntry: unknown }>;
  createIntakeSubmission(payload: unknown): Promise<unknown>;
  updateIntakeSubmission(submissionId: string, payload: unknown): Promise<unknown>;
  createNotification(payload: unknown): Promise<void>;
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
