import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { getDataClient } from "./data/client";
import { getAzureAuthOptions, loginToAzureDemo, setAzureApiAccessTokenProvider } from "./data/azureApiDataClient";
import { useAzureAuth } from "./auth/azureAuth";
import type {
  AzureDemoUser,
  DataClient,
  GroupSessionSummary,
  LiveGroupEntry,
  LiveGroupSessionSnapshot,
  LiveGroupTimeSlot,
  PatientDocumentSummary,
  PublicGroupSessionInfo,
} from "./data/types";
import { CONSENT_FORMS } from './consentForms';
import type { ConsentForm } from './consentForms';
import patientFinderLogo from "./assets/patientfinder-logo.svg";
import ncaddLogo from "./assets/ncadd-logo.png";
import themeButtonLogo from "./assets/theme-button-logo.svg";
import "./App.css";

/* -------------------- Types -------------------- */

type PatientKind = "New Patient" | "Current Patient" | "RSS+" | "RSS" | "Former Patient";
type PatientKindFilter = "all" | PatientKind | "Former Recent" | "Former Archived";
type ViewMode = "sheet" | "cards" | "split";
type SortKey = "name" | "intake" | "lastVisit" | "kind";
type WorkspaceTab = "roster" | "attention";

type IntakeAnswers = {
  // text inputs keyed like: "s5::Full legal name"
  fields: Record<string, string>;
  // single-choice answers keyed like: "location", "mat", "sex", etc.
  singles: Record<string, string>;
  // multi-choice answers keyed like: "substances", "race", etc.
  multis: Record<string, string[]>;
};

type AttendanceStatus = "Present" | "Absent" | "Excused";

type SessionKind = "Group" | "Individual";
type DashboardFilterKey = "dueReview" | "dueUpdate" | "behindAttendance";
type BillingModality = "FF" | "Z" | "Z(O)" | "T" | "NA";
type BillingType =
  | "DCP Summary"
  | "CalOMS Discharge"
  | "CalOms Completion"
  | "Care Coordination"
  | "Crisis"
  | "Naloxone"
  | "MAT ED"
  | "Co Triage"
  | "Same Day Screening"
  | "Assessment"
  | "Intake"
  | "Problem List"
  | "Problem List Review"
  | "Problem List Update"
  | "Treatment Plan"
  | "Treatment Plan Update"
  | "Individual";

type Session = {
  id: string;
  kind: SessionKind;
  title: string;
  date: string; // YYYY-MM-DD
  durationHours: number;
  location?: string;
  patientIds: string[];
  attendance: Record<string, AttendanceStatus>;
};

type AttendanceEntry = {
  sessionId: string;
  sessionTitle: string;
  date: string;
  kind: SessionKind;
  durationHours: number;
  status: AttendanceStatus;
};

type DrugTestResult = "Negative" | "Positive" | "Inconclusive";

type DrugTestEntry = {
  id: string;
  date: string;
  testType: string; // e.g., UA, Oral swab
  result: DrugTestResult;
  substances?: string;
  notes?: string;
};

type BillingEntry = {
  id: string;
  patientId: string;
  sessionId?: string;
  billingType: BillingType;
  serviceDate: string;
  startTime?: string;
  endTime?: string;
  totalMinutes: number;
  modality?: BillingModality;
  naloxoneTraining?: boolean;
  matEducation?: boolean;
  createdAt: string;
};

type AzureDemoSession = {
  accessToken: string;
  user: AzureDemoUser;
};

type LiveGroupSessionState = {
  session: LiveGroupSessionSnapshot;
  entries: LiveGroupEntry[];
  joinUrl: string;
  tokenExpiresAt: string;
};

type PatientRosterDetails = {
  drugOfChoice?: string[];
  medicalPhysApt?: "Needed" | "Scheduled" | "Completed";
  medFormStatus?: "Pending" | "Turned in" | "Not needed";
  notes?: string;
  referringAgency?: "Self" | "DCFS" | "Court" | "Other";
  reauthSapcDate?: string;
  medicalEligibility?: "Yes" | "No" | "Pending";
  matStatus?: "Yes" | "No";
  therapyTrack?: "Sandy" | "Becky";
};

type InAppNotification = {
  id: string;
  title: string;
  message: string;
  priority: "normal" | "urgent";
  patientId?: string;
  recipientEmail?: string;
  recipientUserId?: string;
  senderEmail?: string;
  createdAt: string;
  readAt?: string;
};

type Patient = {
  id: string;
  displayName: string;
  mrn?: string;
  kind: PatientKind;

  intakeDate: string; // YYYY-MM-DD
  lastVisitDate?: string;
  nextApptDate?: string;

  primaryProgram?: string;
  counselor?: string;

  flags?: string[];
  tests?: { name: string; date: string; score?: string }[];

  // New: attendance + UA results (stored locally for now)
  attendance?: AttendanceEntry[];
  drugTests?: DrugTestEntry[];

  intakeAnswers?: IntakeAnswers;
  rosterDetails?: PatientRosterDetails;
};

type PatientCompliance = {
  drugTestMode?: "none" | "weekly_count" | "weekday";
  drugTestsPerWeek?: number;
  drugTestWeekday?: string;
  problemListDate?: string;
  lastProblemListReview?: string;
  lastProblemListUpdate?: string;
  treatmentPlanDate?: string;
  lastTreatmentPlanUpdate?: string;
};

type PatientExtras = {
  drugTests?: DrugTestEntry[];
};

type IntakeSubmission = {
  id: string;
  raw_json: unknown;
  created_at: string;
};

type Route =
  | { name: "home" }
  | { name: "patient"; patientId: string }
  | { name: "billing" }
  | { name: "groups" };

type AuthedRoute = Route | { name: "attendance" };
type AuthMode = "demo" | "entra";

const LOCK_SCREEN_JOKES = [
  "SUD counseling is 20% clinical skill and 80% getting the group back from snack break.",
  "My treatment plan says one thing. My progress note says, 'Please see attached chaos.'",
  "I became an SUD counselor for the calm environment and predictable schedules.",
  "Nothing says outpatient like three breakthroughs and one missing signature.",
  "My clinical style is motivational interviewing with a light touch of 'please sign here.'",
  "In recovery work, every small win matters, especially when someone actually shows up on time.",
  "I can de-escalate a room, but I still lose arguments with the printer.",
  "SUD counselors know relapse prevention and copier troubleshooting are both ongoing processes.",
  "The group topic was boundaries. The real topic was who took the good pen.",
  "I practice active listening and active searching for the attendance sheet.",
  "My resting face says empathy. My charting face says do not talk to me for six minutes.",
  "Recovery is one day at a time. Documentation is somehow all due today.",
  "I use person-centered care and counselor-centered coffee.",
  "Every no-show is a mystery, but every late arrival has a full backstory.",
  "SUD counseling: where 'resistance' and 'the Wi-Fi is down' can happen in the same hour.",
  "I believe in change, growth, and hitting save before the note disappears.",
  "The most powerful intervention is sometimes asking, 'Did you eat anything today?'",
  "I am fluent in reflective listening and in saying, 'We can process that after group.'",
  "My group starts at 9:00 and reality starts around 9:17.",
  "Counselors do not gossip. We discuss patterns in a confidential tone.",
  "Every discharge summary contains at least one sentence written with pure hope.",
  "If therapeutic silence were billable, I would retire early.",
  "SUD counselors can spot denial, avoidance, and an unsigned ROI from across the room.",
  "Half my job is holding space. The other half is finding forms.",
  "My self-care plan includes water, boundaries, and not opening one more chart at 4:59.",
  "There is no stronger bond than a counselor and the client who finally remembers their password.",
  "I entered behavioral health to help people. The fax machine took that personally.",
  "The official animal of outpatient treatment is the emotional support clipboard.",
  "Some heroes wear capes. Some carry Narcan and extra intake packets.",
  "Behind every strong SUD counselor is a note that still needs one tiny edit.",
] as const;

/* -------------------- Formatting / Helpers -------------------- */

