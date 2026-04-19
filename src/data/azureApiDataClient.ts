import type {
  AzureDemoUser,
  DashboardPayload,
  DataClient,
  GroupSessionSummary,
  LiveGroupDetailResponse,
  LiveGroupStartResponse,
  PatientDocumentSummary,
  PatientsPagePayload,
  PublicGroupSessionInfo,
} from "./types";

let accessTokenProvider: (() => Promise<string | null> | string | null) | null = null;
const debugPatientFlow =
  String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "1" ||
  String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "true" ||
  import.meta.env.DEV;

export function setAzureApiAccessTokenProvider(provider: typeof accessTokenProvider) {
  accessTokenProvider = provider;
}

function getApiBaseUrl() {
  const apiBaseUrl = import.meta.env.VITE_AZURE_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new Error("Missing VITE_AZURE_API_BASE_URL. Configure an explicit Azure API URL.");
  }
  const normalized = apiBaseUrl.replace(/\/+$/, "");
  if (debugPatientFlow) {
    console.info("[patient-flow][config] resolved_api_base_url", {
      apiBaseUrl: normalized,
      backendProvider: "azure-api",
      dataSource: "azure-api -> postgresql",
    });
  }
  return normalized;
}

async function toRequestError(response: Response) {
  let detail = "";
  try {
    const payload = await response.clone().json() as { error?: string };
    if (payload?.error) {
      detail = ` - ${payload.error}`;
    }
  } catch {
    // Ignore JSON parse failures and use status-only error.
  }
  return new Error(`Azure API request failed: ${response.status}${detail}`);
}

async function requestJson<T>(path: string): Promise<T> {
  const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
  const requestUrl = `${getApiBaseUrl()}${path}`;
  if (debugPatientFlow && (path.startsWith("/api/patients") || path.startsWith("/api/dashboard"))) {
    console.info("[patient-flow][frontend][request]", {
      path,
      requestUrl,
      hasAccessToken: Boolean(accessToken),
      dataSource: "azure-api -> postgresql",
    });
  }
  const response = await fetch(requestUrl, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  if (debugPatientFlow && (path.startsWith("/api/patients") || path.startsWith("/api/dashboard"))) {
    console.info("[patient-flow][frontend][response]", {
      path,
      requestUrl,
      status: response.status,
      ok: response.ok,
    });
  }

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.blob();
}

async function sendJson<T>(path: string, body: unknown): Promise<T> {
  const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.json() as Promise<T>;
}

async function sendJsonPublic<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.json() as Promise<T>;
}

async function requestJsonPublic<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }

  return response.json() as Promise<T>;
}

async function deleteJson(path: string): Promise<void> {
  const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "DELETE",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    throw await toRequestError(response);
  }
}

export async function getAzureAuthOptions() {
  return requestJson<{ ok: true; authMode: "demo" | "entra"; demoUsers: AzureDemoUser[] }>("/api/auth/options");
}

export async function loginToAzureDemo(email: string, password: string) {
  return sendJson<{ ok: true; authMode: "demo"; accessToken: string; user: AzureDemoUser }>("/api/auth/login", {
    email,
    password,
  });
}