function toDateOnly(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function normalizePatientId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function normalizeImportDate(value: unknown, fallback?: string) {
  const parsed = toDateOnly(value);
  return parsed ?? fallback ?? null;
}

function resolveImportedPatientName(row: any) {
  const direct = firstNonEmptyString(
    row?.full_name,
    row?.fullName,
    row?.name,
    row?.patient_name,
    row?.patientName,
    row?.submitted_full_name
  );
  if (direct) return direct;

  const first = firstNonEmptyString(
    row?.first_name,
    row?.firstName,
    row?.given_name,
    row?.givenName,
    row?.demographics?.first_name,
    row?.demographics?.firstName
  );
  const last = firstNonEmptyString(
    row?.last_name,
    row?.lastName,
    row?.family_name,
    row?.familyName,
    row?.demographics?.last_name,
    row?.demographics?.lastName
  );
  return `${first} ${last}`.trim();
}

function resolveImportedPatientId(row: any) {
  const rawId = firstNonEmptyString(row?.id, row?.patient_id, row?.patientId);
  return rawId || crypto.randomUUID();
}

function fmt(iso?: string) {
  if (!iso) return "—";
  const normalized = toDateOnly(iso);
  if (!normalized) return "—";
  const d = new Date(`${normalized}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatClock(value?: string | null) {
  if (!value) return "—";
  const [hours = "00", minutes = "00"] = value.split(":");
  const parsed = new Date(`2000-01-01T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:00`);
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatNotificationTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hashInstallSeed(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getPublicGroupTokenFromPath() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/group-sign\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function dateTokens(iso?: string) {
  if (!iso) return "";
  const normalized = toDateOnly(iso);
  if (!normalized) return "";
  const d = new Date(`${normalized}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  const monthName = d.toLocaleDateString(undefined, { month: "short" });
  return [
    normalized,
    `${mm}/${dd}/${yyyy}`,
    `${m}/${day}/${yyyy}`,
    `${monthName} ${day} ${yyyy}`,
    `${monthName} ${yyyy}`,
    yyyy,
    `${mm}${dd}${yyyy}`,
  ].join(" ");
}

function normalizeQuery(q: string) {
  const raw = q.trim().toLowerCase();
  const compact = raw.replace(/[^a-z0-9]+/g, "");
  return { raw, compact };
}

function pillClass(kind: PatientKind) {
  if (kind === "New Patient") return "pill pill-new";
  if (kind === "Current Patient" || kind === "RSS+" || kind === "RSS") return "pill pill-active";
  return "pill pill-past";
}

function sortVal(p: Patient, key: SortKey) {
  switch (key) {
    case "name":
      return (p.displayName || "").toLowerCase();
    case "intake":
      return p.intakeDate || "";
    case "lastVisit":
      return p.lastVisitDate || "";
    case "kind":
      return p.kind;
  }
}

function isPastRecentPatient(patient: Patient, nowIso: string) {
  const reference = toDateOnly(patient.lastVisitDate ?? patient.intakeDate);
  if (!reference) return false;
  const daysSince = dayDiff(reference, nowIso);
  return daysSince <= 90;
}

function matchesKindFilter(patient: Patient, filter: PatientKindFilter, nowIso: string) {
  if (filter === "all") return true;
  if (filter === "Former Recent") return patient.kind === "Former Patient" && isPastRecentPatient(patient, nowIso);
  if (filter === "Former Archived") return patient.kind === "Former Patient" && !isPastRecentPatient(patient, nowIso);
  return patient.kind === filter;
}

function isBillingActivePatient(patient: Patient, nowIso: string) {
  if (patient.kind !== "Former Patient") return true;
  const reference = toDateOnly(patient.lastVisitDate ?? patient.intakeDate);
  if (!reference) return true;
  return dayDiff(reference, nowIso) <= 90;
}

function fieldKey(screenId: string, placeholder: string) {
  return `${screenId}::${placeholder}`;
}

function getField(ans: IntakeAnswers | undefined, screenId: string, placeholder: string) {
  if (!ans) return "";
  return ans.fields[fieldKey(screenId, placeholder)] ?? "";
}

function getSingle(ans: IntakeAnswers | undefined, key: string) {
  if (!ans) return "";
  return ans.singles[key] ?? "";
}

function getMulti(ans: IntakeAnswers | undefined, key: string) {
  if (!ans) return [];
  return ans.multis[key] ?? [];
}

function indexPatient(p: Patient) {
  const pieces: string[] = [];

  pieces.push(p.displayName);
  if (p.mrn) pieces.push(p.mrn);
  pieces.push(p.kind);
  if (p.primaryProgram) pieces.push(p.primaryProgram);
  if (p.counselor) pieces.push(p.counselor);

  (p.flags || []).forEach((f) => pieces.push(f));

  pieces.push(dateTokens(p.intakeDate));
  pieces.push(dateTokens(p.lastVisitDate));
  pieces.push(dateTokens(p.nextApptDate));

  (p.tests || []).forEach((t) => {
    pieces.push(t.name);
    pieces.push(dateTokens(t.date));
    if (t.score) pieces.push(t.score);
  });

  if (p.rosterDetails) {
    pieces.push(
      ...(p.rosterDetails.drugOfChoice ?? []),
      p.rosterDetails.medicalPhysApt ?? "",
      p.rosterDetails.medFormStatus ?? "",
      p.rosterDetails.notes ?? "",
      p.rosterDetails.referringAgency ?? "",
      dateTokens(p.rosterDetails.reauthSapcDate),
      p.rosterDetails.medicalEligibility ?? "",
      p.rosterDetails.matStatus ?? "",
      p.rosterDetails.therapyTrack ?? "",
    );
  }

  // Intake answers: index EVERYTHING so Spotlight-ish search works
  const ans = p.intakeAnswers;
  if (ans) {
    Object.values(ans.fields).forEach((v) => v && pieces.push(v));
    Object.entries(ans.singles).forEach(([k, v]) => {
      pieces.push(k);
      if (v) pieces.push(v);
    });
    Object.entries(ans.multis).forEach(([k, arr]) => {
      pieces.push(k);
      arr.forEach((v) => pieces.push(v));
    });
  }

  const raw = pieces.filter(Boolean).join(" ").toLowerCase();
  const compact = raw.replace(/[^a-z0-9]+/g, "");
  return { raw, compact };
}

function toSessionHours(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.round(num * 100) / 100;
}

function weekBounds(iso: string) {
  const normalized = toDateOnly(iso);
  if (!normalized) return weekBounds(todayIso());
  const day = new Date(`${normalized}T00:00:00`);
  const start = new Date(day);
  start.setDate(day.getDate() - day.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

function fmtHours(hours: number) {
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseTimeInput(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  const normalized = raw
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/^(\d{1,2})(\d{2})\s*(am|pm)$/, "$1:$2 $3")
    .replace(/^(\d{1,2})\s*(am|pm)$/, "$1:00 $2");

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (hours === 12) hours = 0;
    if (meridiem === "pm") hours += 12;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatTimeValue(totalMinutes: number) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const meridiem = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function parseDurationMinutes(value: string) {
  const match = value.trim().match(/\d+/);
  if (!match) return null;
  const minutes = Number(match[0]);
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  return minutes;
}

function formatDurationValue(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  return `${rounded} minute${rounded === 1 ? "" : "s"}`;
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  const detail = error.message
    .replace(/^Azure API request failed:\s*\d+\s*-\s*/i, "")
    .trim();
  return detail || fallback;
}

function monthKey(iso: string) {
  return toDateOnly(iso)?.slice(0, 7) ?? todayIso().slice(0, 7);
}

function monthLabel(isoMonth: string) {
  const [year, month] = isoMonth.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function addDaysIso(iso: string, days: number) {
  const normalized = toDateOnly(iso);
  if (!normalized) return todayIso();
  const d = new Date(`${normalized}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(fromIso: string, toIso: string) {
  const fromNormalized = toDateOnly(fromIso);
  const toNormalized = toDateOnly(toIso);
  if (!fromNormalized || !toNormalized) return 0;
  const from = new Date(`${fromNormalized}T00:00:00`);
  const to = new Date(`${toNormalized}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

type AttendanceGoal =
  | { kind: "range"; label: string; minHours: number; maxHours: number }
  | { kind: "cap"; label: string; maxHours: number };

function getAttendanceGoal(program?: string): AttendanceGoal | null {
  const raw = (program ?? "").toLowerCase();
  if (raw.includes("2.1")) return { kind: "range", label: "Level 2.1 IOT", minHours: 9, maxHours: 19 };
  if (raw.includes("1.0")) return { kind: "cap", label: "Level 1.0 OP", maxHours: 9 };
  return null;
}

function getWeeklyGroupTarget(program?: string) {
  const raw = (program ?? "").toLowerCase();
  if (raw.includes("2.1")) return 6;
  if (raw.includes("1.0")) return 4;
  return null;
}

function getWeeklyAttendanceStats(patient: Patient, sessions: Session[], weekDate: string) {
  const goal = getAttendanceGoal(patient.primaryProgram);
  const { start, end } = weekBounds(weekDate);
  const weeklySessions = sessions
    .filter((session) => session.patientIds.includes(patient.id) && session.date >= start && session.date <= end)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const attendedHours = weeklySessions.reduce((sum, session) => {
    const status = session.attendance[patient.id] ?? "Absent";
    return status === "Present" ? sum + toSessionHours(session.durationHours) : sum;
  }, 0);

  const scheduledHours = weeklySessions.reduce((sum, session) => sum + toSessionHours(session.durationHours), 0);
  const presentCount = weeklySessions.filter((session) => (session.attendance[patient.id] ?? "Absent") === "Present").length;

  return { goal, start, end, weeklySessions, attendedHours, scheduledHours, presentCount };
}

function getAttendanceTone(patient: Patient, sessions: Session[], weekDate: string) {
  const { goal, attendedHours } = getWeeklyAttendanceStats(patient, sessions, weekDate);
  if (!goal) return "neutral" as const;
  if (goal.kind === "range") {
    if (attendedHours < goal.minHours) return "behind" as const;
    if (attendedHours > goal.maxHours) return "over" as const;
    return "good" as const;
  }
  if (attendedHours > goal.maxHours) return "over" as const;
  return "good" as const;
}

function AttendanceStatusChip({
  patient,
  sessions,
  weekDate,
}: {
  patient: Patient;
  sessions: Session[];
  weekDate: string;
}) {
  const stats = useMemo(() => getWeeklyAttendanceStats(patient, sessions, weekDate), [patient, sessions, weekDate]);
  const tone = getAttendanceTone(patient, sessions, weekDate);

  if (!stats.goal) return <span className="attendanceStatusChip neutral">No program goal</span>;

  let text = "";
  if (stats.goal.kind === "range") {
    text =
      tone === "behind"
        ? `${fmtHours(stats.attendedHours)} this week • below min`
        : tone === "over"
          ? `${fmtHours(stats.attendedHours)} this week • over range`
          : `${fmtHours(stats.attendedHours)} this week • on track`;
  } else {
    text =
      tone === "over"
        ? `${fmtHours(stats.attendedHours)} this week • over cap`
        : `${fmtHours(stats.attendedHours)} this week • within cap`;
  }

  return <span className={`attendanceStatusChip ${tone}`}>{text}</span>;
}

function getWeeklyHistory(patient: Patient, sessions: Session[]) {
  const goal = getAttendanceGoal(patient.primaryProgram);
  const buckets = new Map<string, number>();

  sessions.forEach((session) => {
    if (!session.patientIds.includes(patient.id)) return;
    if ((session.attendance[patient.id] ?? "Absent") !== "Present") return;
    const { start } = weekBounds(session.date);
    buckets.set(start, (buckets.get(start) ?? 0) + toSessionHours(session.durationHours));
  });

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([start, hours]) => ({
      weekStart: start,
      label: new Date(`${start}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      hours,
      targetMax: goal?.maxHours ?? 0,
      targetMin: goal?.kind === "range" ? goal.minHours : undefined,
    }));
}

function getDrugTestSummary(patient: Patient, compliance: PatientCompliance | undefined, weekDate: string) {
  const tests = patient.drugTests ?? [];
  const config = compliance ?? {};
  const mode = config.drugTestMode ?? "none";
  const { start, end } = weekBounds(weekDate);
  const thisWeekTests = tests.filter((test) => test.date >= start && test.date <= end);

  if (mode === "weekly_count") {
    const target = Math.max(1, config.drugTestsPerWeek ?? 1);
    const tone = thisWeekTests.length >= target ? "good" : "behind";
    return { tone, label: `Drug tests ${thisWeekTests.length}/${target} this week` };
  }

  if (mode === "weekday") {
    const weekday = Number(config.drugTestWeekday ?? "1");
    const dueDate = addDaysIso(start, weekday);
    const done = thisWeekTests.some((test) => test.date === dueDate);
    const today = new Date().toISOString().slice(0, 10);
    const tone = done ? "good" : today > dueDate ? "behind" : "neutral";
    const weekdayLabel = new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
    return { tone, label: done ? `Drug test done for ${weekdayLabel}` : `Drug test due ${weekdayLabel}` };
  }

  return { tone: "neutral" as const, label: "Drug testing as needed" };
}

function buildDueLabel(delta: number, iso: string, kind: string) {
  if (delta < 0) return `${kind} overdue since ${fmt(iso)}`;
  if (delta === 0) return `${kind} due today`;
  return `${kind} due ${fmt(iso)}`;
}

function getProblemListSummary(compliance: PatientCompliance | undefined) {
  const config = compliance ?? {};
  if (!config.problemListDate) {
    return {
      tone: "neutral" as const,
      reviewText: "Problem list date not set",
      updateText: "No review or update schedule yet",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const nextReview = addDaysIso(config.lastProblemListReview ?? config.problemListDate, 30);
  const nextUpdate = addDaysIso(config.lastProblemListUpdate ?? config.problemListDate, 90);
  const reviewDelta = dayDiff(today, nextReview);
  const updateDelta = dayDiff(today, nextUpdate);
  const tone = reviewDelta < 0 || updateDelta < 0 ? "behind" : reviewDelta <= 7 || updateDelta <= 14 ? "neutral" : "good";

  return {
    tone,
    reviewText: buildDueLabel(reviewDelta, nextReview, "Review"),
    updateText: buildDueLabel(updateDelta, nextUpdate, "Update"),
  };
}

function getSheetRowData(patient: Patient, compliance: PatientCompliance | undefined) {
  const problemListDueDates = getProblemListDueDates(compliance);
  const treatmentPlanDueDates = getTreatmentPlanDueDates(patient, compliance);
  const roster = patient.rosterDetails ?? {};
  const locCode = (patient.primaryProgram ?? "").includes("2.1") ? "2.1" : (patient.primaryProgram ?? "").includes("1.0") ? "1.0" : "—";
  return {
    ncaddId: patient.id.slice(0, 8),
    clientName: patient.displayName,
    sageId: patient.mrn ?? "—",
    locCode,
    doc: roster.drugOfChoice?.join(", ") ?? "—",
    admitDate: fmt(patient.intakeDate),
    problemListInitial: compliance?.problemListDate ? fmt(compliance.problemListDate) : "—",
    problemListReview: problemListDueDates?.nextReview ? fmt(problemListDueDates.nextReview) : "—",
    problemListUpdate: problemListDueDates?.nextUpdate ? fmt(problemListDueDates.nextUpdate) : "—",
    treatmentPlanInitial: treatmentPlanDueDates?.initial ? fmt(treatmentPlanDueDates.initial) : "—",
    treatmentPlanUpdate: treatmentPlanDueDates?.nextUpdate ? fmt(treatmentPlanDueDates.nextUpdate) : "—",
    medicalPhysApt: roster.medicalPhysApt ?? "—",
    medForm: roster.medFormStatus ?? "—",
    referringAgency: roster.referringAgency ?? "—",
    reauthSapcDate: roster.reauthSapcDate ? fmt(roster.reauthSapcDate) : "—",
    medicalEligibility: roster.medicalEligibility ?? "—",
    matStatus: roster.matStatus ?? "—",
    therapyTrack: roster.therapyTrack ?? "—",
    notes: roster.notes ?? "",
  };
}

function getProblemListDueDates(compliance: PatientCompliance | undefined) {
  if (!compliance?.problemListDate) return null;
  return {
    nextReview: addDaysIso(compliance.lastProblemListReview ?? compliance.problemListDate, 30),
    nextUpdate: addDaysIso(compliance.lastProblemListUpdate ?? compliance.problemListDate, 90),
  };
}

function getTreatmentPlanDueDates(patient: Patient, compliance: PatientCompliance | undefined) {
  const config = compliance ?? {};
  const initial = config.treatmentPlanDate ?? addDaysIso(patient.intakeDate, 30);
  return {
    initial,
    nextUpdate: addDaysIso(config.lastTreatmentPlanUpdate ?? initial, 180),
  };
}

function getTreatmentPlanSummary(patient: Patient, compliance: PatientCompliance | undefined) {
  const config = compliance ?? {};
  const today = todayIso();

  if (!config.treatmentPlanDate) {
    const initialDue = addDaysIso(patient.intakeDate, 30);
    const initialDelta = dayDiff(today, initialDue);
    return {
      tone: initialDelta < 0 ? "behind" : initialDelta <= 7 ? "neutral" : "good",
      reviewText: buildDueLabel(initialDelta, initialDue, "Initial treatment plan"),
      updateText: "Treatment plan update starts after the initial plan is created",
    };
  }

  const nextUpdate = addDaysIso(config.lastTreatmentPlanUpdate ?? config.treatmentPlanDate, 180);
  const updateDelta = dayDiff(today, nextUpdate);
  return {
    tone: updateDelta < 0 ? "behind" : updateDelta <= 14 ? "neutral" : "good",
    reviewText: `Treatment plan set ${fmt(config.treatmentPlanDate)}`,
    updateText: buildDueLabel(updateDelta, nextUpdate, "Treatment plan update"),
  };
}

function getTherapySummary(patient: Patient) {
  const track = patient.rosterDetails?.therapyTrack;
  if (!track) {
    return {
      tone: "neutral" as const,
      label: "Therapy track not set",
    };
  }
  return {
    tone: "good" as const,
    label: track,
  };
}

function formatBillingMinutes(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  return `${rounded}`;
}

function formatBillingDayList(entries: BillingEntry[]) {
  return entries
    .sort((a, b) => (a.serviceDate === b.serviceDate ? a.createdAt.localeCompare(b.createdAt) : a.serviceDate.localeCompare(b.serviceDate)))
    .map((entry) => `${Number(entry.serviceDate.slice(8, 10))}`)
    .join(", ");
}

function formatBillingCell(entries: BillingEntry[]) {
  return entries
    .sort((a, b) => (a.serviceDate === b.serviceDate ? a.createdAt.localeCompare(b.createdAt) : a.serviceDate.localeCompare(b.serviceDate)))
    .map((entry) => `${Number(entry.serviceDate.slice(8, 10))}-${formatBillingMinutes(entry.totalMinutes)}`)
    .join(", ");
}

function formatBillingModalities(entries: BillingEntry[]) {
  return entries
    .sort((a, b) => (a.serviceDate === b.serviceDate ? a.createdAt.localeCompare(b.createdAt) : a.serviceDate.localeCompare(b.serviceDate)))
    .map((entry) => entry.modality ?? "NA")
    .join(", ");
}

type WorkItem = {
  id: string;
  tone: "good" | "neutral" | "behind" | "over";
  title: string;
  detail: string;
  sortScore: number;
};

function getPatientWorkItems(patient: Patient, compliance: PatientCompliance | undefined, sessions: Session[], weekDate: string) {
  const today = todayIso();
  const attendance = getWeeklyAttendanceStats(patient, sessions, weekDate);
  const attendanceTone = getAttendanceTone(patient, sessions, weekDate);
  const drug = getDrugTestSummary(patient, compliance, weekDate);
  const problemList = getProblemListSummary(compliance);
  const treatmentPlan = getTreatmentPlanSummary(patient, compliance);
  const items: WorkItem[] = [];

  if (attendance.goal) {
    let detail = "";
    if (attendance.goal.kind === "range") {
      detail =
        attendanceTone === "behind"
          ? `${fmtHours(attendance.goal.minHours - attendance.attendedHours)} left to hit the weekly minimum`
          : attendanceTone === "over"
            ? `${fmtHours(attendance.attendedHours - attendance.goal.maxHours)} over target range`
            : `${fmtHours(attendance.attendedHours)} logged this week`;
    } else {
      detail =
        attendanceTone === "over"
          ? `${fmtHours(attendance.attendedHours - attendance.goal.maxHours)} over weekly cap`
          : `${fmtHours(attendance.attendedHours)} logged this week`;
    }

    items.push({
      id: `${patient.id}-attendance`,
      tone: attendanceTone,
      title: "Attendance",
      detail,
      sortScore: attendanceTone === "behind" ? 0 : attendanceTone === "over" ? 1 : 5,
    });
  }

  items.push({
    id: `${patient.id}-drug`,
    tone: drug.tone as WorkItem["tone"],
    title: "Drug testing",
    detail: drug.label,
    sortScore: drug.tone === "behind" ? 1 : drug.tone === "neutral" ? 3 : 6,
  });

  items.push({
    id: `${patient.id}-treatment`,
    tone: problemList.tone as WorkItem["tone"],
    title: "Problem list",
    detail: problemList.tone === "behind" ? `${problemList.reviewText} • ${problemList.updateText}` : problemList.reviewText,
    sortScore: problemList.tone === "behind" ? 1 : problemList.tone === "neutral" ? 3 : 6,
  });

  items.push({
    id: `${patient.id}-tx-plan`,
    tone: treatmentPlan.tone as WorkItem["tone"],
    title: "Treatment plan",
    detail: treatmentPlan.tone === "behind" ? `${treatmentPlan.reviewText} • ${treatmentPlan.updateText}` : treatmentPlan.updateText,
    sortScore: treatmentPlan.tone === "behind" ? 2 : treatmentPlan.tone === "neutral" ? 4 : 7,
  });

  if (patient.nextApptDate) {
    const days = dayDiff(today, patient.nextApptDate);
    const tone = days < 0 ? "behind" : days <= 2 ? "neutral" : "good";
    items.push({
      id: `${patient.id}-appt`,
      tone,
      title: "Next appointment",
      detail: days < 0 ? `Follow-up missed ${fmt(patient.nextApptDate)}` : days === 0 ? "Appointment due today" : `Scheduled ${fmt(patient.nextApptDate)}`,
      sortScore: tone === "behind" ? 2 : tone === "neutral" ? 4 : 7,
    });
  }

  return items.sort((a, b) => a.sortScore - b.sortScore);
}

function toneLabel(tone: "good" | "neutral" | "behind" | "over") {
  if (tone === "good") return "On track";
  if (tone === "behind") return "Needs attention";
  if (tone === "over") return "Review";
  return "Upcoming";
}

function mergePatientWithExtras(row: any, extras: PatientExtras | undefined, rosterDetails: PatientRosterDetails | undefined): Patient {
  const normalizedKind = toPatientKind(row.status);
  const intakeDate = row.intake_date;
  const kind = normalizedKind === "New Patient" && intakeDate && dayDiff(intakeDate, todayIso()) > 20
    ? "Current Patient"
    : normalizedKind;

  return {
    id: normalizePatientId(row.id),
    displayName: row.full_name || "Unknown",
    mrn: row.mrn,
    kind,
    intakeDate,
    lastVisitDate: row.last_visit_date,
    nextApptDate: row.next_appt_date,
    primaryProgram: row.primary_program,
    counselor: row.counselor_name,
    flags: row.flags || [],
    drugTests: extras?.drugTests ?? [],
    rosterDetails,
  };
}

function mapPatientRow(row: any) {
  const normalizedId = normalizePatientId(row.id);
  return mergePatientWithExtras(
    { ...row, id: normalizedId },
    undefined,
    undefined
  );
}

function buildSessions(sessionRows: any[], attendeeRows: any[]): Session[] {
  const byId = new Map<string, Session>();

  (sessionRows ?? []).forEach((row: any) => {
    byId.set(row.id, {
      id: row.id,
      kind: row.kind,
      title: row.title,
      date: row.date,
      durationHours: toSessionHours(row.duration_hours),
      location: row.location ?? undefined,
      patientIds: [],
      attendance: {},
    });
  });

  (attendeeRows ?? []).forEach((row: any) => {
    const session = byId.get(row.session_id);
    if (!session) return;
    const patientId = normalizePatientId(row.patient_id);
    session.patientIds.push(patientId);
    session.attendance[patientId] = row.status;
  });

  return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function AttendanceTrendGraph({ patient, sessions }: { patient: Patient; sessions: Session[] }) {
  const weeks = useMemo(() => getWeeklyHistory(patient, sessions), [patient, sessions]);
  const goal = getAttendanceGoal(patient.primaryProgram);

  if (!weeks.length) {
    return (
      <div className="attendanceTrendCard">
        <div className="sectionTitle">Attendance flow</div>
        <div className="attendanceMeterEmpty">Weekly trend will appear after this patient has attended sessions.</div>
      </div>
    );
  }

  const maxHours = Math.max(goal?.maxHours ?? 0, ...weeks.map((w) => w.hours), 1);
  const points = weeks
    .map((week, index) => {
      const x = weeks.length === 1 ? 50 : (index / (weeks.length - 1)) * 100;
      const y = 100 - (week.hours / maxHours) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const minY = goal?.kind === "range" ? 100 - (goal.minHours / maxHours) * 100 : null;
  const maxY = goal ? 100 - (goal.maxHours / maxHours) * 100 : null;

  return (
    <div className="attendanceTrendCard">
      <div className="attendanceTrendHead">
        <div className="sectionTitle" style={{ marginBottom: 0 }}>Attendance flow</div>
        <div className="attendanceMeterRange">
          {goal ? (goal.kind === "range" ? `${goal.minHours}-${goal.maxHours}h target` : `Up to ${goal.maxHours}h target`) : "No program target"}
        </div>
      </div>
      <div className="attendanceTrendChart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="attendanceTrendSvg" aria-hidden="true">
          {maxY !== null ? <line x1="0" y1={maxY} x2="100" y2={maxY} className="attendanceTrendTarget" /> : null}
          {minY !== null ? <line x1="0" y1={minY} x2="100" y2={minY} className="attendanceTrendMinimum" /> : null}
          <polyline points={points} className="attendanceTrendLine" />
          {weeks.map((week, index) => {
            const x = weeks.length === 1 ? 50 : (index / (weeks.length - 1)) * 100;
            const y = 100 - (week.hours / maxHours) * 100;
            return <circle key={week.weekStart} cx={x} cy={y} r="2.4" className="attendanceTrendPoint" />;
          })}
        </svg>
      </div>
      <div className="attendanceTrendLabels">
        {weeks.map((week) => (
          <div key={week.weekStart} className="attendanceTrendLabel">
            <strong>{week.label}</strong>
            <span>{fmtHours(week.hours)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyAttendanceMeter({
  patient,
  sessions,
  weekDate,
  compact = false,
}: {
  patient: Patient;
  sessions: Session[];
  weekDate: string;
  compact?: boolean;
}) {
  const stats = useMemo(() => getWeeklyAttendanceStats(patient, sessions, weekDate), [patient, sessions, weekDate]);
  const { goal, start, end, weeklySessions, attendedHours, scheduledHours, presentCount } = stats;
  const weeklyGroupTarget = getWeeklyGroupTarget(patient.primaryProgram);
  const totalGroupsAttended = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.kind === "Group" &&
          session.patientIds.includes(patient.id) &&
          (session.attendance[patient.id] ?? "Absent") === "Present"
      ).length,
    [patient.id, sessions]
  );
  const daysSinceIntake = Math.max(0, dayDiff(patient.intakeDate, todayIso()));
  const weeksSinceIntake = Math.max(1, Math.ceil((daysSinceIntake + 1) / 7));
  const expectedGroups = weeklyGroupTarget ? weeklyGroupTarget * weeksSinceIntake : null;

  if (!goal) {
    return (
      <div className={`attendanceMeter${compact ? " compact" : ""}`}>
        <div className="attendanceMeterHeader">
          <div className="attendanceMeterTitle">Weekly attendance</div>
          <div className="attendanceMeterRange">{fmt(start)} - {fmt(end)}</div>
        </div>
        <div className="attendanceMeterEmpty">Set the patient program to `1.0` or `2.1` to track required hours.</div>
      </div>
    );
  }

  const cap = goal.maxHours;
  const fillPct = Math.min((attendedHours / cap) * 100, 100);
  const minPct = goal.kind === "range" ? (goal.minHours / goal.maxHours) * 100 : 100;

  let tone: "behind" | "good" | "over" = "good";
  let summary = "";

  if (goal.kind === "range") {
    if (attendedHours < goal.minHours) {
      tone = "behind";
      summary = `${fmtHours(goal.minHours - attendedHours)} left to hit the weekly minimum`;
    } else if (attendedHours > goal.maxHours) {
      tone = "over";
      summary = `${fmtHours(attendedHours - goal.maxHours)} over the weekly range`;
    } else {
      tone = "good";
      summary = "Within the required weekly range";
    }
  } else if (attendedHours > goal.maxHours) {
    tone = "over";
    summary = `${fmtHours(attendedHours - goal.maxHours)} over the weekly cap`;
  } else {
    tone = "good";
    summary = `${fmtHours(goal.maxHours - attendedHours)} left before the weekly cap`;
  }

  return (
    <div className={`attendanceMeter ${tone}${compact ? " compact" : ""}`}>
      <div className="attendanceMeterHeader">
        <div>
          <div className="attendanceMeterTitle">Weekly attendance</div>
          <div className="attendanceMeterRange">{goal.label} • {fmt(start)} - {fmt(end)}</div>
        </div>
        <div className="attendanceMeterHours">
          {fmtHours(attendedHours)}
          <span>{goal.kind === "range" ? ` / ${goal.minHours}-${goal.maxHours}h` : ` / ${goal.maxHours}h`}</span>
        </div>
      </div>

      <div className="attendanceTrackWrap">
        <div className="attendanceTrack">
          <div className="attendanceFill" style={{ width: `${fillPct}%` }} />
          {goal.kind === "range" ? <div className="attendanceMinMarker" style={{ left: `${minPct}%` }} /> : null}
        </div>
        <div className="attendanceTrackLabels">
          <span>0</span>
          {goal.kind === "range" ? <span>{goal.minHours}h min</span> : <span>goal</span>}
          <span>{goal.maxHours}h</span>
        </div>
      </div>

      <div className="attendanceMeterFooter">
        <span>{summary}</span>
        <span>{presentCount} present{presentCount === 1 ? "" : "s"} • {fmtHours(scheduledHours)} scheduled</span>
      </div>

      {weeklyGroupTarget ? (
        <div className="attendanceMetricLine">
          Groups attended: {totalGroupsAttended} / {expectedGroups} expected ({weeklyGroupTarget}/week)
        </div>
      ) : null}

      {!compact && weeklySessions.length ? (
        <div className="attendanceSessionList">
          {weeklySessions.map((session) => {
            const status = session.attendance[patient.id] ?? "Absent";
            return (
              <div key={session.id} className="attendanceSessionRow">
                <span>{fmt(session.date)} • {session.title}</span>
                <span>{fmtHours(toSessionHours(session.durationHours))} • {status}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Status normalizer (handles legacy DB values like 'new'/'active') ---- */
function toPatientKind(status: string | null | undefined): PatientKind {
  if (!status) return "New Patient";
  const s = status.toLowerCase();
  if (s === "new patient" || s === "new enrollee" || s === "new") return "New Patient";
  if (s === "current patient" || s === "current" || s === "active patient" || s === "active") return "Current Patient";
  if (s === "rss+" || s === "rss_plus" || s === "rss plus") return "RSS+";
  if (s === "rss") return "RSS";
  if (s === "former patient" || s === "former" || s === "past patient" || s === "past" || s === "inactive") return "Former Patient";
  return "New Patient";
}

/* ---- Medical questions (from medical.html QUESTIONS array) ---- */
const MEDICAL_QUESTIONS: Array<{ n: number; text: string; type: string; allowNA?: boolean }> = [
  { n: 1,  type: "details", text: "Have you ever had a heart attack or any problem associated with the heart? If yes, list when, diagnosis, and if currently taking medication." },
  { n: 2,  type: "details", text: "Are you currently experiencing chest pain(s)? If yes, give details." },
  { n: 3,  type: "details", text: "Do you have any serious health problems or illnesses (such as tuberculosis or active pneumonia) that may be contagious to others around you? If yes, give details." },
  { n: 4,  type: "details", text: "Have you ever tested positive for tuberculosis? If yes, when? Give details." },
  { n: 5,  type: "details", text: "Have you ever been treated for HIV or AIDS? If yes, when? Give details." },
  { n: 6,  type: "details", text: "Have you ever tested positive for a sexually transmitted infection? If yes, give details and list any medications you are taking." },
  { n: 7,  type: "details", text: "Have you had a head injury in the last six (6) months? Have you ever had a head injury that resulted in a period of loss of consciousness? If yes, give details." },
  { n: 8,  type: "details", text: "Have you ever been diagnosed with diabetes? If yes, give details including insulin, oral medications, or special diet." },
  { n: 9,  type: "details", text: "Do you have any open lesions/wounds? If yes, explain and list any medications you are taking." },
  { n: 10, type: "details", text: "Have you ever had any form of seizures, delirium tremens or convulsions? If yes, give date of last episode(s) and list any medications you are taking." },
  { n: 11, type: "details", text: "Do you use a C-PAP machine or are you dependent upon oxygen? If yes, explain." },
  { n: 12, type: "details", text: "Have you ever had a stroke? If yes, give details." },
  { n: 13, type: "details", allowNA: true, text: "Are you pregnant?" },
  { n: 14, type: "details", allowNA: true, text: "Are you receiving prenatal care?" },
  { n: 15, type: "details", allowNA: true, text: "Any complications? If yes, explain." },
  { n: 16, type: "details", text: "Do you have a history of any other illness that may require frequent medical attention? If yes, give details and list any medications you are taking." },
  { n: 17, type: "details", text: "Have you ever had blood clots in the legs or elsewhere that required medical attention? If yes, give details." },
  { n: 18, type: "details", text: "Have you ever had high blood pressure or hypertension? If yes, give details." },
  { n: 19, type: "details", text: "Do you have a history of cancer? If yes, give details and list any medications you are taking." },
  { n: 20, type: "details", text: "Do you have any allergies to medications, foods, animals, chemicals, or any other substance? If yes, give details and list any medications you are taking." },
  { n: 21, type: "details", text: "Have you ever had an ulcer, gallstones, internal bleeding, or any type of bowel or colon inflammation? If yes, give details." },
  { n: 22, type: "details", text: "Have you ever been diagnosed with any type of hepatitis or other liver illness? If yes, give details and list any medications you are taking." },
  { n: 23, type: "details", text: "Have you ever been told you had problems with your thyroid gland, been treated for, or told you need to be treated for any other type of glandular disease? If yes, give details." },
  { n: 24, type: "details", text: "Do you currently have any lung diseases such as asthma, emphysema, or chronic bronchitis? If yes, give details." },
  { n: 25, type: "details", text: "Have you ever had kidney stones or kidney infections, or had problems, or been told you have problems with your kidneys or bladder? If yes, give details." },
  { n: 26, type: "details", text: "Do you have any of the following: arthritis, back problems, bone injuries, muscle injuries, or joint injuries? If yes, give details including any ongoing pain or disabilities." },
  { n: 27, type: "details", text: "Do you take over the counter pain medications such as aspirin, Tylenol, or ibuprofen? If yes, list the medication(s) and how often you take it." },
  { n: 28, type: "details", text: "Do you take over the counter digestive medications such as Tums or Maalox? If yes, list the medication(s) and how often you take it." },
  { n: 29, type: "details", text: "Do you wear or need to wear glasses, contact lenses, or hearing aids? If yes, give details." },
  { n: 30, type: "date",    text: "When was your last dental exam?" },
  { n: 31, type: "details", text: "Are you in need of dental care? If yes, give details." },
  { n: 32, type: "details", text: "Do you wear or need to wear dentures or other dental appliances that may require dental care? If yes, give details." },
  { n: 33, type: "details", text: "Have you had any surgeries or hospitalizations due to illness or injury in the past? If yes, give details." },
  { n: 34, type: "date_text", text: "When was the last time you saw a physician and/or psychiatrist? Please include the purpose of the visit." },
  { n: 35, type: "table_drugs_7d_na", text: "In the past seven days what types of drugs, including alcohol, have you used?" },
  { n: 36, type: "table_drugs_1y_na", text: "In the past year what types of drugs, including alcohol, have you used?" },
  { n: 37, type: "meds_na", text: "Do you take any prescription medications including psychiatric medications? (If yes, list type of drug and route of administration; then list prescribed medication previously consumed.)" },
  { n: 38, type: "details", text: "Are you currently feeling down, depressed, anxious or hopeless? If yes, describe." },
  { n: 39, type: "details", text: "Are you currently receiving treatment services for an emotional/psychiatric diagnosis? If yes, for what are you being treated?" },
  { n: 40, type: "details", text: "Over the last 2 weeks, have you felt nervous, anxious, or on edge? Did you feel unable to stop or control your worrying? If yes, describe." },
  { n: 41, type: "details", text: "Over the last 2 weeks, have you had thoughts of suicide or thought that you would be better off dead? If yes, describe." },
  { n: 42, type: "details", text: "Have you attempted suicide in the past two (2) years? If yes, give dates." },
  { n: 43, type: "details", text: "Have you ever harmed yourself/others or thought about harming yourself/others? If yes, describe." },
  { n: 44, type: "details", text: "Are you currently feeling that you're hearing voices or seeing things? If yes, describe." },
  { n: 45, type: "details", text: "Have you ever been in a relationship where your partner has pushed or slapped you? If yes, describe." },
  { n: 46, type: "table_treatment_na", text: "Have you received alcoholism or drug abuse recovery treatment services in the past? If yes, give details (type, facility, dates, completed)." },
  { n: 47, type: "details", text: "Have you ever been treated for withdrawal symptoms? If yes, state dates treated and list any medications prescribed." },
];

const LS_THEME = "pf_theme";

const THEMES = [
  { id: "cosmos",   label: "Cosmos"   },
  { id: "midnight", label: "Midnight" },
  { id: "slate",    label: "Slate"    },
  { id: "mulberry", label: "Mulberry" },
  { id: "snow",     label: "Snow"     },
  { id: "warm",     label: "Warm"     },
  { id: "dune",     label: "Dune"     },
  { id: "lagoon",   label: "Lagoon"   },
  { id: "ember",    label: "Ember"    },
] as const;

type ThemeId = typeof THEMES[number]["id"];

const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  forest: "mulberry",
  aurora: "dune",
};

function normalizeThemeId(value: string | null): ThemeId {
  const candidate = (value && (LEGACY_THEME_MAP[value] ?? value)) || "cosmos";
  return THEMES.some((theme) => theme.id === candidate) ? candidate as ThemeId : "cosmos";
}

const THEME_COLORS: Record<ThemeId, string> = {
  cosmos:   "#2a1f3e",
  midnight: "#0d1422",
  slate:    "#252f45",
  mulberry: "#47243f",
  snow:     "#e8ecf2",
  warm:     "#e4c9a8",
  dune:     "#7b5836",
  lagoon:   "#103a44",
  ember:    "#44231a",
};

/* -------------------- App -------------------- */

export default function App() {
  const azureAuth = useAzureAuth();
  const publicGroupToken = getPublicGroupTokenFromPath();
  const azureDemoSessionKey = "patientfinder.azure-demo.session.v1";
  const [azureDemoSession, setAzureDemoSession] = useState<AzureDemoSession | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(azureDemoSessionKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AzureDemoSession;
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<AuthMode>("demo");
  const [authOptionsError, setAuthOptionsError] = useState<string | null>(null);
  const [azureDemoUsers, setAzureDemoUsers] = useState<AzureDemoUser[]>([]);
  const [route, setRoute] = useState<AuthedRoute>({ name: "home" });
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [jsonImporting, setJsonImporting] = useState(false);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [directoryPatients, setDirectoryPatients] = useState<Patient[]>([]);
  const [patientDetail, setPatientDetail] = useState<Patient | null>(null);
  const [patientDetailLoading, setPatientDetailLoading] = useState(false);
  const [patientDetailError, setPatientDetailError] = useState<string | null>(null);
  const [caseAssignments, setCaseAssignments] = useState<Record<string, string>>({});
  const [caseAssignmentEmails, setCaseAssignmentEmails] = useState<Record<string, string>>({});
  const [complianceByPatient, setComplianceByPatient] = useState<Record<string, PatientCompliance>>({});
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [teammateEmails, setTeammateEmails] = useState<string[]>([]);
  const [showNotificationComposer, setShowNotificationComposer] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ notificationId: string; patientName: string; title: string } | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<{ patientId: string; patientName: string } | null>(null);
  const [patientDocumentsTabActive, setPatientDocumentsTabActive] = useState(false);
  const [privacyLocked, setPrivacyLocked] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileGlanceOpen, setMobileGlanceOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [desktopGlanceOpen, setDesktopGlanceOpen] = useState(false);
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const [lockJokeIndex, setLockJokeIndex] = useState(() => Math.floor(Math.random() * LOCK_SCREEN_JOKES.length));

  const [sessions, setSessions] = useState<Session[]>([]);
  const [billingEntries, setBillingEntries] = useState<BillingEntry[]>([]);
  const [groupSessions, setGroupSessions] = useState<GroupSessionSummary[]>([]);
  const [openingGroupId, setOpeningGroupId] = useState<string | null>(null);
  const [liveGroupState, setLiveGroupState] = useState<LiveGroupSessionState | null>(null);
  const [liveGroupBusy, setLiveGroupBusy] = useState(false);
  const [liveGroupError, setLiveGroupError] = useState<string | null>(null);
  const [liveGroupSuccess, setLiveGroupSuccess] = useState<string | null>(null);
  const [isMobileWorkspace, setIsMobileWorkspace] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 720 : false
  );

  const [view, setView] = useState<ViewMode>("sheet");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [kindFilter, setKindFilter] = useState<PatientKindFilter>("all");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilterKey | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("roster");
  const dataClient = getDataClient();

  const [search, setSearch] = useState("");
  const { raw: qRaw, compact: qCompact } = useMemo(() => normalizeQuery(search), [search]);
  const [patientPage, setPatientPage] = useState(0);
  const patientPageSize = 50;
  const [patientTotal, setPatientTotal] = useState(0);

  const [forceRoster, setForceRoster] = useState(false);
  const [caseLoadOnly, setCaseLoadOnly] = useState(true);
  const debugPatientFlow =
    String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "1" ||
    String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "true" ||
    import.meta.env.DEV;

  useEffect(() => {
    setPatientPage(0);
  }, [qRaw, kindFilter, sortKey, sortDir, forceRoster, caseLoadOnly]);

  useEffect(() => {
    let cancelled = false;
    void getAzureAuthOptions()
      .then((payload) => {
        if (!cancelled) {
          setAuthOptionsError(null);
          setAuthMode(payload.authMode ?? "demo");
          setAzureDemoUsers(payload.authMode === "demo" ? (payload.demoUsers ?? []) : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthMode("demo");
          setAzureDemoUsers([]);
          setAuthOptionsError(getRequestErrorMessage(error, "Unable to resolve auth mode from Azure API."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isEntraMode = authMode === "entra" && azureAuth.enabled;
  const activeAuthUser = isEntraMode
    ? (azureAuth.user
      ? {
          id: azureAuth.user.id,
          email: azureAuth.user.email,
          name: azureAuth.user.name,
          roles: azureAuth.roles,
        }
      : null)
    : (azureDemoSession?.user ?? null);
  const activeAccessToken = isEntraMode ? azureAuth.accessToken : (azureDemoSession?.accessToken ?? null);
  const hasCounselorRole = activeAuthUser?.roles.includes("Counselor") ?? false;
  const hasAdminRole = activeAuthUser?.roles.includes("Admin") ?? false;
  const hasIntakeRole = activeAuthUser?.roles.includes("Intake") ?? false;
  const hasKnownWorkspaceRole = hasCounselorRole || hasAdminRole || hasIntakeRole;
  const authReadyForApi = isEntraMode
    ? Boolean(activeAuthUser && activeAccessToken && !azureAuth.loading)
    : Boolean(activeAuthUser && activeAccessToken);

  useEffect(() => {
    setAzureApiAccessTokenProvider(async () => activeAccessToken);
    if (typeof window !== "undefined") {
      if (azureDemoSession) {
        window.localStorage.setItem(azureDemoSessionKey, JSON.stringify(azureDemoSession));
      } else {
        window.localStorage.removeItem(azureDemoSessionKey);
      }
    }
  }, [activeAccessToken, azureDemoSession]);

  useEffect(() => {
    if (!activeAuthUser) return;
    if (!hasKnownWorkspaceRole) {
      // Fallback for missing/partial role claims: keep roster visible instead of blanking the workspace.
      setForceRoster(true);
      setCaseLoadOnly(false);
      return;
    }
    setForceRoster(hasAdminRole || hasIntakeRole);
    setCaseLoadOnly(hasCounselorRole && !hasAdminRole && !hasIntakeRole);
  }, [activeAuthUser, hasAdminRole, hasCounselorRole, hasIntakeRole, hasKnownWorkspaceRole]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewport = () => setIsMobileWorkspace(window.innerWidth <= 720);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (isMobileWorkspace && view === "split") {
      setView("cards");
    }
  }, [isMobileWorkspace, view]);

  useEffect(() => {
    if (!privacyLocked) return;
    setLockJokeIndex(Math.floor(Math.random() * LOCK_SCREEN_JOKES.length));
    const interval = window.setInterval(() => {
      setLockJokeIndex((current) => (current + 1) % LOCK_SCREEN_JOKES.length);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [privacyLocked]);

  useEffect(() => {
    if (!isMobileWorkspace || privacyLocked) {
      setMobileMenuOpen(false);
      setMobileGlanceOpen(false);
      setMobileSearchOpen(false);
    }
  }, [isMobileWorkspace, privacyLocked]);

  useEffect(() => {
    if (isMobileWorkspace || privacyLocked) {
      setDesktopMenuOpen(false);
    }
  }, [isMobileWorkspace, privacyLocked]);

  useEffect(() => {
    if (isMobileWorkspace || privacyLocked) {
      setDesktopGlanceOpen(false);
      setDesktopSearchOpen(false);
    }
  }, [isMobileWorkspace, privacyLocked]);

  const activeUserId = String(activeAuthUser?.id ?? activeAuthUser?.email ?? "azure-demo-user").toLowerCase();
  const activeUserEmail = activeAuthUser?.email ?? "";
  const mobileInstallBaseUrl = String(import.meta.env.VITE_MOBILE_INSTALL_URL ?? "").trim();
  const expoGoUrl = String(import.meta.env.VITE_EXPO_GO_URL ?? "").trim();
  const mobileInstallCode = hashInstallSeed(`${activeUserId}:patientfinder-mobile`);
  const mobileInstallUrl = mobileInstallBaseUrl
    ? `${mobileInstallBaseUrl}${mobileInstallBaseUrl.includes("?") ? "&" : "?"}invite=${encodeURIComponent(mobileInstallCode)}`
    : "";
  const iosInstallTarget = expoGoUrl || mobileInstallUrl;
  const expoGoInfoUrl = "https://expo.dev/go";
  const counselorId = activeUserId;
  const counselorLabel = activeUserEmail?.split("@")[0] ?? "My";

  const loadDashboardData = useEffectEvent(async () => {
    if (!authReadyForApi) {
      if (debugPatientFlow) {
        console.info("[patient-flow][frontend][dashboard-skip]", {
          reason: "auth_not_ready",
          isEntraMode,
          hasAuthUser: Boolean(activeAuthUser),
          hasAccessToken: Boolean(activeAccessToken),
          azureAuthLoading: azureAuth.loading,
        });
      }
      return;
    }
    setLoadingPatients(true);
    setLoadError(null);

    let patientsRows: any[] = [];
    let totalPatientsRows = 0;
    let assignmentsRows: any[] = [];
    let complianceRows: any[] = [];
    let drugTestsRows: any[] = [];
    let sessionsRows: any[] = [];
    let attendeeRows: any[] = [];
    let rosterRows: any[] = [];
    let notificationsRows: any[] = [];
    let billingRows: any[] = [];
    let groupRows: GroupSessionSummary[] = [];

    try {
      const statusMap: Record<PatientKind, "new" | "current" | "rss_plus" | "rss" | "former"> = {
        "New Patient": "new",
        "Current Patient": "current",
        "RSS+": "rss_plus",
        "RSS": "rss",
        "Former Patient": "former",
      };
      const patientStatus = kindFilter === "all" || kindFilter === "Former Recent" || kindFilter === "Former Archived"
        ? undefined
        : statusMap[kindFilter];
      const pastTier = kindFilter === "Former Recent" ? "recent" : kindFilter === "Former Archived" ? "archived" : undefined;
      const shouldHideUnscopedRoster = !forceRoster && !caseLoadOnly && !qRaw;
      const patientsPagePromise = shouldHideUnscopedRoster
        ? Promise.resolve({ patients: [], total: 0, limit: patientPageSize, offset: patientPage * patientPageSize })
        : dataClient.getPatientsPage({
            q: qRaw || undefined,
            status: patientStatus,
            pastTier,
            assignedToUserId: caseLoadOnly ? counselorId : undefined,
            assignedToEmail: caseLoadOnly ? activeUserEmail.toLowerCase() : undefined,
            sortKey,
            sortDir,
            limit: patientPageSize,
            offset: patientPage * patientPageSize,
          });

      if (debugPatientFlow) {
        console.info("[patient-flow][frontend][dashboard-load-start]", {
          isEntraMode,
          hasAccessToken: Boolean(activeAccessToken),
          qRaw,
          kindFilter,
          patientPage,
          patientPageSize,
          dataSource: "azure-api -> postgresql",
        });
      }
      const [dashboard, groups, patientsPage] = await Promise.all([
        dataClient.getDashboard({ includePatients: false }),
        dataClient.getGroupSessions(),
        patientsPagePromise,
      ]);
      patientsRows = (patientsPage.patients as any[]) ?? [];
      totalPatientsRows = Number(patientsPage.total ?? 0);
      if (debugPatientFlow) {
        console.info("[patient-flow][frontend][dashboard-load-success]", {
          patientsCount: patientsRows.length,
          totalPatientsRows,
          groupsCount: (groups ?? []).length,
        });
      }
      assignmentsRows = (dashboard.assignments as any[]) ?? [];
      complianceRows = (dashboard.compliance as any[]) ?? [];
      drugTestsRows = (dashboard.drugTests as any[]) ?? [];
      sessionsRows = (dashboard.sessions as any[]) ?? [];
      attendeeRows = (dashboard.attendanceSessionPatients as any[]) ?? [];
      rosterRows = (dashboard.rosterDetails as any[]) ?? [];
      notificationsRows = (dashboard.notifications as any[]) ?? [];
      billingRows = (dashboard.billingEntries as any[]) ?? [];
      groupRows = groups;
    } catch (error) {
      console.error("Error fetching Azure API dashboard:", error);
      const errorMessage = getRequestErrorMessage(error, "Unable to load patient roster.");
      const authFailure = /401|sign-in is required|could not be verified|unauthorized/i.test(errorMessage);
      if (!isEntraMode && authFailure) {
        // Demo token expired/invalid: force a clean re-login instead of leaving a blank roster shell.
        setAzureDemoSession(null);
        setPatients([]);
        setCaseAssignments({});
        setCaseAssignmentEmails({});
      }
      setLoadError(getRequestErrorMessage(error, "Unable to load patient roster."));
      setLoadingPatients(false);
      return;
    }

    const nextAssignments: Record<string, string> = {};
    const nextAssignmentEmails: Record<string, string> = {};
    const nextTeammateEmails = new Set<string>();
    assignmentsRows.forEach((row: any) => {
      const patientId = normalizePatientId(row.patient_id);
      nextAssignments[patientId] = String(row.counselor_user_id ?? row.counselor_email ?? "").toLowerCase();
      if (row.counselor_email) {
        const counselorEmail = String(row.counselor_email).toLowerCase();
        nextAssignmentEmails[patientId] = counselorEmail;
        nextTeammateEmails.add(counselorEmail);
      }
    });
    if (activeUserEmail) nextTeammateEmails.add(activeUserEmail.toLowerCase());

    const nextCompliance: Record<string, PatientCompliance> = {};
    complianceRows.forEach((row: any) => {
      nextCompliance[normalizePatientId(row.patient_id)] = {
        drugTestMode: row.drug_test_mode ?? "none",
        drugTestsPerWeek: row.drug_tests_per_week ?? undefined,
        drugTestWeekday: row.drug_test_weekday != null ? String(row.drug_test_weekday) : undefined,
        problemListDate: row.problem_list_date ?? row.treatment_plan_date ?? undefined,
        lastProblemListReview: row.last_problem_list_review ?? row.last_treatment_plan_review ?? undefined,
        lastProblemListUpdate: row.last_problem_list_update ?? row.last_treatment_plan_update ?? undefined,
        treatmentPlanDate: row.treatment_plan_date ?? undefined,
        lastTreatmentPlanUpdate: row.treatment_plan_update ?? row.last_treatment_plan_update ?? undefined,
      };
    });

    const nextExtras: Record<string, PatientExtras> = {};
    drugTestsRows.forEach((row: any) => {
      const patientId = normalizePatientId(row.patient_id);
      if (!nextExtras[patientId]) nextExtras[patientId] = { drugTests: [] };
      nextExtras[patientId].drugTests!.push({
        id: row.id,
        date: row.date,
        testType: row.test_type,
        result: row.result,
        substances: row.substances ?? undefined,
        notes: row.notes ?? undefined,
      });
    });

    const nextRosterDetails: Record<string, PatientRosterDetails> = {};
    rosterRows.forEach((row: any) => {
      nextRosterDetails[normalizePatientId(row.patient_id)] = {
        drugOfChoice: Array.isArray(row.drug_of_choice) ? row.drug_of_choice : undefined,
        medicalPhysApt: row.medical_phys_apt ?? undefined,
        medFormStatus: row.med_form_status ?? undefined,
        notes: row.notes ?? undefined,
        referringAgency: row.referring_agency ?? undefined,
        reauthSapcDate: row.reauth_sapc_date ?? undefined,
        medicalEligibility: row.medical_eligibility ?? undefined,
        matStatus: row.mat_status ?? undefined,
        therapyTrack: row.therapy_track ?? undefined,
      };
    });

    setCaseAssignments(nextAssignments);
    setCaseAssignmentEmails(nextAssignmentEmails);
    setTeammateEmails([...nextTeammateEmails].sort());
    setComplianceByPatient(nextCompliance);
    setPatientTotal(totalPatientsRows);
    setPatients(
      patientsRows.map((row) => {
        const normalizedId = normalizePatientId(row.id);
        return mergePatientWithExtras(
          { ...row, id: normalizedId },
          nextExtras[normalizedId] ?? nextExtras[row.id],
          nextRosterDetails[normalizedId] ?? nextRosterDetails[row.id]
        );
      })
    );
    // If a counselor has no active assignments yet, default to full roster instead of an empty case-load view.
    if ((activeAuthUser?.roles.includes("Counselor") ?? false) && !(activeAuthUser?.roles.includes("Admin") ?? false)) {
      const assignedCount = patientsRows.filter((row: any) => nextAssignments[normalizePatientId(row.id)] === counselorId).length;
      if (assignedCount === 0 && patientsRows.length > 0) {
        setForceRoster(true);
        setCaseLoadOnly(false);
      }
    }
    setSessions(buildSessions(sessionsRows, attendeeRows));
    setBillingEntries(
      billingRows.map((row) => ({
        id: row.id,
        patientId: row.patient_id,
        sessionId: row.session_id ?? undefined,
        billingType: row.billing_type,
        serviceDate: row.service_date,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
        totalMinutes: Number(row.total_minutes ?? 0),
        modality: row.modality ?? undefined,
        naloxoneTraining: !!row.naloxone_training,
        matEducation: !!row.mat_education,
        createdAt: row.created_at,
      }))
    );
    setNotifications(
      notificationsRows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        priority: row.priority,
        patientId: row.patient_id ?? undefined,
        recipientEmail: row.recipient_email ?? undefined,
        recipientUserId: row.recipient_user_id ?? undefined,
        senderEmail: row.sender_email ?? undefined,
        createdAt: row.created_at,
        readAt: row.read_at ?? undefined,
      }))
    );
    setGroupSessions(groupRows);
    setLoadingPatients(false);
  });

  const loadPatientDirectory = useEffectEvent(async () => {
    if (!authReadyForApi) return;
    try {
      const rows = await dataClient.getPatients();
      setDirectoryPatients(((rows as any[]) ?? []).map((row) => mapPatientRow(row)));
    } catch (error) {
      console.error("Unable to load full patient directory:", error);
    }
  });

  useEffect(() => {
    if (!activeAuthUser) {
      setPatients([]);
      setDirectoryPatients([]);
      setCaseAssignments({});
      setCaseAssignmentEmails({});
      setPatientTotal(0);
      setComplianceByPatient({});
      setBillingEntries([]);
      setGroupSessions([]);
      setLiveGroupState(null);
      setLiveGroupError(null);
      setLiveGroupSuccess(null);
      setLiveGroupBusy(false);
      setLoadError(null);
      setPatientDocumentsTabActive(false);
      return;
    }

    if (route.name === "patient" && patientDocumentsTabActive) {
      return;
    }

    void loadDashboardData();
    void loadPatientDirectory();
  }, [
    activeAuthUser,
    authReadyForApi,
    patientPage,
    qRaw,
    kindFilter,
    sortKey,
    sortDir,
    forceRoster,
    caseLoadOnly,
    loadDashboardData,
    loadPatientDirectory,
    route.name,
    patientDocumentsTabActive,
  ]);


  const [theme, setThemeState] = useState<ThemeId>(() => {
    return normalizeThemeId(localStorage.getItem(LS_THEME));
  });

  const applyTheme = (t: ThemeId) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(LS_THEME, t);
  };

  useEffect(() => {
    // Sync DOM with saved theme (anti-flash script handles initial load)
    document.documentElement.setAttribute("data-theme", theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const indexed = useMemo(() => {
    return patients.map((p) => ({ p, idx: indexPatient(p) }));
  }, [patients]);
  const currentWeek = todayIso();

  const results = useMemo(() => {
    let rows = indexed;

    if (kindFilter !== "all") rows = rows.filter(({ p }) => matchesKindFilter(p, kindFilter, currentWeek));
    if (caseLoadOnly) rows = rows.filter(({ p }) => caseAssignments[p.id] === counselorId);

    if (qRaw) {
      rows = rows.filter(({ idx }) => {
        const rawHit = idx.raw.includes(qRaw);
        const compactHit = qCompact ? idx.compact.includes(qCompact) : false;
        return rawHit || compactHit;
      });
    } else if (!forceRoster && !caseLoadOnly) {
      rows = [];
    }

    if (dashboardFilter) {
      rows = rows.filter(({ p }) => {
        const due = getProblemListDueDates(complianceByPatient[p.id]);
        if (dashboardFilter === "dueReview") return due ? dayDiff(currentWeek, due.nextReview) <= 7 : false;
        if (dashboardFilter === "dueUpdate") return due ? dayDiff(currentWeek, due.nextUpdate) <= 14 : false;
        return getAttendanceTone(p, sessions, currentWeek) === "behind";
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = sortVal(a.p, sortKey);
      const bv = sortVal(b.p, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return rows.map((r) => r.p);
  }, [indexed, qRaw, qCompact, kindFilter, sortKey, sortDir, forceRoster, caseLoadOnly, caseAssignments, counselorId, dashboardFilter, complianceByPatient, currentWeek, sessions]);

  const patientPageStart = patientTotal ? patientPage * patientPageSize + 1 : 0;
  const patientPageEnd = Math.min(patientTotal, (patientPage + 1) * patientPageSize);
  const canPageBack = patientPage > 0;
  const canPageForward = patientPageEnd < patientTotal;

  const [selectedId, setSelectedId] = useState<string>(patients[0]?.id ?? "");
  const selected = useMemo(() => results.find((p) => p.id === selectedId) ?? results[0], [results, selectedId]);
  const caseLoadPatients = useMemo(
    () => patients.filter((patient) => caseAssignments[patient.id] === counselorId),
    [patients, caseAssignments, counselorId]
  );
  const dashboardScopePatients = useMemo(
    () => (forceRoster ? patients : caseLoadPatients),
    [forceRoster, patients, caseLoadPatients]
  );
  const operationalPatients = useMemo(
    () => (directoryPatients.length ? directoryPatients : patients),
    [directoryPatients, patients]
  );
  const billingPatients = useMemo(
    () => operationalPatients.filter((patient) => isBillingActivePatient(patient, currentWeek)),
    [operationalPatients, currentWeek]
  );

  useEffect(() => {
    // Deploy/data safety: if a counselor lands on an empty case-load, auto-fallback to full roster.
    if (loadingPatients) return;
    if (!hasCounselorRole || hasAdminRole || hasIntakeRole) return;
    if (!caseLoadOnly || forceRoster) return;
    if (!patients.length || caseLoadPatients.length) return;
    setForceRoster(true);
    setCaseLoadOnly(false);
  }, [
    loadingPatients,
    hasCounselorRole,
    hasAdminRole,
    hasIntakeRole,
    caseLoadOnly,
    forceRoster,
    patients.length,
    caseLoadPatients.length,
  ]);

  const dashboardMetrics = useMemo(() => {
    const dueReview = dashboardScopePatients.filter((patient) => {
      const due = getProblemListDueDates(complianceByPatient[patient.id]);
      return due ? dayDiff(currentWeek, due.nextReview) <= 7 : false;
    }).length;

    const dueUpdate = dashboardScopePatients.filter((patient) => {
      const due = getProblemListDueDates(complianceByPatient[patient.id]);
      return due ? dayDiff(currentWeek, due.nextUpdate) <= 14 : false;
    }).length;

    const behindAttendance = dashboardScopePatients.filter((patient) => getAttendanceTone(patient, sessions, currentWeek) === "behind").length;

    return {
      totalPatients: dashboardScopePatients.length,
      assignedPatients: caseLoadPatients.length,
      dueReview,
      dueUpdate,
      behindAttendance,
    };
  }, [dashboardScopePatients, caseLoadPatients, complianceByPatient, sessions, currentWeek]);

  const agendaRows = useMemo(() => {
    const source = results.length
      ? results
      : patients.filter((patient) => caseAssignments[patient.id] === counselorId);

    return source
      .flatMap((patient) =>
        getPatientWorkItems(patient, complianceByPatient[patient.id], sessions, currentWeek).map((item) => ({
          patient,
          item,
        }))
      )
      .sort((a, b) => a.item.sortScore - b.item.sortScore || a.patient.displayName.localeCompare(b.patient.displayName))
      .slice(0, 8);
  }, [results, patients, caseAssignments, counselorId, complianceByPatient, sessions, currentWeek]);

  const counselorSpotlightNotes = useMemo(() => {
    if (hasAdminRole || !hasCounselorRole) return [];
    const email = activeUserEmail.toLowerCase();

    return notifications
      .filter(
        (note) =>
          note.patientId &&
          !note.readAt &&
          ((note.recipientEmail && note.recipientEmail.toLowerCase() === email) || (note.recipientUserId && note.recipientUserId === activeUserId))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 4)
      .map((note) => {
        const patient = patients.find((entry) => entry.id === note.patientId);
        if (!patient) return null;
        return { note, patient };
      })
      .filter((entry): entry is { note: InAppNotification; patient: Patient } => Boolean(entry));
  }, [notifications, patients, hasAdminRole, hasCounselorRole, activeUserEmail, activeUserId]);
  const adminInboxNotes = useMemo(() => {
    if (!hasAdminRole) return [];
    const email = activeUserEmail.toLowerCase();

    return notifications
      .filter(
        (note) =>
          !note.readAt &&
          ((note.recipientEmail && note.recipientEmail.toLowerCase() === email) || (note.recipientUserId && note.recipientUserId === activeUserId))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((note) => {
        const patient = note.patientId ? patients.find((entry) => entry.id === note.patientId) : null;
        if (!patient) return null;
        return { note, patient };
      })
      .filter((entry): entry is { note: InAppNotification; patient: Patient } => Boolean(entry));
  }, [notifications, patients, hasAdminRole, activeUserEmail, activeUserId]);
  const highlightedNotes = hasAdminRole ? adminInboxNotes : counselorSpotlightNotes;

  const applyDashboardFilter = (filter: DashboardFilterKey) => {
    setDashboardFilter((current) => current === filter ? null : filter);
    setWorkspaceTab("roster");
    setMobileGlanceOpen(false);
    setDesktopGlanceOpen(false);
  };

  useEffect(() => {
    if (!results.length) return;
    if (!selectedId || !results.some((p) => p.id === selectedId)) setSelectedId(results[0].id);
  }, [results, selectedId]);

  const openPatient = (id: string) => setRoute({ name: "patient", patientId: normalizePatientId(id) });

  const openGroupPdf = async (groupSessionId: string) => {
    setOpeningGroupId(groupSessionId);
    try {
      const blob = await dataClient.downloadGroupPdf(groupSessionId);
      const objectUrl = window.URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      console.error("Unable to open group PDF:", error);
      window.alert("Could not open that group PDF right now.");
    } finally {
      setOpeningGroupId(null);
    }
  };

  const refreshLiveGroupSession = useEffectEvent(async (sessionId: string) => {
    try {
      const next = await dataClient.getLiveGroupSession(sessionId);
      setLiveGroupState((current) => {
        if (!current || current.session.id !== sessionId) return current;
        return {
          ...current,
          session: next.session,
          entries: next.entries,
        };
      });
      setLiveGroupError(null);
      setLiveGroupSuccess(null);
    } catch (error) {
      console.error("Unable to refresh live group session:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not refresh live sign-ins right now."));
    }
  });

  const startLiveGroupSession = async (payload: { topic: string; timeSlot: LiveGroupTimeSlot }) => {
    setLiveGroupBusy(true);
    setLiveGroupError(null);
    setLiveGroupSuccess(null);
    try {
      const started = await dataClient.startLiveGroupSession(payload);
      setLiveGroupState({
        session: started.session,
        entries: [],
        joinUrl: started.joinUrl,
        tokenExpiresAt: started.tokenExpiresAt,
      });
      await refreshLiveGroupSession(started.session.id);
      void loadDashboardData();
      setLiveGroupSuccess("Live session started. Share the link and collect signatures before finalizing.");
    } catch (error) {
      console.error("Unable to start live group session:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not start the group session. Please try again."));
    } finally {
      setLiveGroupBusy(false);
    }
  };

  const clearGroupHistory = async () => {
    const confirmed = window.confirm(
      "Delete all existing group sessions and stored group PDFs? This cannot be undone."
    );
    if (!confirmed) return;

    setLiveGroupBusy(true);
    setLiveGroupError(null);
    setLiveGroupSuccess(null);
    try {
      await dataClient.clearGroupSessions();
      setLiveGroupState(null);
      await loadDashboardData();
      setLiveGroupSuccess("Group session history and PDFs were reset.");
    } catch (error) {
      console.error("Unable to clear group history:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not clear group history right now."));
    } finally {
      setLiveGroupBusy(false);
    }
  };

  const setLiveGroupMatch = async (entryId: string, patientId: string | null) => {
    if (!liveGroupState) return;
    setLiveGroupBusy(true);
    setLiveGroupError(null);
    setLiveGroupSuccess(null);
    try {
      await dataClient.setLiveGroupEntryMatch(liveGroupState.session.id, entryId, patientId);
      await refreshLiveGroupSession(liveGroupState.session.id);
      void loadDashboardData();
    } catch (error) {
      console.error("Unable to match group sign-in:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not update that match."));
    } finally {
      setLiveGroupBusy(false);
    }
  };

  const removeLiveGroupEntry = async (entryId: string) => {
    if (!liveGroupState) return;
    setLiveGroupBusy(true);
    setLiveGroupError(null);
    setLiveGroupSuccess(null);
    try {
      await dataClient.removeLiveGroupEntry(liveGroupState.session.id, entryId);
      await refreshLiveGroupSession(liveGroupState.session.id);
      void loadDashboardData();
    } catch (error) {
      console.error("Unable to remove group sign-in:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not remove that sign-in."));
    } finally {
      setLiveGroupBusy(false);
    }
  };

  const finalizeLiveGroupSession = async (payload: { counselorSignName: string; counselorSignatureDataUrl: string }) => {
    if (!liveGroupState) return;
    const finalizedSessionId = liveGroupState.session.id;
    const finalizedTopic = liveGroupState.session.topic;
    setLiveGroupBusy(true);
    setLiveGroupError(null);
    setLiveGroupSuccess(null);
    try {
      await dataClient.finalizeLiveGroupSession(finalizedSessionId, payload);
      setLiveGroupState(null);
      await loadDashboardData();
      setLiveGroupSuccess(`Finalized "${finalizedTopic}" and generated the group PDF.`);
      await openGroupPdf(finalizedSessionId);
    } catch (error) {
      console.error("Unable to finalize group session:", error);
      setLiveGroupError(getRequestErrorMessage(error, "Could not finalize this group session."));
    } finally {
      setLiveGroupBusy(false);
    }
  };

  const logout = async () => {
    if (isEntraMode) {
      await azureAuth.logout();
      return;
    }
    setAzureDemoSession(null);
    setRoute({ name: "home" });
    setSearch("");
    setForceRoster(false);
    setCaseLoadOnly(true);
    setPrivacyLocked(true);
  };

  const refreshPatients = async () => {
    await loadDashboardData();
    await loadPatientDirectory();
  };

  useEffect(() => {
    if (route.name !== "patient") {
      setPatientDetail(null);
      setPatientDetailError(null);
      setPatientDetailLoading(false);
      return;
    }

    const routePatientId = normalizePatientId(route.patientId);
    if (!routePatientId) {
      setPatientDetail(null);
      setPatientDetailError("Missing patient id.");
      return;
    }

    if (!authReadyForApi) {
      if (debugPatientFlow) {
        console.info("[patient-flow][frontend][patient-detail-skip]", {
          reason: "auth_not_ready",
          routePatientId,
          hasAccessToken: Boolean(activeAccessToken),
          hasAuthUser: Boolean(activeAuthUser),
        });
      }
      return;
    }

    const inList = patients.find((entry) => normalizePatientId(entry.id) === routePatientId);
    if (inList) {
      setPatientDetail(inList);
      setPatientDetailError(null);
      setPatientDetailLoading(false);
      if (debugPatientFlow) {
        console.info("[patient-flow][frontend][patient-detail]", {
          routePatientId,
          selectedPatientFound: true,
          source: "loaded-patient-list",
        });
      }
      return;
    }

    let cancelled = false;
    setPatientDetailLoading(true);
    setPatientDetailError(null);
    if (debugPatientFlow) {
      console.info("[patient-flow][frontend][patient-detail-load-start]", {
        routePatientId,
        source: "api",
      });
    }
    void dataClient
      .getPatient(routePatientId)
      .then((row: any) => {
        if (cancelled) return;
        if (!row) {
          setPatientDetail(null);
          setPatientDetailError("Patient not found.");
          if (debugPatientFlow) {
            console.info("[patient-flow][frontend][patient-detail-load-finish]", {
              routePatientId,
              selectedPatientFound: false,
            });
          }
          return;
        }
        const normalizedRowId = normalizePatientId(row.id);
        const found = mergePatientWithExtras(row, undefined, undefined);
        setPatientDetail({ ...found, id: normalizedRowId });
        setPatientDetailError(null);
        if (debugPatientFlow) {
          console.info("[patient-flow][frontend][patient-detail-load-finish]", {
            routePatientId,
            selectedPatientFound: true,
            selectedPatientId: normalizedRowId,
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPatientDetail(null);
        setPatientDetailError(getRequestErrorMessage(error, "Unable to load patient detail."));
        console.error("Error fetching patient detail:", error);
      })
      .finally(() => {
        if (cancelled) return;
        setPatientDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    route,
    patients,
    authReadyForApi,
    activeAccessToken,
    activeAuthUser,
    dataClient,
    debugPatientFlow,
  ]);

  const toggleCaseAssignment = async (patientId: string) => {
    if (caseAssignments[patientId] === counselorId) {
      await dataClient.clearCaseAssignment(patientId);
      setCaseAssignments((prev) => {
        const next = { ...prev };
        delete next[patientId];
        return next;
      });
      setCaseAssignmentEmails((prev) => {
        const next = { ...prev };
        delete next[patientId];
        return next;
      });
      return;
    }

    await dataClient.saveCaseAssignment(patientId, {
      counselor_user_id: activeUserId,
      counselor_email: activeUserEmail || null,
    });
    setCaseAssignments((prev) => ({ ...prev, [patientId]: counselorId }));
    if (activeUserEmail) {
      setCaseAssignmentEmails((prev) => ({ ...prev, [patientId]: activeUserEmail.toLowerCase() }));
    }
  };

  const updateCompliance = async (patientId: string, patch: Partial<PatientCompliance>) => {
    const next = { ...(complianceByPatient[patientId] ?? {}), ...patch };
    const payload = {
      patient_id: patientId,
      drug_test_mode: next.drugTestMode ?? "none",
      drug_tests_per_week: next.drugTestMode === "weekly_count" ? next.drugTestsPerWeek ?? 1 : null,
      drug_test_weekday: next.drugTestMode === "weekday" && next.drugTestWeekday != null ? Number(next.drugTestWeekday) : null,
      problem_list_date: next.problemListDate ?? null,
      last_problem_list_review: next.lastProblemListReview ?? null,
      last_problem_list_update: next.lastProblemListUpdate ?? null,
      treatment_plan_date: next.treatmentPlanDate ?? null,
      treatment_plan_update: next.lastTreatmentPlanUpdate ?? null,
      updated_by: activeUserId || null,
    };
    await dataClient.saveCompliance(patientId, payload);
    setComplianceByPatient((prev) => ({ ...prev, [patientId]: next }));
  };

  const updateRosterDetails = async (patientId: string, patch: Partial<PatientRosterDetails>) => {
    const patient = patients.find((row) => row.id === patientId);
    if (!patient) return;

    const next = { ...(patient.rosterDetails ?? {}), ...patch };
    const payload = {
      patient_id: patientId,
      drug_of_choice: next.drugOfChoice?.length ? next.drugOfChoice : null,
      medical_phys_apt: next.medicalPhysApt ?? null,
      med_form_status: next.medFormStatus ?? null,
      notes: next.notes ?? null,
      referring_agency: next.referringAgency ?? null,
      reauth_sapc_date: next.reauthSapcDate ?? null,
      medical_eligibility: next.medicalEligibility ?? null,
      mat_status: next.matStatus ?? null,
      therapy_track: next.therapyTrack ?? null,
      updated_by: activeUserId || null,
    };

    await dataClient.saveRosterDetails(patientId, payload);
    setPatients((prev) => prev.map((row) => (row.id === patientId ? { ...row, rosterDetails: next } : row)));
  };

  const updatePatientProgram = async (patientId: string, program: string) => {
    await dataClient.updatePatient(patientId, { primary_program: program || null });
    setPatients((prev) =>
      prev.map((row) => (row.id === patientId ? { ...row, primaryProgram: program || undefined } : row))
    );
  };

  const sendNotification = async (payload: {
    recipientEmail: string;
    title: string;
    message: string;
    priority: "normal" | "urgent";
    patientId: string;
  }) => {
    const insertPayload = {
      recipient_email: payload.recipientEmail.toLowerCase(),
      title: payload.title,
      message: payload.message,
      priority: payload.priority,
      patient_id: payload.patientId,
      recipient_user_id: null,
      sender_email: activeUserEmail || null,
    };

    await dataClient.createNotification(insertPayload);
    return true;
  };

  const openPatientHighlightComposer = (patientId: string) => {
    const patient = patients.find((entry) => entry.id === patientId);
    if (!patient) return;
    setHighlightTarget({ patientId: patient.id, patientName: patient.displayName });
  };

  const sendPatientHighlight = async (payload: {
    patientId: string;
    message: string;
    priority: "normal" | "urgent";
  }) => {
    const assignedEmail =
      caseAssignmentEmails[payload.patientId] ??
      (caseAssignments[payload.patientId]?.includes("@") ? caseAssignments[payload.patientId] : "");

    if (!assignedEmail) {
      window.alert("This patient does not have an assigned counselor email yet. Assign the case first, then send a highlight note.");
      return false;
    }

    const patient = patients.find((entry) => entry.id === payload.patientId);
    if (!patient) return false;

    return sendNotification({
      recipientEmail: assignedEmail,
      patientId: payload.patientId,
      title: `Patient highlight: ${patient.displayName}`,
      message: payload.message,
      priority: payload.priority,
    });
  };

  const dismissNotification = async (notificationId: string) => {
    await dataClient.markNotificationRead(notificationId);
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((note) => (note.id === notificationId ? { ...note, readAt: note.readAt ?? now } : note)));
  };

  const replyToNotification = async (notificationId: string, message: string) => {
    await dataClient.replyToNotification(notificationId, { message });
    await dismissNotification(notificationId);
  };

  const exportRosterSpreadsheet = () => {
    const headers = [
      "NCADD ID",
      "Client's Name",
      "Sage ID",
      "LOC",
      "DOC",
      "Admit Date",
      "Problem List",
      "Problem List Review 30",
      "Problem List Update 90",
      "Treatment Plan",
      "Treatment Plan Update 180",
      "Medical / Phys Apt.",
      "Med Form",
      "Referring Agency",
      "Reauth SAP-C Date",
      "Medical Eligibility",
      "MAT",
      "Therapy",
      "Notes",
    ];

    const body = results
      .map((patient) => {
        const row = getSheetRowData(patient, complianceByPatient[patient.id]);
        return [
          row.ncaddId,
          row.clientName,
          row.sageId,
          row.locCode,
          row.doc,
          row.admitDate,
          row.problemListInitial,
          row.problemListReview,
          row.problemListUpdate,
          row.treatmentPlanInitial,
          row.treatmentPlanUpdate,
          row.medicalPhysApt,
          row.medForm,
          row.referringAgency,
          row.reauthSapcDate,
          row.medicalEligibility,
          row.matStatus,
          row.therapyTrack,
          row.notes,
        ];
      })
      .map(
        (cells) =>
          `<tr>${cells.map((cell) => `<td>${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`).join("")}</tr>`
      )
      .join("");

    const html = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <table>
            <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `patientfinder-roster-${todayIso()}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const addPatientDrugTest = async (patientId: string, entry: Omit<DrugTestEntry, "id">) => {
    const payload = {
      patient_id: patientId,
      date: entry.date,
      test_type: entry.testType,
      result: entry.result,
      substances: entry.substances ?? null,
      notes: entry.notes ?? null,
      created_by: activeUserId || null,
    };
    const data = await dataClient.createDrugTest(patientId, payload) as any;
    const nextEntry: DrugTestEntry = {
      id: data.id,
      date: data.date,
      testType: data.test_type,
      result: data.result,
      substances: data.substances ?? undefined,
      notes: data.notes ?? undefined,
    };
    setPatients((prev) =>
      prev.map((patient) => (patient.id === patientId ? { ...patient, drugTests: [nextEntry, ...(patient.drugTests ?? [])] } : patient))
    );
  };

  const commitPatientBilling = async ({
    patientId,
    billingType,
    serviceDate,
    startTime,
    endTime,
    totalMinutes,
    modality,
    naloxoneTraining,
    matEducation,
  }: {
    patientId: string;
    billingType: BillingType;
    serviceDate: string;
    startTime: string;
    endTime: string;
    totalMinutes: number;
    modality: BillingModality;
    naloxoneTraining: boolean;
    matEducation: boolean;
  }) => {
    const response = await dataClient.commitBilling(patientId, {
      billing_type: billingType,
      service_date: serviceDate,
      start_time: startTime || null,
      end_time: endTime || null,
      total_minutes: totalMinutes,
      modality,
      naloxone_training: naloxoneTraining,
      mat_education: matEducation,
      duration_hours: toSessionHours(totalMinutes / 60),
      title: billingType === "Individual" ? "Individual Session" : billingType,
      created_by: activeUserId || null,
    }) as any;

    const sessionData = response.session;
    const billingData = response.billingEntry;

    const nextSession: Session = {
      id: sessionData.id,
      kind: sessionData.kind,
      title: sessionData.title,
      date: sessionData.date,
      durationHours: toSessionHours(sessionData.duration_hours),
      location: sessionData.location ?? undefined,
      patientIds: [patientId],
      attendance: { [patientId]: "Present" },
    };

    const nextBillingEntry: BillingEntry = {
      id: billingData.id,
      patientId: billingData.patient_id,
      sessionId: billingData.session_id ?? undefined,
      billingType: billingData.billing_type,
      serviceDate: billingData.service_date,
      startTime: billingData.start_time ?? undefined,
      endTime: billingData.end_time ?? undefined,
      totalMinutes: Number(billingData.total_minutes ?? totalMinutes),
      modality: billingData.modality ?? undefined,
      naloxoneTraining: !!billingData.naloxone_training,
      matEducation: !!billingData.mat_education,
      createdAt: billingData.created_at,
    };

    setSessions((prev) => [nextSession, ...prev]);
    setBillingEntries((prev) => [nextBillingEntry, ...prev]);
    return { ok: true, message: `Committed ${billingType.toLowerCase()} to billing.` };
  };
  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonImporting(true);
    try {
      const text = await file.text();
      const rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error('JSON must be a top-level array of patient objects.');
      const now = new Date().toISOString();
      const today = now.substring(0, 10);
      const skippedRows: number[] = [];
      const records = rows
        .map((r: any, index: number) => {
          const fullName = resolveImportedPatientName(r);
          const mrn = firstNonEmptyString(r?.mrn, r?.sage_id, r?.sageId) || null;
          const externalId = firstNonEmptyString(r?.external_id, r?.externalId, r?.client_id, r?.clientId) || null;
          if (!fullName && !mrn && !externalId) {
            skippedRows.push(index + 1);
            return null;
          }
          return {
            id: resolveImportedPatientId(r),
            full_name: fullName || `MRN ${mrn ?? externalId ?? index + 1}`,
            mrn,
            external_id: externalId,
            status: firstNonEmptyString(r?.status, r?.patient_status) || 'new',
            location: firstNonEmptyString(r?.location, r?.site, r?.clinic) || null,
            intake_date: normalizeImportDate(r?.intake_date ?? r?.intakeDate ?? r?.admit_date ?? r?.admitDate, today),
            primary_program: firstNonEmptyString(r?.primary_program, r?.primaryProgram, r?.program) || null,
            counselor_name: firstNonEmptyString(r?.counselor_name, r?.counselorName, r?.counselor) || null,
            flags: Array.isArray(r?.flags) ? r.flags : [],
            last_visit_date: normalizeImportDate(r?.last_visit_date ?? r?.lastVisitDate),
            next_appt_date: normalizeImportDate(r?.next_appt_date ?? r?.nextApptDate ?? r?.next_appointment_date),
            created_at: now,
            updated_at: now,
          };
        })
        .filter((record): record is NonNullable<typeof record> => Boolean(record));
      if (!records.length) {
        throw new Error("No valid patient rows found. Expected at least a name, MRN, or external ID per row.");
      }
      await dataClient.bulkUpsertPatients({ records });
      await refreshPatients();
      if (skippedRows.length) {
        alert(
          `✓ Imported ${records.length} patient${records.length === 1 ? '' : 's'}.\n` +
          `Skipped ${skippedRows.length} row${skippedRows.length === 1 ? '' : 's'} with no usable identity fields.`
        );
      } else {
        alert(`✓ Imported ${records.length} patient${records.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      alert('Import failed: ' + String(err));
    }
    setJsonImporting(false);
    e.target.value = '';
  };


  if (publicGroupToken) {
    return <PublicGroupSignPage token={publicGroupToken} dataClient={dataClient} />;
  }

  if (!activeAuthUser) {
    if (isEntraMode) {
      return (
        <div className="page authPage">
          <EntraLoginScreen loading={azureAuth.loading} onLogin={azureAuth.login} />
          {authOptionsError ? <div className="authErr">{authOptionsError}</div> : null}
        </div>
      );
    }
    return (
      <div className="page authPage">
        <AzureDemoLoginScreen
          demoUsers={azureDemoUsers}
          onLoggedIn={setAzureDemoSession}
          bootstrapError={authOptionsError}
        />
      </div>
    );
  }
  /* ---------- HOME (PHI-safe) ---------- */
  if (route.name === "home") {
    return (
      <div className="page workspacePage">
        <div className={!isMobileWorkspace && privacyLocked ? "workspaceShell locked" : "workspaceShell"}>
          {!isMobileWorkspace && !privacyLocked ? (
            <aside className="workspaceSidebar">
              <button className="workspaceBrand compact unlocked" onClick={() => setPrivacyLocked(true)}>
                <img className="workspaceLogo compact unlocked" src={patientFinderLogo} alt="Patient Finder logo" />
              </button>

              <button
                className={desktopMenuOpen ? "workspaceActionBtn primary workspaceSidebarMenuToggle" : "workspaceActionBtn workspaceSidebarMenuToggle"}
                onClick={() => setDesktopMenuOpen((open) => !open)}
              >
                {desktopMenuOpen ? "Close menu" : "Menu"}
              </button>

              {desktopMenuOpen ? (
                <>
                  <div className="workspaceSidebarSection">
                    <div className="workspaceSectionLabel">Views</div>
                    <div className="workspaceSidebarTabs">
                      <button
                        className={workspaceTab === "roster" ? "workspaceSidebarTab active" : "workspaceSidebarTab"}
                        onClick={() => setWorkspaceTab("roster")}
                      >
                        <strong>Roster</strong>
                        <span>Search, filters, and patient list</span>
                      </button>
                      <button
                        className={workspaceTab === "attention" ? "workspaceSidebarTab active" : "workspaceSidebarTab"}
                        onClick={() => setWorkspaceTab("attention")}
                      >
                        <strong>What needs attention first</strong>
                        <span>{agendaRows.length ? `${agendaRows.length} priority item${agendaRows.length === 1 ? "" : "s"}` : "No urgent items right now"}</span>
                      </button>
                    </div>
                  </div>

                  <div className="workspaceSidebarSection">
                    <button
                      className={!forceRoster && caseLoadOnly ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                      onClick={() => {
                        setWorkspaceTab("roster");
                        setCaseLoadOnly(true);
                        setForceRoster(false);
                        setSearch("");
                      }}
                    >
                      {counselorLabel} case load
                    </button>
                    <button
                      className={forceRoster ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                      onClick={() => {
                        setWorkspaceTab("roster");
                        setForceRoster(true);
                        setCaseLoadOnly(false);
                        setSearch("");
                      }}
                    >
                      Full roster
                    </button>
                    <button className="workspaceActionBtn" onClick={() => setRoute({ name: "attendance" })}>
                      Visits & tests
                    </button>
                    <button className="workspaceActionBtn" onClick={() => setRoute({ name: "billing" })}>
                      Billing
                    </button>
                    <button className="workspaceActionBtn" onClick={() => setRoute({ name: "groups" })}>
                      Groups
                    </button>
                  </div>

                  <div className="workspaceSidebarSection">
                    <button className="workspaceActionBtn" onClick={() => setShowAddPatient(true)}>
                      Add patient
                    </button>
                    <button className="workspaceActionBtn" onClick={exportRosterSpreadsheet}>
                      Export roster spreadsheet
                    </button>
                    <label className={`workspaceActionBtn upload${jsonImporting ? " disabled" : ""}`}>
                      {jsonImporting ? "Importing JSON..." : "Import patient JSON"}
                      <input type="file" accept=".json" hidden onChange={handleJsonUpload} disabled={jsonImporting} />
                    </label>
                    {hasAdminRole ? (
                      <button className="workspaceActionBtn" onClick={() => setShowNotificationComposer(true)}>
                        Send counselor note
                      </button>
                    ) : null}
                    <button className="workspaceActionBtn" onClick={logout}>
                      Logout
                    </button>
                  </div>

                  {mobileInstallUrl ? (
                    <div className="workspaceSidebarSection">
                      <div className="workspaceSectionLabel">Mobile install</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                          iPhone uses Expo Go (free) and does not require an Apple Developer account.
                        </div>
                        <button
                          className="workspaceActionBtn"
                          onClick={() => window.open(mobileInstallUrl, "_blank", "noopener,noreferrer")}
                        >
                          Android install
                        </button>
                        <button
                          className="workspaceActionBtn"
                          onClick={() => {
                            if (expoGoUrl) {
                              window.open(expoGoUrl, "_blank", "noopener,noreferrer");
                            } else {
                              window.open(expoGoInfoUrl, "_blank", "noopener,noreferrer");
                            }
                            window.alert(
                              `iPhone setup (free via Expo Go):\n1) Install Expo Go from the App Store.\n2) Open Expo Go.\n3) Paste this link in Expo Go:\n${iosInstallTarget}`,
                            );
                          }}
                        >
                          iPhone (Expo Go)
                        </button>
                        <button
                          className="workspaceActionBtn"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(mobileInstallUrl);
                              window.alert("Install link copied.");
                            } catch {
                              window.alert("Could not copy automatically. Open link and copy from browser.");
                            }
                          }}
                        >
                          Copy install link
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </aside>
          ) : null}

          <main className={!isMobileWorkspace && privacyLocked ? "workspaceMain desktopLocked" : "workspaceMain"}>
            {isMobileWorkspace ? (
              <section className="workspaceMobileHero">
                <button className={privacyLocked ? "workspaceMobileBrand locked" : "workspaceMobileBrand unlocked"} onClick={() => setPrivacyLocked(true)}>
                  <img className="workspaceMobileLogo" src={patientFinderLogo} alt="Patient Finder logo" />
                </button>

                <div className="workspaceMobileStatusRow">
                </div>

                {!privacyLocked ? (
                  <div className="workspaceMobileTopSub">
                    {results.length} visible • {patientPageStart}-{patientPageEnd} of {patientTotal}
                  </div>
                ) : null}

                {!privacyLocked && patientTotal > 0 ? (
                  <div className="workspaceMobilePagerRow">
                    <button className="btn ghost" disabled={!canPageBack || loadingPatients} onClick={() => setPatientPage((prev) => Math.max(0, prev - 1))}>
                      Prev page
                    </button>
                    <button className="btn ghost" disabled={!canPageForward || loadingPatients} onClick={() => setPatientPage((prev) => prev + 1)}>
                      Next page
                    </button>
                  </div>
                ) : null}

                {!privacyLocked ? (
                  <div className="workspaceMobileHeroActions">
                    <button className="btn" onClick={() => setPrivacyLocked(true)}>
                      Lock workspace
                    </button>
                    <button
                      className={mobileMenuOpen ? "btn ghost active" : "btn ghost"}
                      onClick={() => {
                        setMobileMenuOpen((open) => !open);
                        setMobileGlanceOpen(false);
                        setMobileSearchOpen(false);
                      }}
                    >
                      {mobileMenuOpen ? "Close menu" : "Menu"}
                    </button>
                    <button
                      className={mobileGlanceOpen ? "btn ghost active" : "btn ghost"}
                      onClick={() => {
                        setMobileGlanceOpen((open) => !open);
                        setMobileMenuOpen(false);
                        setMobileSearchOpen(false);
                      }}
                    >
                      At a glance
                    </button>
                    <button
                      className={mobileSearchOpen ? "btn ghost active" : "btn ghost"}
                      onClick={() => {
                        setMobileSearchOpen((open) => !open);
                        setMobileMenuOpen(false);
                        setMobileGlanceOpen(false);
                      }}
                    >
                      Search & organize
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {privacyLocked ? (
              isMobileWorkspace ? (
                <div className="workspacePrivacyStage">
                  <div className="workspacePrivacyCard">
                    <div className="workspaceRosterTitle">Patient data is hidden until you choose to unlock the workspace.</div>
                    <div className="workspaceAgendaDetail">Tap the logo any time to lock the screen again without signing out.</div>
                    <button className="btn" onClick={() => setPrivacyLocked(false)}>
                      Unlock workspace
                    </button>
                  </div>
                  <div className="workspaceLockJokeStage">
                    <div className="workspaceLockJokeCard">
                      <div className="workspaceLockJokeGlow" aria-hidden="true" />
                      <div key={lockJokeIndex} className="workspaceLockJokeText">
                        {LOCK_SCREEN_JOKES[lockJokeIndex]}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="workspaceDesktopLockStage">
                  <button className="workspaceBrand hero locked" onClick={() => setPrivacyLocked(false)}>
                    <img className="workspaceLogo hero locked" src={patientFinderLogo} alt="Patient Finder logo" />
                  </button>
                  <button className="workspaceUnlockBtn" onClick={() => setPrivacyLocked(false)}>
                    Unlock
                  </button>
                  <div className="workspaceLockJokeStage desktop">
                    <div className="workspaceLockJokeCard desktop">
                      <div className="workspaceLockJokeGlow" aria-hidden="true" />
                      <div key={lockJokeIndex} className="workspaceLockJokeText">
                        {LOCK_SCREEN_JOKES[lockJokeIndex]}
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <>
                {isMobileWorkspace && mobileMenuOpen ? (
                  <section className="workspaceMobileMenuCard">
                    <div className="workspaceMobileMenuGrid">
                      <button
                        className={!forceRoster && caseLoadOnly ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                        onClick={() => {
                          setWorkspaceTab("roster");
                          setCaseLoadOnly(true);
                          setForceRoster(false);
                          setSearch("");
                          setMobileMenuOpen(false);
                        }}
                      >
                        {counselorLabel} case load
                      </button>
                      <button
                        className={forceRoster ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                        onClick={() => {
                          setWorkspaceTab("roster");
                          setForceRoster(true);
                          setCaseLoadOnly(false);
                          setSearch("");
                          setMobileMenuOpen(false);
                        }}
                      >
                        Full roster
                      </button>
                      <button
                        className={workspaceTab === "attention" ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                        onClick={() => {
                          setWorkspaceTab("attention");
                          setMobileMenuOpen(false);
                        }}
                      >
                        What needs attention first
                      </button>
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setShowAddPatient(true);
                          setMobileMenuOpen(false);
                        }}
                      >
                        Add patient
                      </button>
                      <button className="workspaceActionBtn" onClick={exportRosterSpreadsheet}>
                        Export roster
                      </button>
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setRoute({ name: "attendance" });
                          setMobileMenuOpen(false);
                        }}
                      >
                        Visits & tests
                      </button>
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setRoute({ name: "billing" });
                          setMobileMenuOpen(false);
                        }}
                      >
                        Billing
                      </button>
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setRoute({ name: "groups" });
                          setMobileMenuOpen(false);
                        }}
                      >
                        Groups
                      </button>
                      {hasAdminRole ? (
                        <button
                          className="workspaceActionBtn"
                          onClick={() => {
                            setShowNotificationComposer(true);
                            setMobileMenuOpen(false);
                          }}
                        >
                          Send counselor note
                        </button>
                      ) : null}
                      <button className="workspaceActionBtn" onClick={logout}>
                        Logout
                      </button>
                    </div>
                    {mobileInstallUrl ? (
                      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                        <div className="workspaceSectionLabel">Mobile install</div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                          iPhone is Expo Go only (free).
                        </div>
                        <button
                          className="workspaceActionBtn"
                          onClick={() => window.open(mobileInstallUrl, "_blank", "noopener,noreferrer")}
                        >
                          Android install
                        </button>
                        <button
                          className="workspaceActionBtn"
                          onClick={() => {
                            if (expoGoUrl) {
                              window.open(expoGoUrl, "_blank", "noopener,noreferrer");
                            } else {
                              window.open(expoGoInfoUrl, "_blank", "noopener,noreferrer");
                            }
                            window.alert(
                              `iPhone setup (free via Expo Go):\n1) Install Expo Go from the App Store.\n2) Open Expo Go.\n3) Paste this link in Expo Go:\n${iosInstallTarget}`,
                            );
                          }}
                        >
                          iPhone (Expo Go)
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {isMobileWorkspace && mobileGlanceOpen ? (
                  <section className="workspaceMobileMenuCard">
                    <div className="workspaceSectionLabel">At a glance</div>
                    <div className="workspaceSummaryBar mobile">
                      <div className="workspaceSummaryItem">
                        <span className="workspaceStatLabel">{forceRoster ? "Roster" : "Case load"}</span>
                        <strong>{dashboardMetrics.totalPatients}</strong>
                        <small>{forceRoster ? "Total patients" : "Assigned patients"}</small>
                      </div>
                      <div className="workspaceSummaryItem">
                        <span className="workspaceStatLabel">Mine</span>
                        <strong>{dashboardMetrics.assignedPatients}</strong>
                        <small>Assigned to you</small>
                      </div>
                      <button
                        className={dashboardFilter === "dueReview" ? "workspaceSummaryItem alert active" : "workspaceSummaryItem alert interactive"}
                        onClick={() => applyDashboardFilter("dueReview")}
                      >
                        <span className="workspaceStatLabel">Problem List Reviews</span>
                        <strong>{dashboardMetrics.dueReview}</strong>
                        <small>{dashboardFilter === "dueReview" ? "Showing matching patients" : "Due in 7 days"}</small>
                      </button>
                      <button
                        className={dashboardFilter === "dueUpdate" ? "workspaceSummaryItem alert active" : "workspaceSummaryItem alert interactive"}
                        onClick={() => applyDashboardFilter("dueUpdate")}
                      >
                        <span className="workspaceStatLabel">Problem List Updates</span>
                        <strong>{dashboardMetrics.dueUpdate}</strong>
                        <small>{dashboardFilter === "dueUpdate" ? "Showing matching patients" : "Due in 14 days"}</small>
                      </button>
                      <button
                        className={dashboardFilter === "behindAttendance" ? "workspaceSummaryItem active" : "workspaceSummaryItem interactive"}
                        onClick={() => applyDashboardFilter("behindAttendance")}
                      >
                        <span className="workspaceStatLabel">Visits</span>
                        <strong>{dashboardMetrics.behindAttendance}</strong>
                        <small>{dashboardFilter === "behindAttendance" ? "Showing matching patients" : "Below weekly target"}</small>
                      </button>
                    </div>
                  </section>
                ) : null}

                {!isMobileWorkspace ? (
                  <section className="workspaceDesktopRevealRow">
                    <button
                      className={desktopGlanceOpen ? "workspaceSidebarTab active" : "workspaceSidebarTab"}
                      onClick={() => {
                        setDesktopGlanceOpen((open) => !open);
                      }}
                    >
                      <strong>At a glance</strong>
                      <span>Show due items, counts, and quick filters</span>
                    </button>
                    <button
                      className={desktopSearchOpen ? "workspaceSidebarTab active" : "workspaceSidebarTab"}
                      onClick={() => {
                        setDesktopSearchOpen((open) => !open);
                      }}
                    >
                      <strong>Search</strong>
                      <span>Show search, sort, and view controls</span>
                    </button>
                  </section>
                ) : null}

                {!isMobileWorkspace && desktopGlanceOpen ? (
                  <section className="workspaceSummaryBar">
                    <div className="workspaceSummaryItem">
                      <span className="workspaceStatLabel">{forceRoster ? "Roster" : "Case load"}</span>
                      <strong>{dashboardMetrics.totalPatients}</strong>
                      <small>{forceRoster ? "Total patients" : "Assigned patients"}</small>
                    </div>
                    <div className="workspaceSummaryItem">
                      <span className="workspaceStatLabel">Mine</span>
                      <strong>{dashboardMetrics.assignedPatients}</strong>
                      <small>Assigned to you</small>
                    </div>
                    <button
                      className={dashboardFilter === "dueReview" ? "workspaceSummaryItem alert active" : "workspaceSummaryItem alert interactive"}
                      onClick={() => applyDashboardFilter("dueReview")}
                    >
                      <span className="workspaceStatLabel">Problem List Reviews</span>
                      <strong>{dashboardMetrics.dueReview}</strong>
                      <small>{dashboardFilter === "dueReview" ? "Showing matching patients" : "Due in 7 days"}</small>
                    </button>
                    <button
                      className={dashboardFilter === "dueUpdate" ? "workspaceSummaryItem alert active" : "workspaceSummaryItem alert interactive"}
                      onClick={() => applyDashboardFilter("dueUpdate")}
                    >
                      <span className="workspaceStatLabel">Problem List Updates</span>
                      <strong>{dashboardMetrics.dueUpdate}</strong>
                      <small>{dashboardFilter === "dueUpdate" ? "Showing matching patients" : "Due in 14 days"}</small>
                    </button>
                    <button
                      className={dashboardFilter === "behindAttendance" ? "workspaceSummaryItem active" : "workspaceSummaryItem interactive"}
                      onClick={() => applyDashboardFilter("behindAttendance")}
                    >
                      <span className="workspaceStatLabel">Visits</span>
                      <strong>{dashboardMetrics.behindAttendance}</strong>
                      <small>{dashboardFilter === "behindAttendance" ? "Showing matching patients" : "Below weekly target"}</small>
                    </button>
                  </section>
                ) : null}

                {workspaceTab === "roster" ? (
                  <section className="workspaceBoard">
                    {(isMobileWorkspace && mobileSearchOpen) || (!isMobileWorkspace && desktopSearchOpen) ? (
                      <div className="workspaceFilters">
                        <div className="workspaceSectionLabel">Search & organize</div>
                        <div className="workspaceSearchWrap">
                          <input
                            autoFocus={!isMobileWorkspace}
                            className="workspaceSearch"
                            value={search}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSearch(v);
                              if (v.trim().length) {
                                setForceRoster(false);
                                setCaseLoadOnly(false);
                              }
                            }}
                            placeholder="Search by patient, MRN, date, drug test, flag, intake field..."
                          />
                          <div className="workspaceSearchHint">
                            Try <span className="mono">Medi-Cal</span>, <span className="mono">THC</span>, <span className="mono">1.0</span>, or <span className="mono">2026-02-09</span>.
                          </div>
                          {dashboardFilter ? (
                            <div className="workspaceSearchHint">
                              Quick filter on:
                              {" "}
                              <span className="mono">
                                {dashboardFilter === "dueReview" ? "Problem List Reviews" : dashboardFilter === "dueUpdate" ? "Problem List Updates" : "Visits"}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="workspaceFilterRow">
                          {!isMobileWorkspace ? (
                            <div className="seg">
                              <button className={view === "sheet" ? "segBtn on" : "segBtn"} onClick={() => setView("sheet")}>
                                Sheet
                              </button>
                              <button className={view === "split" ? "segBtn on" : "segBtn"} onClick={() => setView("split")}>
                                Focus
                              </button>
                              <button className={view === "cards" ? "segBtn on" : "segBtn"} onClick={() => setView("cards")}>
                                Cards
                              </button>
                            </div>
                          ) : (
                            <div className="seg workspaceMobileViewSeg">
                              <button className={view === "cards" ? "segBtn on" : "segBtn"} onClick={() => setView("cards")}>
                                iPhone
                              </button>
                              <button className={view === "sheet" ? "segBtn on" : "segBtn"} onClick={() => setView("sheet")}>
                                Sheet
                              </button>
                            </div>
                          )}

                          <select className="select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as PatientKindFilter)}>
                            <option value="all">All statuses</option>
                            <option value="New Patient">New (0-20 days)</option>
                            <option value="Current Patient">Current patients</option>
                            <option value="RSS+">RSS+</option>
                            <option value="RSS">RSS</option>
                            <option value="Former Patient">Former patients</option>
                            <option value="Former Recent">Former (0-90 days)</option>
                            <option value="Former Archived">Former (90+ days)</option>
                          </select>

                          <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                            <option value="name">Sort by name</option>
                            <option value="intake">Sort by intake date</option>
                            <option value="lastVisit">Sort by last visit</option>
                            <option value="kind">Sort by status</option>
                          </select>

                          <button className="btn ghost" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                            {sortDir === "asc" ? "Ascending" : "Descending"}
                          </button>

                          <div className="workspaceResultsCount">
                            {results.length} visible • {patientPageStart}-{patientPageEnd} of {patientTotal}
                          </div>
                          <div className="workspaceSheetControls">
                            <button className="btn ghost" disabled={!canPageBack || loadingPatients} onClick={() => setPatientPage((prev) => Math.max(0, prev - 1))}>
                              Prev
                            </button>
                            <button className="btn ghost" disabled={!canPageForward || loadingPatients} onClick={() => setPatientPage((prev) => prev + 1)}>
                              Next
                            </button>
                          </div>
                        </div>

                        <div className="workspaceSheetLegend">
                          <span className="workspaceLegendItem">
                            <span className="workspaceLegendSwatch alert" />
                            Red rows mean overdue or past due
                          </span>
                          <span className="workspaceLegendItem">
                            <span className="workspaceLegendSwatch watch" />
                            Amber rows mean coming up soon
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <div className="workspaceContentGrid singleColumn">
                      <SearchResults
                        view={view}
                        rows={results}
                        sessions={sessions}
                        complianceByPatient={complianceByPatient}
                        caseAssignments={caseAssignments}
                        counselorId={counselorId}
                        isMobile={isMobileWorkspace}
                        onUpdateRosterDetails={updateRosterDetails}
                        onUpdatePatientProgram={updatePatientProgram}
                        selectedId={selected?.id}
                        onSelect={setSelectedId}
                        onOpen={openPatient}
                        selected={selected}
                        canHighlightPatient={hasAdminRole}
                        isAdminView={hasAdminRole}
                        onHighlightPatient={openPatientHighlightComposer}
                      />
                    </div>
                  </section>
                ) : (
                  <section className="workspaceBoard workspaceAgendaBoard">
                    <div className="workspaceBoardHeader">
                      <div>
                        <div className="workspaceSectionLabel">Counselor Agenda</div>
                        <div className="workspaceAgendaTitle">What needs attention first</div>
                      </div>
                      <div className="workspaceResultsCount">
                        {agendaRows.length + highlightedNotes.length} item{agendaRows.length + highlightedNotes.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="workspaceAgendaList">
                      {highlightedNotes.map(({ note, patient }) => (
                        <button
                          key={note.id}
                          className="workspaceAgendaItem workspaceAgendaNoteItem"
                          onClick={() => openPatient(patient.id)}
                        >
                          <div className="workspaceAgendaTop">
                            <strong>{patient.displayName}</strong>
                            <div className="workspaceAgendaNoteActions">
                              <span className={`workspaceTone ${note.priority === "urgent" ? "behind" : "neutral"}`}>
                                {hasAdminRole ? "Counselor reply" : "Admin note"}
                              </span>
                              {!hasAdminRole ? (
                                <button
                                  className="workspaceMiniBtn"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setReplyTarget({
                                      notificationId: note.id,
                                      patientName: patient.displayName,
                                      title: note.title,
                                    });
                                  }}
                                >
                                  Reply
                                </button>
                              ) : null}
                              <button
                                className="workspaceMiniBtn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void dismissNotification(note.id);
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                          <div className="workspaceAgendaMeta">{note.title}</div>
                          <div className="workspaceAgendaDetail">{note.message}</div>
                          <div className="workspaceAgendaMeta">Sent {formatNotificationTimestamp(note.createdAt)}{note.senderEmail ? ` • ${note.senderEmail}` : ""}</div>
                        </button>
                      ))}
                      {agendaRows.map(({ patient, item }) => (
                        <button key={item.id} className="workspaceAgendaItem" onClick={() => openPatient(patient.id)}>
                          <div className="workspaceAgendaTop">
                            <strong>{patient.displayName}</strong>
                            <span className={`workspaceTone ${item.tone}`}>{toneLabel(item.tone)}</span>
                          </div>
                          <div className="workspaceAgendaMeta">{item.title}</div>
                          <div className="workspaceAgendaDetail">{item.detail}</div>
                        </button>
                      ))}
                      {!agendaRows.length && !highlightedNotes.length ? (
                        <div className="workspaceAgendaEmpty">
                          {loadingPatients ? "Loading roster data..." : "No urgent items right now. Open the roster tab to review patients or search the full list."}
                        </div>
                      ) : null}
                    </div>
                  </section>
                )}

                <div className="homeFooter">
                  {loadingPatients ? "Loading patients from database..." : ""}
                  {!loadingPatients && loadError ? ` ${loadError}` : ""}
                </div>
              </>
            )}
          </main>
        </div>

        {showAddPatient && (
          <AddPatientModal
            dataClient={dataClient}
            onClose={() => setShowAddPatient(false)}
            onAdded={(p) => {
              setPatients((prev) => [p, ...prev]);
              setShowAddPatient(false);
            }}
          />
        )}
        {showNotificationComposer && hasAdminRole && (
          <NotificationComposerModal
            recipients={teammateEmails}
            patients={patients}
            currentUserEmail={activeUserEmail}
            onClose={() => setShowNotificationComposer(false)}
            onSend={async (payload) => {
              const ok = await sendNotification(payload);
              if (ok) setShowNotificationComposer(false);
            }}
          />
        )}
        {replyTarget ? (
          <NotificationReplyModal
            patientName={replyTarget.patientName}
            title={replyTarget.title}
            onClose={() => setReplyTarget(null)}
            onSend={async (message) => {
              await replyToNotification(replyTarget.notificationId, message);
              setReplyTarget(null);
            }}
          />
        ) : null}
        {highlightTarget && hasAdminRole ? (
          <PatientHighlightModal
            patientName={highlightTarget.patientName}
            onClose={() => setHighlightTarget(null)}
            onSend={async ({ message, priority }) => {
              const ok = await sendPatientHighlight({
                patientId: highlightTarget.patientId,
                message,
                priority,
              });
              if (ok) setHighlightTarget(null);
            }}
          />
        ) : null}
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  /* ---------- ATTENDANCE ---------- */
  if (route.name === "attendance") {
    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={() => setRoute({ name: "home" })}>
            ← Home
          </button>
          <div className="count">Visits & tests entries: {sessions.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            Billing sheet
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "groups" })}>
            Groups
          </button>
          <button className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>

        <AttendancePage
          patients={operationalPatients}
          onCommitBilling={commitPatientBilling}
          onAddDrugTest={addPatientDrugTest}
        />
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  if (route.name === "billing") {
    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={() => setRoute({ name: "home" })}>
            ← Home
          </button>
          <div className="count">Billing entries: {billingEntries.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            Visits & tests
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "groups" })}>
            Groups
          </button>
          <button className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>

        <BillingPage patients={billingPatients} billingEntries={billingEntries} />
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  if (route.name === "groups") {
    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={() => setRoute({ name: "home" })}>
            ← Home
          </button>
          <div className="count">Group sessions: {groupSessions.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            Visits & tests
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            Billing
          </button>
          <button className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>

        <GroupsPage
          groups={groupSessions}
          openingGroupId={openingGroupId}
          onOpenPdf={openGroupPdf}
          patients={operationalPatients}
          activeCounselorName={activeAuthUser.name || activeAuthUser.email}
          activeSession={liveGroupState}
          busy={liveGroupBusy}
          err={liveGroupError}
          successMessage={liveGroupSuccess}
          onStartSession={startLiveGroupSession}
          onSetMatch={setLiveGroupMatch}
          onRemoveEntry={removeLiveGroupEntry}
          onFinalize={finalizeLiveGroupSession}
          onRefreshSession={(sessionId) => refreshLiveGroupSession(sessionId)}
          onDismissLiveSession={() => setLiveGroupState(null)}
          onClearHistory={clearGroupHistory}
        />
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  /* ---------- PATIENT PAGE ---------- */
  if (route.name === "patient") {
    const normalizedRoutePatientId = normalizePatientId(route.patientId);
    const p =
      patientDetail && normalizePatientId(patientDetail.id) === normalizedRoutePatientId
        ? patientDetail
        : patients.find((x) => normalizePatientId(x.id) === normalizedRoutePatientId);

    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={() => setRoute({ name: "home" })}>
            ← Home
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setRoute({ name: "home" });
              setSearch(p?.displayName ?? "");
            }}
          >
            Back to results
          </button>

          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            Visits & tests
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            Billing
          </button>

          <button className="btn ghost" onClick={logout}>
            Logout
          </button>
        </div>

        {patientDetailLoading ? (
          <div className="panel">
            <div className="panelHead">Loading patient</div>
            <div className="panelBody">Fetching patient details from Azure API...</div>
          </div>
        ) : p ? (
          <PatientPage
            patient={p}
            allSessions={sessions}
            dataClient={dataClient}
            counselorId={counselorId}
            isAssigned={caseAssignments[p.id] === counselorId}
            compliance={complianceByPatient[p.id]}
            onToggleAssignment={() => toggleCaseAssignment(p.id)}
            onUpdateCompliance={(patch) => updateCompliance(p.id, patch)}
            onUpdateRosterDetails={(patch) => updateRosterDetails(p.id, patch)}
            onUpdatePatient={(next) => {
              setPatients((prev) => prev.map((x) => (x.id === next.id ? next : x)));
              setPatientDetail((current) => (current && current.id === next.id ? next : current));
            }}
            onDeletePatient={() => {
              setPatients((prev) => prev.filter((x) => x.id !== p.id));
              setPatientDetail(null);
              setRoute({ name: "home" });
            }}
            canHighlightPatient={hasAdminRole}
            onHighlightPatient={() => openPatientHighlightComposer(p.id)}
            onDocumentsTabActiveChange={setPatientDocumentsTabActive}
          />
        ) : (
          <div className="panel">
            <div className="panelHead">Not found</div>
            <div className="panelBody">
              {patientDetailError ?? "That patient record was not found in Azure-backed patient data."}
            </div>
          </div>
        )}
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  return null;
}

/* -------------------- Search Results UI -------------------- */

function SheetInputCell({
  value,
  placeholder,
  onSave,
}: {
  value?: string;
  placeholder?: string;
  onSave: (value: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <input
      className="sheetCellInput"
      value={draft}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (value ?? "")) onSave(draft);
      }}
    />
  );
}

function SheetDateCell({
  value,
  onSave,
}: {
  value?: string;
  onSave: (value: string) => void | Promise<void>;
}) {
  return (
    <input
      className="sheetCellInput"
      type="date"
      value={value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onSave(e.target.value)}
    />
  );
}

function SheetSelectCell({
  value,
  placeholder = "—",
  options,
  onSave,
}: {
  value?: string;
  placeholder?: string;
  options: string[];
  onSave: (value: string) => void | Promise<void>;
}) {
  return (
    <select
      className="sheetCellSelect"
      value={value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onSave(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function SheetMultiSelectCell({
  value,
  placeholder = "Select",
  onOpen,
}: {
  value?: string[];
  placeholder?: string;
  onOpen: () => void;
}) {
  return (
    <button className="sheetCellMulti" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      {value?.length ? value.join(", ") : placeholder}
    </button>
  );
}

function SearchResults({
  view,
  rows,
  sessions,
  complianceByPatient,
  caseAssignments,
  counselorId,
  isMobile,
  onUpdateRosterDetails,
  onUpdatePatientProgram,
  selectedId,
  onSelect,
  onOpen,
  selected,
  canHighlightPatient,
  isAdminView,
  onHighlightPatient,
}: {
  view: ViewMode;
  rows: Patient[];
  sessions: Session[];
  complianceByPatient: Record<string, PatientCompliance>;
  caseAssignments: Record<string, string>;
  counselorId: string;
  isMobile: boolean;
  onUpdateRosterDetails: (patientId: string, patch: Partial<PatientRosterDetails>) => void | Promise<void>;
  onUpdatePatientProgram: (patientId: string, program: string) => void | Promise<void>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  selected?: Patient;
  canHighlightPatient: boolean;
  isAdminView: boolean;
  onHighlightPatient: (patientId: string) => void;
}) {
  const weekDate = todayIso();
  const [docEditor, setDocEditor] = useState<{ patientId: string; current: string[] } | null>(null);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);

  if (isMobile && view === "cards") {
    return (
      <div className="workspaceMobileRoster">
        <div className="workspaceRosterCard">
          <div className="workspaceRosterHead">
            <div>
              <div className="workspaceSectionLabel">Mobile Roster</div>
              <div className="workspaceRosterTitle">Tap a patient to open the same focused workflow as the iOS app.</div>
            </div>
            <div className="workspaceResultsCount">{rows.length} visible</div>
          </div>

          <div className="workspaceMobilePatientList">
            {rows.map((p) => {
              const attendance = getWeeklyAttendanceStats(p, sessions, weekDate);
              const drug = getDrugTestSummary(p, complianceByPatient[p.id], weekDate);
              const problemList = getProblemListSummary(complianceByPatient[p.id]);
              const workItems = getPatientWorkItems(p, complianceByPatient[p.id], sessions, weekDate).slice(0, 2);

              return (
                <button
                  key={p.id}
                  className={p.id === selectedId ? "workspaceMobilePatientCard selected" : "workspaceMobilePatientCard"}
                  onClick={() => {
                    onSelect(p.id);
                    onOpen(p.id);
                  }}
                >
                  <div className="workspaceMobilePatientTop">
                    <div className="workspaceMobilePatientIdentity">
                      <strong>{p.displayName}</strong>
                      <span>MRN {p.mrn ?? "—"} • {p.primaryProgram ?? "Program not set"}</span>
                    </div>
                    <div className="workspaceMobilePatientChevron" aria-hidden="true">›</div>
                  </div>

                  <div className="workspaceMobilePatientSignals">
                    <span className={pillClass(p.kind)}>{p.kind}</span>
                    {caseAssignments[p.id] === counselorId ? <span className="miniAssignmentTag">My case load</span> : null}
                    <AttendanceStatusChip patient={p} sessions={sessions} weekDate={weekDate} />
                  </div>

                  <div className="workspaceMobilePatientStats">
                    <div className="workspaceMobileStatCard">
                      <span className="workspaceMiniLabel">Next appt</span>
                      <strong>{fmt(p.nextApptDate)}</strong>
                    </div>
                    <div className="workspaceMobileStatCard">
                      <span className="workspaceMiniLabel">This week</span>
                      <strong>{attendance.goal ? `${attendance.attendedHours}h` : "No goal"}</strong>
                    </div>
                  </div>

                  <div className="workspaceMobilePatientFooter">
                    <span className={`workspaceTone ${drug.tone}`}>{drug.label}</span>
                    <span className={`workspaceTone ${problemList.tone}`}>{problemList.reviewText}</span>
                    {workItems.map((item) => (
                      <span key={item.id} className={`workspaceTone ${item.tone}`}>
                        {item.title}: {item.detail}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
            {!rows.length ? <div className="workspaceEmptyState">No patients match the current search or filters.</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (view === "split") {
    return (
      <div className="workspaceSplit">
        <div className="workspaceRosterCard">
          <div className="workspaceRosterHead">
            <div>
              <div className="workspaceSectionLabel">Roster</div>
              <div className="workspaceRosterTitle">Browse your patients like a live table, with the next action always visible.</div>
            </div>
            <div className="workspaceResultsCount">{rows.length} visible</div>
          </div>
          <div className="workspaceSplitList">
            {rows.map((p) => {
              const drug = getDrugTestSummary(p, complianceByPatient[p.id], weekDate);
              const problemList = getProblemListSummary(complianceByPatient[p.id]);
              return (
                <button
                  key={p.id}
                  className={p.id === selectedId ? "workspaceSplitRow selected" : "workspaceSplitRow"}
                  onClick={() => onSelect(p.id)}
                  onDoubleClick={() => onOpen(p.id)}
                  title="Double-click to open"
                >
                  <div className="workspaceSplitIdentity">
                    <strong>{p.displayName}</strong>
                    <span>MRN {p.mrn ?? "—"} • {p.primaryProgram ?? "Program not set"}</span>
                  </div>
                  <div className="workspaceSplitSignals">
                    <AttendanceStatusChip patient={p} sessions={sessions} weekDate={weekDate} />
                    <span className={`workspaceTone ${drug.tone}`}>{drug.label}</span>
                    <span className={`workspaceTone ${problemList.tone}`}>{problemList.reviewText}</span>
                  </div>
                  <div className="workspaceSplitMeta">
                    {caseAssignments[p.id] === counselorId ? <span className="miniAssignmentTag">My case load</span> : null}
                    <span className={pillClass(p.kind)}>{p.kind}</span>
                  </div>
                </button>
              );
            })}
            {!rows.length ? <div className="workspaceEmptyState">No patients match the current search or filters.</div> : null}
          </div>
        </div>

        <div className="workspacePreviewCard">
          <div className="workspaceRosterHead">
            <div>
              <div className="workspaceSectionLabel">Selected Patient</div>
              <div className="workspaceRosterTitle">Keep the detail view close while you work through the roster.</div>
            </div>
          </div>
          <div className="workspacePreviewBody">
            {selected ? (
              <PreviewCard
                patient={selected}
                sessions={sessions}
                compliance={complianceByPatient[selected.id]}
                assigned={caseAssignments[selected.id] === counselorId}
                canHighlight={canHighlightPatient}
                onHighlight={() => onHighlightPatient(selected.id)}
              />
            ) : (
              <div className="workspaceEmptyState">Select a patient to preview their schedule and requirements.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === "sheet") {
        return (
      <div className="workspaceRosterCard">
          <div className="workspaceRosterHead sheetHeaderCompact">
            <div>
              <div className="workspaceSectionLabel">Roster Sheet</div>
            </div>
          </div>
        <div className={isAdminView ? "workspaceSheetWrap adminCompact" : "workspaceSheetWrap"}>
          <div
            className="workspaceSheet"
            ref={sheetScrollRef}
          >
            <div className="workspaceSheetHead">
              <div>NCADD ID</div>
              <div>Client's Name</div>
              <div>Sage ID</div>
              <div>LOC</div>
              <div>DOC</div>
              <div>Admit Date</div>
              <div>Problem List</div>
              <div>Problem List Review 30</div>
              <div>Problem List Update 90</div>
              <div>Treatment Plan</div>
              <div>Treatment Plan Update 180</div>
              <div>Medical / Phys Apt.</div>
              <div>Med Form</div>
              <div>Referring Agency</div>
              <div>Reauth SAP-C</div>
              <div>Medical Eligibility</div>
              <div>MAT</div>
              <div>Therapy</div>
              <div>Notes</div>
            </div>
            {rows.map((p) => {
              const dueDates = getProblemListDueDates(complianceByPatient[p.id]);
              const attendance = getWeeklyAttendanceStats(p, sessions, weekDate);
              const problemList = getProblemListSummary(complianceByPatient[p.id]);
              const treatmentPlan = getTreatmentPlanSummary(p, complianceByPatient[p.id]);
              const treatmentPlanDueDates = getTreatmentPlanDueDates(p, complianceByPatient[p.id]);
              const reauthDelta = p.rosterDetails?.reauthSapcDate ? dayDiff(weekDate, p.rosterDetails.reauthSapcDate) : null;
              const rowTone =
                problemList.tone === "behind" || (reauthDelta !== null && reauthDelta < 0)
                  ? "alert"
                  : problemList.tone === "neutral" || (reauthDelta !== null && reauthDelta <= 7)
                    ? "watch"
                    : "";

              return (
                <button
                  key={p.id}
                  className={p.id === selectedId ? `workspaceSheetRow ${rowTone} selected` : `workspaceSheetRow ${rowTone}`}
                  onClick={() => onSelect(p.id)}
                  onDoubleClick={() => onOpen(p.id)}
                  title="Double-click to open"
                >
                  <div>{p.id.slice(0, 8)}</div>
                  <div className="workspaceSheetName">
                    <strong>{p.displayName}</strong>
                    <div className="workspaceCellTags">
                      <span className={pillClass(p.kind)}>{p.kind}</span>
                      {caseAssignments[p.id] === counselorId ? <span className="miniAssignmentTag">Assigned</span> : null}
                    </div>
                  </div>
                  <div>{p.mrn ?? "—"}</div>
                  <div>
                    <SheetSelectCell
                      value={p.primaryProgram ?? ""}
                      options={LOC_PROGRAM_OPTS}
                      onSave={(value) => {
                        onSelect(p.id);
                        void onUpdatePatientProgram(p.id, value);
                      }}
                    />
                  </div>
                  <div>
                    <SheetMultiSelectCell
                      value={p.rosterDetails?.drugOfChoice}
                      placeholder="Select DOC"
                      onOpen={() => setDocEditor({ patientId: p.id, current: p.rosterDetails?.drugOfChoice ?? [] })}
                    />
                  </div>
                  <div>{fmt(p.intakeDate)}</div>
                  <div>{complianceByPatient[p.id]?.problemListDate ? fmt(complianceByPatient[p.id]?.problemListDate) : "—"}</div>
                  <div><span className={`workspaceTone ${problemList.tone}`}>{dueDates?.nextReview ? fmt(dueDates.nextReview) : "—"}</span></div>
                  <div><span className={`workspaceTone ${problemList.tone}`}>{dueDates?.nextUpdate ? fmt(dueDates.nextUpdate) : "—"}</span></div>
                  <div><span className={`workspaceTone ${treatmentPlan.tone}`}>{complianceByPatient[p.id]?.treatmentPlanDate ? fmt(complianceByPatient[p.id]?.treatmentPlanDate) : "—"}</span></div>
                  <div><span className={`workspaceTone ${treatmentPlan.tone}`}>{fmt(treatmentPlanDueDates.nextUpdate)}</span></div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.medicalPhysApt}
                      options={MEDICAL_PHYS_APT_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { medicalPhysApt: (value || undefined) as PatientRosterDetails["medicalPhysApt"] })}
                    />
                  </div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.medFormStatus}
                      options={MED_FORM_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { medFormStatus: (value || undefined) as PatientRosterDetails["medFormStatus"] })}
                    />
                  </div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.referringAgency}
                      options={REFERRING_AGENCY_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { referringAgency: (value || undefined) as PatientRosterDetails["referringAgency"] })}
                    />
                  </div>
                  <div>
                    <SheetDateCell
                      value={p.rosterDetails?.reauthSapcDate}
                      onSave={(value) => onUpdateRosterDetails(p.id, { reauthSapcDate: value || undefined })}
                    />
                  </div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.medicalEligibility}
                      options={MEDICAL_ELIGIBILITY_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { medicalEligibility: (value || undefined) as PatientRosterDetails["medicalEligibility"] })}
                    />
                  </div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.matStatus}
                      options={MAT_STATUS_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { matStatus: (value || undefined) as PatientRosterDetails["matStatus"] })}
                    />
                  </div>
                  <div>
                    <SheetSelectCell
                      value={p.rosterDetails?.therapyTrack}
                      options={THERAPY_OPTS}
                      onSave={(value) => onUpdateRosterDetails(p.id, { therapyTrack: (value || undefined) as PatientRosterDetails["therapyTrack"] })}
                    />
                  </div>
                  <div className="workspaceSheetNotes">
                    <SheetInputCell
                      value={p.rosterDetails?.notes}
                      placeholder="Add note"
                      onSave={(value) => onUpdateRosterDetails(p.id, { notes: value || undefined })}
                    />
                    {attendance.goal ? <span>{attendance.attendedHours}h this week</span> : null}
                  </div>
                </button>
              );
            })}
            {!rows.length ? <div className="workspaceEmptyState">No patients match the current search or filters.</div> : null}
          </div>
          <div className="workspaceSheetFloatingArrows" aria-hidden="false">
            <button className="workspaceMiniBtn workspaceArrowBtn" onClick={() => sheetScrollRef.current?.scrollBy({ left: -420, behavior: "smooth" })}>
              <span>←</span>
            </button>
            <button className="workspaceMiniBtn workspaceArrowBtn" onClick={() => sheetScrollRef.current?.scrollBy({ left: 420, behavior: "smooth" })}>
              <span>→</span>
            </button>
          </div>
        </div>
        {docEditor ? (
          <MultiEditModal
            title="Drug of Choice"
            opts={SUBSTANCE_OPTS}
            cur={docEditor.current}
            onSave={(vals) => onUpdateRosterDetails(docEditor.patientId, { drugOfChoice: vals.length ? vals : undefined })}
            onClose={() => setDocEditor(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="workspaceCardGrid">
      {rows.map((p) => (
        <button
          key={p.id}
          className={p.id === selectedId ? "workspaceRosterTile selected" : "workspaceRosterTile"}
          onClick={() => onSelect(p.id)}
          onDoubleClick={() => onOpen(p.id)}
          title="Double-click to open"
        >
          <div className="workspaceTileTop">
            <div className="workspaceCellIdentity">
              <strong>{p.displayName}</strong>
              <span>MRN {p.mrn ?? "—"}</span>
            </div>
            <div className={pillClass(p.kind)}>{p.kind}</div>
          </div>
          <div className="workspaceTileGrid">
            <div className="workspaceMiniBlock">
              <span className="workspaceMiniLabel">Program</span>
              <strong>{p.primaryProgram ?? "Not set"}</strong>
            </div>
            <div className="workspaceMiniBlock">
              <span className="workspaceMiniLabel">Next appointment</span>
              <strong>{fmt(p.nextApptDate)}</strong>
            </div>
          </div>
          <AttendanceStatusChip patient={p} sessions={sessions} weekDate={weekDate} />
          <div className="workspaceTileSignals">
            {getPatientWorkItems(p, complianceByPatient[p.id], sessions, weekDate).slice(0, 2).map((item) => (
              <span key={item.id} className={`workspaceTone ${item.tone}`}>
                {item.title}: {item.detail}
              </span>
            ))}
          </div>
          {caseAssignments[p.id] === counselorId ? <span className="miniAssignmentTag">Assigned to me</span> : null}
        </button>
      ))}
      {!rows.length ? <div className="workspaceEmptyState">No patients match the current search or filters.</div> : null}
    </div>
  );
}

/* -------------------- Theme Picker -------------------- */

function NotificationComposerModal({
  recipients,
  patients,
  currentUserEmail,
  onClose,
  onSend,
}: {
  recipients: string[];
  patients: Patient[];
  currentUserEmail: string;
  onClose: () => void;
  onSend: (payload: {
    recipientEmail: string;
    title: string;
    message: string;
    priority: "normal" | "urgent";
    patientId: string;
  }) => Promise<void>;
}) {
  const [recipientEmail, setRecipientEmail] = useState(recipients.find((email) => email !== currentUserEmail) ?? "");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [patientId, setPatientId] = useState("");
  const [sending, setSending] = useState(false);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Send counselor note</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="addGrid">
            <label className="addField">
              <span className="addLabel">Recipient</span>
              <select className="select" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}>
                <option value="">Choose teammate</option>
                {recipients.filter((email) => email !== currentUserEmail).map((email) => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            </label>

            <label className="addField">
              <span className="addLabel">Priority</span>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as "normal" | "urgent")}>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>

            <label className="addField">
              <span className="addLabel">Patient</span>
              <select className="select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">Choose patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>{patient.displayName}</option>
                ))}
              </select>
            </label>

            <label className="addField">
              <span className="addLabel">Title</span>
              <input className="authInput" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should they notice?" />
            </label>
          </div>

          <label className="addField" style={{ marginTop: 12 }}>
            <span className="addLabel">Message</span>
            <textarea className="authInput controlCenterTextarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should the counselor focus on for this patient?" />
          </label>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button
            className="btn"
            disabled={sending || !recipientEmail || !patientId || !title.trim() || !message.trim()}
            onClick={async () => {
              setSending(true);
              await onSend({
                recipientEmail,
                title: title.trim(),
                message: message.trim(),
                priority,
                patientId,
              });
              setSending(false);
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationReplyModal({
  patientName,
  title,
  onClose,
  onSend,
}: {
  patientName: string;
  title: string;
  onClose: () => void;
  onSend: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Reply to admin note</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="workspaceAgendaMeta">Patient</div>
          <div className="workspaceAgendaDetail">{patientName}</div>
          <div className="workspaceAgendaMeta">Original note</div>
          <div className="workspaceAgendaDetail">{title}</div>
          <label className="addField" style={{ marginTop: 12 }}>
            <span className="addLabel">Reply</span>
            <textarea
              className="authInput controlCenterTextarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your response back to admin"
            />
          </label>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button
            className="btn"
            disabled={sending || !message.trim()}
            onClick={async () => {
              setSending(true);
              await onSend(message.trim());
              setSending(false);
            }}
          >
            {sending ? "Sending..." : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatientHighlightModal({
  patientName,
  onClose,
  onSend,
}: {
  patientName: string;
  onClose: () => void;
  onSend: (payload: { message: string; priority: "normal" | "urgent" }) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [sending, setSending] = useState(false);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Highlight patient for counselor</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="workspaceAgendaMeta">Patient</div>
          <div className="workspaceAgendaDetail">{patientName}</div>
          <label className="addField" style={{ marginTop: 12 }}>
            <span className="addLabel">Priority</span>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as "normal" | "urgent")}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="addField" style={{ marginTop: 12 }}>
            <span className="addLabel">Note</span>
            <textarea
              className="authInput controlCenterTextarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type what the counselor should focus on next."
            />
          </label>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button
            className="btn"
            disabled={sending || !message.trim()}
            onClick={async () => {
              setSending(true);
              await onSend({ message: message.trim(), priority });
              setSending(false);
            }}
          >
            {sending ? "Sending..." : "Send highlight"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemePicker({ theme, setTheme }: { theme: ThemeId; setTheme: (t: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="themeFloat">
      <button className="themeFloatBtn" onClick={() => setOpen((o) => !o)} title="Change theme" aria-label="Change theme">
        <img className="themeFloatImage rainbow" src={themeButtonLogo} alt="" aria-hidden="true" />
      </button>
      {open && (
        <div className="themePanel">
          <div className="themePanelTitle">Theme</div>
          <div className="themeList">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={t.id === theme ? "themeItem on" : "themeItem"}
                onClick={() => { setTheme(t.id); setOpen(false); }}
              >
                <span className="themeItemDot" style={{ background: THEME_COLORS[t.id] }} />
                {t.label}{t.id === theme ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewCard({
  patient,
  sessions,
  compliance,
  assigned,
  canHighlight,
  onHighlight,
}: {
  patient: Patient;
  sessions: Session[];
  compliance?: PatientCompliance;
  assigned: boolean;
  canHighlight: boolean;
  onHighlight: () => void;
}) {
  const drugTest = getDrugTestSummary(patient, compliance, new Date().toISOString().slice(0, 10));
  const problemList = getProblemListSummary(compliance);
  const treatmentPlan = getTreatmentPlanSummary(patient, compliance);
  const therapy = getTherapySummary(patient);
  return (
    <div>
      <div className="hero" style={{ marginBottom: 10 }}>
        <div>
          <div className="heroName">{patient.displayName}</div>
          <div className="heroMeta">
            MRN {patient.mrn ?? "—"} • {patient.primaryProgram ?? "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {canHighlight ? (
            <button className="btn btnHighlight" onClick={onHighlight}>
              Highlight for counselor
            </button>
          ) : null}
          {assigned ? <span className="miniAssignmentTag">My case load</span> : null}
          <div className={pillClass(patient.kind)}>{patient.kind}</div>
        </div>
      </div>

      <div className="grid3">
        <div className="tile">
          <div className="label">Intake date</div>
          <div className="value">{fmt(patient.intakeDate)}</div>
        </div>
        <div className="tile">
          <div className="label">Last visit</div>
          <div className="value">{fmt(patient.lastVisitDate)}</div>
        </div>
        <div className="tile">
          <div className="label">Next appointment</div>
          <div className="value">{fmt(patient.nextApptDate)}</div>
        </div>
      </div>

      <WeeklyAttendanceMeter patient={patient} sessions={sessions} weekDate={new Date().toISOString().slice(0, 10)} compact />

      <div className="quickChecklist">
        <div className={`quickCheckItem ${drugTest.tone}`}>
          <strong>Drug testing</strong>
          <span>{drugTest.label}</span>
        </div>
        <div className={`quickCheckItem ${problemList.tone}`}>
          <strong>Problem list</strong>
          <span>{problemList.reviewText}</span>
        </div>
        <div className={`quickCheckItem ${treatmentPlan.tone}`}>
          <strong>Treatment plan</strong>
          <span>{treatmentPlan.updateText}</span>
        </div>
        <div className={`quickCheckItem ${therapy.tone}`}>
          <strong>Therapy</strong>
          <span>{therapy.label}</span>
        </div>
      </div>

      <div className="section">
        <div className="sectionTitle">Top signals</div>
        <div className="flags">
          {(patient.flags ?? []).map((f) => (
            <span key={f} className="flag">
              {f}
            </span>
          ))}
          {(patient.tests ?? []).slice(0, 4).map((t, idx) => (
            <span key={idx} className="flag">
              {t.name}
            </span>
          ))}
          {!((patient.flags ?? []).length || (patient.tests ?? []).length) ? (
            <span className="empty">No flags/tests.</span>
          ) : null}
        </div>
      </div>

      <div className="hintTiny">Double-click any result to open the full patient page.</div>
    </div>
  );
}

/* -------------------- Patient Page -------------------- */

function PatientPage({
  patient,
  allSessions,
  dataClient,
  counselorId,
  isAssigned,
  compliance,
  onToggleAssignment,
  onUpdateCompliance,
  onUpdateRosterDetails,
  onUpdatePatient,
  onDeletePatient,
  canHighlightPatient,
  onHighlightPatient,
  onDocumentsTabActiveChange,
}: {
  patient: Patient;
  allSessions: Session[];
  dataClient: DataClient;
  counselorId: string;
  isAssigned: boolean;
  compliance?: PatientCompliance;
  onToggleAssignment: () => void;
  onUpdateCompliance: (patch: Partial<PatientCompliance>) => void;
  onUpdateRosterDetails: (patch: Partial<PatientRosterDetails>) => void;
  onUpdatePatient: (next: Patient) => void;
  onDeletePatient: () => void;
  canHighlightPatient: boolean;
  onHighlightPatient: () => void;
  onDocumentsTabActiveChange?: (active: boolean) => void;
}) {
  const [tab, setTab] = useState<"overview" | "documents" | "intake" | "snap" | "health" | "consents" | "attendance">("overview");
  const [overviewPane, setOverviewPane] = useState<"summary" | "alerts" | "roster" | "compliance">("summary");
  const [sub, setSub] = useState<IntakeSubmission | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [documents, setDocuments] = useState<PatientDocumentSummary[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [hasLoadedDocuments, setHasLoadedDocuments] = useState(false);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);
  const [documentsPath, setDocumentsPath] = useState<string[]>([]);
  const [documentsSearch, setDocumentsSearch] = useState("");
  const [documentsSort, setDocumentsSort] = useState<"name" | "date" | "size">("name");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
  const [programSaving, setProgramSaving] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);

  useEffect(() => {
    onDocumentsTabActiveChange?.(tab === "documents");
    return () => onDocumentsTabActiveChange?.(false);
  }, [tab, onDocumentsTabActiveChange]);

  useEffect(() => {
    setHasLoadedDocuments(false);
    setDocuments([]);
    setDocumentsLoading(true);
  }, [patient.id]);

  useEffect(() => {
    let cancelled = false;
    setSubLoading(true);
    dataClient
      .getLatestIntakeSubmission(patient.id)
      .then((data) => {
        if (cancelled) return;
        setSub((data as IntakeSubmission) ?? null);
        setSubLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSub(null);
        setSubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataClient, patient.id]);

  useEffect(() => {
    if (tab !== "documents" && hasLoadedDocuments) return;
    let cancelled = false;
    setDocumentsLoading(true);
    dataClient
      .getPatientDocuments(patient.id)
      .then((rows) => {
        if (cancelled) return;
        setDocuments(rows);
        setHasLoadedDocuments(true);
        setDocumentsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDocuments([]);
        setHasLoadedDocuments(true);
        setDocumentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataClient, patient.id, tab, hasLoadedDocuments]);

  const ans: IntakeAnswers | undefined = sub
    ? {
        fields: ((sub.raw_json as any)?.sections?.intake?.fields ?? {}) as Record<string, string>,
        singles: ((sub.raw_json as any)?.sections?.intake?.radios ?? {}) as Record<string, string>,
        multis: ((sub.raw_json as any)?.sections?.intake?.multi ?? {}) as Record<string, string[]>,
      }
    : undefined;

  const patientSessions = useMemo(() => {
    return allSessions.filter((s) => s.patientIds.includes(patient.id)).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [allSessions, patient.id]);

  const patientAttendance = useMemo(() => {
    return patientSessions.map((s) => ({
      sessionId: s.id,
      sessionTitle: s.title,
      date: s.date,
      kind: s.kind,
      durationHours: toSessionHours(s.durationHours),
      status: s.attendance[patient.id] ?? "Absent",
    }));
  }, [patientSessions, patient.id]);

  const attendanceWeekDate = patientAttendance[0]?.date ?? new Date().toISOString().slice(0, 10);

  const drugTestSummary = getDrugTestSummary(patient, compliance, new Date().toISOString().slice(0, 10));
  const problemListSummary = getProblemListSummary(compliance);
  const treatmentPlanSummary = getTreatmentPlanSummary(patient, compliance);
  const therapySummary = getTherapySummary(patient);
  const roster = patient.rosterDetails ?? {};

  const updateConsentRawJson = async (newJson: any) => {
    if (!sub) return;
    const next = await dataClient.updateIntakeSubmission(sub.id, { raw_json: newJson });
    setSub(next as IntakeSubmission);
  };

  const handleStatusChange = async (newKind: PatientKind) => {
    setStatusChanging(true);
    const statusMap: Record<PatientKind, string> = {
      "New Patient": "new",
      "Current Patient": "current",
      "RSS+": "rss_plus",
      "RSS": "rss",
      "Former Patient": "former",
    };
    await dataClient.updatePatient(patient.id, { status: statusMap[newKind] });
    setStatusChanging(false);
    onUpdatePatient({ ...patient, kind: newKind });
  };

  const handlePrimaryProgramChange = async (newProgram: string) => {
    setProgramSaving(true);
    await dataClient.updatePatient(patient.id, { primary_program: newProgram || null });
    setProgramSaving(false);
    onUpdatePatient({ ...patient, primaryProgram: newProgram || undefined });
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const normalizeDocumentPath = (value: string) => {
    const segments = value
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/[^a-zA-Z0-9._ -]+/g, "_"));
    if (!segments.length) return "";
    const fileName = segments[segments.length - 1];
    segments[segments.length - 1] = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
    return segments.join("/");
  };

  const createIntakeSub = async () => {
    const emptyJson = {
      meta: { createdAt: new Date().toISOString(), source: "manual" },
      sections: { intake: { fields: {}, radios: {}, multi: {} } },
    };
    const data = await dataClient.createIntakeSubmission({
      patient_id: patient.id,
      raw_json: emptyJson,
      status: "received",
    });
    setSub(data as IntakeSubmission);
  };

  const openPatientDocument = async (document: PatientDocumentSummary) => {
    setDownloadingDocumentId(document.id);
    try {
      const blob = await dataClient.downloadPatientDocument(document.id);
      const url = URL.createObjectURL(blob);
      const fileName = normalizeDocumentPath(document.original_filename || "").split("/").pop() || "document.pdf";
      setDocumentPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, fileName };
      });
    } catch (error) {
      console.error("Unable to open patient document:", error);
      window.alert("Could not open that document right now.");
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const printBlobUrl = (blobUrl: string) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.border = "0";
    iframe.src = blobUrl;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => {
        iframe.remove();
      }, 1_000);
    };
    document.body.appendChild(iframe);
  };

  const printPatientDocument = async (document: PatientDocumentSummary) => {
    setDownloadingDocumentId(document.id);
    try {
      const blob = await dataClient.downloadPatientDocument(document.id);
      const url = URL.createObjectURL(blob);
      printBlobUrl(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      console.error("Unable to print patient document:", error);
      window.alert("Could not prepare that document for printing.");
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const closeDocumentPreview = () => {
    setDocumentPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const formatDocumentSize = (value: number | string) => {
    const n = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const allDocumentFolders = useMemo(() => {
    const set = new Set<string>();
    documents.forEach((doc) => {
      const cleaned = normalizeDocumentPath(doc.original_filename || "");
      const parts = cleaned.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i += 1) {
        set.add(parts.slice(0, i).join("/"));
      }
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const currentPathKey = documentsPath.join("/");
  const { raw: docsSearchRaw } = useMemo(() => normalizeQuery(documentsSearch), [documentsSearch]);

  const docFolderEntries = useMemo(() => {
    const folderMap = new Map<string, string>();
    const fileRows: PatientDocumentSummary[] = [];
    documents.forEach((doc) => {
      const cleaned = normalizeDocumentPath(doc.original_filename || "");
      const parts = cleaned.split("/").filter(Boolean);
      const parent = parts.slice(0, -1).join("/");
      if (parent !== currentPathKey) return;
      fileRows.push(doc);
    });
    allDocumentFolders.forEach((folderPath) => {
      const parts = folderPath.split("/");
      const parent = parts.slice(0, -1).join("/");
      if (parent !== currentPathKey) return;
      const name = parts[parts.length - 1];
      folderMap.set(name, folderPath);
    });
    const folders = [...folderMap.entries()]
      .map(([name, fullPath]) => ({ name, fullPath }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = [...fileRows].sort((a, b) => a.original_filename.localeCompare(b.original_filename));
    return { folders, files };
  }, [allDocumentFolders, currentPathKey, documents]);

  const docVisibleFiles = useMemo(() => {
    const filtered = docsSearchRaw
      ? docFolderEntries.files.filter((doc) => normalizeDocumentPath(doc.original_filename).toLowerCase().includes(docsSearchRaw))
      : docFolderEntries.files;
    const sorted = [...filtered];
    if (documentsSort === "date") {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (documentsSort === "size") {
      sorted.sort((a, b) => Number(b.byte_size) - Number(a.byte_size));
    } else {
      sorted.sort((a, b) => a.original_filename.localeCompare(b.original_filename));
    }
    return sorted;
  }, [docFolderEntries.files, docsSearchRaw, documentsSort]);

  const renameDocumentInState = (documentId: string, nextPath: string) => {
    setDocuments((prev) =>
      prev.map((row) => (row.id === documentId ? { ...row, original_filename: nextPath } : row))
    );
  };

  const folderContainsDocument = (folderPath: string, doc: PatientDocumentSummary) => {
    const docPath = normalizeDocumentPath(doc.original_filename);
    const docFolder = docPath.split("/").slice(0, -1).join("/");
    return docFolder === folderPath || docFolder.startsWith(`${folderPath}/`);
  };

  const renameDocument = async (doc: PatientDocumentSummary) => {
    const currentName = normalizeDocumentPath(doc.original_filename || "").split("/").filter(Boolean).pop() || doc.original_filename;
    const nextName = window.prompt("Rename file", currentName);
    if (!nextName || !nextName.trim()) return;
    const parent = normalizeDocumentPath(doc.original_filename || "").split("/").filter(Boolean).slice(0, -1).join("/");
    const nextPath = normalizeDocumentPath(parent ? `${parent}/${nextName}` : nextName);
    if (!nextPath) return;
    try {
      renameDocumentInState(doc.id, nextPath);
      const updated = await dataClient.renamePatientDocument(doc.id, { originalFileName: nextPath });
      renameDocumentInState(doc.id, normalizeDocumentPath(updated.original_filename || nextPath));
    } catch (error) {
      renameDocumentInState(doc.id, doc.original_filename);
      console.error("Unable to rename patient document:", error);
      window.alert("Could not rename that file right now.");
      return;
    }
  };

  const moveDocument = async (doc: PatientDocumentSummary) => {
    const currentPath = normalizeDocumentPath(doc.original_filename || "");
    const available = allDocumentFolders.length ? `\nExisting folders:\n${allDocumentFolders.join("\n")}` : "";
    const folderInput = window.prompt(
      `Move "${currentPath.split("/").pop()}" to folder path (leave blank for root).${available}`,
      currentPath.split("/").slice(0, -1).join("/")
    );
    if (folderInput === null) return;
    const fileName = currentPath.split("/").pop() || doc.original_filename;
    const targetPath = normalizeDocumentPath(folderInput.trim() ? `${folderInput.trim()}/${fileName}` : fileName);
    if (!targetPath) return;
    try {
      renameDocumentInState(doc.id, targetPath);
      const updated = await dataClient.renamePatientDocument(doc.id, { originalFileName: targetPath });
      renameDocumentInState(doc.id, normalizeDocumentPath(updated.original_filename || targetPath));
    } catch (error) {
      renameDocumentInState(doc.id, doc.original_filename);
      console.error("Unable to move patient document:", error);
      window.alert("Could not move that file right now.");
      return;
    }
  };

  const deleteDocument = async (doc: PatientDocumentSummary) => {
    const ok = window.confirm(`Delete document "${doc.original_filename}"? This cannot be undone.`);
    if (!ok) return;
    const snapshot = documents;
    setDocuments((prev) => prev.filter((row) => row.id !== doc.id));
    try {
      await dataClient.deletePatientDocument(doc.id);
    } catch (error) {
      setDocuments(snapshot);
      console.error("Unable to delete patient document:", error);
      window.alert("Could not delete that file right now.");
      return;
    }
  };

  const renameFolder = async (folderPath: string) => {
    const parts = folderPath.split("/").filter(Boolean);
    const currentName = parts[parts.length - 1];
    const nextName = window.prompt("Rename folder", currentName);
    if (!nextName || !nextName.trim()) return;
    const parent = parts.slice(0, -1);
    const nextFolderPath = [...parent, nextName.trim().replace(/[^a-zA-Z0-9._ -]+/g, "_")].filter(Boolean).join("/");
    if (!nextFolderPath || nextFolderPath === folderPath) return;
    const impacted = documents.filter((doc) => folderContainsDocument(folderPath, doc));
    if (!impacted.length) return;
    setDocumentsBusy(true);
    try {
      const renamePlan = impacted.map((doc) => {
        const current = normalizeDocumentPath(doc.original_filename);
        const nextPath = current.startsWith(`${folderPath}/`) ? `${nextFolderPath}/${current.slice(folderPath.length + 1)}` : current;
        return {
          documentId: doc.id,
          previousPath: doc.original_filename,
          nextPath,
        };
      });
      renamePlan.forEach((item) => renameDocumentInState(item.documentId, item.nextPath));
      const results = await Promise.allSettled(
        renamePlan.map((item) => dataClient.renamePatientDocument(item.documentId, { originalFileName: item.nextPath }))
      );
      const failed = results.some((result) => result.status === "rejected");
      if (failed) {
        renamePlan.forEach((item) => renameDocumentInState(item.documentId, item.previousPath));
        throw new Error("Some files could not be renamed.");
      }
    } catch (error) {
      console.error("Unable to rename folder:", error);
      window.alert("Could not rename that folder right now.");
      return;
    } finally {
      setDocumentsBusy(false);
    }
  };

  const deleteFolder = async (folderPath: string) => {
    const impacted = documents.filter((doc) => folderContainsDocument(folderPath, doc));
    if (!impacted.length) return;
    const ok = window.confirm(`Delete folder "${folderPath}" and ${impacted.length} document(s)? This cannot be undone.`);
    if (!ok) return;
    setDocumentsBusy(true);
    try {
      const impactedIds = new Set(impacted.map((doc) => doc.id));
      const snapshot = documents;
      setDocuments((prev) => prev.filter((row) => !impactedIds.has(row.id)));
      const results = await Promise.allSettled(impacted.map((doc) => dataClient.deletePatientDocument(doc.id)));
      const failed = results.some((result) => result.status === "rejected");
      if (failed) {
        setDocuments(snapshot);
        throw new Error("Some files could not be deleted.");
      }
    } catch (error) {
      console.error("Unable to delete folder:", error);
      window.alert("Could not delete that folder right now.");
      return;
    } finally {
      setDocumentsBusy(false);
    }
  };

  const bulkMoveSelected = async () => {
    if (!selectedDocumentIds.length) return;
    const folderInput = window.prompt("Move selected files to folder path (leave blank for root)", currentPathKey);
    if (folderInput === null) return;
    const destinationFolder = folderInput.trim();
    setDocumentsBusy(true);
    try {
      const selected = documents.filter((row) => selectedDocumentIds.includes(row.id));
      const movePlan = selected.map((doc) => {
        const fileName = normalizeDocumentPath(doc.original_filename).split("/").pop() || doc.original_filename;
        const nextPath = normalizeDocumentPath(destinationFolder ? `${destinationFolder}/${fileName}` : fileName);
        return {
          documentId: doc.id,
          previousPath: doc.original_filename,
          nextPath,
        };
      });
      movePlan.forEach((item) => renameDocumentInState(item.documentId, item.nextPath));
      const results = await Promise.allSettled(
        movePlan.map((item) => dataClient.renamePatientDocument(item.documentId, { originalFileName: item.nextPath }))
      );
      const failed = results.some((result) => result.status === "rejected");
      if (failed) {
        movePlan.forEach((item) => renameDocumentInState(item.documentId, item.previousPath));
        throw new Error("Some files could not be moved.");
      }
      setSelectedDocumentIds([]);
    } catch (error) {
      console.error("Unable to move selected documents:", error);
      window.alert("Could not move all selected files.");
      return;
    } finally {
      setDocumentsBusy(false);
    }
  };

  const bulkDeleteSelected = async () => {
    if (!selectedDocumentIds.length) return;
    const ok = window.confirm(`Delete ${selectedDocumentIds.length} selected document(s)? This cannot be undone.`);
    if (!ok) return;
    setDocumentsBusy(true);
    try {
      const selectedIds = new Set(selectedDocumentIds);
      const snapshot = documents;
      setDocuments((prev) => prev.filter((row) => !selectedIds.has(row.id)));
      const results = await Promise.allSettled(
        selectedDocumentIds.map((docId) => dataClient.deletePatientDocument(docId))
      );
      const failed = results.some((result) => result.status === "rejected");
      if (failed) {
        setDocuments(snapshot);
        throw new Error("Some files could not be deleted.");
      }
      setSelectedDocumentIds([]);
    } catch (error) {
      console.error("Unable to delete selected documents:", error);
      window.alert("Could not delete all selected files.");
      return;
    } finally {
      setDocumentsBusy(false);
    }
  };

  const createFolderHere = () => {
    const folderName = window.prompt("New folder name");
    if (!folderName || !folderName.trim()) return;
    const next = [...documentsPath, folderName.trim().replace(/[^a-zA-Z0-9._ -]+/g, "_")].filter(Boolean);
    setDocumentsPath(next);
  };

  useEffect(() => {
    setSelectedDocumentIds([]);
  }, [documentsPath, documentsSearch, documentsSort]);

  useEffect(() => () => {
    if (documentPreview) URL.revokeObjectURL(documentPreview.url);
  }, [documentPreview]);

  return (
    <div className="patientWrap">
      <div className="panel" style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div className="panelHead">Patient Page</div>
        <div className="panelBody">
          <div className="hero">
            <div>
              <div className="heroName">{patient.displayName}</div>
              <div className="heroMeta">
                MRN {patient.mrn ?? "—"} • {patient.primaryProgram ?? "—"} • Counselor {patient.counselor ?? "—"} • Signed in as {counselorId}
              </div>
            </div>
            <div className="patientHeroActions">
              {canHighlightPatient ? (
                <button className="btn ghost btnCompact" onClick={onHighlightPatient}>
                  Highlight
                </button>
              ) : null}
              <button className={isAssigned ? "btn ghost btnCompact" : "btn ghost btnCompact"} onClick={onToggleAssignment}>
                {isAssigned ? "Remove Case Assignment" : "Assign Case"}
              </button>
              <select
                className="select"
                value={patient.kind}
                onChange={(e) => handleStatusChange(e.target.value as PatientKind)}
                disabled={statusChanging}
                style={{ minWidth: 138 }}
              >
                <option value="New Patient">New Patient</option>
                <option value="Current Patient">Current Patient</option>
                <option value="RSS+">RSS+</option>
                <option value="RSS">RSS</option>
                <option value="Former Patient">Former Patient</option>
              </select>
              <div className={pillClass(patient.kind)}>{patient.kind}</div>
              <button className="btn btnDanger btnCompact" onClick={() => setShowDeleteModal(true)}>Delete</button>
            </div>
          </div>

          <div className="tabs">
            {(["overview", "documents", "intake", "snap", "health", "consents", "attendance"] as const).map((t) => (
              <button key={t} className={tab === t ? "tabBtn on" : "tabBtn"} onClick={() => setTab(t)}>
                {t === "attendance" ? "Visits & tests" : t === "documents" ? "Documents" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <>
              <div className="overviewSubTabs">
                <button className={overviewPane === "summary" ? "tabBtn on compact" : "tabBtn compact"} onClick={() => setOverviewPane("summary")}>Summary</button>
                <button className={overviewPane === "alerts" ? "tabBtn on compact" : "tabBtn compact"} onClick={() => setOverviewPane("alerts")}>Signals</button>
                <button className={overviewPane === "roster" ? "tabBtn on compact" : "tabBtn compact"} onClick={() => setOverviewPane("roster")}>Roster Fields</button>
                <button className={overviewPane === "compliance" ? "tabBtn on compact" : "tabBtn compact"} onClick={() => setOverviewPane("compliance")}>Compliance</button>
              </div>

              {overviewPane === "summary" ? (
                <>
                  <div className="grid3">
                    <div className="tile">
                      <div className="label">Intake date</div>
                      <div className="value">{fmt(patient.intakeDate)}</div>
                    </div>
                    <div className="tile">
                      <div className="label">Last visit</div>
                      <div className="value">{fmt(patient.lastVisitDate)}</div>
                    </div>
                    <div className="tile">
                      <div className="label">Next appointment</div>
                      <div className="value">{fmt(patient.nextApptDate)}</div>
                    </div>
                  </div>
                  <div className="quickChecklist">
                    <div className={`quickCheckItem ${isAssigned ? "good" : "neutral"}`}>
                      <strong>Assignment</strong>
                      <span>{isAssigned ? "Assigned to your case load" : "Not assigned to your case load"}</span>
                    </div>
                    <div className={`quickCheckItem ${getAttendanceTone(patient, allSessions, new Date().toISOString().slice(0, 10))}`}>
                      <strong>Attendance</strong>
                      <span>{getWeeklyAttendanceStats(patient, allSessions, new Date().toISOString().slice(0, 10)).goal ? "Weekly requirement active" : "Program target not set"}</span>
                    </div>
                    <div className={`quickCheckItem ${drugTestSummary.tone}`}>
                      <strong>Drug testing</strong>
                      <span>{drugTestSummary.label}</span>
                    </div>
                    <div className={`quickCheckItem ${problemListSummary.tone}`}>
                      <strong>Problem list</strong>
                      <span>{problemListSummary.reviewText}</span>
                    </div>
                  </div>
                </>
              ) : null}

              {overviewPane === "alerts" ? (
                <div className="quickChecklist">
                  <div className={`quickCheckItem ${isAssigned ? "good" : "neutral"}`}>
                    <strong>Assignment</strong>
                    <span>{isAssigned ? "On your case load" : "Not on your case load yet"}</span>
                  </div>
                  <div className={`quickCheckItem ${getAttendanceTone(patient, allSessions, new Date().toISOString().slice(0, 10))}`}>
                    <strong>Attendance</strong>
                    <span>{getWeeklyAttendanceStats(patient, allSessions, new Date().toISOString().slice(0, 10)).goal ? "Weekly requirement visible below" : "Program target not set"}</span>
                  </div>
                  <div className={`quickCheckItem ${drugTestSummary.tone}`}>
                    <strong>Drug testing</strong>
                    <span>{drugTestSummary.label}</span>
                  </div>
                  <div className={`quickCheckItem ${problemListSummary.tone}`}>
                    <strong>Problem list</strong>
                    <span>{problemListSummary.reviewText}</span>
                  </div>
                  <div className={`quickCheckItem ${treatmentPlanSummary.tone}`}>
                    <strong>Treatment plan</strong>
                    <span>{treatmentPlanSummary.updateText}</span>
                  </div>
                  <div className={`quickCheckItem ${therapySummary.tone}`}>
                    <strong>Therapy</strong>
                    <span>{therapySummary.label}</span>
                  </div>
                </div>
              ) : null}

              {overviewPane === "roster" ? (
                <>
                <div className="controlCenterGrid">
                  <label className="addField">
                    <span className="addLabel">Level of care</span>
                    <select
                      className="select"
                      value={patient.primaryProgram ?? ""}
                      onChange={(e) => handlePrimaryProgramChange(e.target.value)}
                      disabled={programSaving}
                    >
                      <option value="">Select program</option>
                      {LOC_PROGRAM_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Drug of choice</span>
                    <button className="btn ghost controlCenterPicker" onClick={() => setShowDocModal(true)}>
                      {roster.drugOfChoice?.length ? roster.drugOfChoice.join(", ") : "Select DOC options"}
                    </button>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Referring agency</span>
                    <select className="select" value={roster.referringAgency ?? ""} onChange={(e) => onUpdateRosterDetails({ referringAgency: (e.target.value || undefined) as PatientRosterDetails["referringAgency"] })}>
                      <option value="">Select agency</option>
                      {REFERRING_AGENCY_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Reauth SAP-C date</span>
                    <input className="authInput" type="date" value={roster.reauthSapcDate ?? ""} onChange={(e) => onUpdateRosterDetails({ reauthSapcDate: e.target.value || undefined })} />
                  </label>

                  <label className="addField">
                    <span className="addLabel">Medical eligibility</span>
                    <select className="select" value={roster.medicalEligibility ?? ""} onChange={(e) => onUpdateRosterDetails({ medicalEligibility: (e.target.value || undefined) as PatientRosterDetails["medicalEligibility"] })}>
                      <option value="">Select status</option>
                      {MEDICAL_ELIGIBILITY_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">MAT</span>
                    <select className="select" value={roster.matStatus ?? ""} onChange={(e) => onUpdateRosterDetails({ matStatus: (e.target.value || undefined) as PatientRosterDetails["matStatus"] })}>
                      <option value="">Select MAT</option>
                      {MAT_STATUS_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Therapy</span>
                    <select className="select" value={roster.therapyTrack ?? ""} onChange={(e) => onUpdateRosterDetails({ therapyTrack: (e.target.value || undefined) as PatientRosterDetails["therapyTrack"] })}>
                      <option value="">Select therapist</option>
                      {THERAPY_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Medical / Phys Apt.</span>
                    <select className="select" value={roster.medicalPhysApt ?? ""} onChange={(e) => onUpdateRosterDetails({ medicalPhysApt: (e.target.value || undefined) as PatientRosterDetails["medicalPhysApt"] })}>
                      <option value="">Select status</option>
                      {MEDICAL_PHYS_APT_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="addField">
                    <span className="addLabel">Med form</span>
                    <select className="select" value={roster.medFormStatus ?? ""} onChange={(e) => onUpdateRosterDetails({ medFormStatus: (e.target.value || undefined) as PatientRosterDetails["medFormStatus"] })}>
                      <option value="">Select status</option>
                      {MED_FORM_OPTS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="addField controlCenterNotes">
                  <span className="addLabel">Notes</span>
                  <textarea
                    className="authInput controlCenterTextarea"
                    defaultValue={roster.notes ?? ""}
                    onBlur={(e) => onUpdateRosterDetails({ notes: e.target.value || undefined })}
                    placeholder="Quick notes for the roster and weekly updates"
                  />
                </label>
                </>
              ) : null}

              {overviewPane === "compliance" ? (
                <>
                <div className="controlCenterGrid">
                  <label className="addField">
                    <span className="addLabel">Drug test schedule</span>
                    <select
                      className="select"
                      value={compliance?.drugTestMode ?? "none"}
                      onChange={(e) => onUpdateCompliance({ drugTestMode: e.target.value as PatientCompliance["drugTestMode"] })}
                    >
                      <option value="none">As needed</option>
                      <option value="weekly_count">Tests per week</option>
                      <option value="weekday">Recurring weekday</option>
                    </select>
                  </label>

                  {(compliance?.drugTestMode ?? "none") === "weekly_count" ? (
                    <label className="addField">
                      <span className="addLabel">Drug tests each week</span>
                      <input
                        className="authInput"
                        type="number"
                        min="1"
                        value={compliance?.drugTestsPerWeek ?? 1}
                        onChange={(e) => onUpdateCompliance({ drugTestsPerWeek: Number(e.target.value) || 1 })}
                      />
                    </label>
                  ) : null}

                  {(compliance?.drugTestMode ?? "none") === "weekday" ? (
                    <label className="addField">
                      <span className="addLabel">Recurring drug test day</span>
                      <select
                        className="select"
                        value={compliance?.drugTestWeekday ?? "1"}
                        onChange={(e) => onUpdateCompliance({ drugTestWeekday: e.target.value })}
                      >
                        <option value="0">Sunday</option>
                        <option value="1">Monday</option>
                        <option value="2">Tuesday</option>
                        <option value="3">Wednesday</option>
                        <option value="4">Thursday</option>
                        <option value="5">Friday</option>
                        <option value="6">Saturday</option>
                      </select>
                    </label>
                  ) : null}

                  <label className="addField">
                    <span className="addLabel">Problem list date</span>
                    <input
                      className="authInput"
                      type="date"
                      value={compliance?.problemListDate ?? ""}
                      onChange={(e) => onUpdateCompliance({ problemListDate: e.target.value })}
                    />
                  </label>

                  <label className="addField">
                    <span className="addLabel">Last problem list review</span>
                    <input
                      className="authInput"
                      type="date"
                      value={compliance?.lastProblemListReview ?? ""}
                      onChange={(e) => onUpdateCompliance({ lastProblemListReview: e.target.value })}
                    />
                  </label>

                  <label className="addField">
                    <span className="addLabel">Last problem list update</span>
                    <input
                      className="authInput"
                      type="date"
                      value={compliance?.lastProblemListUpdate ?? ""}
                      onChange={(e) => onUpdateCompliance({ lastProblemListUpdate: e.target.value })}
                    />
                  </label>

                  <label className="addField">
                    <span className="addLabel">Treatment plan set date</span>
                    <input
                      className="authInput"
                      type="date"
                      value={compliance?.treatmentPlanDate ?? ""}
                      onChange={(e) => onUpdateCompliance({ treatmentPlanDate: e.target.value })}
                    />
                  </label>

                  <label className="addField">
                    <span className="addLabel">Last treatment plan update</span>
                    <input
                      className="authInput"
                      type="date"
                      value={compliance?.lastTreatmentPlanUpdate ?? ""}
                      onChange={(e) => onUpdateCompliance({ lastTreatmentPlanUpdate: e.target.value })}
                    />
                  </label>
                </div>
                <div className="hintTiny" style={{ marginTop: 10 }}>
                  LOC drives attendance targets. Problem lists roll on a 30-day review and 90-day update cycle. Treatment plans should be created within 30 days of intake and updated every 6 months. These controls track deadlines and roster operations, not full clinical documentation.
                </div>
                </>
              ) : null}
            </>
          ) : null}

          {tab === "documents" ? (
            <div className="section">
              <div className="sectionTitle">Patient Documents</div>
              <div className="hintTiny">Organize files by folders/subfolders. Rename, move, and delete are available per file.</div>
              <div className="docsToolbar">
                <div className="docsBreadcrumbs">
                  <button className="btn ghost btnCompact" onClick={() => setDocumentsPath([])}>Root</button>
                  {documentsPath.map((segment, index) => (
                    <button
                      key={`${segment}-${index}`}
                      className="btn ghost btnCompact"
                      onClick={() => setDocumentsPath(documentsPath.slice(0, index + 1))}
                    >
                      {segment}
                    </button>
                  ))}
                </div>
                <div className="docsActions">
                  <button className="btn ghost btnCompact" onClick={() => setDocumentsPath(documentsPath.slice(0, -1))} disabled={!documentsPath.length}>Up</button>
                  <button className="btn ghost btnCompact" onClick={createFolderHere}>New Folder</button>
                </div>
              </div>
              <div className="docsToolbar">
                <input
                  className="authInput docsSearchInput"
                  placeholder="Search files in this folder"
                  value={documentsSearch}
                  onChange={(e) => setDocumentsSearch(e.target.value)}
                />
                <div className="docsActions">
                  <select className="select" value={documentsSort} onChange={(e) => setDocumentsSort(e.target.value as "name" | "date" | "size")}>
                    <option value="name">Sort: Name</option>
                    <option value="date">Sort: Uploaded date</option>
                    <option value="size">Sort: Size</option>
                  </select>
                  <button className="btn ghost btnCompact" onClick={() => setSelectedDocumentIds(docVisibleFiles.map((doc) => doc.id))} disabled={!docVisibleFiles.length}>Select all</button>
                  <button className="btn ghost btnCompact" onClick={() => setSelectedDocumentIds([])} disabled={!selectedDocumentIds.length}>Clear</button>
                  <button className="btn ghost btnCompact" onClick={() => void bulkMoveSelected()} disabled={!selectedDocumentIds.length || documentsBusy}>Move selected</button>
                  <button className="btn btnDanger btnCompact" onClick={() => void bulkDeleteSelected()} disabled={!selectedDocumentIds.length || documentsBusy}>Delete selected</button>
                </div>
              </div>
              {documentsLoading ? (
                <div className="hintTiny">Loading documents…</div>
              ) : (
                <div className="table docsTable" style={{ marginTop: 12 }}>
                  <div className="thead" style={{ gridTemplateColumns: "0.35fr 2.2fr 0.9fr 0.9fr 1fr 1.9fr" }}>
                    <div>Select</div>
                    <div>Name</div>
                    <div>Type</div>
                    <div>Size</div>
                    <div>Uploaded</div>
                    <div>Actions</div>
                  </div>
                  {docFolderEntries.folders.map((folder) => (
                    <div
                      key={folder.fullPath}
                      className="trow docsFolderRow"
                      style={{ gridTemplateColumns: "0.35fr 2.2fr 0.9fr 0.9fr 1fr 1.9fr" }}
                    >
                      <div>—</div>
                      <div className="strong">[Folder] {folder.name}</div>
                      <div>Folder</div>
                      <div>—</div>
                      <div>—</div>
                      <div className="docsActions">
                        <button className="btn ghost btnCompact" onClick={() => setDocumentsPath(folder.fullPath.split("/"))}>Open</button>
                        <button className="btn ghost btnCompact" onClick={() => void renameFolder(folder.fullPath)} disabled={documentsBusy}>Rename</button>
                        <button className="btn btnDanger btnCompact" onClick={() => void deleteFolder(folder.fullPath)} disabled={documentsBusy}>Delete</button>
                      </div>
                    </div>
                  ))}
                  {docVisibleFiles.map((doc) => {
                    const parts = normalizeDocumentPath(doc.original_filename || "").split("/").filter(Boolean);
                    const displayName = parts[parts.length - 1] || doc.original_filename;
                    const selectedDoc = selectedDocumentIds.includes(doc.id);
                    return (
                      <div key={doc.id} className="trow" style={{ gridTemplateColumns: "0.35fr 2.2fr 0.9fr 0.9fr 1fr 1.9fr" }}>
                        <div>
                          <input
                            type="checkbox"
                            checked={selectedDoc}
                            onChange={(e) =>
                              setSelectedDocumentIds((prev) =>
                                e.target.checked ? [...new Set([...prev, doc.id])] : prev.filter((id) => id !== doc.id)
                              )
                            }
                          />
                        </div>
                        <div className="strong">[File] {displayName}</div>
                        <div>{doc.document_type}</div>
                        <div>{formatDocumentSize(doc.byte_size)}</div>
                        <div>{fmt(doc.created_at)}</div>
                        <div className="docsActions">
                          <button
                            className="btn ghost btnCompact"
                            disabled={downloadingDocumentId === doc.id}
                            onClick={() => void openPatientDocument(doc)}
                          >
                            {downloadingDocumentId === doc.id ? "Opening…" : "Open"}
                          </button>
                          <button
                            className="btn ghost btnCompact"
                            disabled={downloadingDocumentId === doc.id}
                            onClick={() => void printPatientDocument(doc)}
                          >
                            {downloadingDocumentId === doc.id ? "Preparing…" : "Print"}
                          </button>
                          <button className="btn ghost btnCompact" onClick={() => void renameDocument(doc)} disabled={documentsBusy}>Rename</button>
                          <button className="btn ghost btnCompact" onClick={() => void moveDocument(doc)} disabled={documentsBusy}>Move</button>
                          <button className="btn btnDanger btnCompact" onClick={() => void deleteDocument(doc)} disabled={documentsBusy}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                  {!docFolderEntries.folders.length && !docFolderEntries.files.length ? (
                    <div className="empty">No documents in this folder yet.</div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {tab === "attendance" ? (
            <div className="section">
              <div className="sectionTitle">Visits & tests history</div>
              <div className="hintTiny">This is pulled from the Visits & tests workspace.</div>
              <WeeklyAttendanceMeter patient={patient} sessions={allSessions} weekDate={attendanceWeekDate} />
              <AttendanceTrendGraph patient={patient} sessions={allSessions} />
              <div className="table">
                <div className="thead" style={{ gridTemplateColumns: "1.1fr 2fr 0.8fr 1fr" }}>
                  <div>Date</div>
                  <div>Session</div>
                  <div>Hours</div>
                  <div>Status</div>
                </div>
                {patientAttendance.map((a) => (
                  <div className="trow" style={{ gridTemplateColumns: "1.1fr 2fr 0.8fr 1fr" }} key={a.sessionId}>
                    <div>{fmt(a.date)}</div>
                    <div className="strong">
                      {a.kind}: {a.sessionTitle}
                    </div>
                    <div>{fmtHours(a.durationHours)}</div>
                    <div>
                      <span className={a.status === "Present" ? "flag" : a.status === "Excused" ? "flag" : "muted"}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                ))}
                {!patientAttendance.length ? <div className="empty">No attendance records yet.</div> : null}
              </div>
            </div>
          ) : null}

          {tab === "intake" ? (
            <div className="section">
              <div className="sectionTitle">Client info (intake)</div>
              {subLoading ? (
                <div className="hintTiny">Loading…</div>
              ) : !sub ? (
                <div style={{ marginTop: 8 }}>
                  <div className="hintTiny">No intake record for this patient yet.</div>
                  <button className="btn" style={{ marginTop: 10 }} onClick={createIntakeSub}>
                    + Create intake record
                  </button>
                </div>
              ) : (
                <IntakeTab rawJson={(sub.raw_json as any)} ans={ans} onRawJsonUpdate={updateConsentRawJson} />
              )}
            </div>
          ) : null}

          {tab === "snap" ? (
            <div className="section">
              <div className="sectionTitle">SNAP Assessment</div>
              {subLoading ? <div className="hintTiny">Loading…</div> :
               !sub ? <div className="hintTiny">No intake submission found.</div> :
               <SnapTab rawJson={(sub.raw_json as any)} />}
            </div>
          ) : null}

          {tab === "health" ? (
            <div className="section">
              <div className="sectionTitle">Health Questionnaire</div>
              {subLoading ? <div className="hintTiny">Loading…</div> :
               !sub ? <div className="hintTiny">No intake submission found.</div> :
               <HealthTab rawJson={(sub.raw_json as any)} />}
            </div>
          ) : null}

          {tab === "consents" ? (
            <div className="section">
              <div className="sectionTitle">Consent Forms</div>
              {subLoading ? <div className="hintTiny">Loading…</div> :
               !sub ? <div className="hintTiny">No intake submission found.</div> :
               <ConsentsList rawJson={(sub.raw_json as any)} subId={sub.id} onRawJsonUpdate={updateConsentRawJson} />}
            </div>
          ) : null}
        </div>
      </div>
      {showDeleteModal && (
        <DeletePatientModal
          dataClient={dataClient}
          patient={patient}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={onDeletePatient}
        />
      )}
      {showDocModal && (
        <MultiEditModal
          title="Drug of Choice"
          opts={SUBSTANCE_OPTS}
          cur={roster.drugOfChoice ?? []}
          onSave={(vals) => onUpdateRosterDetails({ drugOfChoice: vals.length ? vals : undefined })}
          onClose={() => setShowDocModal(false)}
        />
      )}
      {documentPreview && (
        <div
          className="modalOverlay"
          onClick={closeDocumentPreview}
        >
          <div
            className="modalCard"
            style={{ width: "min(1120px, 96vw)", maxHeight: "92vh", display: "grid", gridTemplateRows: "auto 1fr" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <div className="modalTitle">Document Preview: {documentPreview.fileName}</div>
              <button
                className="modalClose"
                onClick={closeDocumentPreview}
              >
                ✕
              </button>
            </div>
            <div className="modalBody" style={{ padding: 0, overflow: "hidden" }}>
              <iframe
                src={documentPreview.url}
                title={documentPreview.fileName}
                style={{ width: "100%", height: "78vh", border: "0" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------- Delete Patient Modal -------------------- */

function DeletePatientModal({ dataClient, patient, onClose, onDeleted }: {
  dataClient: DataClient;
  patient: Patient;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState("");

  const handleDelete = async () => {
    setDeleting(true);
    setErr("");
    try {
      await dataClient.deletePatient(patient.id);
      setDeleting(false);
    } catch (error) {
      setDeleting(false);
      setErr(error instanceof Error ? error.message : "Failed to delete patient.");
      return;
    }
    onDeleted();
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard deleteCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead modalHeadDanger">
          <div className="modalTitle">⚠ Delete Patient</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <p style={{ margin: "0 0 14px 0", fontSize: 15, lineHeight: 1.5 }}>
            You are about to permanently delete{" "}
            <strong>{patient.displayName}</strong>.
          </p>
          <div className="deleteWarningBox">
            This will remove the patient record and all intake data from the database.{" "}
            This action <strong>cannot be undone</strong>.
          </div>
          {err && <div className="authErr" style={{ marginTop: 12 }}>{err}</div>}
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button className="btn btnDanger" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete Forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Intake option lists (mirrors intake.html) ---- */
const LOCATION_OPTS  = ["Van Nuys", "Santa Clarita"];
const LOC_PROGRAM_OPTS = ["1.0 Outpatient", "2.1 Intensive Outpatient"];
const REFERRING_AGENCY_OPTS = ["Self", "DCFS", "Court", "Other"];
const MEDICAL_PHYS_APT_OPTS = ["Needed", "Scheduled", "Completed"];
const MED_FORM_OPTS = ["Pending", "Turned in", "Not needed"];
const MEDICAL_ELIGIBILITY_OPTS = ["Yes", "No", "Pending"];
const MAT_STATUS_OPTS = ["Yes", "No"];
const THERAPY_OPTS = ["Sandy", "Becky"];
const LANGUAGE_OPTS  = ["English", "Espa\u00f1ol"];
const SUBSTANCE_OPTS = [
  "Alcohol",
  "Methamphetamine",
  "Fentanyl",
  "Heroin",
  "Cannabis",
  "Cocaine / Crack",
  "Prescription opioids",
  "Benzodiazepines",
  "Xanax",
  "Oxycodone",
  "Hydrocodone",
  "Amphetamines",
  "MDMA / Ecstasy",
  "Hallucinogens",
  "PCP",
  "Nicotine",
  "Inhalants",
  "Other",
];
const MAT_OPTS       = ["Yes", "No", "Not sure yet"];
const SEX_OPTS       = ["Male", "Female", "Intersex", "Prefer not to disclose"];
const BILLING_SESSION_TYPE_OPTS: BillingType[] = [
  "DCP Summary",
  "CalOMS Discharge",
  "CalOms Completion",
  "Co Triage",
  "Same Day Screening",
  "Assessment",
  "Intake",
  "Problem List",
  "Problem List Review",
  "Problem List Update",
  "Treatment Plan",
  "Treatment Plan Update",
  "Individual",
  "Care Coordination",
  "Crisis",
];
const BILLING_AUX_COLUMN_OPTS: BillingType[] = ["Naloxone", "MAT ED"];
const BILLING_SHEET_COLUMN_OPTS: BillingType[] = [
  "DCP Summary",
  "CalOMS Discharge",
  "CalOms Completion",
  "Naloxone",
  "MAT ED",
  "Co Triage",
  "Same Day Screening",
  "Assessment",
  "Intake",
  "Problem List",
  "Problem List Review",
  "Problem List Update",
  "Treatment Plan",
  "Treatment Plan Update",
  "Individual",
  "Care Coordination",
  "Crisis",
];
const BILLING_MODALITY_OPTS: Array<{ value: BillingModality; label: string }> = [
  { value: "FF", label: "Face to face (FF)" },
  { value: "Z", label: "Zoom at home (Z)" },
  { value: "Z(O)", label: "Zoom not at home (Z(O))" },
  { value: "T", label: "Telephone (T)" },
  { value: "NA", label: "Not applicable (NA)" },
];
const PREG_OPTS      = ["Yes", "No", "Not applicable", "Prefer not to disclose"];
const GENDER_OPTS    = ["Man", "Woman", "Transgender man", "Transgender woman", "Non-binary / gender diverse", "Prefer not to disclose"];
const ORIENT_OPTS    = ["Straight / heterosexual", "Gay", "Lesbian", "Bisexual", "Questioning / unsure", "Prefer not to disclose"];
const MARITAL_OPTS   = ["Single", "Married", "Divorced", "Separated", "Widowed"];
const ETHNICITY_OPTS = ["Hispanic or Latino", "Not Hispanic or Latino", "Prefer not to disclose"];
const VETERAN_OPTS   = ["Yes", "No"];
const EMPLOY_OPTS    = ["Employed full-time", "Employed part-time", "Unemployed", "Student", "Retired", "Disabled", "Temporary or seasonal work"];
const RACE_OPTS      = ["White", "Black or African American", "Asian", "American Indian or Alaska Native", "Native Hawaiian or Other Pacific Islander", "Other"];
const ASSIST_OPTS    = ["Medi-Cal", "SSI", "SSDI", "CalFresh", "None"];
const ACCOM_OPTS     = ["Mobility / wheelchair access", "Hearing assistance", "Vision assistance", "Interpreter / language support", "Reading / writing help", "Other"];
const YN_OPTS        = ["Yes", "No"];
const COURT_OPTS     = ["Probation officer", "Parole officer", "Case manager", "Social worker", "None"];

/* -------------------- Intake Tab -------------------- */

function IntakeTab({ rawJson, ans, onRawJsonUpdate }: {
  rawJson: any;
  ans: IntakeAnswers | undefined;
  onRawJsonUpdate?: (json: any) => Promise<void>;
}) {
  const cell       = getField(ans, "s5", "Cell phone");
  const homePhone  = getField(ans, "s5", "Home phone");
  const email      = getField(ans, "s5", "Email address");
  const address    = getField(ans, "s5", "Street address");
  const city       = getField(ans, "s5", "City");
  const zip        = getField(ans, "s5", "ZIP code");
  const location   = getSingle(ans, "location");
  const language   = getSingle(ans, "language");
  const mat        = getSingle(ans, "mat");
  const submittedAt = rawJson?.meta?.submittedAt as string | undefined;

  const sex        = getSingle(ans, "sex");
  const preg       = getSingle(ans, "preg");
  const gender     = getSingle(ans, "gender");
  const orient     = getSingle(ans, "orient");
  const marital    = getSingle(ans, "marital_status");
  const ethnicity  = getSingle(ans, "ethnicity");
  const veteran    = getSingle(ans, "veteran");
  const employment = getSingle(ans, "employment");

  const substances         = getMulti(ans, "substances");
  const race               = getMulti(ans, "race");
  const publicAssist       = getMulti(ans, "public_assistance").filter(a => a !== "None");
  const accommodations     = getSingle(ans, "accommodations");
  const accommodationsList = getMulti(ans, "accommodations_list");
  const accomDetail        = getField(ans, "s13", "Type any details here...");
  const advanceDir         = getSingle(ans, "advance_directive");
  const advanceDirDetail   = getField(ans, "s14", "If yes, please provide details (e.g., where it's stored, who has a copy, who is the decision-maker)...");

  const ecName           = getField(ans, "s18", "Full name");
  const ecRel            = getField(ans, "s18", "Relationship");
  const ecAddr           = getField(ans, "s18", "Address");
  const ecPhone          = getField(ans, "s18", "Phone number");
  const courtDetail      = getField(ans, "s19", "Name, agency, phone or email (optional)");
  const courtInvolvement = getMulti(ans, "court_involvement");

  const matClass = mat === "Yes" ? "iMatYes" : mat === "Not sure yet" ? "iMatMaybe" : "iMatNo";

  // Multi-select modal state
  const [multiModal, setMultiModal] = useState<{
    title: string; opts: string[]; cur: string[]; onSave: (vals: string[]) => void;
  } | null>(null);

  // MAT inline-select state
  const [editingMat, setEditingMat] = useState(false);
  const [matDraft, setMatDraft]     = useState("");

  // ── Patch helpers ───────────────────────────────────────────────────────
  const pf = (screenId: string, ph: string) =>
    onRawJsonUpdate
      ? (val: string) => onRawJsonUpdate({
          ...rawJson,
          sections: { ...rawJson?.sections, intake: { ...rawJson?.sections?.intake,
            fields: { ...rawJson?.sections?.intake?.fields, [`${screenId}::${ph}`]: val },
          }},
        })
      : undefined;

  const pr = (radioKey: string) =>
    onRawJsonUpdate
      ? (val: string) => onRawJsonUpdate({
          ...rawJson,
          sections: { ...rawJson?.sections, intake: { ...rawJson?.sections?.intake,
            radios: { ...rawJson?.sections?.intake?.radios, [radioKey]: val },
          }},
        })
      : undefined;

  const pm = (multiKey: string) =>
    onRawJsonUpdate
      ? (vals: string[]) => onRawJsonUpdate({
          ...rawJson,
          sections: { ...rawJson?.sections, intake: { ...rawJson?.sections?.intake,
            multi: { ...rawJson?.sections?.intake?.multi, [multiKey]: vals },
          }},
        })
      : undefined;

  const openMulti = (title: string, opts: string[], key: string, cur: string[]) => {
    const fn = pm(key);
    if (!fn) return;
    setMultiModal({ title, opts, cur, onSave: fn });
  };

  // Small helper: pencil button for section headers
  const HeadEdit = ({ onClick }: { onClick: () => void }) =>
    onRawJsonUpdate ? (
      <button className="iEditBtn iEditBtnHead" onClick={onClick} title="Edit">✎</button>
    ) : null;

  return (
    <div className="intakeTabWrap">

      {/* ── Contact & Enrollment ── */}
      <div className="iSection">
        <div className="iHead iHead-blue">Contact & Enrollment</div>
        <div className="iInfoGrid">
          <IInfoTile label="Cell"           value={cell}      onSave={pf("s5", "Cell phone")} />
          <IInfoTile label="Home phone"     value={homePhone} onSave={pf("s5", "Home phone")} />
          <IInfoTile label="Email"          value={email}     onSave={pf("s5", "Email address")} />
          <IInfoTile label="Street address" value={address}   onSave={pf("s5", "Street address")} />
          <IInfoTile label="City"           value={city}      onSave={pf("s5", "City")} />
          <IInfoTile label="ZIP code"       value={zip}       onSave={pf("s5", "ZIP code")} />
          <IInfoTile label="Location"       value={location}  onSave={pr("location")} options={LOCATION_OPTS} />
          <IInfoTile label="Language"       value={language}  onSave={pr("language")} options={LANGUAGE_OPTS} />
          {submittedAt && <IInfoTile label="Submitted" value={new Date(submittedAt).toLocaleDateString()} />}
        </div>
      </div>

      {/* ── Substances & MAT ── */}
      <div className="iSection">
        <div className="iHead iHead-orange">
          Substances & MAT
          <HeadEdit onClick={() => openMulti("Substances", SUBSTANCE_OPTS, "substances", substances)} />
        </div>
        {substances.length > 0
          ? <div className="iChips">{substances.map(s => <span key={s} className="iChip iSub">{s}</span>)}</div>
          : <span className="iDimLabel">—</span>}
        <div className="iMatRow">
          <span className="iDimLabel">Medication-Assisted Treatment</span>
          {editingMat ? (
            <select className="iEditSelect" value={matDraft}
              onChange={e => { pr("mat")?.(e.target.value); setEditingMat(false); }}
              onBlur={() => setEditingMat(false)}
              autoFocus
            >
              <option value="">—</option>
              {MAT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <>
              {mat ? <span className={`iMatBadge ${matClass}`}>{mat}</span>
                   : <span className="iMatBadge iMatNo">—</span>}
              {onRawJsonUpdate && (
                <button className="iEditBtn" style={{ opacity: 0.55 }} title="Edit MAT"
                  onClick={() => { setMatDraft(mat); setEditingMat(true); }}>✎</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Demographics ── */}
      <div className="iSection">
        <div className="iHead iHead-purple">Demographics</div>
        <div className="iDemoGrid">
          <IDemoItem label="Sex at birth"             value={sex}        onSave={pr("sex")}            options={SEX_OPTS} />
          <IDemoItem label="Pregnant / breastfeeding" value={preg}       onSave={pr("preg")}           options={PREG_OPTS} />
          <IDemoItem label="Gender identity"          value={gender}     onSave={pr("gender")}         options={GENDER_OPTS} />
          <IDemoItem label="Orientation"              value={orient}     onSave={pr("orient")}         options={ORIENT_OPTS} />
          <IDemoItem label="Marital status"           value={marital}    onSave={pr("marital_status")} options={MARITAL_OPTS} />
          <IDemoItem label="Ethnicity"                value={ethnicity}  onSave={pr("ethnicity")}      options={ETHNICITY_OPTS} />
          <IDemoItem label="Veteran"                  value={veteran}    onSave={pr("veteran")}        options={VETERAN_OPTS} />
          <IDemoItem label="Employment"               value={employment} onSave={pr("employment")}     options={EMPLOY_OPTS} />
        </div>
        <div className="iRaceRow">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="iDimLabel">Race</span>
            <HeadEdit onClick={() => openMulti("Race", RACE_OPTS, "race", race)} />
          </div>
          <div className="iChips">
            {race.length > 0
              ? race.map(r => <span key={r} className="iChip iRace">{r}</span>)
              : <span className="iDimLabel">—</span>}
          </div>
        </div>
      </div>

      {/* ── Public Assistance ── */}
      <div className="iSection">
        <div className="iHead iHead-green">
          Public Assistance
          <HeadEdit onClick={() => openMulti("Public Assistance", ASSIST_OPTS, "public_assistance",
            [...publicAssist, ...(getMulti(ans, "public_assistance").filter(a => a === "None"))])} />
        </div>
        {publicAssist.length > 0
          ? <div className="iChips">{publicAssist.map(a => <span key={a} className="iChip iAssist">{a}</span>)}</div>
          : <span className="iDimLabel">—</span>}
      </div>

      {/* ── Accommodations & Advance Directive ── */}
      <div className="iSection">
        <div className="iHead iHead-teal">Accommodations & Directives</div>
        <div className="iDemoGrid" style={{ marginBottom: 12 }}>
          <IDemoItem label="Accommodations needed"    value={accommodations} onSave={pr("accommodations")}   options={YN_OPTS} />
          <IDemoItem label="Advance directive on file" value={advanceDir}   onSave={pr("advance_directive")} options={YN_OPTS} />
        </div>
        {accommodations === "Yes" && (
          <div className="iNoteBlock">
            <div className="iNoteTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Accommodations list
              <HeadEdit onClick={() => openMulti("Accommodations", ACCOM_OPTS, "accommodations_list", accommodationsList)} />
            </div>
            {accommodationsList.length > 0 && (
              <div className="iChips" style={{ marginTop: 6 }}>
                {accommodationsList.map(a => <span key={a} className="iChip iAccom">{a}</span>)}
              </div>
            )}
            {accomDetail && <div className="iNoteBody">{accomDetail}</div>}
          </div>
        )}
        {advanceDir === "Yes" && (
          <div className="iNoteBlock" style={{ marginTop: accommodations === "Yes" ? 10 : 0 }}>
            <div className="iNoteTitle">Advance Healthcare Directive on file ✓</div>
            {advanceDirDetail && <div className="iNoteBody">{advanceDirDetail}</div>}
          </div>
        )}
      </div>

      {/* ── Emergency Contact ── */}
      <div className="iSection">
        <div className="iHead iHead-gray">Emergency Contact</div>
        <div className="iInfoGrid">
          <IInfoTile label="Name"         value={ecName}  onSave={pf("s18", "Full name")} />
          <IInfoTile label="Relationship" value={ecRel}   onSave={pf("s18", "Relationship")} />
          <IInfoTile label="Address"      value={ecAddr}  onSave={pf("s18", "Address")} />
          <IInfoTile label="Phone"        value={ecPhone} onSave={pf("s18", "Phone number")} />
        </div>
      </div>

      {/* ── Court / Legal ── */}
      <div className="iSection">
        <div className="iHead iHead-amber">
          Court / Care Coordination
          <HeadEdit onClick={() => openMulti("Court / Care Coordination", COURT_OPTS, "court_involvement", courtInvolvement)} />
        </div>
        {courtInvolvement.filter(c => c !== "None").length > 0 && (
          <div className="iChips" style={{ marginBottom: 8 }}>
            {courtInvolvement.filter(c => c !== "None").map(c => <span key={c} className="iChip iSub">{c}</span>)}
          </div>
        )}
        <IInfoTile label="Contact info" value={courtDetail} onSave={pf("s19", "Name, agency, phone or email (optional)")} />
      </div>

      {multiModal && (
        <MultiEditModal
          title={multiModal.title}
          opts={multiModal.opts}
          cur={multiModal.cur}
          onSave={multiModal.onSave}
          onClose={() => setMultiModal(null)}
        />
      )}
    </div>
  );
}

function IInfoTile({ label, value, onSave, options }: {
  label: string; value: string;
  onSave?: (v: string) => void;
  options?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => { if (onSave) onSave(draft.trim()); setEditing(false); };

  return (
    <div className="iInfoTile">
      <div className="iDimLabel">
        {label}
        {onSave && !editing && (
          <button className="iEditBtn" onClick={() => { setDraft(value); setEditing(true); }} title="Edit">✎</button>
        )}
      </div>
      {editing ? (
        options ? (
          <select className="iEditSelect" value={draft} autoFocus
            onChange={e => { if (onSave) onSave(e.target.value); setEditing(false); }}
            onBlur={() => setEditing(false)}>
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className="iEditInput" value={draft} autoFocus
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          />
        )
      ) : (
        <div className="iInfoValue">{value || "—"}</div>
      )}
    </div>
  );
}

function IDemoItem({ label, value, onSave, options }: {
  label: string; value: string;
  onSave?: (v: string) => void;
  options?: string[];
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="iDemoItem">
      <div className="iDimLabel">
        {label}
        {onSave && !editing && (
          <button className="iEditBtn" onClick={() => setEditing(true)} title="Edit">✎</button>
        )}
      </div>
      {editing ? (
        options ? (
          <select className="iEditSelect" value={value} autoFocus
            onChange={e => { onSave?.(e.target.value); setEditing(false); }}
            onBlur={() => setEditing(false)}>
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className="iEditInput" defaultValue={value} autoFocus
            onBlur={e => { onSave?.(e.target.value.trim()); setEditing(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onSave?.((e.target as HTMLInputElement).value.trim()); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
          />
        )
      ) : (
        <div className="iDemoPill">{value || "—"}</div>
      )}
    </div>
  );
}

function MultiEditModal({ title, opts, cur, onSave, onClose }: {
  title: string; opts: string[]; cur: string[];
  onSave: (vals: string[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(cur);
  const toggle = (v: string) =>
    setDraft(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard multiEditCard" onClick={e => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">{title}</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="multiCheckList">
            {opts.map(opt => (
              <label key={opt} className="multiCheckItem">
                <input type="checkbox" checked={draft.includes(opt)} onChange={() => toggle(opt)} />
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => { onSave(draft); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- SNAP Tab -------------------- */

function SnapTab({ rawJson }: { rawJson: any }) {
  const snap = rawJson?.sections?.snap ?? {};
  const groups: Array<{ label: string; key: string; klass: string }> = [
    { label: "Strengths", key: "strengths", klass: "chip-green" },
    { label: "Needs", key: "needs", klass: "chip-red" },
    { label: "Abilities", key: "abilities", klass: "chip-blue" },
    { label: "Preferences", key: "preferences", klass: "chip-purple" },
  ];

  return (
    <div className="snapWrap">
      {groups.map((g) => {
        const arr = (snap?.[g.key] ?? []) as string[];
        return (
          <div className="snapGroup" key={g.key}>
            <div className="snapTitle">{g.label}</div>
            <div className="snapChips">
              {arr.length ? arr.map((v, i) => <span key={`${g.key}-${i}`} className={`snapChip ${g.klass}`}>{v}</span>) : <span className="muted">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ynBadge(v: string | undefined) {
  if (v === "Yes") return <span className="hBadge hYes">Yes</span>;
  if (v === "No") return <span className="hBadge hNo">No</span>;
  if (v === "N/A") return <span className="hBadge hNa">N/A</span>;
  return <span className="hBadge">—</span>;
}

function HealthTab({ rawJson }: { rawJson: any }) {
  const answers = rawJson?.sections?.medical?.answers ?? {};
  return (
    <div className="healthList">
      {MEDICAL_QUESTIONS.map((q) => {
        const a = answers[String(q.n)] ?? {};
        return (
          <div className="healthQ" key={q.n}>
            <div className="healthHead">
              <div className="healthNum">Q{q.n}</div>
              <div className="healthText">{q.text}</div>
              <div>{ynBadge(a.yn)}</div>
            </div>
            {a.date ? <div className="healthMeta"><b>Date:</b> {a.date}</div> : null}
            {a.unknown ? <div className="healthMeta"><b>Date:</b> I don't remember</div> : null}
            {a.details ? <div className="healthMeta"><b>Details:</b> {a.details}</div> : null}
            {a.na ? <div className="healthMeta"><i>Not applicable</i></div> : null}
            {a.rows?.length ? (
              <JsonRows
                title={q.type === "table_treatment_na" ? "Treatment history" : "Drug use"}
                rows={a.rows}
                cols={q.type === "table_treatment_na" ? ["Type", "Facility", "Year", "Completed?"] : ["Substance", "Route"]}
              />
            ) : null}
            {a.rowsA?.length ? <JsonRows title="Current Medications" rows={a.rowsA} cols={["Medication", "Route"]} /> : null}
            {a.rowsB?.length ? <JsonRows title="Prior Prescribed Medications" rows={a.rowsB} cols={["Medication", "Route"]} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function JsonRows({ title, rows, cols }: { title: string; rows: unknown[]; cols?: string[] }) {
  return (
    <div className="healthMeta">
      <b>{title}:</b>
      <div className="healthRows">
        {rows.map((r, i) => {
          const cells = (Array.isArray(r) ? r : Object.values(r as Record<string, unknown>)) as string[];
          return (
            <div key={i} className="healthRow">
              {cols
                ? cols.map((col, j) =>
                    cells[j] ? (
                      <span key={j} className="healthRowCell">
                        <span className="healthCellLabel">{col}</span> {cells[j]}
                      </span>
                    ) : null
                  )
                : cells.filter(Boolean).join(" \u2022 ")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderConsentHtml(
  form: ConsentForm,
  eventDate: string,
  patientName: string,
  patientSigUrl: string,
  counselorSigUrl?: string,
  counselorSignedAt?: string,
) {
  const counselorBox = counselorSigUrl
    ? `<img class="sigImg" src="${counselorSigUrl}" /><div class="line">Signed: ${counselorSignedAt ? new Date(counselorSignedAt).toLocaleString() : "—"}</div>`
    : `<div class="empty">No counselor signature</div><div class="line">Counselor name / date</div>`;
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${form.title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 26px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .meta { margin-bottom: 16px; color: #444; }
    .body { white-space: pre-wrap; line-height: 1.45; border: 1px solid #ddd; padding: 14px; border-radius: 8px; }
    .sigRow { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; min-height: 120px; }
    .sigImg { max-width: 100%; max-height: 80px; display: block; margin-top: 8px; border-bottom: 1px solid #ccc; }
    .line { margin-top: 42px; border-top: 1px solid #444; padding-top: 4px; font-size: 12px; color: #444; }
    .empty { margin-top: 42px; border-top: 1px dashed #ccc; padding-top: 4px; font-size: 12px; color: #aaa; }
    @media print { button { display: none; } body { margin: 10mm; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Print</button>
  <h1>${form.title}</h1>
  <div class="meta">Date: ${eventDate || "—"} • Patient: ${patientName || "—"}</div>
  <div class="body">${form.body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
  <div class="sigRow">
    <div class="box">
      <b>Patient Signature</b>
      ${patientSigUrl ? `<img class="sigImg" src="${patientSigUrl}" />` : `<div class="empty">No signature captured</div>`}
      <div class="line">Patient name / date</div>
    </div>
    <div class="box">
      <b>Counselor Review</b>
      ${counselorBox}
    </div>
  </div>
</body>
</html>`;
}

function ConsentsList({
  rawJson,
  subId: _subId,
  onRawJsonUpdate,
}: {
  rawJson: any;
  subId: string;
  onRawJsonUpdate: (json: any) => Promise<void>;
}) {
  const [sigModal, setSigModal] = useState<{ type: "patient" | "counselor"; formDataKey: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const events = (rawJson?.consents?.events ?? []) as Array<{ formId: string; acknowledgedAt?: string }>;
  const dataByForm = rawJson?.consents?.dataByForm ?? {};
  const globalPatientSig = rawJson?.signature?.dataUrl || "";
  const patientName = rawJson?.patient?.fullName || dataByForm?.beginData_v1?.patientName || "";

  const latestByForm = new Map<string, { acknowledgedAt?: string }>();
  for (const e of events) {
    if (!e?.formId) continue;
    latestByForm.set(e.formId, { acknowledgedAt: e.acknowledgedAt });
  }

  const forms = CONSENT_FORMS.filter((f) => latestByForm.has(f.id));

  const handleSaveSig = async (dataUrl: string) => {
    if (!sigModal) return;
    setSaving(true);
    const { type, formDataKey } = sigModal;
    const now = new Date().toISOString();
    const newJson = {
      ...rawJson,
      consents: {
        ...rawJson?.consents,
        dataByForm: {
          ...dataByForm,
          [formDataKey]: {
            ...dataByForm[formDataKey],
            ...(type === "patient"
              ? { patientSignature: dataUrl, patientSignedAt: now }
              : { counselorSignature: dataUrl, counselorSignedAt: now }),
          },
        },
      },
    };
    await onRawJsonUpdate(newJson);
    setSaving(false);
    setSigModal(null);
  };

  return (
    <>
      <div className="consentList">
        {!forms.length ? <div className="empty">No consent acknowledgments found.</div> : null}
        {forms.map((f) => {
          const ev = latestByForm.get(f.id);
          const formData = dataByForm?.[f.dataKey] ?? {};
          const pname = formData?.fields?.patientName || formData?.patientName || patientName || "—";
          const pdate = formData?.fields?.todayDate || formData?.todayDate || (ev?.acknowledgedAt ? new Date(ev.acknowledgedAt).toLocaleString() : "—");
          const patientSig: string = formData?.patientSignature || globalPatientSig || "";
          const counselorSig: string = formData?.counselorSignature || "";
          const patientSigned = patientSig.length > 10;
          const counselorSigned = counselorSig.length > 10;

          return (
            <div className="consentCard" key={f.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="consentTitle">{f.title}</div>
                <div className="consentMeta">Patient: {pname} • Date: {pdate}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {patientSigned ? (
                  <span className="sigCheck" title="Patient signed">✓</span>
                ) : (
                  <button
                    className="btn ghost sigBtn"
                    onClick={() => setSigModal({ type: "patient", formDataKey: f.dataKey })}
                    title="Add patient signature"
                  >
                    Patient sig
                  </button>
                )}
                {counselorSigned ? (
                  <span className="sigCheck" title="Counselor signed">✓</span>
                ) : (
                  <button
                    className="btn sigBtn"
                    onClick={() => setSigModal({ type: "counselor", formDataKey: f.dataKey })}
                    title="Add counselor signature"
                  >
                    Counselor sig
                  </button>
                )}
                <button
                  className="btn ghost sigBtn"
                  onClick={() => {
                    const html = renderConsentHtml(
                      f,
                      String(pdate),
                      String(pname),
                      patientSig,
                      counselorSig || undefined,
                      formData?.counselorSignedAt,
                    );
                    const w = window.open("", "_blank", "width=960,height=800");
                    if (!w) return;
                    w.document.open();
                    w.document.write(html);
                    w.document.close();
                  }}
                >
                  View & Print
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {sigModal && (
        <SignaturePadModal
          title={sigModal.type === "patient" ? "Patient Signature" : "Counselor Signature"}
          onSave={handleSaveSig}
          onClose={() => setSigModal(null)}
          saving={saving}
        />
      )}
    </>
  );
}

function PublicGroupSignPage({
  token,
  dataClient,
}: {
  token: string;
  dataClient: DataClient;
}) {
  const [session, setSession] = useState<PublicGroupSessionInfo | null>(null);
  const [name, setName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void dataClient
      .getPublicGroupSession(token)
      .then((payload) => {
        if (!cancelled) {
          setSession(payload);
          setErr(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErr("This group sign-in link is invalid or has expired.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataClient, token]);

  const submit = async () => {
    if (!name.trim() || !signatureDataUrl) {
      setErr("Please enter your name and signature.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await dataClient.submitPublicGroupSign({
        token,
        participantName: name.trim(),
        signatureDataUrl,
      });
      setDone(true);
    } catch {
      setErr("Could not submit your sign-in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page authPage">
      <div className="authCard publicSignCard">
        <div className="authBrand">
          <img className="authLogo" src={ncaddLogo} alt="NCADD logo" />
        </div>
        <div className="authTitle">Group Sign-In</div>
        {loading ? <div className="authSub">Loading session...</div> : null}
        {!loading && session ? (
          <div className="authSub">
            {session.topic} • {fmt(session.groupDate)} • {formatClock(session.startTime)} - {formatClock(session.endTime)}
          </div>
        ) : null}
        {done ? (
          <div className="publicSignDone">
            <div className="authTitle" style={{ fontSize: 18 }}>You are signed in.</div>
            <div className="authSub">You can close this page now.</div>
          </div>
        ) : (
          <>
            <div className="authGrid">
              <label className="authLabel">Full Name</label>
              <input className="authInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" autoFocus />
              <label className="authLabel">Signature</label>
              <div className="publicSignSignatureRow">
                <button className="btn ghost" onClick={() => setSigOpen(true)}>
                  {signatureDataUrl ? "Edit signature" : "Add signature"}
                </button>
                {signatureDataUrl ? <img src={signatureDataUrl} alt="Signature preview" className="publicSignPreview" /> : null}
              </div>
            </div>
            <div className="authRow">
              <button className="btn" onClick={() => void submit()} disabled={submitting || loading || !session}>
                {submitting ? "Submitting..." : "Submit Sign-In"}
              </button>
            </div>
            {err ? <div className="authErr">{err}</div> : null}
          </>
        )}
      </div>
      {sigOpen ? (
        <SignaturePadModal
          title="Patient Signature"
          onSave={(dataUrl) => {
            setSignatureDataUrl(dataUrl);
            setSigOpen(false);
          }}
          onClose={() => setSigOpen(false)}
          saving={submitting}
        />
      ) : null}
    </div>
  );
}

function SignaturePadModal({
  title,
  onSave,
  onClose,
  saving = false,
}: {
  title: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 520;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getXY = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return [(t.clientX - rect.left) * scaleX, (t.clientY - rect.top) * scaleY];
    }
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = getXY(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = getXY(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const endDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard sigPadCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">{title}</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="sigPadWrap">
            <canvas
              ref={canvasRef}
              className="sigCanvas"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
          <div className="sigPadHint">Draw your signature above using mouse or finger</div>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={clear} disabled={saving}>Clear</button>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              onSave(canvas.toDataURL("image/png"));
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Signature"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AzureDemoLoginScreen({
  demoUsers,
  onLoggedIn,
  bootstrapError,
}: {
  demoUsers: AzureDemoUser[];
  onLoggedIn: (session: AzureDemoSession) => void;
  bootstrapError?: string | null;
}) {
  const [email, setEmail] = useState(demoUsers[0]?.email ?? "");
  const [password, setPassword] = useState("Demo123!");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email && demoUsers[0]?.email) {
      setEmail(demoUsers[0].email);
    }
  }, [demoUsers, email]);

  const submit = async () => {
    setLoading(true);
    setErr(null);

    try {
      const payload = await loginToAzureDemo(email.trim(), password);
      onLoggedIn({
        accessToken: payload.accessToken,
        user: payload.user,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setErr(detail ? `Sign-in failed: ${detail}` : "That demo login did not work. Double-check the email and password.");
      setLoading(false);
      return;
    }

    setLoading(false);
  };

  return (
    <div className="authCard">
      <div className="authBrand">
        <img className="authLogo" src={patientFinderLogo} alt="Patient Finder logo" />
      </div>
      <div className="authTitle">Patient Finder Azure Demo</div>
      <div className="authSub">Use one of the seeded demo accounts to show how case loads stick to the signed-in counselor.</div>

      <div className="authGrid">
        <label className="authLabel">Email</label>
        <input
          className="authInput"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          disabled={loading}
        />

        <label className="authLabel">Password</label>
        <input
          className="authInput"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) submit();
          }}
          disabled={loading}
        />
      </div>

      {demoUsers.length ? (
        <div className="authHint" style={{ marginTop: 14 }}>
          Demo accounts: {demoUsers.map((user) => `${user.email} (${user.roles.join(", ")})`).join(" • ")}
        </div>
      ) : null}

      <div className="authHint">Default demo password: <strong>Demo123!</strong></div>

      <div className="authRow">
        <div />
        <button className="btn" onClick={submit} disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>

      {err ? <div className="authErr">{err}</div> : null}
      {bootstrapError ? <div className="authErr">{bootstrapError}</div> : null}
    </div>
  );
}

function EntraLoginScreen({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin: () => Promise<void>;
}) {
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      await onLogin();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setErr(detail ? `Sign-in failed: ${detail}` : "Microsoft sign-in did not complete.");
    }
  };

  return (
    <div className="authCard">
      <div className="authBrand">
        <img className="authLogo" src={patientFinderLogo} alt="Patient Finder logo" />
      </div>
      <div className="authTitle">Patient Finder</div>
      <div className="authSub">Sign in with your NCADD Microsoft account.</div>
      <div className="authRow">
        <div />
        <button className="btn" onClick={submit} disabled={loading}>
          {loading ? "Opening Microsoft sign-in…" : "Continue with Microsoft"}
        </button>
      </div>
      {err ? <div className="authErr">{err}</div> : null}
    </div>
  );
}

/* -------------------- Attendance -------------------- */

function AttendancePage({
  patients,
  onCommitBilling,
  onAddDrugTest,
}: {
  patients: Patient[];
  onCommitBilling: (input: {
    patientId: string;
    billingType: BillingType;
    serviceDate: string;
    startTime: string;
    endTime: string;
    totalMinutes: number;
    modality: BillingModality;
    naloxoneTraining: boolean;
    matEducation: boolean;
  }) => Promise<{ ok: boolean; message: string }>;
  onAddDrugTest: (patientId: string, entry: Omit<DrugTestEntry, "id">) => void | Promise<void>;
}) {
  const patientIndex = useMemo(() => patients.map((p) => ({ p, idx: indexPatient(p) })), [patients]);

  const [billingType, setBillingType] = useState<BillingType>("Individual");
  const [sessionDate, setSessionDate] = useState(todayIso);
  const [sessionStart, setSessionStart] = useState("");
  const [sessionEnd, setSessionEnd] = useState("");
  const [sessionDuration, setSessionDuration] = useState("");
  const [sessionModality, setSessionModality] = useState<BillingModality>("FF");
  const [sessionNaloxoneTraining, setSessionNaloxoneTraining] = useState(false);
  const [sessionMatEducation, setSessionMatEducation] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [selectedSessionPatientId, setSelectedSessionPatientId] = useState("");
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");

  const [drugTestDate, setDrugTestDate] = useState(todayIso);
  const [drugTestResult, setDrugTestResult] = useState<Exclude<DrugTestResult, "Inconclusive">>("Negative");
  const [drugTestSubstances, setDrugTestSubstances] = useState<string[]>([]);
  const [drugTestQuery, setDrugTestQuery] = useState("");
  const [selectedDrugTestPatientId, setSelectedDrugTestPatientId] = useState<string>("");
  const [drugTestSaving, setDrugTestSaving] = useState(false);
  const [drugTestMessage, setDrugTestMessage] = useState("");

  const { raw: sessionQueryRaw, compact: sessionQueryCompact } = useMemo(
    () => normalizeQuery(sessionQuery),
    [sessionQuery]
  );
  const { raw: drugQueryRaw, compact: drugQueryCompact } = useMemo(
    () => normalizeQuery(drugTestQuery),
    [drugTestQuery]
  );

  const sessionMatches = useMemo(() => {
    if (!sessionQueryRaw) return [];
    return patientIndex
      .filter(({ idx }) => idx.raw.includes(sessionQueryRaw) || (sessionQueryCompact ? idx.compact.includes(sessionQueryCompact) : false))
      .map(({ p }) => p)
      .slice(0, 8);
  }, [patientIndex, sessionQueryRaw, sessionQueryCompact]);

  const drugTestMatches = useMemo(() => {
    if (!drugQueryRaw) return [];
    return patientIndex
      .filter(({ idx }) => idx.raw.includes(drugQueryRaw) || (drugQueryCompact ? idx.compact.includes(drugQueryCompact) : false))
      .map(({ p }) => p)
      .slice(0, 8);
  }, [patientIndex, drugQueryRaw, drugQueryCompact]);

  const selectedDrugTestPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedDrugTestPatientId),
    [patients, selectedDrugTestPatientId]
  );
  const selectedSessionPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedSessionPatientId),
    [patients, selectedSessionPatientId]
  );

  useEffect(() => {
    if (drugTestResult === "Negative" && drugTestSubstances.length) {
      setDrugTestSubstances([]);
    }
  }, [drugTestResult, drugTestSubstances.length]);

  const syncFromStartAndEnd = (startValue: string, endValue: string) => {
    const startMinutes = parseTimeInput(startValue);
    const endMinutes = parseTimeInput(endValue);
    if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) return;
    setSessionDuration(formatDurationValue(endMinutes - startMinutes));
  };

  const syncFromStartAndDuration = (startValue: string, durationValue: string) => {
    const startMinutes = parseTimeInput(startValue);
    const durationMinutes = parseDurationMinutes(durationValue);
    if (startMinutes === null || durationMinutes === null) return;
    setSessionEnd(formatTimeValue(startMinutes + durationMinutes));
  };

  const handleSessionStartChange = (value: string) => {
    setSessionStart(value);
    if (parseTimeInput(sessionEnd) !== null) {
      syncFromStartAndEnd(value, sessionEnd);
      return;
    }
    if (parseDurationMinutes(sessionDuration) !== null) {
      syncFromStartAndDuration(value, sessionDuration);
    }
  };

  const handleSessionEndChange = (value: string) => {
    setSessionEnd(value);
    syncFromStartAndEnd(sessionStart, value);
  };

  const handleSessionDurationChange = (value: string) => {
    setSessionDuration(value);
    syncFromStartAndDuration(sessionStart, value);
  };

  const saveSession = async () => {
    const startMinutes = parseTimeInput(sessionStart);
    const durationMinutes = parseDurationMinutes(sessionDuration);
    if (!selectedSessionPatientId || startMinutes === null || durationMinutes === null || !sessionDate) return;

    setSessionSaving(true);
    setSessionMessage("");
    const result = await onCommitBilling({
      patientId: selectedSessionPatientId,
      billingType,
      serviceDate: sessionDate,
      startTime: sessionStart,
      endTime: sessionEnd,
      totalMinutes: durationMinutes,
      modality: sessionModality,
      naloxoneTraining: sessionNaloxoneTraining,
      matEducation: sessionMatEducation,
    });
    setSessionSaving(false);
    setSessionMessage(result.message);
    if (!result.ok) return;

    setSelectedSessionPatientId("");
    setSessionQuery("");
    setSessionStart("");
    setSessionEnd("");
    setSessionDuration("");
    setSessionModality("FF");
    setSessionNaloxoneTraining(false);
    setSessionMatEducation(false);
    setBillingType("Individual");
    setSessionDate(todayIso());
  };

  const saveDrugTest = async () => {
    if (!selectedDrugTestPatientId || !drugTestDate) return;

    setDrugTestSaving(true);
    setDrugTestMessage("");

    await onAddDrugTest(selectedDrugTestPatientId, {
      date: drugTestDate,
      testType: "UA",
      result: drugTestResult,
      substances: drugTestResult === "Positive" ? drugTestSubstances.join(", ") || "Positive" : undefined,
    });

    setDrugTestSaving(false);
    setDrugTestMessage(`Saved ${drugTestResult.toLowerCase()} drug test.`);
    setSelectedDrugTestPatientId("");
    setDrugTestQuery("");
    setDrugTestSubstances([]);
    setDrugTestResult("Negative");
  };

  const sessionDurationMinutes = parseDurationMinutes(sessionDuration);
  const sessionCanSave =
    !!sessionDate &&
    parseTimeInput(sessionStart) !== null &&
    sessionDurationMinutes !== null &&
    !!selectedSessionPatientId;

  const drugTestCanSave =
    !!selectedDrugTestPatientId &&
    !!drugTestDate &&
    (drugTestResult === "Negative" || drugTestSubstances.length > 0);

  return (
    <div className="attendanceWorkbench">
      <div className="panel">
        <div className="panelHead">Log visit</div>
        <div className="panelBody">
          <div className="attendanceForm">
            <label className="attendanceField">
              <span className="addLabel">Billing type</span>
              <select className="select" value={billingType} onChange={(e) => setBillingType(e.target.value as BillingType)}>
                {BILLING_SESSION_TYPE_OPTS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="attendanceField">
              <span className="addLabel">Date</span>
              <input className="authInput" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </label>

            <div className="attendanceTimingGrid">
              <label className="attendanceField">
                <span className="addLabel">Start time</span>
                <input
                  className="authInput"
                  value={sessionStart}
                  onChange={(e) => handleSessionStartChange(e.target.value)}
                  placeholder="1:00 pm"
                />
              </label>

              <label className="attendanceField">
                <span className="addLabel">End time</span>
                <input
                  className="authInput"
                  value={sessionEnd}
                  onChange={(e) => handleSessionEndChange(e.target.value)}
                  placeholder="1:55 pm"
                />
              </label>

              <label className="attendanceField">
                <span className="addLabel">Total time</span>
                <input
                  className="authInput"
                  value={sessionDuration}
                  onChange={(e) => handleSessionDurationChange(e.target.value)}
                  placeholder="55 minutes"
                />
              </label>
            </div>

            <label className="attendanceField">
              <span className="addLabel">Session format</span>
              <select className="select" value={sessionModality} onChange={(e) => setSessionModality(e.target.value as BillingModality)}>
                {BILLING_MODALITY_OPTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="attendanceSelectedList">
              <label className="attendanceSelectedCard">
                <div>
                  <div className="strong">Naloxone training</div>
                  <div className="muted">Adds just the day number to the Naloxone billing column.</div>
                </div>
                <input
                  type="checkbox"
                  checked={sessionNaloxoneTraining}
                  onChange={(e) => setSessionNaloxoneTraining(e.target.checked)}
                />
              </label>
              <label className="attendanceSelectedCard">
                <div>
                  <div className="strong">MAT education</div>
                  <div className="muted">Adds just the day number to the MAT ED billing column.</div>
                </div>
                <input
                  type="checkbox"
                  checked={sessionMatEducation}
                  onChange={(e) => setSessionMatEducation(e.target.checked)}
                />
              </label>
            </div>

            <label className="attendanceField">
              <span className="addLabel">Patient search</span>
              <input
                className="search"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                placeholder="Search patient by name or MRN"
              />
            </label>

            {selectedSessionPatient ? (
              <div className="attendanceSelectedCard">
                <div>
                  <div className="strong">{selectedSessionPatient.displayName}</div>
                  <div className="muted">MRN {selectedSessionPatient.mrn ?? "—"}</div>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setSelectedSessionPatientId("");
                    setSessionQuery("");
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="attendanceBlankState">No patients selected yet.</div>
            )}

            {sessionQueryRaw ? (
              <div className="attendanceSearchResults">
                {sessionMatches.map((patient) => {
                  const selected = selectedSessionPatientId === patient.id;
                  return (
                    <button
                      key={patient.id}
                      className={selected ? "attendanceSearchRow selected" : "attendanceSearchRow"}
                      onClick={() => {
                        setSelectedSessionPatientId(patient.id);
                        setSessionQuery("");
                      }}
                    >
                      <div>
                        <div className="strong">{patient.displayName}</div>
                        <div className="muted">MRN {patient.mrn ?? "—"}</div>
                      </div>
                      <span className={pillClass(patient.kind)}>{patient.kind}</span>
                    </button>
                  );
                })}
                {!sessionMatches.length ? <div className="attendanceBlankState">No patients match that search.</div> : null}
              </div>
            ) : null}

            <div className="attendanceHint">
              Enter start and end to fill total time, or enter start and total time to fill end time automatically.
            </div>

            {sessionMessage ? <div className="hintTiny">{sessionMessage}</div> : null}

            <button className="btn" onClick={saveSession} disabled={!sessionCanSave || sessionSaving}>
              {sessionSaving ? "Committing..." : "Commit to billing"}
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panelHead">Log drug test</div>
        <div className="panelBody">
          <div className="attendanceForm">
            <label className="attendanceField">
              <span className="addLabel">Date</span>
              <input className="authInput" type="date" value={drugTestDate} onChange={(e) => setDrugTestDate(e.target.value)} />
            </label>

            <label className="attendanceField">
              <span className="addLabel">Result</span>
              <select
                className="select"
                value={drugTestResult}
                onChange={(e) => setDrugTestResult(e.target.value as Exclude<DrugTestResult, "Inconclusive">)}
              >
                <option value="Negative">Negative</option>
                <option value="Positive">Positive</option>
              </select>
            </label>

            {drugTestResult === "Positive" ? (
              <label className="attendanceField">
                <span className="addLabel">Positive for</span>
                <select
                  className="select"
                  multiple
                  value={drugTestSubstances}
                  onChange={(e) =>
                    setDrugTestSubstances(Array.from(e.target.selectedOptions).map((option) => option.value))
                  }
                >
                  {SUBSTANCE_OPTS.map((substance) => (
                    <option key={substance} value={substance}>
                      {substance}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="attendanceField">
              <span className="addLabel">Patient search</span>
              <input
                className="search"
                value={drugTestQuery}
                onChange={(e) => setDrugTestQuery(e.target.value)}
                placeholder="Search patient by name or MRN"
              />
            </label>

            {selectedDrugTestPatient ? (
              <div className="attendanceSelectedCard">
                <div>
                  <div className="strong">{selectedDrugTestPatient.displayName}</div>
                  <div className="muted">MRN {selectedDrugTestPatient.mrn ?? "—"}</div>
                </div>
                <button className="btn ghost" onClick={() => setSelectedDrugTestPatientId("")}>Clear</button>
              </div>
            ) : (
              <div className="attendanceBlankState">No patient selected yet.</div>
            )}

            {drugQueryRaw ? (
              <div className="attendanceSearchResults">
                {drugTestMatches.map((patient) => (
                  <button
                    key={patient.id}
                    className={selectedDrugTestPatientId === patient.id ? "attendanceSearchRow selected" : "attendanceSearchRow"}
                    onClick={() => setSelectedDrugTestPatientId(patient.id)}
                  >
                    <div>
                      <div className="strong">{patient.displayName}</div>
                      <div className="muted">MRN {patient.mrn ?? "—"}</div>
                    </div>
                    <span className={pillClass(patient.kind)}>{patient.kind}</span>
                  </button>
                ))}
                {!drugTestMatches.length ? <div className="attendanceBlankState">No patients match that search.</div> : null}
              </div>
            ) : null}

            {drugTestMessage ? <div className="hintTiny">{drugTestMessage}</div> : null}

            <button className="btn" onClick={saveDrugTest} disabled={!drugTestCanSave || drugTestSaving}>
              {drugTestSaving ? "Saving..." : "Save drug test"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupsPage({
  groups,
  openingGroupId,
  onOpenPdf,
  patients,
  activeCounselorName,
  activeSession,
  busy,
  err,
  successMessage,
  onStartSession,
  onSetMatch,
  onRemoveEntry,
  onFinalize,
  onRefreshSession,
  onDismissLiveSession,
  onClearHistory,
}: {
  groups: GroupSessionSummary[];
  openingGroupId: string | null;
  onOpenPdf: (groupSessionId: string) => Promise<void>;
  patients: Patient[];
  activeCounselorName: string;
  activeSession: LiveGroupSessionState | null;
  busy: boolean;
  err: string | null;
  successMessage: string | null;
  onStartSession: (payload: { topic: string; timeSlot: LiveGroupTimeSlot }) => Promise<void>;
  onSetMatch: (entryId: string, patientId: string | null) => Promise<void>;
  onRemoveEntry: (entryId: string) => Promise<void>;
  onFinalize: (payload: { counselorSignName: string; counselorSignatureDataUrl: string }) => Promise<void>;
  onRefreshSession: (sessionId: string) => Promise<void>;
  onDismissLiveSession: () => void;
  onClearHistory: () => Promise<void>;
}) {
  const [topic, setTopic] = useState("");
  const [timeSlot, setTimeSlot] = useState<LiveGroupTimeSlot>("17:30-19:00");
  const [copied, setCopied] = useState(false);
  const [matching, setMatching] = useState<Record<string, string>>({});
  const [finalSignName, setFinalSignName] = useState(activeCounselorName);
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);

  useEffect(() => {
    setFinalSignName(activeCounselorName);
  }, [activeCounselorName]);

  useEffect(() => {
    setMatching({});
    setCopied(false);
  }, [activeSession?.session.id]);

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const left = `${a.group_date}T${a.start_time}`;
        const right = `${b.group_date}T${b.start_time}`;
        return right.localeCompare(left);
      }),
    [groups]
  );

  const patientChoices = useMemo(
    () =>
      [...patients]
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((patient) => ({ id: patient.id, label: patient.displayName })),
    [patients]
  );

  const startSession = async () => {
    if (!topic.trim()) return;
    await onStartSession({ topic: topic.trim(), timeSlot });
    setTopic("");
  };

  const copyJoinLink = async () => {
    if (!activeSession?.joinUrl) return;
    try {
      await navigator.clipboard.writeText(activeSession.joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="workspaceRosterCard groupsPageCard">
      {activeSession ? (
        <div className="groupsWorkflowBanner">
          <div className="groupsWorkflowKicker">Live workflow mode</div>
          <div className="groupsWorkflowTitle">Zoom Group Session In Progress</div>
          <div className="groupsWorkflowSteps">
            <span>1. Share link</span>
            <span>2. Match sign-ins</span>
            <span>3. Finalize PDF</span>
          </div>
        </div>
      ) : null}

      <div className="workspaceRosterHead">
        <div>
          <div className="workspaceSectionLabel">Groups</div>
          <div className="workspaceRosterTitle">Create a sign-in link, share in Zoom, match participants, and generate one PDF.</div>
        </div>
        <div className="workspaceResultsCount">{sortedGroups.length} session{sortedGroups.length === 1 ? "" : "s"}</div>
      </div>

      <div className={`groupsLiveCard ${activeSession ? "groupsLiveCardActive" : ""}`}>
        <div className="groupsLiveHead">
          <div className="workspaceSectionLabel">Zoom Group Sign-In</div>
          {activeSession ? <span className="attendanceStatusChip neutral">In progress</span> : null}
        </div>

        {!activeSession ? (
          <div className="groupsLiveStartGrid">
            <label className="attendanceField">
              <span className="addLabel">Time</span>
              <select className="authInput" value={timeSlot} onChange={(e) => setTimeSlot(e.target.value as LiveGroupTimeSlot)}>
                <option value="17:30-19:00">5:30 PM - 7:00 PM</option>
                <option value="19:15-20:45">7:15 PM - 8:45 PM</option>
              </select>
            </label>
            <label className="attendanceField">
              <span className="addLabel">Topic</span>
              <input className="authInput" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tonight's group topic" />
            </label>
            <div className="groupsLiveActions">
              <button className="btn" onClick={() => void startSession()} disabled={busy || !topic.trim()}>
                {busy ? "Creating..." : "Create Link"}
              </button>
              <button className="btn ghost" onClick={() => void onClearHistory()} disabled={busy || !sortedGroups.length}>
                {busy ? "Working..." : "Reset Group History"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="groupsLiveMeta">
              <span>{fmt(activeSession.session.group_date)}</span>
              <span>{formatClock(activeSession.session.start_time)} - {formatClock(activeSession.session.end_time)}</span>
              <span>{activeSession.session.topic}</span>
              <span>Expires: {new Date(activeSession.tokenExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </div>
            <div className="groupsLiveLinkRow">
              <input className="authInput" value={activeSession.joinUrl} readOnly />
              <button className="btn ghost" onClick={() => void copyJoinLink()}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="groupsLiveHint">
              Share this link in Zoom chat, then press refresh when new patients submit.
            </div>
            <div className="groupsLiveActions">
              <button className="btn ghost" disabled={busy} onClick={() => void onRefreshSession(activeSession.session.id)}>
                {busy ? "Refreshing..." : "Refresh submissions"}
              </button>
            </div>
            <div className="groupsLiveEntries">
              {!activeSession.entries.length ? <div className="empty">No submissions yet.</div> : null}
              {activeSession.entries.map((entry) => (
                <div key={entry.id} className="groupsLiveEntryRow">
                  <div className="groupsLiveEntryIdentity">
                    <strong>{entry.participant_name}</strong>
                    <span>{new Date(entry.signed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <div className="groupsLiveEntryMatch">
                    <select
                      className="authInput"
                      value={matching[entry.id] ?? entry.patient_id ?? ""}
                      onChange={(e) => setMatching((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                      disabled={busy}
                    >
                      <option value="">Unmatched</option>
                      {patientChoices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => void onSetMatch(entry.id, (matching[entry.id] ?? entry.patient_id ?? "") || null)}
                    >
                      Save match
                    </button>
                    <button className="btn ghost" disabled={busy} onClick={() => void onRemoveEntry(entry.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="groupsLiveFinalize">
              <label className="attendanceField">
                <span className="addLabel">Counselor sign name</span>
                <input className="authInput" value={finalSignName} onChange={(e) => setFinalSignName(e.target.value)} />
              </label>
              <button className="btn" onClick={() => setSigModalOpen(true)} disabled={busy || !finalSignName.trim()}>
                Finalize PDF
              </button>
              <button className="btn ghost" onClick={onDismissLiveSession} disabled={busy}>
                Hide panel
              </button>
            </div>
            <div className="groupsFinalizeHint">
              Finalize creates the completed group sign-in PDF and marks this session as closed.
            </div>
          </>
        )}
        {err ? <div className="authErr">{err}</div> : null}
        {successMessage ? <div className="groupsSuccessNote">{successMessage}</div> : null}
      </div>

      {!sortedGroups.length ? <div className="empty">No group sessions yet.</div> : null}

      {sortedGroups.length ? (
        <>
          <div className="groupsPageList">
            {(showFullHistory ? sortedGroups : sortedGroups.slice(0, 24)).map((group) => (
              <article key={group.id} className="groupsPageRow compact">
                <div className="groupsPagePrimary">
                  <div className="groupsPageTitle compact">{group.topic}</div>
                  <div className="groupsPageMeta compact">
                    <span>{fmt(group.group_date)}</span>
                    <span>{formatClock(group.start_time)} - {formatClock(group.end_time)}</span>
                    <span>{group.participant_count} participant{group.participant_count === 1 ? "" : "s"}</span>
                    <span>{group.counselor_name}</span>
                  </div>
                </div>
                <div className="groupsPageActions compact">
                  <span className="groupsPageFileName">{group.pdf_original_filename || "No PDF yet"}</span>
                  {group.pdf_original_filename ? (
                    <button
                      className="btn"
                      onClick={() => void onOpenPdf(group.id)}
                      disabled={openingGroupId === group.id}
                    >
                      {openingGroupId === group.id ? "Opening..." : "Open PDF"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {sortedGroups.length > 24 ? (
            <button className="btn ghost" onClick={() => setShowFullHistory((current) => !current)}>
              {showFullHistory ? "Show fewer sessions" : `Show all ${sortedGroups.length} sessions`}
            </button>
          ) : null}
        </>
      ) : null}
      {sigModalOpen && activeSession ? (
        <SignaturePadModal
          title="Counselor Signature"
          onClose={() => setSigModalOpen(false)}
          onSave={(dataUrl) => {
            void onFinalize({
              counselorSignName: finalSignName.trim(),
              counselorSignatureDataUrl: dataUrl,
            });
            setSigModalOpen(false);
          }}
          saving={busy}
        />
      ) : null}
    </div>
  );
}

function BillingPage({
  patients,
  billingEntries,
}: {
  patients: Patient[];
  billingEntries: BillingEntry[];
}) {
  const [billingMonth, setBillingMonth] = useState(() => monthKey(todayIso()));
  const billingSheetScrollRef = useRef<HTMLDivElement | null>(null);

  const patientRows = useMemo(
    () => [...patients].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [patients]
  );

  const entryMap = useMemo(() => {
    const next = new Map<string, BillingEntry[]>();
    billingEntries
      .filter((entry) => monthKey(entry.serviceDate) === billingMonth)
      .forEach((entry) => {
        const key = `${entry.patientId}::${entry.billingType}`;
        const bucket = next.get(key) ?? [];
        bucket.push(entry);
        next.set(key, bucket);
      });
    return next;
  }, [billingEntries, billingMonth]);

  const auxEntryMap = useMemo(() => {
    const next = new Map<string, BillingEntry[]>();
    billingEntries
      .filter((entry) => monthKey(entry.serviceDate) === billingMonth)
      .forEach((entry) => {
        if (entry.naloxoneTraining || entry.billingType === "Naloxone") {
          const bucket = next.get(`${entry.patientId}::Naloxone`) ?? [];
          bucket.push(entry);
          next.set(`${entry.patientId}::Naloxone`, bucket);
        }
        if (entry.matEducation || entry.billingType === "MAT ED") {
          const bucket = next.get(`${entry.patientId}::MAT ED`) ?? [];
          bucket.push(entry);
          next.set(`${entry.patientId}::MAT ED`, bucket);
        }
      });
    return next;
  }, [billingEntries, billingMonth]);

  return (
    <div className="workspaceRosterCard billingPageCard">
      <div className="workspaceRosterHead">
        <div>
          <div className="workspaceSectionLabel">Billing Sheet</div>
          <div className="workspaceRosterTitle">Whole roster, current month, in the same day-minute format your team already uses.</div>
        </div>
        <div className="billingToolbar">
          <label className="attendanceField">
            <span className="addLabel">Month</span>
            <input className="authInput" type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
          </label>
          <div className="workspaceResultsCount">{monthLabel(billingMonth)}</div>
        </div>
      </div>

      <div className="billingHint">
        Main service columns show `day-minutes` with the modality codes underneath. Naloxone and MAT ED columns show just the day number.
      </div>

      <div className="workspaceSheetWrap">
        <div className="workspaceSheet billingSheet" ref={billingSheetScrollRef}>
          <div className="workspaceSheetHead billingSheetHead">
            <div>Patient</div>
            <div>MRN</div>
            <div>LOC</div>
            {BILLING_SHEET_COLUMN_OPTS.map((option) => (
              <div key={option}>{option}</div>
            ))}
          </div>
          {patientRows.map((patient) => (
            <div key={patient.id} className="workspaceSheetRow billingSheetRow">
              <div className="workspaceSheetName">
                <strong>{patient.displayName}</strong>
              </div>
              <div>{patient.mrn ?? "—"}</div>
              <div>{patient.primaryProgram ?? "—"}</div>
              {BILLING_SHEET_COLUMN_OPTS.map((option) => {
                const entries = BILLING_AUX_COLUMN_OPTS.includes(option)
                  ? auxEntryMap.get(`${patient.id}::${option}`) ?? []
                  : entryMap.get(`${patient.id}::${option}`) ?? [];
                return (
                  <div key={option} className="billingCell">
                    {entries.length ? (
                      BILLING_AUX_COLUMN_OPTS.includes(option) ? (
                        formatBillingDayList(entries)
                      ) : (
                        <>
                          <div>{formatBillingCell(entries)}</div>
                          <div className="billingCellMeta">{formatBillingModalities(entries)}</div>
                        </>
                      )
                    ) : "—"}
                  </div>
                );
              })}
            </div>
          ))}
          {!patientRows.length ? <div className="workspaceEmptyState">No patients loaded yet.</div> : null}
        </div>
        <div className="workspaceSheetFloatingArrows" aria-hidden="false">
          <button
            className="workspaceMiniBtn workspaceArrowBtn"
            onClick={() => billingSheetScrollRef.current?.scrollBy({ left: -420, behavior: "smooth" })}
          >
            <span>←</span>
          </button>
          <button
            className="workspaceMiniBtn workspaceArrowBtn"
            onClick={() => billingSheetScrollRef.current?.scrollBy({ left: 420, behavior: "smooth" })}
          >
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- Add Patient Modal -------------------- */

function AddPatientModal({
  dataClient,
  onClose,
  onAdded,
}: {
  dataClient: DataClient;
  onClose: () => void;
  onAdded: (p: Patient) => void;
}) {
  const today = new Date().toISOString().substring(0, 10);
  const [form, setForm] = useState({
    full_name: "",
    mrn: "",
    status: "new" as "new" | "current" | "rss_plus" | "rss" | "former",
    location: "Van Nuys",
    intake_date: today,
    last_visit_date: "",
    next_appt_date: "",
    primary_program: "",
    counselor_name: "",
    flags: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setErr("Full name is required."); return; }
    setSaving(true);
    setErr("");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record = {
      id,
      full_name: form.full_name.trim(),
      mrn: form.mrn.trim() || null,
      status: form.status,
      location: form.location || null,
      intake_date: form.intake_date || today,
      last_visit_date: form.last_visit_date || null,
      next_appt_date: form.next_appt_date || null,
      primary_program: form.primary_program.trim() || null,
      counselor_name: form.counselor_name.trim() || null,
      flags: form.flags ? form.flags.split(",").map((s) => s.trim()).filter(Boolean) : [],
      created_at: now,
      updated_at: now,
    };
    try {
      await dataClient.createPatient(record);
      setSaving(false);
    } catch (error) {
      setSaving(false);
      setErr(error instanceof Error ? error.message : "Failed to add patient.");
      return;
    }
    onAdded({
      id,
      displayName: record.full_name,
      mrn: record.mrn ?? undefined,
      kind: toPatientKind(record.status),
      intakeDate: record.intake_date,
      lastVisitDate: record.last_visit_date ?? undefined,
      nextApptDate: record.next_appt_date ?? undefined,
      primaryProgram: record.primary_program ?? undefined,
      counselor: record.counselor_name ?? undefined,
      flags: record.flags,
    });
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Add Patient</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <form className="modalBody" onSubmit={handleSubmit}>
          <div className="addGrid">
            <label className="addField">
              <span className="addLabel">Full name *</span>
              <input className="authInput" value={form.full_name} onChange={f("full_name")} placeholder="First Last" autoFocus />
            </label>
            <label className="addField">
              <span className="addLabel">MRN</span>
              <input className="authInput" value={form.mrn} onChange={f("mrn")} placeholder="Optional" />
            </label>
            <label className="addField">
              <span className="addLabel">Status</span>
              <select className="select" value={form.status} onChange={f("status")}>
                <option value="new">New Patient</option>
                <option value="current">Current Patient</option>
                <option value="rss_plus">RSS+</option>
                <option value="rss">RSS</option>
                <option value="former">Former Patient</option>
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Location</span>
              <select className="select" value={form.location} onChange={f("location")}>
                <option>Van Nuys</option>
                <option>Santa Clarita</option>
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Intake date</span>
              <input className="authInput" type="date" value={form.intake_date} onChange={f("intake_date")} />
            </label>
            <label className="addField">
              <span className="addLabel">Last visit date</span>
              <input className="authInput" type="date" value={form.last_visit_date} onChange={f("last_visit_date")} />
            </label>
            <label className="addField">
              <span className="addLabel">Next appointment</span>
              <input className="authInput" type="date" value={form.next_appt_date} onChange={f("next_appt_date")} />
            </label>
            <label className="addField">
              <span className="addLabel">Primary program</span>
              <input className="authInput" value={form.primary_program} onChange={f("primary_program")} placeholder="e.g. Outpatient" />
            </label>
            <label className="addField">
              <span className="addLabel">Counselor</span>
              <input className="authInput" value={form.counselor_name} onChange={f("counselor_name")} placeholder="Name" />
            </label>
            <label className="addField">
              <span className="addLabel">Flags (comma-separated)</span>
              <input className="authInput" value={form.flags} onChange={f("flags")} placeholder="e.g. MAT, Medi-Cal, High Risk" />
            </label>
          </div>
          {err ? <div className="authErr" style={{ marginTop: 12 }}>{err}</div> : null}
          <div className="modalFoot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : "Add Patient"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