export const azureApiDataClient: DataClient = {
  async getDashboard(options) {
    const qs = new URLSearchParams();
    if (options?.includePatients === false) qs.set("include_patients", "0");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const payload = await requestJson<{ dashboard: DashboardPayload }>(`/api/dashboard${suffix}`);
    return payload.dashboard;
  },
  async getPatientsPage(params) {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set("q", params.q.trim());
    if (params.status) qs.set("status", params.status);
    if (params.pastTier) qs.set("past_tier", params.pastTier);
    if (params.assignedToUserId) qs.set("assigned_to_user_id", params.assignedToUserId);
    if (params.assignedToEmail) qs.set("assigned_to_email", params.assignedToEmail);
    if (params.sortKey) qs.set("sort_key", params.sortKey);
    if (params.sortDir) qs.set("sort_dir", params.sortDir);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    if (typeof params.offset === "number") qs.set("offset", String(params.offset));
    const path = `/api/patients?${qs.toString()}`;
    const payload = await requestJson<{ patients: unknown[]; total?: number; limit?: number; offset?: number }>(path);
    if (debugPatientFlow) {
      console.info("[patient-flow][frontend][patients-list]", {
        path,
        query: Object.fromEntries(qs.entries()),
        count: Array.isArray(payload.patients) ? payload.patients.length : 0,
        total: Number(payload.total ?? 0),
      });
    }
    return {
      patients: payload.patients ?? [],
      total: Number(payload.total ?? 0),
      limit: Number(payload.limit ?? params.limit ?? 50),
      offset: Number(payload.offset ?? params.offset ?? 0),
    } satisfies PatientsPagePayload;
  },
  async getPatients() {
    const payload = await requestJson<{ patients: unknown[] }>("/api/patients");
    if (debugPatientFlow) {
      console.info("[patient-flow][frontend][patients-list]", {
        path: "/api/patients",
        count: Array.isArray(payload.patients) ? payload.patients.length : 0,
      });
    }
    return payload.patients;
  },
  async getPatient(patientId: string) {
    const normalizedPatientId = String(patientId ?? "").trim().toLowerCase();
    const path = `/api/patients/${encodeURIComponent(normalizedPatientId)}`;
    const payload = await requestJson<{ patient: unknown | null }>(path);
    if (debugPatientFlow) {
      console.info("[patient-flow][frontend][patient-detail]", {
        path,
        patientId: normalizedPatientId,
        found: Boolean(payload.patient),
      });
    }
    return payload.patient;
  },
  async getLatestIntakeSubmission(patientId: string) {
    const payload = await requestJson<{ intakeSubmission: unknown | null }>(`/api/patients/${patientId}/intake`);
    return payload.intakeSubmission;
  },
  async getPatientDocuments(patientId: string) {
    const payload = await requestJson<{ documents: PatientDocumentSummary[] }>(`/api/patients/${patientId}/documents`);
    return payload.documents ?? [];
  },
  async downloadPatientDocument(documentId: string) {
    return requestBlob(`/api/patient-documents/${documentId}/download`);
  },
  async createPatient(payload) {
    const response = await sendJson<{ patient: unknown }>("/api/patients", payload);
    return response.patient;
  },
  async updatePatient(patientId, payload) {
    const response = await patchJson<{ patient: unknown }>(`/api/patients/${patientId}`, payload);
    return response.patient;
  },
  async deletePatient(patientId) {
    await deleteJson(`/api/patients/${patientId}`);
  },
  async saveCaseAssignment(patientId, payload) {
    await sendJson(`/api/patients/${patientId}/case-assignment`, payload);
  },
  async clearCaseAssignment(patientId) {
    await deleteJson(`/api/patients/${patientId}/case-assignment`);
  },
  async saveCompliance(patientId, payload) {
    await sendJson(`/api/patients/${patientId}/compliance`, payload);
  },
  async saveRosterDetails(patientId, payload) {
    await sendJson(`/api/patients/${patientId}/roster-details`, payload);
  },
  async createDrugTest(patientId, payload) {
    const response = await sendJson<{ drugTest: unknown }>(`/api/patients/${patientId}/drug-tests`, payload);
    return response.drugTest;
  },
  async commitBilling(patientId, payload) {
    const response = await sendJson<{ session: unknown; billingEntry: unknown }>(`/api/patients/${patientId}/billing-entries`, payload);
    return { session: response.session, billingEntry: response.billingEntry };
  },
  async createIntakeSubmission(payload) {
    const response = await sendJson<{ intakeSubmission: unknown }>("/api/intake-submissions", payload);
    return response.intakeSubmission;
  },
  async updateIntakeSubmission(submissionId, payload) {
    const response = await patchJson<{ intakeSubmission: unknown }>(`/api/intake-submissions/${submissionId}`, payload);
    return response.intakeSubmission;
  },
  async createNotification(payload) {
    await sendJson("/api/notifications", payload);
  },
  async markNotificationRead(notificationId) {
    await patchJson(`/api/notifications/${notificationId}/read`, {});
  },
  async replyToNotification(notificationId, payload) {
    await sendJson(`/api/notifications/${notificationId}/reply`, payload);
  },
  async bulkUpsertPatients(payload) {
    await sendJson("/api/patients/bulk-upsert", payload);
  },
  async getGroupSessions() {
    const payload = await requestJson<{ groups: GroupSessionSummary[] }>("/api/groups");
    return payload.groups ?? [];
  },
  async clearGroupSessions() {
    await deleteJson("/api/groups");
  },
  async downloadGroupPdf(groupSessionId: string) {
    return requestBlob(`/api/groups/${groupSessionId}/pdf`);
  },
  async startLiveGroupSession(payload) {
    return sendJson<LiveGroupStartResponse>("/api/groups/live/start", payload);
  },
  async getLiveGroupSession(sessionId) {
    return requestJson<LiveGroupDetailResponse>(`/api/groups/live/${sessionId}`);
  },
  async setLiveGroupEntryMatch(sessionId, entryId, patientId) {
    await sendJson(`/api/groups/live/${sessionId}/match`, { entryId, patientId });
  },
  async removeLiveGroupEntry(sessionId, entryId) {
    const accessToken = accessTokenProvider ? await accessTokenProvider() : null;
    const response = await fetch(`${getApiBaseUrl()}/api/groups/live/${sessionId}/entry/${entryId}`, {
      method: "DELETE",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    if (!response.ok) {
      throw await toRequestError(response);
    }
  },
  async finalizeLiveGroupSession(sessionId, payload) {
    await sendJson(`/api/groups/live/${sessionId}/finalize`, payload);
  },
  async getPublicGroupSession(token) {
    const encoded = encodeURIComponent(token);
    const payload = await requestJsonPublic<{ ok: true; session: PublicGroupSessionInfo }>(`/api/public/group-sign/${encoded}`);
    return payload.session;
  },
  async submitPublicGroupSign(payload) {
    await sendJsonPublic("/api/public/group-sign/submit", payload);
  },
};
