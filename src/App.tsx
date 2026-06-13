import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { getDataClient } from "./data/client";
import {
  clearAzureApiDocumentBlobCache,
  getAzureAuthOptions,
  getAzureApiHealth,
  loginToAzureDemo,
  setAzureApiAccessTokenProvider,
} from "./data/azureApiDataClient";
import { useAzureAuth } from "./auth/azureAuth";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import { useWorkspaceLayout } from "./workspace/useWorkspaceLayout";
import type {
  AiNoteType,
  AzureDemoUser,
  DataClient,
  GroupSessionSummary,
  LiveGroupEntry,
  LiveGroupSessionSnapshot,
  LiveGroupTimeSlot,
  PatientDocumentSummary,
  PatientVaultDocumentSummary,
  PublicGroupSessionInfo,
} from "./data/types";
import { CONSENT_FORMS } from './consentForms';
import type { ConsentForm } from './consentForms';
import patientFinderLogo from "./assets/patientfinder-logo.svg";
import ncaddLogo from "./assets/ncadd-logo.png";
import themeButtonLogo from "./assets/theme-button-logo-white.svg";
import nameSlayerSeedRules from "./nameSlayerSeedRules.json";
import { PatientBridgeWorkbookPage } from "./admin/PatientBridgeWorkbookPage";
import "./App.css";

const NAME_SLAYER_SPLASH_LOGO = "/name-slayer-mobile.jpg";

if (typeof window !== "undefined" && !GlobalWorkerOptions.workerPort) {
  GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.entry.ts", import.meta.url), { type: "module" });
}

/* -------------------- Types -------------------- */

type PatientKind = "New Patient" | "Current Patient" | "RSS+" | "RSS" | "Former Patient";
type PatientKindFilter = "all" | PatientKind | "Former Recent" | "Former Archived";
type ViewMode = "sheet" | "split";
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

type NameSlayerBusyState = false | "extracting" | "saving";
type NameSlayerStage = "splash" | "workflow";
type NameSlayerRule = {
  kind: "regex";
  pattern: string;
  placeholder: string;
};

const NAME_SLAYER_RULES = nameSlayerSeedRules as NameSlayerRule[];

function MobileGlanceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function StatusDiamondIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 8.5h12" />
      <path d="M6 12h8" />
      <path d="M6 15.5h10" />
      <circle cx="17" cy="8.5" r="1.1" />
      <circle cx="15" cy="12" r="1.1" />
      <circle cx="16" cy="15.5" r="1.1" />
    </svg>
  );
}

function SortDiamondIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 4v13" />
      <path d="M5.5 14.5 8 17l2.5-2.5" />
      <path d="M16 20V7" />
      <path d="M13.5 9.5 16 7l2.5 2.5" />
    </svg>
  );
}

function SheetDiamondIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M5 10h14" />
      <path d="M10 5v14" />
    </svg>
  );
}

function tokenizeNameSlayerText(text: string) {
  const tokens: { text: string; start: number; end: number }[] = [];
  const re = /(\s+|[^\s]+)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text))) {
    tokens.push({ text: match[0], start: index, end: index + match[0].length });
    index += match[0].length;
  }
  return tokens;
}

function escapeNameSlayerPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNameSlayerPattern(term: string) {
  const normalized = term.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const pieces = normalized.split(" ").map(escapeNameSlayerPattern);
  return new RegExp(`\\b${pieces.join("\\s+")}\\b`, "gi");
}

function applyNameSlayerExtraTermRedactions(text: string, extraTerms: string[]) {
  let next = text;
  for (const rawTerm of extraTerms) {
    const term = rawTerm.trim();
    if (!term) continue;
    const pattern = buildNameSlayerPattern(term);
    if (!pattern) continue;
    next = next.replace(pattern, "{Name}");
  }
  return next;
}

function getNameSlayerPatientTerms(patientName: string) {
  const normalized = patientName.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const parts = normalized.split(" ").map((part) => part.trim()).filter(Boolean);
  const terms = new Set<string>([normalized]);
  parts.forEach((part) => {
    if (part.length >= 2) terms.add(part);
  });
  if (parts.length >= 2) {
    terms.add(parts.slice(0, 2).join(" "));
    terms.add(parts.slice(-2).join(" "));
  }
  return [...terms];
}

function applyNameSlayerRedactions(text: string, extraTerms: string[] = []) {
  let next = text;
  const nextLabel = String.raw`\s+\b(?:dob|date of birth|birth date|phone|email|address|mrn|medical record number|patient id|client id|case number|counselor name|provider name|provider|name)\s*[:\-]`;
  next = next.replace(
    new RegExp(String.raw`\b(?:patient name|client name|name)\s*[:\-]\s*([^\r\n]+?)(?=${nextLabel}|$)`, "gi"),
    (match, value) => match.replace(value, "{PatientName}"),
  );
  next = next.replace(
    new RegExp(String.raw`\b(?:counselor name|provider name|provider)\s*[:\-]\s*([^\r\n]+?)(?=${nextLabel}|$)`, "gi"),
    (match, value) => match.replace(value, "{ProviderName}"),
  );
  next = next.replace(
    new RegExp(String.raw`\b(?:dob|date of birth|birth date)\s*[:\-]\s*([^\r\n]+?)(?=${nextLabel}|$)`, "gi"),
    (match, value) => match.replace(value, "{DOB}"),
  );
  next = next.replace(
    new RegExp(String.raw`\b(?:mrn|medical record number|patient id|client id|case number)\s*[:\-]\s*([^\r\n]+?)(?=${nextLabel}|$)`, "gi"),
    (match, value) => match.replace(value, "{ID}"),
  );
  next = next.replace(/\b(?:address|home address)\s*[:\-]\s*([^\r\n]+)/gi, (match, value) => match.replace(value, "{Address}"));
  next = next.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "{Email}");
  next = next.replace(/\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "{Phone}");
  next = next.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "{SSN}");
  next = next.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, "{Date}");
  next = next.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/gi, "{Date}");
  next = next.replace(/\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pkwy|parkway)\b(?:\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?(?:\s+[A-Z]{2}\b)?(?:\s+\d{5}(?:-\d{4})?)?/gi, "{Address}");
  for (const rule of NAME_SLAYER_RULES) {
    try {
      next = next.replace(new RegExp(rule.pattern, "gi"), rule.placeholder);
    } catch (error) {
      console.error("Invalid Name Slayer rule:", rule.pattern, error);
    }
  }
  next = applyNameSlayerExtraTermRedactions(next, extraTerms);
  return next;
}

function redactNameSlayerRange(text: string, start: number | null, end: number | null, placeholder = "{ManualRedaction}") {
  if (start == null || end == null || start >= end) return text;
  return `${text.slice(0, start)}${placeholder}${text.slice(end)}`;
}

function normalizePdfLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function isAlwaysPdfBoilerplateLine(line: string) {
  if (!line) return false;
  if (/^(?:\d+|\d+\s*\/\s*\d+|page\s+\d+\s+of\s+\d+)$/i.test(line)) return true;
  if (/\bhttps?:\/\/\S+/i.test(line) || /\bwww\./i.test(line)) return true;
  if (/\b\d+\s*\/\s*\d+\b/.test(line)) return true;
  return false;
}

function isRepeatedPdfBoilerplateLine(line: string) {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*[AP]M\b/i.test(line);
}

function cleanPdfPages(pageTexts: string[]) {
  const splitPages = pageTexts.map((pageText) =>
    pageText
      .split(/\r?\n/)
      .map((line) => normalizePdfLine(line))
      .filter(Boolean),
  );

  const counts = new Map<string, number>();
  for (const pageLines of splitPages) {
    const seenOnPage = new Set(pageLines);
    for (const line of seenOnPage) {
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }

  const minRepeatCount = Math.max(2, Math.ceil(pageTexts.length * 0.6));
  return splitPages
    .map((pageLines) =>
      pageLines
        .filter((line) => {
          if (isAlwaysPdfBoilerplateLine(line)) return false;
          const repeats = counts.get(line) || 0;
          if (repeats < minRepeatCount) return true;
          return !isRepeatedPdfBoilerplateLine(line);
        })
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

function shouldOcrPdf(pageTexts: string[]) {
  const lines = cleanPdfPages(pageTexts)
    .flatMap((pageText) => pageText.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;

  const uniqueLines = new Set(lines);
  if (uniqueLines.size <= 2) return true;

  const boilerplateHits = lines.filter((line) => (
    /\bhttps?:\/\/\S+/i.test(line)
    || /\bwww\./i.test(line)
    || /\b\d+\s*\/\s*\d+\b/.test(line)
    || /\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(line)
  )).length;

  return boilerplateHits / lines.length >= 0.6 && lines.join(" ").length < 600;
}

async function extractTextFromPdf(file: File) {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => (item as { str: string }).str).join(" "));
  }
  const cleanedPages = cleanPdfPages(pages);
  const extracted = cleanedPages.join("\n\n").trim();
  if (extracted && !shouldOcrPdf(pages)) return extracted;

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang/4.0.0/",
    });
    const ocrPages: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        const { data } = await worker.recognize(canvas);
        ocrPages.push(data.text || "");
      }
    } finally {
      await worker.terminate();
    }
    const ocrText = cleanPdfPages(ocrPages).join("\n\n").trim();
    return ocrText || extracted;
  } catch (error) {
    console.error("Name Slayer OCR fallback failed:", error);
    return extracted;
  }
}

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
  threadId?: string;
  parentNotificationId?: string;
  title: string;
  message: string;
  priority: "normal" | "urgent";
  patientId?: string;
  recipientEmail?: string;
  recipientUserId?: string;
  senderEmail?: string;
  senderUserId?: string;
  createdAt: string;
  readAt?: string;
};

export type Patient = {
  id: string;
  displayName: string;
  mrn?: string;
  externalId?: string;
  dateOfBirth?: string;
  status?: string;
  kind: PatientKind;

  intakeDate: string; // YYYY-MM-DD
  lastVisitDate?: string;
  nextApptDate?: string;

  primaryProgram?: string;
  counselor?: string;
  location?: string;

  flags?: string[];
  tests?: { name: string; date: string; score?: string }[];

  // New: attendance + UA results (stored locally for now)
  attendance?: AttendanceEntry[];
  drugTests?: DrugTestEntry[];

  intakeAnswers?: IntakeAnswers;
  rosterDetails?: PatientRosterDetails;
  compliance?: PatientCompliance;
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
  treatmentPlanCycleDays?: 90 | 180;
};

type CompliancePatch = Partial<PatientCompliance> & { resetProblemListCycle?: boolean };

type PatientAttendanceRegimen = {
  requiredVisitDaysPerWeek: number;
  requiredDrugTestsPerWeek: number;
  requiredVisitWeekdays: number[];
  requiredTestWeekdays: number[];
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
  | { name: "groups" }
  | { name: "mobile" }
  | { name: "patientbridge" };

type AuthedRoute = Route | { name: "attendance" };
type AuthMode = "demo" | "entra";

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

function getTreatmentPlanCycleStorageKey(patientId: string) {
  return `patientfinder.compliance.treatmentPlanCycleDays.v1.${normalizePatientId(patientId)}`;
}

function normalizeComplianceDates(compliance: PatientCompliance): PatientCompliance {
  const next = { ...compliance };
  // Source-of-truth rule: PL update completion becomes the new PL date anchor.
  if (next.lastProblemListUpdate) {
    if (!next.problemListDate || next.lastProblemListUpdate > next.problemListDate) {
      next.problemListDate = next.lastProblemListUpdate;
    }
  }
  if (next.problemListDate && next.lastProblemListReview && next.lastProblemListReview < next.problemListDate) {
    next.lastProblemListReview = undefined;
  }
  if (next.lastTreatmentPlanUpdate && (!next.treatmentPlanDate || next.lastTreatmentPlanUpdate > next.treatmentPlanDate)) {
    next.treatmentPlanDate = next.lastTreatmentPlanUpdate;
  }
  return next;
}

function getStoredTreatmentPlanCycleDays(patientId: string): 90 | 180 {
  if (typeof window === "undefined") return 90;
  try {
    const raw = window.localStorage.getItem(getTreatmentPlanCycleStorageKey(patientId));
    return raw === "180" ? 180 : 90;
  } catch {
    return 90;
  }
}

function setStoredTreatmentPlanCycleDays(patientId: string, days: 90 | 180) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getTreatmentPlanCycleStorageKey(patientId), String(days));
  } catch {
    // ignore local storage failures
  }
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
  const queryToken = window.location.search ? new URLSearchParams(window.location.search).get("group-sign") : null;
  if (queryToken) {
    try {
      return decodeURIComponent(queryToken);
    } catch {
      return null;
    }
  }
  const match = window.location.pathname.match(/^\/(?:group-sign|g)\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function formatSpreadsheetDrugLabel(drug: string) {
  const normalized = drug.trim().toLowerCase();
  if (normalized === "cannabis") return "can";
  if (normalized === "alcohol") return "alc";
  if (normalized === "methamphetamine") return "meth";
  if (normalized === "cocaine") return "coc";
  if (normalized === "heroin") return "h";
  if (normalized === "fentanyl") return "fent";
  return drug;
}

function formatSpreadsheetDrugChoices(drugs: string[] | undefined) {
  if (!drugs?.length) return "DOC —";
  return drugs.map(formatSpreadsheetDrugLabel).join(", ");
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

function formatProgramBadge(primaryProgram?: string) {
  const text = String(primaryProgram ?? "").trim();
  if (text.startsWith("2.1")) return "2.1 Intensive Outpatient";
  if (text.startsWith("1.0")) return "1.0 Outpatient";
  return "—";
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

function parseIntakeAnswers(rawJson: unknown): IntakeAnswers | undefined {
  const intake = (rawJson as any)?.sections?.intake;
  if (!intake) return undefined;
  return {
    fields: ((intake.fields ?? {}) as Record<string, string>) ?? {},
    singles: ((intake.radios ?? {}) as Record<string, string>) ?? {},
    multis: ((intake.multi ?? {}) as Record<string, string[]>) ?? {},
  };
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
  if (/load failed|failed to fetch|networkerror/i.test(error.message)) {
    return "Network connection to the selected API target failed. Try switching API target to Local Dev.";
  }
  const detail = error.message
    .replace(/^Azure API request failed:\s*\d+\s*-\s*/i, "")
    .trim();
  return detail || fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function cleanPersonLabel(value: string | undefined | null, fallback = "—") {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallback;
  if (isUuidLike(trimmed)) return fallback;
  return trimmed;
}

function buildHighlightMap(notes: InAppNotification[]) {
  const map: Record<string, "normal" | "urgent"> = {};
  notes.forEach((note) => {
    if (!note.patientId || note.readAt || !/^Patient highlight:/i.test(note.title)) return;
    const nextPriority = note.priority === "urgent" ? "urgent" : "normal";
    const normalizedPatientId = normalizePatientId(note.patientId);
    const current = map[normalizedPatientId];
    if (!current || nextPriority === "urgent") {
      map[normalizedPatientId] = nextPriority;
    }
  });
  return map;
}

type HighlightThread = {
  threadId: string;
  patientId: string | undefined;
  patientName: string;
  latest: InAppNotification;
  messages: InAppNotification[];
  unreadForMe: boolean;
  startedByMe: boolean;
  receivedByMe: boolean;
};

function buildHighlightThreads(
  notes: InAppNotification[],
  patients: Patient[],
  currentUserEmail: string,
  currentUserId: string
) {
  const email = currentUserEmail.toLowerCase();
  const grouped = new Map<string, InAppNotification[]>();
  notes.forEach((note) => {
    const threadId = note.threadId ?? note.id;
    if (!grouped.has(threadId)) grouped.set(threadId, []);
    grouped.get(threadId)!.push(note);
  });

  const threads: Array<HighlightThread | null> = [...grouped.entries()].map(([threadId, items]) => {
    const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = ordered[ordered.length - 1];
    const related = ordered.filter((note) => {
      const matchesRecipient =
        (note.recipientEmail && note.recipientEmail.toLowerCase() === email) ||
        (note.recipientUserId && note.recipientUserId.toLowerCase() === currentUserId.toLowerCase());
      const matchesSender =
        (note.senderEmail && note.senderEmail.toLowerCase() === email) ||
        (note.senderUserId && note.senderUserId.toLowerCase() === currentUserId.toLowerCase());
      return matchesRecipient || matchesSender;
    });
    if (!related.length) return null;
    const patientId = latest.patientId ?? related.find((note) => note.patientId)?.patientId;
    const patient = patientId ? patients.find((entry) => normalizePatientId(entry.id) === normalizePatientId(patientId)) : null;
    const unreadForMe = related.some(
      (note) =>
        !note.readAt &&
        ((note.recipientEmail && note.recipientEmail.toLowerCase() === email) ||
          (note.recipientUserId && note.recipientUserId.toLowerCase() === currentUserId.toLowerCase()))
    );
    const startedByMe = related.some(
      (note) =>
        (note.senderEmail && note.senderEmail.toLowerCase() === email) ||
        (note.senderUserId && note.senderUserId.toLowerCase() === currentUserId.toLowerCase())
    );
    const receivedByMe = related.some(
      (note) =>
        (note.recipientEmail && note.recipientEmail.toLowerCase() === email) ||
        (note.recipientUserId && note.recipientUserId.toLowerCase() === currentUserId.toLowerCase())
    );
    return {
      threadId,
      patientId: patientId ?? undefined,
      patientName: patient?.displayName ?? (latest.title.replace(/^Patient highlight:\s*/i, "") || "Unknown patient"),
      latest,
      messages: related,
      unreadForMe,
      startedByMe,
      receivedByMe,
    } satisfies HighlightThread;
  });

  return threads.filter((thread): thread is HighlightThread => Boolean(thread)).sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
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

function formatDueDaysLabel(days: number | null, emptyLabel: string) {
  if (days === null) return emptyLabel;
  if (days === 0) return "Due today";
  if (days === 1) return "Due in 1 day";
  return `Due in ${days} days`;
}

function getProblemListSummary(compliance: PatientCompliance | undefined, patient?: Patient) {
  if (patient && patient.kind === "Former Patient") {
    return {
      tone: "neutral" as const,
      reviewText: "Problem list ended at this program",
      updateText: "No upcoming problem list review or update",
    };
  }

  const config = compliance ?? {};
  if (!config.problemListDate) {
    return {
      tone: "neutral" as const,
      reviewText: "Problem list date not set",
      updateText: "No review or update schedule yet",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const review30 = addDaysIso(config.problemListDate, 30);
  const review60 = addDaysIso(config.problemListDate, 60);
  const lastReviewRaw = config.lastProblemListReview ?? null;
  const lastReview = lastReviewRaw && lastReviewRaw >= config.problemListDate ? lastReviewRaw : null;
  const nextReview =
    !lastReview ? review30 : lastReview < review60 ? review60 : null;
  const nextUpdate = addDaysIso(config.problemListDate, 90);
  const reviewDelta = nextReview ? dayDiff(today, nextReview) : null;
  const updateDelta = dayDiff(today, nextUpdate);
  const tone =
    (reviewDelta !== null && reviewDelta < 0) || updateDelta < 0
      ? "behind"
      : (reviewDelta !== null && reviewDelta <= 7) || updateDelta <= 14
        ? "neutral"
        : "good";

  return {
    tone,
    reviewText: reviewDelta === null ? "30/60-day review cycle complete" : buildDueLabel(reviewDelta, nextReview as string, "Review"),
    updateText: buildDueLabel(updateDelta, nextUpdate, "Update"),
  };
}

function getLastProblemListReviewLabel(compliance: PatientCompliance | undefined, patient?: Patient) {
  if (patient && patient.kind === "Former Patient") return "";
  const config = compliance ?? {};
  if (!config.problemListDate || !config.lastProblemListReview) return "";
  const review60 = addDaysIso(config.problemListDate, 60);
  const reviewType = config.lastProblemListReview < review60 ? "30-day" : "60-day";
  return `${reviewType}: ${fmt(config.lastProblemListReview)}`;
}

function getNextProblemListMilestone(compliance: PatientCompliance | undefined, patient?: Patient) {
  if (patient && patient.kind === "Former Patient") return null;
  const config = compliance ?? {};
  if (!config.problemListDate) return null;
  const review30 = addDaysIso(config.problemListDate, 30);
  const review60 = addDaysIso(config.problemListDate, 60);
  const lastReviewRaw = config.lastProblemListReview ?? null;
  const lastReview = lastReviewRaw && lastReviewRaw >= config.problemListDate ? lastReviewRaw : null;
  if (!lastReview) return { label: "PL Review", dueDate: review30 };
  if (lastReview < review60) return { label: "PL Review", dueDate: review60 };
  return { label: "PL Update", dueDate: addDaysIso(config.problemListDate, 90) };
}

function getProblemListInitialDueDate(patient: Patient) {
  return addDaysIso(patient.intakeDate, 7);
}

function isTreatmentPlanEnded(patient: Patient) {
  return patient.kind === "RSS" || patient.kind === "RSS+" || patient.kind === "Former Patient";
}

function isProblemListEnded(patient: Patient) {
  return patient.kind === "Former Patient";
}

function getNextUpSummary(patient: Patient, compliance: PatientCompliance | undefined, todayIsoValue: string) {
  const config = compliance ?? {};
  if (isProblemListEnded(patient) && isTreatmentPlanEnded(patient)) {
    return { label: "No upcoming items", tone: "neutral" as const };
  }
  if (!config.problemListDate) {
    if (patient.kind !== "New Patient") {
      return { label: "Set Problem List", tone: "neutral" as const };
    }
    const dueDate = addDaysIso(patient.intakeDate, 7);
    const delta = dayDiff(todayIsoValue, dueDate);
    const tone = delta < 0 ? "behind" : delta <= 3 ? "due" : "good";
    return { label: `Problem List ${fmt(dueDate)}`, tone };
  }

  const cycleDays = config.treatmentPlanCycleDays ?? 90;
  const treatmentPlanEnded = isTreatmentPlanEnded(patient);
  const problemListNext = getNextProblemListMilestone(config);

  const candidates = [
    ...(problemListNext ? [problemListNext] : []),
    ...(!treatmentPlanEnded && !config.treatmentPlanDate ? [{ key: "tx_initial", label: "Tx Plan", dueDate: addDaysIso(patient.intakeDate, 30) }] : []),
    ...(!treatmentPlanEnded
      ? [{
          key: "tx_update",
          label: "Tx Plan Update",
          dueDate: addDaysIso(config.lastTreatmentPlanUpdate ?? config.treatmentPlanDate ?? addDaysIso(patient.intakeDate, 30), cycleDays),
        }]
      : []),
  ];

  const next = candidates.reduce((earliest, item) => {
    if (!earliest) return item;
    return item.dueDate < earliest.dueDate ? item : earliest;
  }, null as (typeof candidates)[number] | null);

  if (!next) {
    return { label: "—", tone: "neutral" as const };
  }

  const delta = dayDiff(todayIsoValue, next.dueDate);
  const tone = delta < 0 ? "behind" : delta <= 3 ? "due" : "good";
  return { label: `${next.label} ${fmt(next.dueDate)}`, tone };
}

function getProblemListDueDates(compliance: PatientCompliance | undefined, patient?: Patient) {
  if (patient && patient.kind === "Former Patient") return null;
  if (!compliance?.problemListDate) return null;
  const nextMilestone = getNextProblemListMilestone(compliance, patient);
  return {
    nextReview: nextMilestone?.label === "PL Review" ? nextMilestone.dueDate : null,
    nextUpdate: addDaysIso(compliance.problemListDate, 90),
  };
}

function getTreatmentPlanSummary(patient: Patient, compliance: PatientCompliance | undefined) {
  const config = compliance ?? {};
  const today = todayIso();

  if (isTreatmentPlanEnded(patient)) {
    return {
      tone: "neutral" as const,
      reviewText: "Treatment plan ended at this program",
      updateText: "No upcoming treatment plan review or update",
      ended: true,
    };
  }

  if (!config.treatmentPlanDate) {
    const initialDue = addDaysIso(patient.intakeDate, 30);
    const initialDelta = dayDiff(today, initialDue);
    return {
      tone: initialDelta < 0 ? "behind" : initialDelta <= 7 ? "neutral" : "good",
      reviewText: buildDueLabel(initialDelta, initialDue, "Initial treatment plan"),
      updateText: "Treatment plan update starts after the initial plan is created",
      ended: false,
    };
  }

  const cycleDays = config.treatmentPlanCycleDays ?? 90;
  const nextUpdate = addDaysIso(config.lastTreatmentPlanUpdate ?? config.treatmentPlanDate, cycleDays);
  const updateDelta = dayDiff(today, nextUpdate);
  return {
    tone: updateDelta < 0 ? "behind" : updateDelta <= 14 ? "neutral" : "good",
    reviewText: `Treatment plan set ${fmt(config.treatmentPlanDate)}`,
    updateText: `${buildDueLabel(updateDelta, nextUpdate, "Treatment plan update")} (${cycleDays}-day cycle)`,
    ended: false,
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
  const problemList = getProblemListSummary(compliance, patient);
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
    detail: treatmentPlan.ended
      ? treatmentPlan.reviewText
      : treatmentPlan.tone === "behind"
        ? `${treatmentPlan.reviewText} • ${treatmentPlan.updateText}`
        : treatmentPlan.updateText,
    sortScore: treatmentPlan.ended ? 5 : treatmentPlan.tone === "behind" ? 2 : treatmentPlan.tone === "neutral" ? 4 : 7,
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

function HeadEdit({ onClick, enabled = true }: { onClick: () => void; enabled?: boolean }) {
  if (!enabled) return null;
  return (
    <button type="button" className="iEditBtn iEditBtnHead" onClick={onClick} title="Edit">
      ✎
    </button>
  );
}

function IntakeChoiceSelect({
  value,
  options,
  onChange,
  className,
  buttonClassName,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={className ? `iChoiceSelect ${className}` : "iChoiceSelect"} ref={anchorRef}>
      <button
        type="button"
        className={buttonClassName ? `iChoiceSelectButton ${buttonClassName}` : "iChoiceSelectButton"}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="iChoiceSelectValue">{value || "—"}</span>
        <span className="iChoiceSelectCaret" aria-hidden="true">▾</span>
      </button>
      {open && !disabled ? (
        <div className="iChoiceSelectMenu" role="listbox">
          <button
            type="button"
            className={!value ? "iChoiceSelectOption on" : "iChoiceSelectOption"}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <span>—</span>
            {!value ? <span aria-hidden="true">✓</span> : null}
          </button>
          {options.map((option) => {
            const selected = value === option;
            return (
              <button
                type="button"
                key={option}
                className={selected ? "iChoiceSelectOption on" : "iChoiceSelectOption"}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <span>{option}</span>
                {selected ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function derivePatientKind(
  primaryProgram: string | null | undefined,
  status: string | null | undefined,
  intakeDate?: string | null
): PatientKind {
  const program = String(primaryProgram ?? "").trim().toLowerCase();
  if (program) {
    if (program === "rss+" || program === "rss_plus" || program === "rss plus") return "RSS+";
    if (program === "rss") return "RSS";
    if (program === "former patient" || program === "former" || program === "past patient" || program === "past" || program === "inactive") {
      return "Former Patient";
    }
    if (program.startsWith("1.0") || program.startsWith("2.1")) {
      return "Current Patient";
    }
  }

  const normalizedKind = toPatientKind(status);
  if (normalizedKind === "New Patient" && intakeDate && dayDiff(intakeDate, todayIso()) > 20) {
    return "Current Patient";
  }
  return normalizedKind;
}

function mergePatientWithExtras(
  row: any,
  extras: PatientExtras | undefined,
  rosterDetails: PatientRosterDetails | undefined,
  intakeAnswers?: IntakeAnswers
): Patient {
  const intakeDate = row.intake_date;
  const kind = derivePatientKind(row.primary_program, row.status, intakeDate);

  return {
    id: normalizePatientId(row.id),
    displayName: row.full_name || "Unknown",
    mrn: row.mrn,
    externalId: row.external_id ?? undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    status: row.status ?? undefined,
    kind,
    intakeDate,
    lastVisitDate: row.last_visit_date,
    nextApptDate: row.next_appt_date,
    primaryProgram: row.primary_program,
    counselor: row.counselor_name,
    location: row.location,
    flags: row.flags || [],
    drugTests: extras?.drugTests ?? [],
    rosterDetails,
    intakeAnswers,
  };
}

function mapPatientAggregate(row: any): Patient {
  const roster = row?.roster_details ?? null;
  const complianceRow = row?.compliance ?? null;
  const drugTests = Array.isArray(row?.drug_tests)
    ? row.drug_tests.map((entry: any) => ({
        id: String(entry.id ?? ""),
        date: String(entry.date ?? ""),
        testType: String(entry.test_type ?? ""),
        result: String(entry.result ?? ""),
        substances: entry.substances ?? undefined,
        notes: entry.notes ?? undefined,
      }))
    : [];
  const intakeAnswers = parseIntakeAnswers(row?.latest_intake_submission?.raw_json);
  const patient = mergePatientWithExtras(
    row,
    { drugTests },
    roster
      ? {
          drugOfChoice: Array.isArray(roster.drug_of_choice) ? roster.drug_of_choice : undefined,
          medicalPhysApt: roster.medical_phys_apt ?? undefined,
          medFormStatus: roster.med_form_status ?? undefined,
          notes: roster.notes ?? undefined,
          referringAgency: roster.referring_agency ?? undefined,
          reauthSapcDate: roster.reauth_sapc_date ?? undefined,
          medicalEligibility: roster.medical_eligibility ?? undefined,
          matStatus: roster.mat_status ?? undefined,
          therapyTrack: roster.therapy_track ?? undefined,
      }
      : undefined
    ,
    intakeAnswers
  );

  return {
    ...patient,
    compliance: complianceRow
      ? {
          drugTestMode: complianceRow.drug_test_mode ?? "none",
          drugTestsPerWeek: complianceRow.drug_tests_per_week ?? undefined,
          drugTestWeekday: complianceRow.drug_test_weekday != null ? String(complianceRow.drug_test_weekday) : undefined,
          problemListDate: toDateOnly(complianceRow.problem_list_date) ?? undefined,
          lastProblemListReview: toDateOnly(complianceRow.last_problem_list_review) ?? undefined,
          lastProblemListUpdate: toDateOnly(complianceRow.last_problem_list_update) ?? undefined,
          treatmentPlanDate: complianceRow.treatment_plan_date ?? undefined,
          lastTreatmentPlanUpdate: complianceRow.treatment_plan_update ?? complianceRow.last_treatment_plan_update ?? undefined,
        }
      : undefined,
  };
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

type ApiTargetProfile = "local-phi" | "ncadd-azure" | "custom";

const API_OVERRIDE_KEY = "patientfinder.azure-demo.apiBaseUrlOverride.v1";
const API_PROFILE_KEY = "patientfinder.azure-demo.apiProfile.v1";
const API_CUSTOM_URL_KEY = "patientfinder.azure-demo.apiCustomBaseUrl.v1";
const LOCAL_API_BASE_URL = String(import.meta.env.VITE_LOCAL_AZURE_API_BASE_URL ?? "http://localhost:3001").trim();
const NCADD_API_BASE_URL = String(import.meta.env.VITE_NCADD_AZURE_API_BASE_URL ?? "https://pfsbx-api-0412346.azurewebsites.net").trim();

function isLikelyLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".lan") ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

const IS_LOCAL_BROWSER =
  typeof window !== "undefined" &&
  isLikelyLocalHost(window.location.hostname);

function getApiTargetLabel(profile: ApiTargetProfile) {
  switch (profile) {
    case "local-phi":
      return "Local PHI";
    case "ncadd-azure":
      return "NCADD Azure";
    case "custom":
      return "Custom API";
  }
}

function getApiTargetDescription(profile: ApiTargetProfile) {
  switch (profile) {
    case "local-phi":
      return "Local API pointed at the real local Postgres.";
    case "ncadd-azure":
      return "Deployed Azure API and Azure Postgres.";
    case "custom":
      return "Any explicit API host you enter.";
  }
}

function getConfiguredApiBaseUrl(profile: ApiTargetProfile, customBaseUrl: string) {
  if (profile === "ncadd-azure") return NCADD_API_BASE_URL;
  if (profile === "custom") return customBaseUrl.trim() || LOCAL_API_BASE_URL;
  return LOCAL_API_BASE_URL;
}

function inferInitialApiProfile(): ApiTargetProfile {
  if (typeof window === "undefined") {
    return "local-phi";
  }
  const storedProfile = window.localStorage.getItem(API_PROFILE_KEY)?.trim();
  if (storedProfile === "local-phi" || storedProfile === "ncadd-azure" || storedProfile === "custom") {
    return storedProfile;
  }
  const override = window.localStorage.getItem(API_OVERRIDE_KEY)?.trim();
  if (override) {
    if (override === NCADD_API_BASE_URL) return "ncadd-azure";
    if (override === LOCAL_API_BASE_URL) return "local-phi";
    return "custom";
  }
  return "local-phi";
}

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
  const [, setLoadingPatients] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddPatient, setShowAddPatient] = useState(false);

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
  const [highlightTarget, setHighlightTarget] = useState<{
    patientId?: string;
    patientName?: string;
    recipientEmail?: string;
  } | null>(null);
  const [caseAssignmentTarget, setCaseAssignmentTarget] = useState<{
    patientId: string;
    patientName: string;
    currentCounselorEmail: string;
  } | null>(null);
  const [highlightedPatientIds, setHighlightedPatientIds] = useState<Record<string, "normal" | "urgent">>({});
  const [counselorThinList, setCounselorThinList] = useState(false);
  const [patientDocumentsTabActive, setPatientDocumentsTabActive] = useState(false);
  const {
    isMobileWorkspace,
    privacyLocked,
    lockWorkspace,
    unlockWorkspace: openWorkspace,
    lockJokeText,
    mobileDashboardScale,
    setMobileDashboardScale,
  } = useWorkspaceLayout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileGlanceOpen, setMobileGlanceOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [desktopGlanceOpen, setDesktopGlanceOpen] = useState(false);
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const desktopSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopDropdownOpen, setDesktopDropdownOpen] = useState<"sort" | "status" | null>(null);
  const desktopSortDropdownRef = useRef<HTMLDivElement | null>(null);
  const desktopStatusDropdownRef = useRef<HTMLDivElement | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [billingEntries, setBillingEntries] = useState<BillingEntry[]>([]);
  const [groupSessions, setGroupSessions] = useState<GroupSessionSummary[]>([]);
  const [openingGroupId, setOpeningGroupId] = useState<string | null>(null);
  const [liveGroupState, setLiveGroupState] = useState<LiveGroupSessionState | null>(null);
  const [liveGroupBusy, setLiveGroupBusy] = useState(false);
  const [liveGroupError, setLiveGroupError] = useState<string | null>(null);
  const [liveGroupSuccess, setLiveGroupSuccess] = useState<string | null>(null);
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
  const patientPageSize = 1000;
  const [patientTotal, setPatientTotal] = useState(0);

  const [forceRoster, setForceRoster] = useState(true);
  const [caseLoadOnly, setCaseLoadOnly] = useState(false);
  const debugPatientFlow =
    String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "1" ||
    String(import.meta.env.VITE_DEBUG_PATIENT_FLOW ?? "").toLowerCase() === "true" ||
    import.meta.env.DEV;

  useEffect(() => {
    setPatientPage(0);
  }, [qRaw, kindFilter, sortKey, sortDir, forceRoster, caseLoadOnly]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapAuthOptions = async () => {
      try {
        const payload = await getAzureAuthOptions();
        if (cancelled) return;
        setAuthOptionsError(null);
        setAuthMode(payload.authMode ?? "demo");
        setAzureDemoUsers(payload.authMode === "demo" ? (payload.demoUsers ?? []) : []);
      } catch (error) {
        if (!cancelled) {
          setAuthMode("demo");
          setAzureDemoUsers([]);
          const profile = typeof window === "undefined" ? "local-phi" : (window.localStorage.getItem(API_PROFILE_KEY)?.trim() as ApiTargetProfile | null);
          const targetLabel = profile && (profile === "local-phi" || profile === "ncadd-azure" || profile === "custom")
            ? getApiTargetLabel(profile)
            : "selected API target";
          setAuthOptionsError(getRequestErrorMessage(error, `Unable to reach the ${targetLabel}. Check the connection profile in the sign-in sheet.`));
        }
      }
    };

    void bootstrapAuthOptions();
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
  const canManageAssignments = hasAdminRole || hasIntakeRole;
  const canManageRosterScope = hasAdminRole || hasIntakeRole;
  const canManagePatients = hasAdminRole || hasIntakeRole;
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
    setForceRoster(canManageRosterScope);
    setCaseLoadOnly(hasCounselorRole && !canManageRosterScope);
  }, [activeAuthUser, hasCounselorRole, hasKnownWorkspaceRole, canManageRosterScope]);


  useEffect(() => {
    if (view === "split") {
      setView("sheet");
      return;
    }
  }, [isMobileWorkspace, view]);

  useEffect(() => {
    if (!isMobileWorkspace || privacyLocked) {
      setMobileMenuOpen(false);
      setMobileGlanceOpen(false);
      setMobileSearchOpen(false);
      return;
    }
    setMobileMenuOpen(false);
    setMobileGlanceOpen(false);
    setMobileSearchOpen(false);
  }, [isMobileWorkspace, privacyLocked, route.name]);

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

  useEffect(() => {
    if (!desktopDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (desktopDropdownOpen === "sort" && desktopSortDropdownRef.current?.contains(target)) return;
      if (desktopDropdownOpen === "status" && desktopStatusDropdownRef.current?.contains(target)) return;
      setDesktopDropdownOpen(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [desktopDropdownOpen]);

  useEffect(() => {
    if (isMobileWorkspace || privacyLocked || !desktopSearchOpen) return;
    const id = window.requestAnimationFrame(() => {
      desktopSearchInputRef.current?.focus();
      desktopSearchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [desktopSearchOpen, isMobileWorkspace, privacyLocked]);

  useEffect(() => {
    if (!desktopSearchOpen || isMobileWorkspace || privacyLocked) {
      setDesktopDropdownOpen(null);
    }
  }, [desktopSearchOpen, isMobileWorkspace, privacyLocked]);

  const activeUserId = String(activeAuthUser?.id ?? activeAuthUser?.email ?? "azure-demo-user").toLowerCase();
  const activeUserEmail = activeAuthUser?.email ?? "";
  const mobileInstallBaseUrl = String(import.meta.env.VITE_MOBILE_INSTALL_URL ?? "").trim();
  const mobileInstallCode = hashInstallSeed(`${activeUserId}:patientfinder-mobile`);
  const documentScannerInstallUrl = mobileInstallBaseUrl
    ? `${mobileInstallBaseUrl}${mobileInstallBaseUrl.includes("?") ? "&" : "?"}invite=${encodeURIComponent(mobileInstallCode)}`
    : "";
  const counselorId = activeUserId;
  const counselorLabel = activeUserEmail?.split("@")[0] ?? "My";
  const counselorThinListStorageKey = `patientfinder.thinlist.${activeUserId}`;
  const counselorAssignmentOptions = useMemo(() => {
    const optionMap = new Map<string, { email: string; label: string; userId?: string }>();
    const pushOption = (option: { email: string; label: string; userId?: string }) => {
      const normalizedEmail = option.email.trim().toLowerCase();
      if (!normalizedEmail) return;
      if (optionMap.has(normalizedEmail)) return;
      optionMap.set(normalizedEmail, {
        email: normalizedEmail,
        label: option.label,
        userId: option.userId ? option.userId.toLowerCase() : undefined,
      });
    };

    if (activeUserEmail) {
      pushOption({
        email: activeUserEmail,
        label: `${activeAuthUser?.name || activeUserEmail} (You)`,
        userId: counselorId,
      });
    }

    azureDemoUsers
      .filter((user) => user.roles.includes("Counselor") || user.roles.includes("Admin"))
      .forEach((user) => {
        pushOption({
          email: user.email,
          label: user.name ? `${user.name} (${user.email})` : user.email,
          userId: user.id,
        });
      });

    teammateEmails.forEach((email) => {
      pushOption({
        email,
        label: email,
      });
    });

    return [...optionMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [activeAuthUser?.name, activeUserEmail, azureDemoUsers, counselorId, teammateEmails]);
  const counselorLabelByEmail = useMemo(() => {
    const map: Record<string, string> = {};
    counselorAssignmentOptions.forEach((option) => {
      map[option.email] = option.label;
    });
    return map;
  }, [counselorAssignmentOptions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(counselorThinListStorageKey);
    setCounselorThinList(saved === "1");
  }, [counselorThinListStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(counselorThinListStorageKey, counselorThinList ? "1" : "0");
  }, [counselorThinListStorageKey, counselorThinList]);

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
    let aggregateRows: any[] = [];
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
        ? Promise.resolve({ patients: [], total: 0, limit: patientPageSize, offset: 0 })
        : dataClient.getPatientsPage({
            q: qRaw || undefined,
            status: patientStatus,
            pastTier,
            assignedToUserId: caseLoadOnly ? counselorId : undefined,
            assignedToEmail: caseLoadOnly ? activeUserEmail.toLowerCase() : undefined,
            sortKey,
            sortDir,
            limit: patientPageSize,
            offset: 0,
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
        dataClient.getDashboard({ includePatients: true }),
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
      aggregateRows = (dashboard.patientAggregates as any[]) ?? [];
      const useAggregates = aggregateRows.length > 0;

      if (useAggregates) {
        complianceRows = aggregateRows
          .map((row: any) => ({
            patient_id: row.id,
            ...(row.compliance ?? {}),
          }))
          .filter((row: any) => row.patient_id);
        rosterRows = aggregateRows
          .map((row: any) => ({
            patient_id: row.id,
            ...(row.roster_details ?? {}),
          }))
          .filter((row: any) => row.patient_id);
        drugTestsRows = aggregateRows.flatMap((row: any) =>
          Array.isArray(row.drug_tests)
            ? row.drug_tests.map((entry: any) => ({
                ...entry,
                patient_id: row.id,
              }))
            : []
        );
      }
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

    const problemListUpdateEvidenceByPatient = new Map<string, Set<string>>();
    billingRows.forEach((row: any) => {
      const patientId = normalizePatientId(row.patient_id);
      const billingType = String(row.billing_type ?? "").trim().toLowerCase();
      const serviceDate = toDateOnly(row.service_date);
      if (billingType !== "problem list update" || !serviceDate) return;
      if (!problemListUpdateEvidenceByPatient.has(patientId)) {
        problemListUpdateEvidenceByPatient.set(patientId, new Set<string>());
      }
      problemListUpdateEvidenceByPatient.get(patientId)!.add(serviceDate);
    });

    const nextCompliance: Record<string, PatientCompliance> = {};
    const complianceRepairs: Array<{ patientId: string; normalized: PatientCompliance }> = [];
    complianceRows.forEach((row: any) => {
      const patientId = normalizePatientId(row.patient_id);
      const rowProblemListUpdate = toDateOnly(row.last_problem_list_update) ?? undefined;
      const rowTreatmentPlanUpdate = toDateOnly(row.last_treatment_plan_update ?? row.treatment_plan_update) ?? undefined;
      const mirroredUpdateWithoutEvidence =
        Boolean(rowProblemListUpdate) &&
        Boolean(rowTreatmentPlanUpdate) &&
        rowProblemListUpdate === rowTreatmentPlanUpdate;
      const rawCompliance: PatientCompliance = {
        drugTestMode: row.drug_test_mode ?? "none",
        drugTestsPerWeek: row.drug_tests_per_week ?? undefined,
        drugTestWeekday: row.drug_test_weekday != null ? String(row.drug_test_weekday) : undefined,
        problemListDate: toDateOnly(row.problem_list_date) ?? undefined,
        lastProblemListReview: toDateOnly(row.last_problem_list_review) ?? undefined,
        lastProblemListUpdate: mirroredUpdateWithoutEvidence ? undefined : rowProblemListUpdate,
        treatmentPlanDate: row.treatment_plan_date ?? undefined,
        lastTreatmentPlanUpdate: row.treatment_plan_update ?? row.last_treatment_plan_update ?? undefined,
        treatmentPlanCycleDays: getStoredTreatmentPlanCycleDays(patientId),
      };
      const normalized = normalizeComplianceDates(rawCompliance);
      nextCompliance[patientId] = normalized;
      if (
        normalized.problemListDate !== rawCompliance.problemListDate ||
        normalized.lastProblemListReview !== rawCompliance.lastProblemListReview ||
        normalized.treatmentPlanDate !== rawCompliance.treatmentPlanDate
      ) {
        complianceRepairs.push({ patientId, normalized });
      }
    });
    if (complianceRepairs.length) {
      void Promise.allSettled(
        complianceRepairs.map(({ patientId, normalized }) =>
          dataClient.saveCompliance(patientId, {
            patient_id: patientId,
            drug_test_mode: normalized.drugTestMode ?? "none",
            drug_tests_per_week: normalized.drugTestMode === "weekly_count" ? normalized.drugTestsPerWeek ?? 1 : null,
            drug_test_weekday:
              normalized.drugTestMode === "weekday" && normalized.drugTestWeekday != null
                ? Number(normalized.drugTestWeekday)
                : null,
            problem_list_date: normalized.problemListDate ?? null,
            last_problem_list_review: normalized.lastProblemListReview ?? null,
            last_problem_list_update: normalized.lastProblemListUpdate ?? null,
            treatment_plan_date: normalized.treatmentPlanDate ?? null,
            treatment_plan_update: normalized.lastTreatmentPlanUpdate ?? null,
            updated_by: activeUserId || null,
          })
        )
      );
    }

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
        const aggregateRow = aggregateRows.find((entry: any) => normalizePatientId(entry.id) === normalizedId);
        const patient = mergePatientWithExtras(
          { ...row, id: normalizedId },
          nextExtras[normalizedId] ?? nextExtras[row.id],
          nextRosterDetails[normalizedId] ?? nextRosterDetails[row.id],
          parseIntakeAnswers(aggregateRow?.latest_intake_submission?.raw_json)
        );
        return {
          ...patient,
          compliance: nextCompliance[normalizedId] ?? nextCompliance[row.id],
        };
      })
    );
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
    const mappedNotifications = notificationsRows.map((row) => ({
        id: row.id,
        threadId: row.thread_id ?? undefined,
        parentNotificationId: row.parent_notification_id ?? undefined,
        title: row.title,
        message: row.message,
        priority: row.priority,
        patientId: row.patient_id ? normalizePatientId(row.patient_id) : undefined,
        recipientEmail: row.recipient_email ?? undefined,
        recipientUserId: row.recipient_user_id ? String(row.recipient_user_id).toLowerCase() : undefined,
        senderEmail: row.sender_email ?? undefined,
        senderUserId: row.sender_user_id ? String(row.sender_user_id).toLowerCase() : undefined,
        createdAt: row.created_at,
        readAt: row.read_at ?? undefined,
      }));
    setNotifications(mappedNotifications);
    setHighlightedPatientIds(buildHighlightMap(mappedNotifications));
    setGroupSessions(groupRows);
    setLoadingPatients(false);
  });

  const loadPatientDirectory = useEffectEvent(async () => {
    if (!authReadyForApi) return;
    try {
      const dashboard = await dataClient.getDashboard({ includePatients: true });
      const aggregateRows = (dashboard.patientAggregates as any[]) ?? [];
      if (aggregateRows.length) {
        setDirectoryPatients(aggregateRows.map((row: any) => mapPatientAggregate(row)));
        return;
      }
      const patientRows = (dashboard.patients as any[]) ?? [];
      setDirectoryPatients(patientRows.map((row: any) => mapPatientAggregate(row)));
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
    if (kindFilter === "all") rows = rows.filter(({ p }) => p.kind !== "Former Patient");
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
        const due = getProblemListDueDates(complianceByPatient[p.id], p);
        if (dashboardFilter === "dueReview") {
          if (!due?.nextReview) return false;
          const daysUntilReview = dayDiff(currentWeek, due.nextReview);
          return daysUntilReview >= 0 && daysUntilReview <= 7;
        }
        if (dashboardFilter === "dueUpdate") {
          if (!due) return false;
          const daysUntilUpdate = dayDiff(currentWeek, due.nextUpdate);
          return daysUntilUpdate >= 0 && daysUntilUpdate <= 14;
        }
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

  const lockCanvasScroll = workspaceTab === "roster";

  const [selectedId, setSelectedId] = useState<string | null>(patients[0]?.id ?? null);
  const selectionClearedRef = useRef(false);
  const selected = useMemo(() => (selectedId ? results.find((p) => p.id === selectedId) ?? null : null), [results, selectedId]);
  const caseLoadPatients = useMemo(
    () => patients.filter((patient) => patient.kind !== "Former Patient" && caseAssignments[patient.id] === counselorId),
    [patients, caseAssignments, counselorId]
  );
  const dashboardScopePatients = useMemo(
    () => (forceRoster ? patients.filter((patient) => patient.kind !== "Former Patient") : caseLoadPatients),
    [forceRoster, patients, caseLoadPatients]
  );
  const operationalPatients = useMemo(
    () => (directoryPatients.length ? directoryPatients : patients).filter((patient) => patient.kind !== "Former Patient"),
    [directoryPatients, patients]
  );
  const billingPatients = useMemo(
    () => operationalPatients.filter((patient) => isBillingActivePatient(patient, currentWeek)),
    [operationalPatients, currentWeek]
  );
  const renderSplitPatientSheet = (patient: Patient) => {
    const patientCompliance = complianceByPatient[normalizePatientId(patient.id)] ?? complianceByPatient[patient.id];
    return (
      <PatientPage
        patient={patient}
        patientOptions={patients}
        currentUserEmail={activeUserEmail}
        counselorOptions={counselorAssignmentOptions}
        allSessions={sessions}
        dataClient={dataClient}
        hasAssignment={Boolean(caseAssignments[patient.id] || caseAssignmentEmails[patient.id])}
        isAssignedToMe={caseAssignments[patient.id] === counselorId}
        assignedCounselorEmail={
          caseAssignmentEmails[patient.id] ??
          (caseAssignments[patient.id]?.includes("@") ? caseAssignments[patient.id] : "")
        }
        assignedCounselorLabel={
          (() => {
            const email = caseAssignmentEmails[patient.id] ?? (caseAssignments[patient.id]?.includes("@") ? caseAssignments[patient.id] : "");
            if (!email) return undefined;
            return counselorLabelByEmail[email] ?? email;
          })()
        }
        compliance={patientCompliance}
        onAssignCase={() => openCaseAssignmentModal(patient.id)}
        onClearAssignment={() => void clearCaseAssignment(patient.id)}
        onUpdateCompliance={(patch) => updateCompliance(patient.id, patch)}
        onUpdateRosterDetails={(patch) => updateRosterDetails(patient.id, patch)}
            onUpdatePatient={(next) => {
              const normalizedNextId = normalizePatientId(next.id);
              setPatients((prev) => prev.map((x) => (normalizePatientId(x.id) === normalizedNextId ? { ...x, ...next, id: x.id } : x)));
              setPatientDetail((current) => (current && normalizePatientId(current.id) === normalizedNextId ? { ...current, ...next, id: current.id } : current));
            }}
        onDeletePatient={() => {
          setPatients((prev) => prev.filter((x) => x.id !== patient.id));
          setPatientDetail(null);
          goHome();
        }}
        canManageAssignment={canManageAssignments}
        canDeletePatient={hasAdminRole}
        canHighlightPatient={Boolean(activeAuthUser)}
        onSendHighlight={async ({ patientId, message, priority, recipientEmail }) =>
          sendPatientHighlight({
            patientId,
            message,
            priority,
            recipientEmail,
          })
        }
        unreadHighlightNote={unreadPatientNotificationMap[normalizePatientId(patient.id)]}
        onMarkHighlightRead={() => dismissPatientHighlights(patient.id)}
        onReplyToHighlight={async (notificationId, message) => {
          await dataClient.replyToNotification(notificationId, { message });
          await dismissPatientHighlights(patient.id);
        }}
        onDocumentsTabActiveChange={setPatientDocumentsTabActive}
        onQuickScheduleSession={async ({ serviceDate, startTime, durationMinutes, modality }) => {
          const startMinutes = parseTimeInput(startTime);
          if (startMinutes == null) return { ok: false, message: "Invalid start time." };
          const endTime = formatTimeValue(startMinutes + durationMinutes);
          return commitPatientBilling({
            patientId: patient.id,
            billingType: "Individual",
            serviceDate,
            startTime,
            endTime,
            totalMinutes: durationMinutes,
            modality,
            naloxoneTraining: false,
            matEducation: false,
          });
        }}
      />
    );
  };

  const dashboardMetrics = useMemo(() => {
    let nextDueReviewDays: number | null = null;
    const dueReview = dashboardScopePatients.filter((patient) => {
      const due = getProblemListDueDates(complianceByPatient[patient.id], patient);
      if (!due?.nextReview) return false;
      const daysUntilReview = dayDiff(currentWeek, due.nextReview);
      if (daysUntilReview < 0 || daysUntilReview > 7) return false;
      if (nextDueReviewDays === null || daysUntilReview < nextDueReviewDays) {
        nextDueReviewDays = daysUntilReview;
      }
      return true;
    }).length;

    const dueUpdate = dashboardScopePatients.filter((patient) => {
      const due = getProblemListDueDates(complianceByPatient[patient.id], patient);
      if (!due) return false;
      const daysUntilUpdate = dayDiff(currentWeek, due.nextUpdate);
      return daysUntilUpdate >= 0 && daysUntilUpdate <= 14;
    }).length;

    const behindAttendance = dashboardScopePatients.filter((patient) => getAttendanceTone(patient, sessions, currentWeek) === "behind").length;

    return {
      totalPatients: dashboardScopePatients.length,
      assignedPatients: caseLoadPatients.length,
      dueReview,
      nextDueReviewDays,
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
          ((note.recipientEmail && note.recipientEmail.toLowerCase() === email) || (note.recipientUserId && note.recipientUserId.toLowerCase() === activeUserId))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 4)
      .map((note) => {
        const normalizedPatientId = note.patientId ? normalizePatientId(note.patientId) : "";
        const patient = patients.find((entry) => normalizePatientId(entry.id) === normalizedPatientId);
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
          ((note.recipientEmail && note.recipientEmail.toLowerCase() === email) || (note.recipientUserId && note.recipientUserId.toLowerCase() === activeUserId))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((note) => {
        const normalizedPatientId = note.patientId ? normalizePatientId(note.patientId) : "";
        const patient = normalizedPatientId
          ? patients.find((entry) => normalizePatientId(entry.id) === normalizedPatientId)
          : null;
        if (!patient) return null;
        return { note, patient };
      })
      .filter((entry): entry is { note: InAppNotification; patient: Patient } => Boolean(entry));
  }, [notifications, patients, hasAdminRole, activeUserEmail, activeUserId]);
  const autoWorkflowHighlightMap = useMemo(() => {
    const next: Record<string, InAppNotification> = {};
    const now = todayIso();

    patients.forEach((patient) => {
      const compliance = complianceByPatient[patient.id];
      const problemListDate = compliance?.problemListDate;
      const treatmentPlanDate = compliance?.treatmentPlanDate;

      const problemListDueDate = getProblemListInitialDueDate(patient);
      const problemListDaysUntilDue = dayDiff(now, problemListDueDate);
      if (!problemListDate && problemListDaysUntilDue <= 1) {
        next[patient.id] = {
          id: `auto-workflow:${patient.id}:problem-list`,
          title: `Patient highlight: ${patient.displayName}`,
          message: "Problem List is due now. Set the Problem List date to clear this urgent highlight.",
          priority: "urgent",
          patientId: patient.id,
          recipientEmail: activeUserEmail,
          recipientUserId: activeUserId,
          senderEmail: "patientfinder",
          createdAt: `${now}T00:00:00.000Z`,
        };
        return;
      }

      if (isTreatmentPlanEnded(patient)) {
        return;
      }

      if (problemListDate && !treatmentPlanDate) {
        const treatmentPlanDueDate = addDaysIso(patient.intakeDate, 30);
        const treatmentPlanDaysUntilDue = dayDiff(now, treatmentPlanDueDate);
        if (treatmentPlanDaysUntilDue <= 1) {
          next[patient.id] = {
            id: `auto-workflow:${patient.id}:treatment-plan`,
            title: `Patient highlight: ${patient.displayName}`,
            message: "Treatment Plan is due now. Set the Treatment Plan date to clear this urgent highlight.",
            priority: "urgent",
            patientId: patient.id,
            recipientEmail: activeUserEmail,
            recipientUserId: activeUserId,
            senderEmail: "patientfinder",
            createdAt: `${now}T00:00:00.000Z`,
          };
        }
      }
    });

    return next;
  }, [patients, complianceByPatient, activeUserEmail, activeUserId]);
  const unreadPatientNotificationMap = useMemo(() => {
    const email = activeUserEmail.toLowerCase();
    const isMine = (note: InAppNotification) =>
      (note.recipientEmail && note.recipientEmail.toLowerCase() === email) ||
      (note.recipientUserId && note.recipientUserId.toLowerCase() === activeUserId);

    const next: Record<string, InAppNotification> = {};
    notifications
      .filter((note) => note.patientId && !note.readAt && isMine(note))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .forEach((note) => {
        const patientId = normalizePatientId(note.patientId);
        if (!next[patientId]) next[patientId] = note;
      });
    Object.entries(autoWorkflowHighlightMap).forEach(([patientId, note]) => {
      next[normalizePatientId(patientId)] = note;
    });
    return next;
  }, [notifications, activeUserEmail, activeUserId, autoWorkflowHighlightMap]);
  const highlightedNotes = hasAdminRole ? adminInboxNotes : counselorSpotlightNotes;
  const highlightThreads = useMemo(
    () => buildHighlightThreads(notifications, patients, activeUserEmail, activeUserId),
    [notifications, patients, activeUserEmail, activeUserId]
  );
  const hasUnreadHighlights = highlightThreads.some((thread) => thread.unreadForMe);

  const showPastPatients = () => {
    setWorkspaceTab("roster");
    setKindFilter("Former Patient");
    setForceRoster(true);
    setCaseLoadOnly(false);
    setSearch("");
    setDashboardFilter(null);
    setDesktopDropdownOpen(null);
    setMobileGlanceOpen(false);
    setMobileSearchOpen(false);
    setMobileMenuOpen(false);
  };

  const applyDashboardFilter = (filter: DashboardFilterKey) => {
    setDashboardFilter((current) => current === filter ? null : filter);
    setWorkspaceTab("roster");
    setMobileGlanceOpen(false);
    setDesktopGlanceOpen(false);
  };

  useEffect(() => {
    if (!results.length) return;
    if (!selectedId && selectionClearedRef.current) return;
    if (!selectedId || !results.some((p) => p.id === selectedId)) setSelectedId(results[0].id);
  }, [results, selectedId]);

  const handleSelectPatient = (id: string | null) => {
    selectionClearedRef.current = id === null;
    setSelectedId(id);
  };

  const goHome = () => {
    setSearch("");
    setDashboardFilter(null);
    setMobileMenuOpen(false);
    setMobileGlanceOpen(false);
    setMobileSearchOpen(false);
    setDesktopDropdownOpen(null);
    setRoute({ name: "home" });
  };

  const openPatient = (id: string) => {
    setSearch("");
    setMobileMenuOpen(false);
    setMobileGlanceOpen(false);
    setMobileSearchOpen(false);
    setDesktopDropdownOpen(null);
    setRoute({ name: "patient", patientId: normalizePatientId(id) });
  };

  const openGroupPdf = async (groupSessionId: string) => {
    setOpeningGroupId(groupSessionId);
    const pdfWindow = window.open("", "_blank");
    if (!pdfWindow) {
      window.alert("Please allow pop-ups to open this PDF.");
      setOpeningGroupId(null);
      return;
    }
    try {
      pdfWindow.opener = null;
    } catch {
      // Ignore browsers that disallow mutating opener.
    }
    try {
      const blob = await dataClient.downloadGroupPdf(groupSessionId);
      const objectUrl = window.URL.createObjectURL(blob);
      pdfWindow.location.href = objectUrl;
      pdfWindow.focus();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      try {
        pdfWindow.close();
      } catch {
        // Ignore best-effort cleanup errors.
      }
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
    clearAzureApiDocumentBlobCache();
    if (isEntraMode) {
      await azureAuth.logout();
      return;
    }
    setAzureDemoSession(null);
    goHome();
    setSearch("");
    setForceRoster(false);
    setCaseLoadOnly(true);
    lockWorkspace();
  };

  const unlockWorkspaceAndReset = () => {
    setMobileMenuOpen(false);
    setMobileGlanceOpen(false);
    setMobileSearchOpen(false);
    openWorkspace();
  };

  useEffect(() => {
    const clearCache = () => clearAzureApiDocumentBlobCache();
    window.addEventListener("beforeunload", clearCache);
    return () => window.removeEventListener("beforeunload", clearCache);
  }, []);

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

  const clearCaseAssignment = async (patientId: string) => {
    const previousAssigned = caseAssignments[patientId];
    const previousEmail = caseAssignmentEmails[patientId];
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
    try {
      await dataClient.clearCaseAssignment(patientId);
    } catch (error) {
      setCaseAssignments((prev) =>
        previousAssigned ? { ...prev, [patientId]: previousAssigned } : prev
      );
      setCaseAssignmentEmails((prev) =>
        previousEmail ? { ...prev, [patientId]: previousEmail } : prev
      );
      throw error;
    }
  };

  const assignCaseToCounselor = async (patientId: string, counselorEmail: string) => {
    const normalizedEmail = counselorEmail.trim().toLowerCase();
    if (!normalizedEmail) return;
    const selected = counselorAssignmentOptions.find((option) => option.email === normalizedEmail);
    const assignedCounselorId =
      normalizedEmail === activeUserEmail.toLowerCase()
        ? counselorId
        : (selected?.userId ?? normalizedEmail);

    const previousAssigned = caseAssignments[patientId];
    const previousEmail = caseAssignmentEmails[patientId];
    setCaseAssignments((prev) => ({ ...prev, [patientId]: assignedCounselorId }));
    setCaseAssignmentEmails((prev) => ({ ...prev, [patientId]: normalizedEmail }));
    try {
      await dataClient.saveCaseAssignment(patientId, {
        counselor_user_id: assignedCounselorId,
        counselor_email: normalizedEmail,
      });
    } catch (error) {
      setCaseAssignments((prev) => {
        const next = { ...prev };
        if (previousAssigned) {
          next[patientId] = previousAssigned;
        } else {
          delete next[patientId];
        }
        return next;
      });
      setCaseAssignmentEmails((prev) => {
        const next = { ...prev };
        if (previousEmail) {
          next[patientId] = previousEmail;
        } else {
          delete next[patientId];
        }
        return next;
      });
      throw error;
    }
  };

  const openCaseAssignmentModal = (patientId: string) => {
    if (!canManageAssignments) return;
    const patient = patients.find((row) => row.id === patientId) ?? patientDetail;
    if (!patient) return;
    const assignedEmail =
      caseAssignmentEmails[patientId] ??
      (caseAssignments[patientId]?.includes("@") ? caseAssignments[patientId] : "");
    setCaseAssignmentTarget({
      patientId,
      patientName: patient.displayName,
      currentCounselorEmail: assignedEmail,
    });
  };

  const updateCompliance = async (patientId: string, patch: CompliancePatch) => {
    const normalizedPatientId = normalizePatientId(patientId);
    const normalizedPatch = { ...patch };
    const resetProblemListCycle = Boolean(normalizedPatch.resetProblemListCycle);
    delete normalizedPatch.resetProblemListCycle;
    if (normalizedPatch.treatmentPlanCycleDays != null) {
      normalizedPatch.treatmentPlanCycleDays = normalizedPatch.treatmentPlanCycleDays === 180 ? 180 : 90;
      setStoredTreatmentPlanCycleDays(normalizedPatientId, normalizedPatch.treatmentPlanCycleDays);
    }
    if (resetProblemListCycle) {
      normalizedPatch.problemListDate = undefined;
      normalizedPatch.lastProblemListReview = undefined;
      normalizedPatch.lastProblemListUpdate = undefined;
    }
    // Completing an update resets the corresponding original anchor date.
    if (normalizedPatch.lastProblemListUpdate && !normalizedPatch.problemListDate) {
      normalizedPatch.problemListDate = normalizedPatch.lastProblemListUpdate;
    }
    if (normalizedPatch.lastTreatmentPlanUpdate && !normalizedPatch.treatmentPlanDate) {
      normalizedPatch.treatmentPlanDate = normalizedPatch.lastTreatmentPlanUpdate;
    }
    const previous = complianceByPatient[normalizedPatientId] ?? complianceByPatient[patientId] ?? {};
    // If the problem list anchor date changes, start a fresh 30/60 review cycle unless caller explicitly sets review.
    if (
      normalizedPatch.problemListDate &&
      normalizedPatch.problemListDate !== previous.problemListDate &&
      !Object.prototype.hasOwnProperty.call(normalizedPatch, "lastProblemListReview")
    ) {
      normalizedPatch.lastProblemListReview = undefined;
    }
    // If treatment plan anchor changes, reset update anchor unless caller explicitly provides update date.
    if (
      normalizedPatch.treatmentPlanDate &&
      normalizedPatch.treatmentPlanDate !== previous.treatmentPlanDate &&
      !Object.prototype.hasOwnProperty.call(normalizedPatch, "lastTreatmentPlanUpdate")
    ) {
      normalizedPatch.lastTreatmentPlanUpdate = undefined;
    }
    const next = normalizeComplianceDates({ ...previous, ...normalizedPatch });
    setComplianceByPatient((prev) => ({ ...prev, [normalizedPatientId]: next }));
    const payload = {
      patient_id: normalizedPatientId,
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
    try {
      const saved = await dataClient.saveCompliance(normalizedPatientId, payload) as any;
      if (saved && typeof saved === "object") {
        const canonical: PatientCompliance = normalizeComplianceDates({
          drugTestMode: saved.drug_test_mode ?? next.drugTestMode ?? "none",
          drugTestsPerWeek: saved.drug_tests_per_week ?? next.drugTestsPerWeek ?? undefined,
          drugTestWeekday: saved.drug_test_weekday != null ? String(saved.drug_test_weekday) : (next.drugTestWeekday ?? undefined),
          problemListDate: saved.problem_list_date ?? next.problemListDate ?? undefined,
          lastProblemListReview: saved.last_problem_list_review ?? next.lastProblemListReview ?? undefined,
          lastProblemListUpdate: saved.last_problem_list_update ?? next.lastProblemListUpdate ?? undefined,
          treatmentPlanDate: saved.treatment_plan_date ?? next.treatmentPlanDate ?? undefined,
          lastTreatmentPlanUpdate: saved.treatment_plan_update ?? next.lastTreatmentPlanUpdate ?? undefined,
          treatmentPlanCycleDays: next.treatmentPlanCycleDays ?? previous.treatmentPlanCycleDays ?? 90,
        });
        setComplianceByPatient((prev) => ({ ...prev, [normalizedPatientId]: canonical }));
        const changedReview = Boolean(canonical.lastProblemListReview && canonical.lastProblemListReview !== previous.lastProblemListReview);
        const changedUpdate = Boolean(canonical.lastProblemListUpdate && canonical.lastProblemListUpdate !== previous.lastProblemListUpdate);
        const changedTxUpdate = Boolean(canonical.lastTreatmentPlanUpdate && canonical.lastTreatmentPlanUpdate !== previous.lastTreatmentPlanUpdate);
        const changedProblemListDate = Boolean(canonical.problemListDate && canonical.problemListDate !== previous.problemListDate);
        const changedTxDate = Boolean(canonical.treatmentPlanDate && canonical.treatmentPlanDate !== previous.treatmentPlanDate);
        const autoBilling: Array<{ when: string; kind: BillingType }> = [];
        if (changedReview) autoBilling.push({ when: canonical.lastProblemListReview as string, kind: "Problem List Review" });
        if (changedUpdate) autoBilling.push({ when: canonical.lastProblemListUpdate as string, kind: "Problem List Update" });
        if (changedTxUpdate) autoBilling.push({ when: canonical.lastTreatmentPlanUpdate as string, kind: "Treatment Plan Update" });
        if (changedProblemListDate && !changedUpdate) autoBilling.push({ when: canonical.problemListDate as string, kind: "Problem List" });
        if (changedTxDate && !changedTxUpdate) autoBilling.push({ when: canonical.treatmentPlanDate as string, kind: "Treatment Plan" });
        for (const entry of autoBilling) {
          await commitPatientBilling({
            patientId: normalizedPatientId,
            billingType: entry.kind,
            serviceDate: entry.when,
            startTime: "09:00",
            endTime: "10:00",
            totalMinutes: 60,
            modality: "FF",
            naloxoneTraining: false,
            matEducation: false,
          });
        }
      }
    } catch (error) {
      setComplianceByPatient((prev) => ({ ...prev, [normalizedPatientId]: previous }));
      console.error("Unable to persist compliance update:", error);
      window.alert("Could not save compliance date update. Please try again.");
    }
  };

  const updateRosterDetails = async (patientId: string, patch: Partial<PatientRosterDetails>) => {
    const patient = patients.find((row) => row.id === patientId);
    if (!patient) return;

    const asAllowed = <T extends string>(value: string | undefined, allowed: readonly T[]) =>
      value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

    const previousRoster = patient.rosterDetails ?? {};
    const next = { ...(patient.rosterDetails ?? {}), ...patch };
    const payload = {
      patient_id: patientId,
      drug_of_choice: next.drugOfChoice?.length ? next.drugOfChoice : null,
      medical_phys_apt: asAllowed(next.medicalPhysApt, MEDICAL_PHYS_APT_OPTS) ?? null,
      med_form_status: asAllowed(next.medFormStatus, MED_FORM_OPTS) ?? null,
      notes: next.notes ?? null,
      referring_agency: asAllowed(next.referringAgency, REFERRING_AGENCY_OPTS) ?? null,
      reauth_sapc_date: next.reauthSapcDate ?? null,
      medical_eligibility: asAllowed(next.medicalEligibility, MEDICAL_ELIGIBILITY_OPTS) ?? null,
      mat_status: asAllowed(next.matStatus, MAT_STATUS_OPTS) ?? null,
      therapy_track: asAllowed(next.therapyTrack, THERAPY_OPTS) ?? null,
      updated_by: activeUserId || null,
    };
    setPatients((prev) => prev.map((row) => (row.id === patientId ? { ...row, rosterDetails: next } : row)));
    try {
      await dataClient.saveRosterDetails(patientId, payload);
    } catch (error) {
      setPatients((prev) => prev.map((row) => (row.id === patientId ? { ...row, rosterDetails: previousRoster } : row)));
      console.error("Unable to persist roster details:", error);
      window.alert("Could not save roster details. Please try again.");
    }
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

    await withTimeout(
      dataClient.createNotification(insertPayload),
      15000,
      "Notification request timed out. Please try again."
    );
    return true;
  };

  const sendPatientHighlight = async (payload: {
    patientId: string;
    message: string;
    priority: "normal" | "urgent";
    recipientEmail?: string;
  }) => {
    const assignedEmail = payload.recipientEmail?.trim().toLowerCase() || "";

    if (!assignedEmail) {
      window.alert("Choose a recipient before sending a highlight.");
      return false;
    }

    const patient = patients.find((entry) => entry.id === payload.patientId);
    if (!patient) return false;

    try {
      const sent = await sendNotification({
        recipientEmail: assignedEmail,
        patientId: payload.patientId,
        title: `Patient highlight: ${patient.displayName}`,
        message: payload.message,
        priority: payload.priority,
      });
      if (sent) {
        const normalizedPatientId = normalizePatientId(payload.patientId);
        setHighlightedPatientIds((prev) => ({
          ...prev,
          [normalizedPatientId]: payload.priority === "urgent" ? "urgent" : "normal",
        }));
        window.alert(`Highlight sent to ${assignedEmail}.`);
      }
      return sent;
    } catch (error) {
      console.error("Unable to send highlight notification:", error);
      window.alert(getRequestErrorMessage(error, "Could not send highlight right now. Please try again."));
      return false;
    }
  };

  const dismissNotification = async (notificationId: string) => {
    await dataClient.markNotificationRead(notificationId);
    const now = new Date().toISOString();
    setNotifications((prev) => {
      const next = prev.map((note) => (note.id === notificationId ? { ...note, readAt: note.readAt ?? now } : note));
      setHighlightedPatientIds(buildHighlightMap(next));
      return next;
    });
  };

  const dismissPatientHighlights = async (patientId: string) => {
    const normalizedPatientId = normalizePatientId(patientId);
    const targetIds = notifications
      .filter(
        (note) =>
          !note.readAt &&
          note.patientId &&
          normalizePatientId(note.patientId) === normalizedPatientId &&
          /^Patient highlight:/i.test(note.title)
      )
      .map((note) => note.id);
    if (!targetIds.length) return;

    const snapshot = notifications;
    const now = new Date().toISOString();
    const targetSet = new Set(targetIds);
    setNotifications((prev) => {
      const next = prev.map((note) => (targetSet.has(note.id) ? { ...note, readAt: note.readAt ?? now } : note));
      setHighlightedPatientIds(buildHighlightMap(next));
      return next;
    });
    try {
      await Promise.all(targetIds.map((id) => dataClient.markNotificationRead(id)));
    } catch (error) {
      setNotifications(snapshot);
      setHighlightedPatientIds(buildHighlightMap(snapshot));
      throw error;
    }
  };

  const markHighlightThreadRead = async (notificationId: string) => {
    const root = notifications.find((note) => note.id === notificationId);
    if (!root) return;
    const threadId = root.threadId ?? root.id;
    const targetIds = notifications
      .filter((note) => (note.threadId ?? note.id) === threadId && !note.readAt)
      .map((note) => note.id);
    if (!targetIds.length) return;
    const snapshot = notifications;
    const now = new Date().toISOString();
    const targetSet = new Set(targetIds);
    setNotifications((prev) => {
      const next = prev.map((note) => (targetSet.has(note.id) ? { ...note, readAt: note.readAt ?? now } : note));
      setHighlightedPatientIds(buildHighlightMap(next));
      return next;
    });
    try {
      await Promise.all(targetIds.map((id) => dataClient.markNotificationRead(id)));
    } catch (error) {
      setNotifications(snapshot);
      setHighlightedPatientIds(buildHighlightMap(snapshot));
      throw error;
    }
  };

  const replyToNotification = async (notificationId: string, message: string) => {
    await dataClient.replyToNotification(notificationId, { message });
    await dismissNotification(notificationId);
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
      <div
        className={
          lockCanvasScroll
            ? isMobileWorkspace && privacyLocked
              ? "page workspacePage mobileLocked"
              : "page workspacePage"
            : "page workspacePage canvasScrollEnabled"
        }
      >
        <WorkspaceShell
          isMobileWorkspace={isMobileWorkspace}
          privacyLocked={privacyLocked}
          lockJokeText={lockJokeText}
          lockWorkspace={lockWorkspace}
          unlockWorkspace={unlockWorkspaceAndReset}
          desktopMenuOpen={desktopMenuOpen}
          setDesktopMenuOpen={setDesktopMenuOpen}
          hasUnreadHighlights={hasUnreadHighlights}
          setShowNotificationComposer={setShowNotificationComposer}
          setShowAddPatient={setShowAddPatient}
          counselorLabel={counselorLabel}
          canManageRosterScope={canManageRosterScope}
          canManagePatients={canManagePatients}
          hasAdminRole={hasAdminRole}
          forceRoster={forceRoster}
          caseLoadOnly={caseLoadOnly}
          kindFilter={kindFilter}
          setWorkspaceTab={setWorkspaceTab}
          setKindFilter={setKindFilter}
          setCaseLoadOnly={setCaseLoadOnly}
          setForceRoster={setForceRoster}
          setSearch={setSearch}
          showPastPatients={showPastPatients}
          logout={logout}
          setRoute={setRoute}
          setMobileDashboardScale={setMobileDashboardScale}
        >
          <>
                {isMobileWorkspace && mobileMenuOpen ? (
                  <section className="workspaceMobileMenuCard">
                    <div className="workspaceMobileMenuGrid">
                      <div className="workspaceMobileScaleRow">
                        <button
                          className="workspaceMobileScaleBtn"
                          onClick={() => setMobileDashboardScale((scale) => Math.min(1.25, Number((scale + 0.05).toFixed(2))))}
                          title="Increase font size"
                          aria-label="Increase font size"
                        >
                          +
                        </button>
                        <button
                          className="workspaceMobileScaleBtn"
                          onClick={() => setMobileDashboardScale((scale) => Math.max(0.85, Number((scale - 0.05).toFixed(2))))}
                          title="Decrease font size"
                          aria-label="Decrease font size"
                        >
                          -
                        </button>
                        <button
                          className="workspaceMobileScaleBtn ghost"
                          onClick={() => setMobileDashboardScale(1)}
                          title="Reset font size"
                          aria-label="Reset font size"
                        >
                          Reset
                        </button>
                      </div>
                      <button
                        className={hasUnreadHighlights ? "workspaceActionBtn workspaceActionBtnGlow" : "workspaceActionBtn"}
                        onClick={() => {
                          setShowNotificationComposer(true);
                          setMobileMenuOpen(false);
                        }}
                      >
                        Highlights
                      </button>
                      <button
                        className={!forceRoster && caseLoadOnly ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                        onClick={() => {
                          setWorkspaceTab("roster");
                          setKindFilter("all");
                          setCaseLoadOnly(true);
                          setForceRoster(false);
                          setSearch("");
                          setMobileMenuOpen(false);
                        }}
                      >
                        {counselorLabel} case load
                      </button>
                      {canManageRosterScope ? (
                        <button
                          className={forceRoster ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                          onClick={() => {
                            setWorkspaceTab("roster");
                            setKindFilter("all");
                            setForceRoster(true);
                            setCaseLoadOnly(false);
                            setSearch("");
                            setMobileMenuOpen(false);
                          }}
                        >
                          Full roster
                        </button>
                      ) : null}
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setRoute({ name: "groups" });
                          setMobileMenuOpen(false);
                        }}
                      >
                        Groups
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
                        className={kindFilter === "Former Patient" ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                        onClick={showPastPatients}
                      >
                        Past patients
                      </button>
                      {canManagePatients ? (
                        <button
                          className="workspaceActionBtn"
                          onClick={() => {
                            setShowAddPatient(true);
                            setMobileMenuOpen(false);
                          }}
                        >
                          Add patient
                        </button>
                      ) : null}
                      <button
                        className="workspaceActionBtn"
                        onClick={() => {
                          setRoute({ name: "mobile" });
                          setMobileMenuOpen(false);
                        }}
                      >
                        Mobile
                      </button>
                      {hasAdminRole ? (
                        <button
                          className="workspaceActionBtn"
                          onClick={() => {
                            setRoute({ name: "patientbridge" });
                            setMobileMenuOpen(false);
                          }}
                        >
                          patientbridge
                        </button>
                      ) : null}
                      <button className="workspaceActionBtn" onClick={logout}>
                        Logout
                      </button>
                    </div>
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
                        <small>{dashboardFilter === "dueReview" ? "Showing matching patients" : formatDueDaysLabel(dashboardMetrics.nextDueReviewDays, "No upcoming reviews")}</small>
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
                      <small>{dashboardFilter === "dueReview" ? "Showing matching patients" : formatDueDaysLabel(dashboardMetrics.nextDueReviewDays, "No upcoming reviews")}</small>
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
                  <section
                    className={
                      lockCanvasScroll
                        ? `workspaceBoard viewportLocked${view === "split" ? " splitMode" : ""}`
                        : "workspaceBoard"
                    }
                    style={
                      {
                        ["--mobile-dashboard-scale" as any]: mobileDashboardScale,
                        transform: `scale(${mobileDashboardScale})`,
                        transformOrigin: "top left",
                        width: `calc(100% / ${mobileDashboardScale})`,
                      } as any
                    }
                  >
                    {(isMobileWorkspace ? mobileSearchOpen : true) ? (
                      <div className="workspaceFilters">
                        <div className={!isMobileWorkspace ? "workspaceSearchControls" : undefined}>
                        <div className="workspaceSearchWrap">
                          <input
                            ref={desktopSearchInputRef}
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
                            placeholder="Search by patient, sage ID, date, drug test, anything!"
                          />
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

                        <div className={!isMobileWorkspace ? "workspaceFilterRow workspaceFilterRowRight" : "workspaceFilterRow workspaceFilterRowRight workspaceMobileFilterRow"}>
                          {!isMobileWorkspace ? (
                            <>
                              <div className="dropdownAnchor" ref={desktopStatusDropdownRef}>
                                <button
                                  className={desktopDropdownOpen === "status" ? "btn ghost workspaceGlanceBtn active" : "btn ghost workspaceGlanceBtn"}
                                  onClick={() => setDesktopDropdownOpen((current) => (current === "status" ? null : "status"))}
                                  title={`Status: ${kindFilter}`}
                                  aria-label={`Status: ${kindFilter}`}
                                >
                                  <span className="diamondCtrlGlyph" aria-hidden="true"><StatusDiamondIcon /></span>
                                </button>
                                {desktopDropdownOpen === "status" ? (
                                  <div className="diamondMenu">
                                    <button className={kindFilter === "all" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("all"); setDesktopDropdownOpen(null); }}>All statuses</button>
                                    <button className={kindFilter === "New Patient" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("New Patient"); setDesktopDropdownOpen(null); }}>New (0-20 days)</button>
                                    <button className={kindFilter === "Current Patient" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("Current Patient"); setDesktopDropdownOpen(null); }}>Current patients</button>
                                    <button className={kindFilter === "RSS+" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("RSS+"); setDesktopDropdownOpen(null); }}>RSS+</button>
                                    <button className={kindFilter === "RSS" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("RSS"); setDesktopDropdownOpen(null); }}>RSS</button>
                                    <button className={kindFilter === "Former Patient" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("Former Patient"); setDesktopDropdownOpen(null); }}>Former patients</button>
                                    <button className={kindFilter === "Former Recent" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("Former Recent"); setDesktopDropdownOpen(null); }}>Former (0-90 days)</button>
                                    <button className={kindFilter === "Former Archived" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setKindFilter("Former Archived"); setDesktopDropdownOpen(null); }}>Former (90+ days)</button>
                                  </div>
                                ) : null}
                              </div>

                              <div className="dropdownAnchor" ref={desktopSortDropdownRef}>
                                <button
                                  className={desktopDropdownOpen === "sort" ? "btn ghost workspaceGlanceBtn active" : "btn ghost workspaceGlanceBtn"}
                                  onClick={() => setDesktopDropdownOpen((current) => (current === "sort" ? null : "sort"))}
                                  title={`Sort by: ${sortKey}`}
                                  aria-label={`Sort by: ${sortKey}`}
                                >
                                  <span className="diamondCtrlGlyph" aria-hidden="true"><SortDiamondIcon /></span>
                                </button>
                                {desktopDropdownOpen === "sort" ? (
                                  <div className="diamondMenu">
                                    <button className="diamondMenuItem" onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setDesktopDropdownOpen(null); }}>
                                      Direction: {sortDir === "asc" ? "Ascending" : "Descending"}
                                    </button>
                                    <button className={sortKey === "name" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setSortKey("name"); setDesktopDropdownOpen(null); }}>Sort by name</button>
                                    <button className={sortKey === "intake" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setSortKey("intake"); setDesktopDropdownOpen(null); }}>Sort by intake date</button>
                                    <button className={sortKey === "lastVisit" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setSortKey("lastVisit"); setDesktopDropdownOpen(null); }}>Sort by last visit</button>
                                    <button className={sortKey === "kind" ? "diamondMenuItem on" : "diamondMenuItem"} onClick={() => { setSortKey("kind"); setDesktopDropdownOpen(null); }}>Sort by status</button>
                                  </div>
                                ) : null}
                              </div>
                              <div className="workspaceViewDiamondGroup" aria-label="View mode">
                                <button
                                  className={view === "sheet" ? "btn ghost workspaceGlanceBtn active" : "btn ghost workspaceGlanceBtn"}
                                  onClick={() => setView("sheet")}
                                  title="Live table view"
                                  aria-label="Live table view"
                                >
                                  <span className="diamondCtrlGlyph" aria-hidden="true"><SheetDiamondIcon /></span>
                                </button>
                              </div>
                              <div className="workspaceResultsCount">
                                {results.length} visible • {patientTotal} total
                              </div>
                              <button
                                className={desktopGlanceOpen ? "btn ghost workspaceGlanceBtn active" : "btn ghost workspaceGlanceBtn"}
                                onClick={() => setDesktopGlanceOpen((open) => !open)}
                                title="At a glance"
                                aria-label="At a glance"
                              >
                                <span className="diamondCtrlGlyph" aria-hidden="true"><MobileGlanceIcon /></span>
                              </button>
                            </>
                          ) : null}

                          {isMobileWorkspace ? (
                            <>
                            </>
                          ) : null}

                          {hasCounselorRole && !hasAdminRole ? (
                            <button className="btn ghost" onClick={() => setCounselorThinList((current) => !current)} title={counselorThinList ? "Thin list on" : "Thin list off"} aria-label={counselorThinList ? "Thin list on" : "Thin list off"}>
                              {counselorThinList ? "≣" : "≡"}
                            </button>
                          ) : null}

                        </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="workspaceContentGrid singleColumn">
                      {loadError ? (
                        <div className="workspaceLoadError" role="status">
                          {loadError}
                        </div>
                      ) : null}
                      <SearchResults
                        view={view}
                        rows={results}
                        sessions={sessions}
                        complianceByPatient={complianceByPatient}
                        caseAssignments={caseAssignments}
                        counselorId={counselorId}
                        onUpdateCompliance={updateCompliance}
                        onUpdateRosterDetails={updateRosterDetails}
                        selectedId={selectedId}
                        onSelect={handleSelectPatient}
                        onOpen={openPatient}
                        onShiftHighlight={(patient) =>
                          setHighlightTarget({
                            patientId: patient.id,
                            patientName: patient.displayName,
                            recipientEmail:
                              caseAssignmentEmails[patient.id] ??
                              (caseAssignments[patient.id]?.includes("@") ? caseAssignments[patient.id] : "") ??
                              "",
                          })
                        }
                        selected={selected}
                        isAdminView={hasAdminRole || counselorThinList}
                        highlightedPatientIds={highlightedPatientIds}
                        renderPatientSheet={renderSplitPatientSheet}
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
                        (() => {
                          const highlightTone = highlightedPatientIds[normalizePatientId(patient.id)];
                          const highlightClass =
                            highlightTone === "urgent"
                              ? " highlightRingUrgent"
                              : highlightTone === "normal"
                                ? " highlightRingNormal"
                                : "";
                          return (
                        <button
                          key={note.id}
                          className={`workspaceAgendaItem workspaceAgendaNoteItem${highlightClass}`}
                          onClick={() => openPatient(patient.id)}
                        >
                          <div className="workspaceAgendaTop">
                            <strong>{patient.displayName}</strong>
                            <div className="workspaceAgendaNoteActions">
                              <span className={`workspaceTone ${note.priority === "urgent" ? "behind" : "neutral"}`}>
                                {(note.senderEmail ?? "").toLowerCase() === activeUserEmail.toLowerCase() ||
                                (note.senderUserId ?? "").toLowerCase() === activeUserId
                                  ? "Sent highlight"
                                  : "Highlight"}
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
                          );
                        })()
                      ))}
                      {agendaRows.map(({ patient, item }) => (
                        <button
                          key={item.id}
                          className={
                            highlightedPatientIds[normalizePatientId(patient.id)] === "urgent"
                              ? "workspaceAgendaItem highlightRingUrgent"
                              : highlightedPatientIds[normalizePatientId(patient.id)] === "normal"
                                ? "workspaceAgendaItem highlightRingNormal"
                                : "workspaceAgendaItem"
                          }
                          onClick={() => openPatient(patient.id)}
                        >
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
                          No urgent items right now. Open the roster tab to review patients or search the full list.
                        </div>
                      ) : null}
                    </div>
                  </section>
                )}
              </>

        {showAddPatient && canManagePatients && (
          <AddPatientModal
            dataClient={dataClient}
            counselorOptions={counselorAssignmentOptions}
            onClose={() => setShowAddPatient(false)}
            onAdded={(p) => {
              setPatients((prev) => [p, ...prev]);
              setShowAddPatient(false);
            }}
          />
        )}
        {caseAssignmentTarget && canManageAssignments ? (
          <CaseAssignmentModal
            patientName={caseAssignmentTarget.patientName}
            currentCounselorEmail={caseAssignmentTarget.currentCounselorEmail}
            counselorOptions={counselorAssignmentOptions}
            onClose={() => setCaseAssignmentTarget(null)}
            onSave={async (payload) => {
              try {
                if (!payload.counselorEmail) {
                  await clearCaseAssignment(caseAssignmentTarget.patientId);
                } else {
                  await assignCaseToCounselor(caseAssignmentTarget.patientId, payload.counselorEmail);
                }
                setCaseAssignmentTarget(null);
              } catch (error) {
                console.error("Unable to update case assignment:", error);
                window.alert("Could not update case assignment right now.");
              }
            }}
          />
        ) : null}
        {showNotificationComposer && (
          <NotificationComposerModal
            notifications={notifications}
            patients={patients}
            recipients={counselorAssignmentOptions}
            currentUserEmail={activeUserEmail}
            currentUserId={activeUserId}
            onClose={() => setShowNotificationComposer(false)}
            onSendHighlight={async (payload) => {
              const ok = await sendPatientHighlight(payload);
              if (ok) setShowNotificationComposer(false);
            }}
            onReplyToThread={async (notificationId, message) => {
              await replyToNotification(notificationId, message);
            }}
            onMarkThreadRead={async (notificationId) => {
              await markHighlightThreadRead(notificationId);
            }}
            onDeleteThread={async (notificationId) => {
              await dataClient.deleteNotificationThread(notificationId);
              setNotifications((prev) => {
                const targetThreadId = prev.find((entry) => entry.id === notificationId)?.threadId ?? notificationId;
                const next = prev.filter((note) => (note.threadId ?? note.id) !== targetThreadId);
                setHighlightedPatientIds(buildHighlightMap(next));
                return next;
              });
            }}
            onOpenPatient={openPatient}
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
        {highlightTarget ? (
          <PatientHighlightModal
            patientId={highlightTarget.patientId}
            patientName={highlightTarget.patientName}
            patients={patients}
            counselorOptions={counselorAssignmentOptions}
            currentUserEmail={activeUserEmail}
            defaultRecipientEmail={
              (highlightTarget.patientId
                ? caseAssignmentEmails[highlightTarget.patientId] ??
                  (caseAssignments[highlightTarget.patientId]?.includes("@") ? caseAssignments[highlightTarget.patientId] : "") ??
                  highlightTarget.recipientEmail ??
                  ""
                : highlightTarget.recipientEmail ?? "")
            }
            onClose={() => setHighlightTarget(null)}
            onSend={async ({ patientId, message, priority, recipientEmail }) => {
              const ok = await sendPatientHighlight({
                patientId,
                message,
                priority,
                recipientEmail,
              });
              if (ok) setHighlightTarget(null);
            }}
          />
        ) : null}
        </WorkspaceShell>
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  if (route.name === "mobile") {
    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={goHome}>
            ←
          </button>
          <div className="count">Mobile setup</div>
          <button className="btn ghost" onClick={logout}>
            ↪
          </button>
        </div>

        <div className="panel mobileSupportPanel">
          <div className="panelHead">Mobile setup and install</div>
          <div className="panelBody mobileSupportBody">
            <section className="mobileSupportSection">
              <h3 className="mobileSupportTitle">Android scanner app</h3>
              {documentScannerInstallUrl ? (
                <>
                  <div className="mobileSupportText">
                    This is a separate Android scanner app for document capture and upload only. It is not the patientfinder Home Screen app.
                  </div>
                  <div className="mobileSupportActions">
                    <button
                      className="btn"
                      onClick={() => window.open(documentScannerInstallUrl, "_blank", "noopener,noreferrer")}
                    >
                      Download scanner (Android)
                    </button>
                    <button
                      className="btn ghost"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(documentScannerInstallUrl);
                          window.alert("Install link copied.");
                        } catch {
                          window.alert("Could not copy automatically. Open link and copy from browser.");
                        }
                      }}
                    >
                      Copy install link
                    </button>
                  </div>
                </>
              ) : (
                <div className="mobileSupportText">
                  Android scanner link is not configured for this environment yet.
                </div>
              )}
            </section>

            <section className="mobileSupportSection">
              <h3 className="mobileSupportTitle">iPhone Home Screen app (patientfinder)</h3>
              <div className="mobileSupportText">
                This installs patientfinder from Safari to your iPhone Home Screen. Use this for patientfinder access, not document scanning.
              </div>
              <ol className="mobileSupportList">
                <li>Open patientfinder in Safari.</li>
                <li>Tap the Share button (square with an up arrow).</li>
                <li>Select Add to Home Screen.</li>
                <li>Rename it if you want, then tap Add.</li>
              </ol>
            </section>
          </div>
        </div>
        <ThemePicker theme={theme} setTheme={applyTheme} />
      </div>
    );
  }

  if (route.name === "patientbridge") {
    return (
      <div className="page patientBridgePage">
        <PatientBridgeWorkbookPage
          patients={directoryPatients}
          onRefreshPatients={() => void loadPatientDirectory()}
          onBackToPatientFinder={goHome}
          onOpenPatient={openPatient}
          onHighlightPatient={({ patientId, patientName, recipientEmail }) => setHighlightTarget({ patientId, patientName, recipientEmail })}
        />
        {highlightTarget ? (
          <PatientHighlightModal
            patientId={highlightTarget.patientId}
            patientName={highlightTarget.patientName}
            patients={directoryPatients.length ? directoryPatients : patients}
            counselorOptions={counselorAssignmentOptions}
            currentUserEmail={activeUserEmail}
            defaultRecipientEmail={highlightTarget.recipientEmail ?? ""}
            onClose={() => setHighlightTarget(null)}
            onSend={async ({ patientId, message, priority, recipientEmail }) => {
              const ok = await sendPatientHighlight({
                patientId,
                message,
                priority,
                recipientEmail,
              });
              if (ok) setHighlightTarget(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  /* ---------- ATTENDANCE ---------- */
  if (route.name === "attendance") {
    return (
      <div className="page">
        <div className="topRow">
          <button className="btn" onClick={goHome}>
            ←
          </button>
          <div className="count">Visits & tests entries: {sessions.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            Billing sheet
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "groups" })}>
            Groups
          </button>
          <button className="btn ghost" onClick={logout}>
            ↪
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
          <button className="btn" onClick={goHome}>
            ←
          </button>
          <div className="count">Billing entries: {billingEntries.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            📋
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "groups" })}>
            Groups
          </button>
          <button className="btn ghost" onClick={logout}>
            ↪
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
          <button className="btn" onClick={goHome}>
            ←
          </button>
          <div className="count">Group sessions: {groupSessions.length}</div>
          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            📋
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            $
          </button>
          <button className="btn ghost" onClick={logout}>
            ↪
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
    const patientCompliance =
      p ? complianceByPatient[normalizePatientId(p.id)] ?? complianceByPatient[p.id] : undefined;

    return (
      <div className="page patientRoutePage">
        <div className="topRow patientRouteTopRow">
          <button className="btn" onClick={goHome}>
            ←
          </button>

          <button className="btn ghost" onClick={() => setRoute({ name: "attendance" })}>
            📋
          </button>
          <button className="btn ghost" onClick={() => setRoute({ name: "billing" })}>
            $
          </button>

          <button className="btn ghost" onClick={logout}>
            ↪
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
            patientOptions={patients}
            currentUserEmail={activeUserEmail}
            counselorOptions={counselorAssignmentOptions}
            allSessions={sessions}
            dataClient={dataClient}
            hasAssignment={Boolean(caseAssignments[p.id] || caseAssignmentEmails[p.id])}
            isAssignedToMe={caseAssignments[p.id] === counselorId}
            assignedCounselorEmail={
              caseAssignmentEmails[p.id] ??
              (caseAssignments[p.id]?.includes("@") ? caseAssignments[p.id] : "")
            }
            assignedCounselorLabel={
              (() => {
                const email = caseAssignmentEmails[p.id] ?? (caseAssignments[p.id]?.includes("@") ? caseAssignments[p.id] : "");
                if (!email) return undefined;
                return counselorLabelByEmail[email] ?? email;
              })()
            }
            compliance={patientCompliance}
            onAssignCase={() => openCaseAssignmentModal(p.id)}
            onClearAssignment={() => void clearCaseAssignment(p.id)}
            onUpdateCompliance={(patch) => updateCompliance(p.id, patch)}
            onUpdateRosterDetails={(patch) => updateRosterDetails(p.id, patch)}
            onUpdatePatient={(next) => {
              const normalizedNextId = normalizePatientId(next.id);
              setPatients((prev) => prev.map((x) => (normalizePatientId(x.id) === normalizedNextId ? { ...x, ...next, id: x.id } : x)));
              setPatientDetail((current) => (current && normalizePatientId(current.id) === normalizedNextId ? { ...current, ...next, id: current.id } : current));
            }}
            onDeletePatient={() => {
              setPatients((prev) => prev.filter((x) => x.id !== p.id));
              setPatientDetail(null);
              goHome();
            }}
            canManageAssignment={canManageAssignments}
            canDeletePatient={hasAdminRole}
            canHighlightPatient={Boolean(activeAuthUser)}
            onSendHighlight={async ({ patientId, message, priority, recipientEmail }) =>
              sendPatientHighlight({
                patientId,
                message,
                priority,
                recipientEmail,
              })
            }
            unreadHighlightNote={unreadPatientNotificationMap[normalizePatientId(p.id)]}
            onMarkHighlightRead={() => dismissPatientHighlights(p.id)}
            onReplyToHighlight={async (notificationId, message) => {
              await dataClient.replyToNotification(notificationId, { message });
              await dismissPatientHighlights(p.id);
            }}
            onDocumentsTabActiveChange={setPatientDocumentsTabActive}
            onQuickScheduleSession={async ({ serviceDate, startTime, durationMinutes, modality }) => {
              const startMinutes = parseTimeInput(startTime);
              if (startMinutes == null) return { ok: false, message: "Invalid start time." };
              const endTime = formatTimeValue(startMinutes + durationMinutes);
              return commitPatientBilling({
                patientId: p.id,
                billingType: "Individual",
                serviceDate,
                startTime,
                endTime,
                totalMinutes: durationMinutes,
                modality,
                naloxoneTraining: false,
                matEducation: false,
              });
            }}
          />
        ) : (
          <div className="panel">
            <div className="panelHead">Not found</div>
            <div className="panelBody">
              {patientDetailError ?? "That patient record was not found in Azure-backed patient data."}
            </div>
          </div>
        )}
        {caseAssignmentTarget && canManageAssignments ? (
          <CaseAssignmentModal
            patientName={caseAssignmentTarget.patientName}
            currentCounselorEmail={caseAssignmentTarget.currentCounselorEmail}
            counselorOptions={counselorAssignmentOptions}
            onClose={() => setCaseAssignmentTarget(null)}
            onSave={async (payload) => {
              try {
                if (!payload.counselorEmail) {
                  await clearCaseAssignment(caseAssignmentTarget.patientId);
                } else {
                  await assignCaseToCounselor(caseAssignmentTarget.patientId, payload.counselorEmail);
                }
                setCaseAssignmentTarget(null);
              } catch (error) {
                console.error("Unable to update case assignment:", error);
                window.alert("Could not update case assignment right now.");
              }
            }}
          />
        ) : null}
        {highlightTarget ? (
          <PatientHighlightModal
            patientId={highlightTarget.patientId}
            patientName={highlightTarget.patientName}
            patients={patients}
            counselorOptions={counselorAssignmentOptions}
            currentUserEmail={activeUserEmail}
            defaultRecipientEmail={
              (highlightTarget.patientId
                ? caseAssignmentEmails[highlightTarget.patientId] ??
                  (caseAssignments[highlightTarget.patientId]?.includes("@") ? caseAssignments[highlightTarget.patientId] : "") ??
                  highlightTarget.recipientEmail ??
                  ""
                : highlightTarget.recipientEmail ?? "")
            }
            onClose={() => setHighlightTarget(null)}
            onSend={async ({ patientId, message, priority, recipientEmail }) => {
              const ok = await sendPatientHighlight({
                patientId,
                message,
                priority,
                recipientEmail,
              });
              if (ok) setHighlightTarget(null);
            }}
          />
        ) : null}
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

function SearchResults({
  view,
  rows,
  sessions,
  complianceByPatient,
  caseAssignments,
  counselorId,
  onUpdateCompliance,
  onUpdateRosterDetails,
  selectedId,
  onSelect,
  onOpen,
  onShiftHighlight,
  selected,
  isAdminView,
  highlightedPatientIds,
  renderPatientSheet,
}: {
  view: ViewMode;
  rows: Patient[];
  sessions: Session[];
  complianceByPatient: Record<string, PatientCompliance>;
  caseAssignments: Record<string, string>;
  counselorId: string;
  onUpdateCompliance: (patientId: string, patch: CompliancePatch) => void | Promise<void>;
  onUpdateRosterDetails: (patientId: string, patch: Partial<PatientRosterDetails>) => void | Promise<void>;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onShiftHighlight?: (patient: Patient) => void;
  selected?: Patient | null;
  isAdminView: boolean;
  highlightedPatientIds: Record<string, "normal" | "urgent">;
  renderPatientSheet: (patient: Patient) => React.ReactNode;
}) {
  const weekDate = todayIso();
  const [docEditor, setDocEditor] = useState<{ patientId: string; current: string[] } | null>(null);
  const [problemListPicker, setProblemListPicker] = useState<{
    patientId: string;
    patientName: string;
    value: string;
    mode: "problemListDate" | "treatmentPlanDate" | "problemListReview" | "problemListUpdate" | "treatmentPlanUpdate";
    treatmentPlanCycleDays?: 90 | 180;
  } | null>(null);
  const [sheetTreatmentPlanDates, setSheetTreatmentPlanDates] = useState<Record<string, string>>({});
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const [cardExtrasByPatient, setCardExtrasByPatient] = useState<Record<string, string[]>>({});
  const [cardExtrasPicker, setCardExtrasPicker] = useState<{ patientId: string; patientName: string } | null>(null);
  const [featuredPatientsPickerOpen, setFeaturedPatientsPickerOpen] = useState(false);
  const [featuredPatientIds, setFeaturedPatientIds] = useState<string[]>([]);
  const [cardOrderPatientIds, setCardOrderPatientIds] = useState<string[]>([]);
  const [selectedSheetColumn, setSelectedSheetColumn] = useState<string | null>(null);
  const cardExtrasKeyPrefix = "patientfinder.cards.extras.v1.";
  const cardFeaturedKey = `patientfinder.cards.featured.v1.${counselorId || "default"}`;
  const cardOrderKey = `patientfinder.cards.order.v1.${counselorId || "default"}`;
  const defaultCardExtraKeys = ["admit_date", "problem_list_date", "treatment_plan_date", "next_up"];
  const rowIdsSignature = useMemo(() => rows.map((patient) => normalizePatientId(patient.id)).join("|"), [rows]);
  const getHighlightClass = (patientId: string) => {
    const value = highlightedPatientIds[normalizePatientId(patientId)];
    if (value === "urgent") return " highlightRingUrgent";
    if (value === "normal") return " highlightRingNormal";
    return "";
  };

  const getNextUpPickerMode = (label: string) => {
    if (label.startsWith("PL Review")) return "problemListReview" as const;
    if (label.startsWith("PL Update")) return "problemListUpdate" as const;
    if (label.startsWith("Tx Plan Update")) return "treatmentPlanUpdate" as const;
    return null;
  };

  const toggleSheetColumn = (columnKey: string) => {
    setSelectedSheetColumn((current) => (current === columnKey ? null : columnKey));
  };

  useEffect(() => {
    const nextExtras: Record<string, string[]> = {};
    rows.forEach((patient) => {
      const normalizedId = normalizePatientId(patient.id);
      try {
        const rawExtras = window.localStorage.getItem(`${cardExtrasKeyPrefix}${normalizedId}`);
        if (rawExtras) {
          const parsed = JSON.parse(rawExtras) as string[];
          if (Array.isArray(parsed)) {
            nextExtras[normalizedId] = parsed.map((x) => String(x));
          }
        }
      } catch {
        // ignore bad local cache
      }
    });
    setCardExtrasByPatient(nextExtras);
  }, [rowIdsSignature]);


  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(cardFeaturedKey);
      if (!raw) {
        setFeaturedPatientIds([]);
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      const next = Array.isArray(parsed) ? parsed.map((id) => normalizePatientId(id)).filter(Boolean) : [];
      setFeaturedPatientIds(next);
    } catch {
      setFeaturedPatientIds([]);
    }
  }, [cardFeaturedKey]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(cardOrderKey);
      if (!raw) {
        setCardOrderPatientIds([]);
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      const next = Array.isArray(parsed) ? parsed.map((id) => normalizePatientId(id)).filter(Boolean) : [];
      setCardOrderPatientIds(next);
    } catch {
      setCardOrderPatientIds([]);
    }
  }, [cardOrderKey]);

  useEffect(() => {
    const normalizedRowIds = rows.map((patient) => normalizePatientId(patient.id));
    setCardOrderPatientIds((prev) => {
      const kept = prev.filter((id) => normalizedRowIds.includes(id));
      const missing = normalizedRowIds.filter((id) => !kept.includes(id));
      const next = [...kept, ...missing];
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      window.localStorage.setItem(cardOrderKey, JSON.stringify(next));
      return next;
    });
  }, [rowIdsSignature, rows, cardOrderKey]);

  const getCardExtraOptions = (patient: Patient, compliance: PatientCompliance | undefined) => {
    const attendance = getWeeklyAttendanceStats(patient, sessions, weekDate);
    const attendanceText = attendance.goal
      ? `${fmtHours(attendance.attendedHours)} this week`
      : "No weekly attendance goal";
    const cellPhone = getField(patient.intakeAnswers, "s5", "Cell phone");
    const homePhone = getField(patient.intakeAnswers, "s5", "Home phone");
    const email = getField(patient.intakeAnswers, "s5", "Email address");
    const streetAddress = getField(patient.intakeAnswers, "s5", "Street address");
    const city = getField(patient.intakeAnswers, "s5", "City");
    const zip = getField(patient.intakeAnswers, "s5", "ZIP code");
    const emergencyContactName = getField(patient.intakeAnswers, "s18", "Full name");
    const emergencyContactPhone = getField(patient.intakeAnswers, "s18", "Phone number");
    const homeAndCellPhone = [cellPhone, homePhone].filter(Boolean).join(" / ");
    const mailingAddress = [streetAddress, city, zip].filter(Boolean).join(", ");
    return [
      { key: "admit_date", label: "Admit Date", value: fmt(patient.intakeDate), tone: "neutral" },
      { key: "birthday", label: "Birthday", value: fmt(patient.dateOfBirth), tone: "neutral" },
      { key: "phone", label: "Phone", value: homeAndCellPhone || "Not set", tone: "neutral" },
      { key: "email", label: "Email", value: email || "Not set", tone: "neutral" },
      { key: "address", label: "Address", value: mailingAddress || "Not set", tone: "neutral" },
      { key: "emergency_contact", label: "Emergency Contact", value: emergencyContactName || "Not set", tone: "neutral" },
      { key: "emergency_phone", label: "Emergency Phone", value: emergencyContactPhone || "Not set", tone: "neutral" },
      { key: "assignment", label: "Assignment", value: caseAssignments[patient.id] === counselorId ? "Assigned to me" : "Not assigned to me", tone: "neutral" },
      { key: "attendance", label: "Attendance", value: attendanceText, tone: getAttendanceTone(patient, sessions, weekDate) === "behind" ? "behind" : "neutral" },
      { key: "next_appointment", label: "Next appointment", value: fmt(patient.nextApptDate), tone: "neutral" },
      { key: "program", label: "Program", value: patient.primaryProgram ?? "Not set", tone: "neutral" },
      { key: "counselor", label: "Counselor", value: patient.counselor ?? "Not set", tone: "neutral" },
      { key: "medical_eligibility", label: "Medical eligibility", value: patient.rosterDetails?.medicalEligibility ?? "Not set", tone: "neutral" },
      { key: "reauth", label: "Reauth SAP-C", value: fmt(patient.rosterDetails?.reauthSapcDate), tone: "warn" },
      { key: "therapy", label: "Therapy", value: getTherapySummary(patient).label, tone: "neutral" },
      { key: "drug_test", label: "Drug testing", value: getDrugTestSummary(patient, compliance, weekDate).label, tone: getDrugTestSummary(patient, compliance, weekDate).tone },
      { key: "mat", label: "MAT", value: patient.rosterDetails?.matStatus ?? "Not set", tone: "neutral" },
      { key: "medical_phys_apt", label: "Medical / Phys Apt", value: patient.rosterDetails?.medicalPhysApt ?? "Not set", tone: "neutral" },
      { key: "med_form_status", label: "Med Form", value: patient.rosterDetails?.medFormStatus ?? "Not set", tone: "neutral" },
      { key: "referring_agency", label: "Referring Agency", value: patient.rosterDetails?.referringAgency ?? "Not set", tone: "neutral" },
      { key: "problem_list_date", label: "Problem List", value: fmt(compliance?.problemListDate), tone: getProblemListSummary(compliance, patient).tone },
      { key: "problem_list_review", label: "Problem List Review", value: fmt(compliance?.lastProblemListReview), tone: getProblemListSummary(compliance, patient).tone },
      { key: "problem_list_update", label: "Problem List Update", value: fmt(compliance?.lastProblemListUpdate), tone: getProblemListSummary(compliance, patient).tone },
      { key: "treatment_plan_date", label: "Treatment Plan", value: fmt(compliance?.treatmentPlanDate), tone: getTreatmentPlanSummary(patient, compliance).tone },
      { key: "treatment_plan_update", label: "Treatment Plan Update", value: fmt(compliance?.lastTreatmentPlanUpdate), tone: getTreatmentPlanSummary(patient, compliance).tone },
      { key: "next_up", label: "Next Up", value: getNextUpSummary(patient, compliance, weekDate).label, tone: getNextUpSummary(patient, compliance, weekDate).tone === "behind" ? "over" : getNextUpSummary(patient, compliance, weekDate).tone },
    ];
  };

  const toggleCardExtra = (patientId: string, key: string) => {
    const normalizedId = normalizePatientId(patientId);
    setCardExtrasByPatient((prev) => {
      const current = prev[normalizedId] ?? [];
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
      window.localStorage.setItem(`${cardExtrasKeyPrefix}${normalizedId}`, JSON.stringify(next));
      return { ...prev, [normalizedId]: next };
    });
  };

  const toggleFeaturedPatient = (patientId: string) => {
    const normalizedId = normalizePatientId(patientId);
    setFeaturedPatientIds((prev) => {
      const next = prev.includes(normalizedId) ? prev.filter((id) => id !== normalizedId) : [...prev, normalizedId];
      window.localStorage.setItem(cardFeaturedKey, JSON.stringify(next));
      return next;
    });
  };

  const moveCardPatient = (patientId: string, direction: "up" | "down") => {
    const normalizedId = normalizePatientId(patientId);
    setCardOrderPatientIds((prev) => {
      const current = prev.length ? [...prev] : rows.map((patient) => normalizePatientId(patient.id));
      const index = current.indexOf(normalizedId);
      if (index < 0) return prev;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) return prev;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      window.localStorage.setItem(cardOrderKey, JSON.stringify(next));
      return next;
    });
  };

  if (view === "split") {
    const selectedPatient = selected ?? null;

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
              const problemList = getProblemListSummary(complianceByPatient[p.id], p);
              const rowCompliance: PatientCompliance = {
                ...(complianceByPatient[p.id] ?? {}),
                problemListDate: complianceByPatient[p.id]?.problemListDate,
                treatmentPlanDate: sheetTreatmentPlanDates[p.id] ?? complianceByPatient[p.id]?.treatmentPlanDate,
              };
              const nextUp = getNextUpSummary(p, rowCompliance, weekDate);
              const treatmentPlan = getTreatmentPlanSummary(p, rowCompliance);
              const docSummary = formatSpreadsheetDrugChoices(
                p.rosterDetails?.drugOfChoice
              );
              return (
                  <button
                  key={p.id}
                className={
                  p.id === selectedId
                    ? `workspaceSplitRow selected${getHighlightClass(p.id)}`
                    : `workspaceSplitRow${getHighlightClass(p.id)}`
                }
                  onClick={(event) => {
                    if (event.shiftKey && onShiftHighlight) {
                      event.preventDefault();
                      event.stopPropagation();
                      onShiftHighlight(p);
                      return;
                    }
                    onSelect(selectedId === p.id ? null : p.id);
                  }}
                  onDoubleClick={() => onOpen(p.id)}
                  title="Double-click to open"
                >
                  <div className="workspaceSplitIdentity">
                    <strong>{p.displayName}</strong>
                    <div className="workspaceSplitMetaInline">
                      <span className="workspaceSplitMetaText workspaceSplitMetaTextSage">Sage ID {p.mrn ?? "—"}</span>
                      <span className="workspaceSplitMetaText workspaceSplitMetaTextProgram">{p.primaryProgram ?? "—"}</span>
                      <span className="workspaceSplitMetaText workspaceSplitMetaTextDoc">{docSummary || "—"}</span>
                    </div>
                  </div>
                  <div className="workspaceSplitGrid">
                    <span className="workspaceSplitField"><strong>Admit:</strong> {fmt(p.intakeDate)}</span>
                    <span className="workspaceSplitField"><strong>Medical / Phys Apt:</strong> {p.rosterDetails?.medicalPhysApt ?? "—"}</span>
                    <span className="workspaceSplitField"><strong>Med Form:</strong> {p.rosterDetails?.medFormStatus ?? "—"}</span>
                    <span className="workspaceSplitField"><strong>Referring Agency:</strong> {p.rosterDetails?.referringAgency ?? "—"}</span>
                    <span className="workspaceSplitField"><strong>Reauth SAP-C:</strong> {fmt(p.rosterDetails?.reauthSapcDate)}</span>
                    <span className="workspaceSplitField"><strong>Medical Eligibility:</strong> {p.rosterDetails?.medicalEligibility ?? "—"}</span>
                    <span className="workspaceSplitField"><strong>MAT:</strong> {p.rosterDetails?.matStatus ?? "—"}</span>
                    <span className="workspaceSplitField"><strong>Therapy:</strong> {p.rosterDetails?.therapyTrack ?? "—"}</span>
                    <span className="workspaceSplitField workspaceSplitNotes"><strong>Notes:</strong> {p.rosterDetails?.notes || "—"}</span>
                  </div>
                  <div className="workspaceSplitNextUp">
                    <span className="workspaceMiniLabel">Problem List</span>
                    <span
                      className={`workspaceTone ${problemList.tone}`}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value: rowCompliance.problemListDate ?? weekDate,
                          mode: "problemListDate",
                        });
                      }}
                    >
                      {fmt(rowCompliance.problemListDate)}
                    </span>
                  </div>
                  <div className="workspaceSplitNextUp">
                    <span className="workspaceMiniLabel">Treatment Plan</span>
                    <span
                      className={`workspaceTone ${treatmentPlan.tone}`}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value: rowCompliance.treatmentPlanDate ?? weekDate,
                          mode: "treatmentPlanDate",
                          treatmentPlanCycleDays: rowCompliance.treatmentPlanCycleDays ?? 90,
                        });
                      }}
                    >
                      {fmt(rowCompliance.treatmentPlanDate)}
                    </span>
                  </div>
                  <div className="workspaceSplitNextUp">
                    <span className="workspaceMiniLabel">Next Up</span>
                    <span
                      className={`workspaceTone ${nextUp.tone === "behind" ? "over" : nextUp.tone}`}
                      role={getNextUpPickerMode(nextUp.label) ? "button" : undefined}
                      tabIndex={getNextUpPickerMode(nextUp.label) ? 0 : undefined}
                      onClick={(event) => {
                        const mode = getNextUpPickerMode(nextUp.label);
                        if (!mode) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value: weekDate,
                          mode,
                        });
                      }}
                    >
                      {nextUp.label}
                    </span>
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
              <div className="workspaceSectionLabel">Mini Patient Sheet</div>
              <div className="workspaceRosterTitle">Live sheet controls for the selected patient.</div>
            </div>
          </div>
          <div className="workspacePreviewBody workspaceMiniSheetPanel">
            {selectedPatient ? (
              <div className="workspaceSplitPatientSheet">
                {renderPatientSheet(selectedPatient)}
              </div>
            ) : (
              <div className="workspaceEmptyState">Select a patient to preview their schedule and requirements.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === "sheet") {
        const sheetColumns = [
          { key: "name", label: "Client's Name" },
          { key: "admit_date", label: "Admit Date" },
          { key: "problem_list_date", label: "Problem List" },
          { key: "treatment_plan_date", label: "Treatment Plan" },
          { key: "next_up", label: "Next Up" },
          { key: "last_problem_list_review", label: "Last PL Review" },
          { key: "days_in_treatment", label: "Days in Treatment" },
          { key: "medical_phys_apt", label: "Medical / Phys Apt." },
          { key: "med_form_status", label: "Med Form" },
          { key: "referring_agency", label: "Referring Agency" },
          { key: "reauth_sapc", label: "Reauth SAP-C" },
          { key: "medical_eligibility", label: "Medical Eligibility" },
          { key: "mat_status", label: "MAT" },
          { key: "therapy_track", label: "Therapy" },
          { key: "notes", label: "Notes" },
        ] as const;
        return (
        <>
        <div className={isAdminView ? "workspaceSheetWrap adminCompact" : "workspaceSheetWrap"}>
          <div
            className="workspaceSheet"
            data-selected-column={selectedSheetColumn ?? ""}
            ref={sheetScrollRef}
          >
            <div className="workspaceSheetHead">
              {sheetColumns.map((column) => (
                <div
                  key={column.key}
                  className="workspaceSheetHeadCell"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSheetColumn(column.key)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleSheetColumn(column.key);
                  }}
                >
                  {column.label}
                </div>
              ))}
            </div>
            {rows.map((p) => {
              const effectiveProblemListDate = complianceByPatient[p.id]?.problemListDate;
              const effectiveTreatmentPlanDate = sheetTreatmentPlanDates[p.id] ?? complianceByPatient[p.id]?.treatmentPlanDate;
              const effectiveCompliance: PatientCompliance = {
                ...(complianceByPatient[p.id] ?? {}),
                problemListDate: effectiveProblemListDate,
                treatmentPlanDate: effectiveTreatmentPlanDate,
              };
              const problemListEnded = isProblemListEnded(p);
              const dueDates = getProblemListDueDates(effectiveCompliance, p);
              const problemListInitialDueDate = getProblemListInitialDueDate(p);
              const problemListInitialDueDelta = dayDiff(weekDate, problemListInitialDueDate);
              const needsProblemListSetButton = !problemListEnded && !effectiveProblemListDate;
              const showProblemListSetRedGlow = needsProblemListSetButton && problemListInitialDueDelta <= 2;
              const treatmentPlanDueDate = addDaysIso(p.intakeDate, 30);
              const treatmentPlanDaysUntilDue = dayDiff(weekDate, treatmentPlanDueDate);
              const treatmentPlanEnded = isTreatmentPlanEnded(p);
              const needsTreatmentPlanSetButton = !treatmentPlanEnded && Boolean(effectiveProblemListDate) && !effectiveTreatmentPlanDate;
              const showTreatmentPlanSetRedGlow = needsTreatmentPlanSetButton && treatmentPlanDaysUntilDue <= 5;
              const nextUp = getNextUpSummary(p, effectiveCompliance, weekDate);
              const lastProblemListReviewLabel = getLastProblemListReviewLabel(effectiveCompliance, p);
              const docSummary = formatSpreadsheetDrugChoices(
                p.rosterDetails?.drugOfChoice
              );
              const reauthDelta = p.rosterDetails?.reauthSapcDate ? dayDiff(weekDate, p.rosterDetails.reauthSapcDate) : null;
              const reviewDelta = dueDates?.nextReview ? dayDiff(weekDate, dueDates.nextReview) : null;
              const updateDelta = dueDates ? dayDiff(weekDate, dueDates.nextUpdate) : null;
              const hasOverdueDate =
                (reviewDelta !== null && reviewDelta < 0) ||
                (updateDelta !== null && updateDelta < 0) ||
                (reauthDelta !== null && reauthDelta < 0);
              const hasUpcomingDate =
                !hasOverdueDate &&
                ((reviewDelta !== null && reviewDelta <= 7) ||
                  (updateDelta !== null && updateDelta <= 14) ||
                  (reauthDelta !== null && reauthDelta <= 7));
              const rowTone =
                hasOverdueDate ? "alert" : hasUpcomingDate ? "watch" : "";

              return (
                <button
                  key={p.id}
                className={
                  p.id === selectedId
                    ? `workspaceSheetRow ${rowTone} selected${getHighlightClass(p.id)}`
                    : `workspaceSheetRow ${rowTone}${getHighlightClass(p.id)}`
                }
                  onClick={(event) => {
                    if (event.shiftKey && onShiftHighlight) {
                      event.preventDefault();
                      event.stopPropagation();
                      onShiftHighlight(p);
                      return;
                    }
                    onSelect(selectedId === p.id ? null : p.id);
                  }}
                  onDoubleClick={() => onOpen(p.id)}
                  title="Double-click to open"
                >
                  <div className="workspaceSheetName">
                    <strong>{p.displayName}</strong>
                    <div className="workspaceMetaInline">
                      <span className="workspaceMetaText workspaceMetaTextSage" style={{ color: "#d89bff" }}>Sage ID {p.mrn ?? "—"}</span>
                      <span className="workspaceMetaText workspaceMetaTextProgram" style={{ color: "#88b8ff" }}>{p.primaryProgram ?? "—"}</span>
                      <span className="workspaceMetaText workspaceMetaTextDoc" style={{ color: "#ff7a55" }}>{docSummary}</span>
                    </div>
                  </div>
                  <div className="workspaceSheetDateCell">
                    <span className="workspaceTone neutral">{fmt(p.intakeDate)}</span>
                  </div>
                  <div>
                    {needsProblemListSetButton ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className={showProblemListSetRedGlow ? "workspaceSetAction dueSoon" : "workspaceSetAction"}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: weekDate,
                            mode: "problemListDate",
                          });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void onUpdateCompliance(p.id, { problemListDate: weekDate });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: weekDate,
                            mode: "problemListDate",
                          });
                        }}
                      >
                        Set Problem List
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="workspaceTone neutral"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: effectiveProblemListDate ?? weekDate,
                            mode: "problemListDate",
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: effectiveProblemListDate ?? weekDate,
                            mode: "problemListDate",
                          });
                        }}
                      >
                        {fmt(effectiveProblemListDate)}
                      </span>
                    )}
                  </div>
                  <div>
                    {needsTreatmentPlanSetButton ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className={showTreatmentPlanSetRedGlow ? "workspaceSetAction dueSoon" : "workspaceSetAction glow"}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: weekDate,
                            mode: "treatmentPlanDate",
                            treatmentPlanCycleDays: effectiveCompliance.treatmentPlanCycleDays ?? 90,
                          });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSheetTreatmentPlanDates((prev) => ({ ...prev, [p.id]: weekDate }));
                          void onUpdateCompliance(p.id, { treatmentPlanDate: weekDate });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: weekDate,
                            mode: "treatmentPlanDate",
                            treatmentPlanCycleDays: effectiveCompliance.treatmentPlanCycleDays ?? 90,
                          });
                        }}
                      >
                        Set Treatment Plan
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="workspaceTone neutral"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: effectiveTreatmentPlanDate ?? weekDate,
                            mode: "treatmentPlanDate",
                            treatmentPlanCycleDays: effectiveCompliance.treatmentPlanCycleDays ?? 90,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          setProblemListPicker({
                            patientId: p.id,
                            patientName: p.displayName,
                            value: effectiveTreatmentPlanDate ?? weekDate,
                            mode: "treatmentPlanDate",
                            treatmentPlanCycleDays: effectiveCompliance.treatmentPlanCycleDays ?? 90,
                          });
                        }}
                      >
                        {fmt(effectiveTreatmentPlanDate)}
                      </span>
                    )}
                  </div>
                  <div className="workspaceNextUpCell">
                    <span
                      className={
                        nextUp.tone === "behind"
                          ? "workspaceTone over workspaceNextUpDue"
                          : nextUp.tone === "due"
                            ? "workspaceTone over"
                            : `workspaceTone ${nextUp.tone}`
                      }
                      role={getNextUpPickerMode(nextUp.label) ? "button" : undefined}
                      tabIndex={getNextUpPickerMode(nextUp.label) ? 0 : undefined}
                      onClick={(event) => {
                        const mode = getNextUpPickerMode(nextUp.label);
                        if (!mode) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value: weekDate,
                          mode,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        const mode = getNextUpPickerMode(nextUp.label);
                        if (!mode) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value: weekDate,
                          mode,
                        });
                      }}
                      >
                      {nextUp.label}
                    </span>
                  </div>
                  <div className="workspaceSheetDateCell">
                    {lastProblemListReviewLabel ? <span className="workspaceTone neutral">{lastProblemListReviewLabel}</span> : null}
                  </div>
                  <div className="workspaceDaysInTreatment">
                    {`${Math.max(0, dayDiff(p.intakeDate, todayIso()))} days`}
                  </div>
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
                  </div>
                </button>
              );
            })}
            {!rows.length ? <div className="workspaceEmptyState">No patients match the current search or filters.</div> : null}
          </div>
          <div className="workspaceSheetFloatingArrows" aria-hidden="false">
            <button
              type="button"
              className="workspaceArrowLaneBtn"
              aria-label="Scroll left"
              onClick={() => sheetScrollRef.current?.scrollBy({ left: -420, behavior: "smooth" })}
            />
            <button
              type="button"
              className="workspaceArrowLaneBtn"
              aria-label="Scroll right"
              onClick={() => sheetScrollRef.current?.scrollBy({ left: 420, behavior: "smooth" })}
            />
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
        {problemListPicker ? (
          <div className="modalOverlay" onClick={() => setProblemListPicker(null)}>
            <div className="modalCard" onClick={(event) => event.stopPropagation()}>
              <div className="modalHead">
                <div className="modalTitle">
                  {problemListPicker.mode === "problemListDate" ? "Set Problem List Date" :
                    problemListPicker.mode === "treatmentPlanDate" ? "Set Treatment Plan Date" :
                    problemListPicker.mode === "problemListReview" ? "Set Problem List Review Date" :
                    problemListPicker.mode === "problemListUpdate" ? "Set Problem List Update Date" :
                    "Set Treatment Plan Update Date"}
                </div>
                <button className="modalClose" onClick={() => setProblemListPicker(null)}>✕</button>
              </div>
              <div className="modalBody">
                <div className="workspaceAgendaMeta">Patient</div>
                <div className="workspaceAgendaDetail">{problemListPicker.patientName}</div>
                <label className="addField" style={{ marginTop: 12 }}>
                  <span className="addLabel">
                    {problemListPicker.mode === "problemListDate" ? "Problem list date" :
                      problemListPicker.mode === "treatmentPlanDate" ? "Treatment plan date" :
                      problemListPicker.mode === "problemListReview" ? "Problem list review completed date" :
                      problemListPicker.mode === "problemListUpdate" ? "Problem list update completed date" :
                      "Treatment plan update completed date"}
                  </span>
                  <input
                    className="authInput"
                    type="date"
                    value={problemListPicker.value}
                    onChange={(event) => setProblemListPicker((current) => (current ? { ...current, value: event.target.value } : current))}
                  />
                </label>
                {problemListPicker.mode === "treatmentPlanDate" || problemListPicker.mode === "treatmentPlanUpdate" ? (
                  <label className="addField" style={{ marginTop: 12 }}>
                    <span className="addLabel">Next treatment plan cycle</span>
                    <select
                      className="select"
                      value={String(problemListPicker.treatmentPlanCycleDays ?? 90)}
                      onChange={(event) =>
                        setProblemListPicker((current) =>
                          current ? { ...current, treatmentPlanCycleDays: event.target.value === "180" ? 180 : 90 } : current
                        )
                      }
                    >
                      <option value="90">90-day treatment plan</option>
                      <option value="180">180-day treatment plan</option>
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="modalFoot">
                <button className="btn ghost" onClick={() => setProblemListPicker(null)}>Cancel</button>
                <button
                  className="btn workspaceTodayAction"
                  onClick={() => {
                    const targetPatientId = problemListPicker.patientId;
                    if (problemListPicker.mode === "treatmentPlanDate") {
                      setSheetTreatmentPlanDates((prev) => ({ ...prev, [targetPatientId]: weekDate }));
                    }
                    setProblemListPicker(null);
                    const treatmentPlanCycleDays = problemListPicker.treatmentPlanCycleDays ?? 90;
                    const patch =
                      problemListPicker.mode === "treatmentPlanDate" ? { treatmentPlanDate: weekDate, treatmentPlanCycleDays } :
                      problemListPicker.mode === "problemListReview" ? { lastProblemListReview: weekDate } :
                      problemListPicker.mode === "problemListUpdate" ? { problemListDate: weekDate, lastProblemListUpdate: weekDate } :
                      problemListPicker.mode === "treatmentPlanUpdate" ? { treatmentPlanDate: weekDate, lastTreatmentPlanUpdate: weekDate, treatmentPlanCycleDays } :
                      { problemListDate: weekDate };
                    void onUpdateCompliance(targetPatientId, patch);
                  }}
                >
                  Today
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (!problemListPicker.value) return;
                    const targetPatientId = problemListPicker.patientId;
                    const targetDate = problemListPicker.value;
                    if (problemListPicker.mode === "treatmentPlanDate") {
                      setSheetTreatmentPlanDates((prev) => ({ ...prev, [targetPatientId]: targetDate }));
                    }
                    setProblemListPicker(null);
                    const treatmentPlanCycleDays = problemListPicker.treatmentPlanCycleDays ?? 90;
                    const patch =
                      problemListPicker.mode === "treatmentPlanDate" ? { treatmentPlanDate: targetDate, treatmentPlanCycleDays } :
                      problemListPicker.mode === "problemListReview" ? { lastProblemListReview: targetDate } :
                      problemListPicker.mode === "problemListUpdate" ? { problemListDate: targetDate, lastProblemListUpdate: targetDate } :
                      problemListPicker.mode === "treatmentPlanUpdate" ? { treatmentPlanDate: targetDate, lastTreatmentPlanUpdate: targetDate, treatmentPlanCycleDays } :
                      { problemListDate: targetDate };
                    void onUpdateCompliance(targetPatientId, patch);
                  }}
                >
                  Save Date
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const visibleCardRows = (() => {
    const baseRows =
      featuredPatientIds.length > 0
        ? rows.filter((patient) => featuredPatientIds.includes(normalizePatientId(patient.id)))
        : rows;
    const order = cardOrderPatientIds.length ? cardOrderPatientIds : rows.map((patient) => normalizePatientId(patient.id));
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...baseRows].sort((a, b) => {
      const aRank = rank.get(normalizePatientId(a.id)) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(normalizePatientId(b.id)) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  })();

  return (
    <div className="workspaceCardGrid">
      <div className="workspaceCardGridTools">
        <button className="btn ghost btnCompact" onClick={() => setFeaturedPatientsPickerOpen(true)}>
          Choose featured patients
        </button>
        {featuredPatientIds.length ? (
          <button
            className="btn ghost btnCompact"
            onClick={() => {
              setFeaturedPatientIds([]);
              window.localStorage.setItem(cardFeaturedKey, JSON.stringify([]));
            }}
          >
            Show all
          </button>
        ) : null}
      </div>
      {visibleCardRows.map((p) => {
        const normalizedId = normalizePatientId(p.id);
        const rowCompliance: PatientCompliance = {
          ...(complianceByPatient[p.id] ?? {}),
          problemListDate: complianceByPatient[p.id]?.problemListDate,
          treatmentPlanDate: sheetTreatmentPlanDates[p.id] ?? complianceByPatient[p.id]?.treatmentPlanDate,
        };
        const nextUp = getNextUpSummary(p, rowCompliance, weekDate);
              const docSummary = formatSpreadsheetDrugChoices(
                p.rosterDetails?.drugOfChoice
              );
        const extraOptions = getCardExtraOptions(p, rowCompliance);
        const selectedExtraKeys = cardExtrasByPatient[normalizedId] ?? defaultCardExtraKeys;
        const visibleExtras = extraOptions.filter((item) => selectedExtraKeys.includes(item.key));
        const cardWidth = 360;
        const cardHeight = 420;
        const getCardFieldIcon = (key: string) => {
          if (key === "admit_date") return "◷";
          if (key === "birthday") return "BD";
          if (key === "phone") return "☎";
          if (key === "email") return "✉";
          if (key === "address") return "ADR";
          if (key === "emergency_contact") return "EC";
          if (key === "emergency_phone") return "☏";
          if (key === "problem_list_date") return "⚑";
          if (key === "problem_list_review") return "✓";
          if (key === "problem_list_update") return "↻";
          if (key === "treatment_plan_date") return "✦";
          if (key === "treatment_plan_update") return "⟳";
          if (key === "mat") return "M";
          if (key === "medical_phys_apt") return "⚕";
          if (key === "med_form_status") return "MF";
          if (key === "referring_agency") return "⇢";
          if (key === "next_up") return "➜";
          if (key === "attendance") return "◉";
          if (key === "drug_test") return "◈";
          if (key === "assignment") return "⌁";
          return "•";
        };

        return (
          <div
            key={p.id}
            className={
              p.id === selectedId
                ? `workspaceRosterTile workspaceRosterTileV3 selected${getHighlightClass(p.id)}`
                : `workspaceRosterTile workspaceRosterTileV3${getHighlightClass(p.id)}`
            }
            style={{
              width: `${cardWidth}px`,
              height: `${cardHeight}px`,
              overflow: "hidden",
            }}
            onClick={(event) => {
              if (event.shiftKey && onShiftHighlight) {
                event.preventDefault();
                event.stopPropagation();
                onShiftHighlight(p);
                return;
              }
              onSelect(p.id);
            }}
            onDoubleClick={() => onOpen(p.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(p.id);
              } else if (event.key === " ") {
                event.preventDefault();
                onSelect(p.id);
              }
            }}
            role="button"
            tabIndex={0}
            title="Double-click to open"
          >
            <div className="workspaceTileTop">
              <div className="workspaceCellIdentity">
                <strong>{p.displayName}</strong>
                <div className="workspaceMetaInline">
                  <span className="workspaceMetaText workspaceMetaTextSage" style={{ color: "#d89bff" }}>SAGE # {p.mrn ?? "—"}</span>
                  <span className="workspaceMetaText workspaceMetaTextProgram" style={{ color: "#88b8ff" }}>{p.primaryProgram ?? "—"}</span>
                  <span className="workspaceMetaText workspaceMetaTextDoc" style={{ color: "#ff7a55" }}>{docSummary}</span>
                </div>
              </div>
              <div className="workspaceTileTopActions">
                <button
                  className="btn ghost btnCompact"
                  title="Move earlier"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    moveCardPatient(p.id, "up");
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn ghost btnCompact"
                  title="Move later"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    moveCardPatient(p.id, "down");
                  }}
                >
                  ↓
                </button>
                <button
                  className="btn ghost btnCompact"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCardExtrasPicker({ patientId: p.id, patientName: p.displayName });
                  }}
                >
                  Custom fields
                </button>
              </div>
            </div>
            <div className="workspaceTileExtras">
              {visibleExtras.map((item) => {
                const interactiveMode =
                  item.key === "problem_list_date" ? "problemListDate" :
                  item.key === "problem_list_review" ? "problemListReview" :
                  item.key === "problem_list_update" ? "problemListUpdate" :
                  item.key === "treatment_plan_date" ? "treatmentPlanDate" :
                  item.key === "treatment_plan_update" ? "treatmentPlanUpdate" :
                  item.key === "next_up" ? getNextUpPickerMode(nextUp.label) :
                  null;
                if (interactiveMode) {
                  return (
                    <button
                      key={item.key}
                      className={`workspaceTone ${item.tone}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setProblemListPicker({
                          patientId: p.id,
                          patientName: p.displayName,
                          value:
                            interactiveMode === "treatmentPlanDate"
                              ? rowCompliance.treatmentPlanDate ?? weekDate
                              : interactiveMode === "problemListDate"
                                ? rowCompliance.problemListDate ?? weekDate
                                : weekDate,
                          mode: interactiveMode,
                          treatmentPlanCycleDays: rowCompliance.treatmentPlanCycleDays ?? 90,
                        });
                      }}
                    >
                      <span className="workspaceWidgetIcon" aria-hidden="true">{getCardFieldIcon(item.key)}</span>
                      <strong>{item.label}:</strong> <span className="workspaceWidgetValue">{item.value}</span>
                    </button>
                  );
                }
                return (
                  <div
                    key={item.key}
                    className={`workspaceTone ${item.tone}`}
                  >
                    <span className="workspaceWidgetIcon" aria-hidden="true">{getCardFieldIcon(item.key)}</span>
                    <strong>{item.label}:</strong> <span className="workspaceWidgetValue">{item.value}</span>
                  </div>
                );
              })}
              {!visibleExtras.length ? <div className="muted">No custom fields selected.</div> : null}
            </div>
          </div>
        );
      })}
      {!visibleCardRows.length ? <div className="workspaceEmptyState">No featured patients selected.</div> : null}
      {featuredPatientsPickerOpen ? (
        <div className="modalOverlay" onClick={() => setFeaturedPatientsPickerOpen(false)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Choose Featured Patients</div>
              <button className="modalClose" onClick={() => setFeaturedPatientsPickerOpen(false)}>✕</button>
            </div>
            <div className="modalBody">
              <div className="hintTiny">Only selected patients will appear in this filtered view.</div>
              <div className="multiCheckList" style={{ marginTop: 12, maxHeight: 360, overflow: "auto" }}>
                {rows.map((patient) => {
                  const selected = featuredPatientIds.includes(normalizePatientId(patient.id));
                  return (
                    <button
                      key={patient.id}
                      type="button"
                      className={`multiCheckItem${selected ? " on" : ""}`}
                      onClick={() => toggleFeaturedPatient(patient.id)}
                    >
                      <span>{patient.displayName}</span>
                      <span aria-hidden="true">{selected ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {cardExtrasPicker ? (
        <div className="modalOverlay" onClick={() => setCardExtrasPicker(null)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Choose Card Fields</div>
              <button className="modalClose" onClick={() => setCardExtrasPicker(null)}>✕</button>
            </div>
            <div className="modalBody">
              <div className="workspaceAgendaMeta">Patient</div>
              <div className="workspaceAgendaDetail">{cardExtrasPicker.patientName}</div>
              <div className="multiCheckList" style={{ marginTop: 12 }}>
                {(() => {
                  const patient = rows.find((entry) => normalizePatientId(entry.id) === normalizePatientId(cardExtrasPicker.patientId));
                  if (!patient) return null;
                  const options = getCardExtraOptions(patient, complianceByPatient[patient.id]);
                  return options.map((option) => {
                    const selected = (cardExtrasByPatient[normalizePatientId(patient.id)] ?? defaultCardExtraKeys).includes(option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={`multiCheckItem${selected ? " on" : ""}`}
                        onClick={() => toggleCardExtra(patient.id, option.key)}
                      >
                        <span>{option.label}</span>
                        <span aria-hidden="true">{selected ? "✓" : ""}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------- Theme Picker -------------------- */

function CaseAssignmentModal({
  patientName,
  currentCounselorEmail,
  counselorOptions,
  onClose,
  onSave,
}: {
  patientName: string;
  currentCounselorEmail: string;
  counselorOptions: { email: string; label: string; userId?: string }[];
  onClose: () => void;
  onSave: (payload: { counselorEmail: string | null }) => Promise<void>;
}) {
  const [selectedEmail, setSelectedEmail] = useState(currentCounselorEmail || "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Assign Counselor</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="workspaceAgendaMeta">Patient</div>
          <div className="workspaceAgendaDetail">{patientName}</div>
          <div className="addGrid" style={{ marginTop: 12 }}>
            <label className="addField">
              <span className="addLabel">Counselor</span>
              <select className="select" value={selectedEmail} onChange={(e) => setSelectedEmail(e.target.value)}>
                <option value="">Unassigned</option>
                {counselorOptions.map((option) => (
                  <option key={option.email} value={option.email}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const email = selectedEmail.trim();
              await onSave({ counselorEmail: email ? email.toLowerCase() : null });
              setSaving(false);
            }}
          >
            {saving ? "Saving..." : "Save Assignment"}
          </button>
        </div>
      </div>
    </div>
    );
  }

function NotificationComposerModal({
  notifications,
  patients,
  recipients,
  currentUserEmail,
  currentUserId,
  onClose,
  onSendHighlight,
  onReplyToThread,
  onMarkThreadRead,
  onDeleteThread,
  onOpenPatient,
}: {
  notifications: InAppNotification[];
  patients: Patient[];
  recipients: Array<{ email: string; label: string }>;
  currentUserEmail: string;
  currentUserId: string;
  onClose: () => void;
  onSendHighlight: (payload: { patientId: string; recipientEmail: string; message: string; priority: "normal" | "urgent" }) => Promise<void>;
  onReplyToThread: (notificationId: string, message: string) => Promise<void>;
  onMarkThreadRead: (notificationId: string) => Promise<void>;
  onDeleteThread: (notificationId: string) => Promise<void>;
  onOpenPatient?: (patientId: string) => void;
}) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [patientId, setPatientId] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [message, setMessage] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [sending, setSending] = useState(false);

  const threads = useMemo(
    () => buildHighlightThreads(notifications, patients, currentUserEmail, currentUserId),
    [notifications, patients, currentUserEmail, currentUserId]
  );
  const selectedThread = threads.find((thread) => thread.threadId === selectedThreadId) ?? threads[0] ?? null;

  useEffect(() => {
    if (!selectedThreadId && threads[0]) {
      setSelectedThreadId(threads[0].threadId);
    }
  }, [threads, selectedThreadId]);

  useEffect(() => {
    if (!selectedThread) return;
    setReplyDraft("");
  }, [selectedThread?.threadId]);

  const threadReplySource =
    selectedThread?.messages
      .slice()
      .reverse()
      .find((note) => {
        const senderEmail = (note.senderEmail ?? "").toLowerCase();
        const senderUserId = note.senderUserId ?? "";
        return senderEmail !== currentUserEmail.toLowerCase() && senderUserId !== currentUserId;
      }) ??
    null;

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" style={{ width: "min(1100px, 96vw)", maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Highlights</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, overflow: "hidden" }}>
          <div className="highlightThreadList" style={{ overflow: "auto", minHeight: 0 }}>
            {threads.length ? (
              threads.map((thread) => (
                <button
                  key={thread.threadId}
                  className={thread.threadId === selectedThread?.threadId ? "highlightThreadItem on" : "highlightThreadItem"}
                  onClick={() => setSelectedThreadId(thread.threadId)}
                >
                  <div className="highlightThreadTop">
                    <strong>{thread.patientName}</strong>
                    {thread.unreadForMe ? <span className="highlightThreadUnread">New</span> : null}
                  </div>
                  <div className="highlightThreadMeta">{thread.latest.title}</div>
                  <div className="highlightThreadMeta">{thread.latest.message}</div>
                  <div className="highlightThreadFoot">
                    {formatNotificationTimestamp(thread.latest.createdAt)}
                    {thread.latest.senderEmail ? ` • ${thread.latest.senderEmail}` : ""}
                  </div>
                </button>
              ))
            ) : (
              <div className="workspaceEmptyState">No highlights yet.</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 12, minHeight: 0, gridTemplateRows: "auto 1fr auto" }}>
            <div className="highlightThreadPane" style={{ overflow: "auto", minHeight: 0 }}>
              {selectedThread ? (
                <>
                  <div className="workspaceAgendaMeta">Patient</div>
                  <div className="workspaceAgendaDetail">{selectedThread.patientName}</div>
                  {selectedThread.patientId ? (
                    <button className="btn ghost btnCompact" style={{ marginTop: 8 }} onClick={() => onOpenPatient?.(selectedThread.patientId!)}>
                      Open patient
                    </button>
                  ) : null}
                  <div className="highlightMessageStream" style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    {selectedThread.messages.map((note) => (
                      <div key={note.id} className={note.recipientEmail?.toLowerCase() === currentUserEmail.toLowerCase() || note.recipientUserId?.toLowerCase() === currentUserId.toLowerCase() ? "highlightBubble incoming" : "highlightBubble outgoing"}>
                        <div className="workspaceAgendaMeta">
                          {note.senderEmail ?? "patientfinder"} • {formatNotificationTimestamp(note.createdAt)}
                        </div>
                        <div className="workspaceAgendaDetail">{note.message}</div>
                      </div>
                    ))}
                  </div>
                  <div className="highlightActions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {selectedThread.unreadForMe ? (
                      <button className="btn ghost" onClick={() => void onMarkThreadRead(selectedThread.latest.id)}>
                        Read
                      </button>
                    ) : null}
                    <button className="btn ghost" onClick={() => void onDeleteThread(selectedThread.latest.id)}>
                      Delete
                    </button>
                  </div>
                  <label className="addField" style={{ marginTop: 12 }}>
                    <span className="addLabel">Reply</span>
                    <textarea className="authInput controlCenterTextarea" value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} placeholder="Write back to the last sender in this thread." />
                  </label>
                  <div className="modalFoot" style={{ paddingTop: 0 }}>
                    <button className="btn" disabled={!replyDraft.trim() || !threadReplySource} onClick={async () => {
                      if (!threadReplySource || !replyDraft.trim()) return;
                      setSending(true);
                      try {
                        await onReplyToThread(threadReplySource.id, replyDraft.trim());
                        setReplyDraft("");
                      } finally {
                        setSending(false);
                      }
                    }}>
                      {sending ? "Sending..." : "Send reply"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="workspaceEmptyState">Pick a highlight to review the thread.</div>
              )}
            </div>

            <div className="highlightComposer" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
              <div className="workspaceSectionLabel">New highlight</div>
              <div className="addGrid">
                <label className="addField">
                  <span className="addLabel">Patient</span>
                  <select className="select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                    <option value="">Choose patient</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="addField">
                  <span className="addLabel">Send to</span>
                  <select className="select" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}>
                    <option value="">Choose counselor</option>
                    {recipients
                      .filter((option) => option.email.toLowerCase() !== currentUserEmail.toLowerCase())
                      .map((option) => (
                      <option key={option.email} value={option.email}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="addField">
                  <span className="addLabel">Priority</span>
                  <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as "normal" | "urgent")}>
                    <option value="normal">Low priority</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>
              <label className="addField" style={{ marginTop: 12 }}>
                <span className="addLabel">Note</span>
                <textarea className="authInput controlCenterTextarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type what the counselor should focus on next." />
              </label>
            </div>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button
            className="btn"
            disabled={sending || !message.trim() || !recipientEmail || !patientId}
            onClick={async () => {
              setSending(true);
              try {
                await onSendHighlight({ patientId, recipientEmail, message: message.trim(), priority });
                setMessage("");
              } finally {
                setSending(false);
              }
            }}
          >
            {sending ? "Sending..." : "Send highlight"}
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
          <div className="modalTitle">Reply to highlight</div>
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
              placeholder="Write your response back to the sender"
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
  patientId = "",
  patientName = "",
  patients,
  counselorOptions = [],
  currentUserEmail = "",
  defaultRecipientEmail = "",
  onClose,
  onSend,
}: {
  patientId?: string;
  patientName?: string;
  patients: Patient[];
  counselorOptions?: Array<{ email: string; label: string }>;
  currentUserEmail?: string;
  defaultRecipientEmail?: string;
  onClose: () => void;
  onSend: (payload: { message: string; priority: "normal" | "urgent"; recipientEmail: string; patientId: string }) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [recipientEmail, setRecipientEmail] = useState(() => defaultRecipientEmail || "");
  const [selectedPatientId, setSelectedPatientId] = useState(() => patientId || "");
  const [sending, setSending] = useState(false);
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Highlights</div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">
          <div className="addGrid">
            <label className="addField">
              <span className="addLabel">Patient</span>
              <select className="select" value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)}>
                <option value="">Choose patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Send to</span>
              <select className="select" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}>
                <option value="">Choose counselor</option>
                {counselorOptions
                  .filter((option) => option.email.toLowerCase() !== currentUserEmail.toLowerCase())
                  .map((option) => (
                  <option key={option.email} value={option.email}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="workspaceAgendaMeta" style={{ marginTop: 12 }}>Selected patient</div>
          <div className="workspaceAgendaDetail">{selectedPatient?.displayName || patientName || "Choose patient"}</div>
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
            disabled={sending || !message.trim() || !recipientEmail || !selectedPatientId}
            onClick={async () => {
              setSending(true);
              try {
                await onSend({ message: message.trim(), priority, recipientEmail, patientId: selectedPatientId });
              } finally {
                setSending(false);
              }
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
        <span className="themeFloatImage rainbow" aria-hidden="true" />
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
  const problemList = getProblemListSummary(compliance, patient);
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
          <div className="pill pill-active">{formatProgramBadge(patient.primaryProgram)}</div>
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
const _previewCardRetainedForFutureUse = PreviewCard;
void _previewCardRetainedForFutureUse;

/* -------------------- Patient Page -------------------- */

function PatientPage({
  patient,
  patientOptions,
  currentUserEmail,
  counselorOptions,
  allSessions,
  dataClient,
  hasAssignment,
  isAssignedToMe,
  assignedCounselorEmail,
  assignedCounselorLabel,
  compliance,
  onAssignCase,
  onClearAssignment,
  onUpdateCompliance,
  onUpdateRosterDetails,
  onUpdatePatient,
  onDeletePatient,
  canManageAssignment,
  canDeletePatient,
  canHighlightPatient,
  onSendHighlight,
  unreadHighlightNote,
  onMarkHighlightRead,
  onReplyToHighlight,
  onDocumentsTabActiveChange,
  onQuickScheduleSession,
}: {
  patient: Patient;
  patientOptions: Patient[];
  currentUserEmail: string;
  counselorOptions: Array<{ email: string; label: string }>;
  allSessions: Session[];
  dataClient: DataClient;
  hasAssignment: boolean;
  isAssignedToMe: boolean;
  assignedCounselorEmail?: string;
  assignedCounselorLabel?: string;
  compliance?: PatientCompliance;
  onAssignCase: () => void;
  onClearAssignment: () => void;
  onUpdateCompliance: (patch: CompliancePatch) => void;
  onUpdateRosterDetails: (patch: Partial<PatientRosterDetails>) => void;
  onUpdatePatient: (next: Patient) => void;
  onDeletePatient: () => void;
  canManageAssignment: boolean;
  canDeletePatient: boolean;
  canHighlightPatient: boolean;
  onSendHighlight: (payload: {
    patientId: string;
    message: string;
    priority: "normal" | "urgent";
    recipientEmail: string;
  }) => Promise<boolean>;
  unreadHighlightNote?: InAppNotification;
  onMarkHighlightRead: () => Promise<void>;
  onReplyToHighlight: (notificationId: string, message: string) => Promise<void>;
  onDocumentsTabActiveChange?: (active: boolean) => void;
  onQuickScheduleSession: (payload: {
    serviceDate: string;
    startTime: string;
    durationMinutes: number;
    modality: BillingModality;
  }) => Promise<{ ok: boolean; message: string }>;
}) {
  const [tab, setTab] = useState<"overview" | "documents" | "intake" | "snap" | "health" | "consents" | "ai" | "attendance">("overview");
  const [overviewPane, setOverviewPane] = useState<"summary" | "roster">("summary");
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
  const [vaultDocuments, setVaultDocuments] = useState<PatientVaultDocumentSummary[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultDocType, setVaultDocType] = useState<"assessment" | "asam_assessment" | "problem_list" | "problem_list_note" | "treatment_plan" | "medical_necessity_note" | "discharge_note" | "session">("assessment");
  const [vaultText, setVaultText] = useState("");
  const [vaultBusy, setVaultBusy] = useState<false | "pdf" | "text">(false);
  const [nameSlayerOpen, setNameSlayerOpen] = useState(false);
  const [nameSlayerBusy, setNameSlayerBusy] = useState<NameSlayerBusyState>(false);
  const [nameSlayerStage, setNameSlayerStage] = useState<NameSlayerStage>("workflow");
  const [nameSlayerFileName, setNameSlayerFileName] = useState("");
  const [nameSlayerRedactedText, setNameSlayerRedactedText] = useState("");
  const [nameSlayerStatus, setNameSlayerStatus] = useState("");
  const [nameSlayerExtraTermInput, setNameSlayerExtraTermInput] = useState("");
  const [aiNoteType, setAiNoteType] = useState<AiNoteType>("problem_list");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratedNote, setAiGeneratedNote] = useState("");
  const [showProblemListReviewModal, setShowProblemListReviewModal] = useState(false);
  const [reviewAdditionsInput, setReviewAdditionsInput] = useState("");
  const [reviewCompletionsInput, setReviewCompletionsInput] = useState("");
  const [documentPreview, setDocumentPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [showHighlightModal, setShowHighlightModal] = useState(false);
  const [programSaving, setProgramSaving] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [inlineReply, setInlineReply] = useState("");
  const [highlightActionBusy, setHighlightActionBusy] = useState<"read" | "reply" | null>(null);
  const [highlightReplyOpen, setHighlightReplyOpen] = useState(false);
  const [patientTabMenuOpen, setPatientTabMenuOpen] = useState(false);
  const patientTabMenuRef = useRef<HTMLDivElement | null>(null);
  const [showSignalPicker, setShowSignalPicker] = useState(false);
  const [selectedSignalKeys, setSelectedSignalKeys] = useState<string[]>(["assignment"]);
  const [showCompletionDatePicker, setShowCompletionDatePicker] = useState(false);
  const [completionDateDraft, setCompletionDateDraft] = useState("");
  const [completionDateSaving, setCompletionDateSaving] = useState(false);
  const isAutoWorkflowHighlight = Boolean(unreadHighlightNote?.id?.startsWith("auto-workflow:"));
  const weekdayOptions = useMemo(
    () => [
      { value: 0, label: "Sun" },
      { value: 1, label: "Mon" },
      { value: 2, label: "Tue" },
      { value: 3, label: "Wed" },
      { value: 4, label: "Thu" },
      { value: 5, label: "Fri" },
      { value: 6, label: "Sat" },
    ],
    []
  );
  const [attendanceRegimen, setAttendanceRegimen] = useState<PatientAttendanceRegimen>({
    requiredVisitDaysPerWeek: 3,
    requiredDrugTestsPerWeek: 1,
    requiredVisitWeekdays: [1, 3, 5],
    requiredTestWeekdays: [2],
  });
  const [regimenSaving, setRegimenSaving] = useState(false);
  const [regimenMessage, setRegimenMessage] = useState("");
  const [quickSessionDate, setQuickSessionDate] = useState(todayIso);
  const [quickSessionStart, setQuickSessionStart] = useState("9:00 am");
  const [quickSessionDuration, setQuickSessionDuration] = useState("60");
  const [quickSessionSaving, setQuickSessionSaving] = useState(false);
  const [quickSessionMessage, setQuickSessionMessage] = useState("");
  const [attendancePlannerEnabled, setAttendancePlannerEnabled] = useState(false);

  useEffect(() => {
    if (tab === "ai") return;
    setAiGeneratedNote("");
  }, [tab]);

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
    const storageKey = `patientfinder.attendance.regimen.v1.${normalizePatientId(patient.id)}`;
    const enabledKey = `patientfinder.attendance.enabled.v1.${normalizePatientId(patient.id)}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const enabledRaw = window.localStorage.getItem(enabledKey);
      if (enabledRaw != null) {
        setAttendancePlannerEnabled(enabledRaw === "1");
      }
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PatientAttendanceRegimen>;
      setAttendanceRegimen({
        requiredVisitDaysPerWeek: Math.max(1, Number(parsed.requiredVisitDaysPerWeek ?? 3)),
        requiredDrugTestsPerWeek: Math.max(0, Number(parsed.requiredDrugTestsPerWeek ?? 1)),
        requiredVisitWeekdays: Array.isArray(parsed.requiredVisitWeekdays)
          ? parsed.requiredVisitWeekdays.map((x) => Number(x)).filter((x) => x >= 0 && x <= 6)
          : [1, 3, 5],
        requiredTestWeekdays: Array.isArray(parsed.requiredTestWeekdays)
          ? parsed.requiredTestWeekdays.map((x) => Number(x)).filter((x) => x >= 0 && x <= 6)
          : [2],
      });
    } catch {
      // ignore invalid local cache
    }
  }, [patient.id]);

  useEffect(() => {
    const storageKey = `patientfinder.patient.signals.v1.${normalizePatientId(patient.id)}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setSelectedSignalKeys(["assignment"]);
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      const normalized = Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
      setSelectedSignalKeys(normalized.length ? normalized : []);
    } catch {
      setSelectedSignalKeys(["assignment"]);
    }
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

  useEffect(() => {
    if (tab !== "ai") return;
    let cancelled = false;
    setVaultLoading(true);
    dataClient
      .getPatientVaultDocuments(patient.id)
      .then((rows) => {
        if (cancelled) return;
        setVaultDocuments(rows);
        setVaultLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to load AI Vault documents:", error);
        setVaultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataClient, patient.id, tab, vaultBusy]);

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
  const hasVaultAssessment = useMemo(
    () => vaultDocuments.some((doc) => {
      const type = String(doc.document_type).replace(/^vault:/, "");
      return type === "assessment" || type === "asam_assessment";
    }),
    [vaultDocuments]
  );
  const hasVaultProblemList = useMemo(
    () => vaultDocuments.some((doc) => String(doc.document_type).replace(/^vault:/, "") === "problem_list"),
    [vaultDocuments]
  );
  const hasVaultSession = useMemo(
    () => vaultDocuments.some((doc) => String(doc.document_type).replace(/^vault:/, "") === "session"),
    [vaultDocuments]
  );

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
  const problemListSummary = getProblemListSummary(compliance, patient);
  const treatmentPlanSummary = getTreatmentPlanSummary(patient, compliance);
  const therapySummary = getTherapySummary(patient);
  const roster = patient.rosterDetails ?? {};
  const counselorDisplay = cleanPersonLabel(assignedCounselorLabel ?? patient.counselor, "Unassigned");
  const assignedCounselorDisplay = cleanPersonLabel(assignedCounselorLabel ?? assignedCounselorEmail, "another counselor");
  const cellPhone = getField(ans, "s5", "Cell phone");
  const homePhone = getField(ans, "s5", "Home phone");
  const emailAddress = getField(ans, "s5", "Email address");
  const streetAddress = getField(ans, "s5", "Street address");
  const city = getField(ans, "s5", "City");
  const zipCode = getField(ans, "s5", "ZIP code");
  const emergencyContactName = getField(ans, "s18", "Full name");
  const emergencyContactPhone = getField(ans, "s18", "Phone number");
  const phoneSummary = [cellPhone, homePhone].filter(Boolean).join(" / ") || "Not set";
  const addressSummary = [streetAddress, city, zipCode].filter(Boolean).join(", ") || "Not set";
  const signalItems = useMemo(
    () => [
      {
        key: "assignment",
        label: "Assignment",
        value: hasAssignment
          ? isAssignedToMe
            ? "Assigned to your case load"
            : `Assigned to ${assignedCounselorDisplay}`
          : "Not assigned yet",
      },
      { key: "drug_testing", label: "Drug testing", value: drugTestSummary.label },
      { key: "problem_list", label: "Problem list", value: problemListSummary.reviewText },
      { key: "treatment_plan", label: "Treatment plan", value: treatmentPlanSummary.updateText },
      { key: "therapy", label: "Therapy", value: therapySummary.label },
      { key: "drug_of_choice", label: "Drug of choice", value: roster.drugOfChoice?.length ? roster.drugOfChoice.join(", ") : "Not set in intake yet" },
      { key: "intake_date", label: "Intake date", value: fmt(patient.intakeDate) },
      { key: "last_visit", label: "Last visit", value: fmt(patient.lastVisitDate) },
      { key: "next_appointment", label: "Next appointment", value: fmt(patient.nextApptDate) },
      { key: "program", label: "Program", value: patient.primaryProgram ?? "Not set" },
      { key: "location", label: "Location", value: patient.location ?? "Not set" },
      { key: "counselor", label: "Counselor", value: counselorDisplay },
      { key: "birthday", label: "Birthday", value: fmt(patient.dateOfBirth) },
      { key: "phone", label: "Phone", value: phoneSummary },
      { key: "email", label: "Email", value: emailAddress || "Not set" },
      { key: "address", label: "Address", value: addressSummary },
      { key: "emergency_contact", label: "Emergency contact", value: emergencyContactName || "Not set" },
      { key: "emergency_phone", label: "Emergency phone", value: emergencyContactPhone || "Not set" },
      { key: "mat", label: "MAT", value: roster.matStatus ?? "Not set" },
      { key: "medical_phys_apt", label: "Medical / Phys Apt", value: roster.medicalPhysApt ?? "Not set" },
      { key: "med_form_status", label: "Med form", value: roster.medFormStatus ?? "Not set" },
      { key: "referring_agency", label: "Referring agency", value: roster.referringAgency ?? "Not set" },
      { key: "medical_eligibility", label: "Medical eligibility", value: roster.medicalEligibility ?? "Not set" },
      { key: "reauth_sapc", label: "Reauth SAP-C", value: fmt(roster.reauthSapcDate) },
    ],
    [
      addressSummary,
      assignedCounselorDisplay,
      counselorDisplay,
      drugTestSummary.label,
      emailAddress,
      emergencyContactName,
      emergencyContactPhone,
      hasAssignment,
      isAssignedToMe,
      patient.dateOfBirth,
      patient.intakeDate,
      patient.lastVisitDate,
      patient.location,
      patient.nextApptDate,
      patient.primaryProgram,
      phoneSummary,
      problemListSummary.reviewText,
      roster.matStatus,
      roster.medFormStatus,
      roster.medicalEligibility,
      roster.medicalPhysApt,
      roster.reauthSapcDate,
      roster.referringAgency,
      roster.drugOfChoice,
      therapySummary.label,
      treatmentPlanSummary.updateText,
    ]
  );
  const visibleSignalItems = useMemo(
    () => signalItems.filter((item) => selectedSignalKeys.includes(item.key)),
    [signalItems, selectedSignalKeys]
  );
  const getSnapshotToneClass = (key: string) => {
    if (["problem_list", "treatment_plan", "reauth_sapc"].includes(key)) return "toneDue";
    if (["drug_testing", "medical_eligibility", "mat", "medical_phys_apt", "med_form_status"].includes(key)) return "toneClinical";
    if (["assignment", "counselor", "referring_agency", "therapy"].includes(key)) return "toneAdmin";
    if (["phone", "email", "address", "emergency_contact", "emergency_phone"].includes(key)) return "toneContact";
    if (["intake_date", "last_visit", "next_appointment", "birthday"].includes(key)) return "toneDate";
    if (["program", "location", "drug_of_choice"].includes(key)) return "toneProgram";
    return "toneDefault";
  };
  const toggleSignalKey = (key: string) => {
    setSelectedSignalKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key];
      const storageKey = `patientfinder.patient.signals.v1.${normalizePatientId(patient.id)}`;
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };
  const updateConsentRawJson = async (newJson: any) => {
    if (!sub) return;
    const previous = sub;
    // Optimistic update so intake edits feel instant on slower/mobile connections.
    setSub({ ...(sub as IntakeSubmission), raw_json: newJson });
    try {
      const next = await dataClient.updateIntakeSubmission(sub.id, { raw_json: newJson });
      setSub(next as IntakeSubmission);
    } catch (error) {
      setSub(previous);
      console.error("Unable to save intake changes:", error);
      window.alert("Could not save intake changes. Please try again.");
    }
  };

  const handlePrimaryProgramChange = async (newProgram: string) => {
    const previousPatient = patient;
    const previousPrimaryProgram = String(patient.primaryProgram ?? "").trim();
    const nextPrimaryProgram = String(newProgram ?? "").trim();
    const shouldResetProblemList =
      Boolean(previousPrimaryProgram) &&
      Boolean(nextPrimaryProgram) &&
      previousPrimaryProgram.toLowerCase() !== nextPrimaryProgram.toLowerCase();
    onUpdatePatient({
      ...patient,
      primaryProgram: nextPrimaryProgram || undefined,
      kind: derivePatientKind(nextPrimaryProgram || undefined, patient.status, patient.intakeDate),
    });
    setProgramSaving(true);
    try {
      const saved = await dataClient.updatePatient(patient.id, { primary_program: nextPrimaryProgram || null }) as any;
      const savedPrimaryProgram = String(saved?.primary_program ?? nextPrimaryProgram ?? "").trim();
      if (shouldResetProblemList && savedPrimaryProgram) {
        await onUpdateCompliance({
          resetProblemListCycle: true,
          problemListDate: undefined,
          lastProblemListReview: undefined,
          lastProblemListUpdate: undefined,
        });
      }
      const merged = { ...patient, ...mergePatientWithExtras(saved ?? {}, undefined, patient.rosterDetails), id: patient.id };
      onUpdatePatient({
        ...merged,
        primaryProgram: savedPrimaryProgram || undefined,
      });
    } catch (error) {
      onUpdatePatient(previousPatient);
      console.error("Unable to update patient program:", error);
      window.alert(getRequestErrorMessage(error, "Could not save patient program. Please try again."));
    } finally {
      setProgramSaving(false);
    }
  };

  const completionDateValue = toDateOnly(patient.lastVisitDate) ?? "";
  const openCompletionDatePicker = () => {
    setCompletionDateDraft(completionDateValue);
    setShowCompletionDatePicker(true);
  };
  const daysInTreatment = Math.max(0, dayDiff(patient.intakeDate, todayIso()));
  const ninetyDayDate = addDaysIso(patient.intakeDate, 90);
  const hasReachedNinetyDays = daysInTreatment >= 90 || patient.kind === "RSS" || patient.kind === "RSS+" || patient.kind === "Former Patient";
  const hasRssBadge = patient.kind === "RSS" || patient.kind === "RSS+" || patient.kind === "Former Patient";
  const hasCompletionBadge = patient.kind === "Former Patient" || Boolean(completionDateValue);
  const trajectoryMilestones = [
    {
      key: "intake",
      label: "Intake",
      detail: fmt(patient.intakeDate),
      active: true,
      tone: "intake",
    },
    {
      key: "ninety",
      label: "90 days",
      detail: hasReachedNinetyDays ? fmt(ninetyDayDate) : `${Math.max(0, 90 - daysInTreatment)} days left`,
      active: hasReachedNinetyDays,
      tone: "ninety",
    },
    {
      key: "rss",
      label: patient.kind === "RSS+" ? "RSS+" : "RSS",
      detail: hasRssBadge ? "Recovery support" : "Not yet",
      active: hasRssBadge,
      tone: "rss",
    },
    {
      key: "completion",
      label: "Completion",
      detail: completionDateValue ? fmt(completionDateValue) : patient.kind === "Former Patient" ? "Past patient" : "Not yet",
      active: hasCompletionBadge,
      tone: "completion",
      onClick: openCompletionDatePicker,
    },
  ];
  const saveCompletionDate = async () => {
    setCompletionDateSaving(true);
    try {
      await dataClient.updatePatient(patient.id, { last_visit_date: completionDateDraft || null });
      onUpdatePatient({ ...patient, lastVisitDate: completionDateDraft || undefined });
      setShowCompletionDatePicker(false);
    } finally {
      setCompletionDateSaving(false);
    }
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const patientTabs = [
    { key: "overview", label: "Overview" },
    { key: "ai", label: "AI" },
    { key: "intake", label: "Intake" },
    { key: "snap", label: "SNAP" },
    { key: "health", label: "Health" },
    { key: "consents", label: "Consents" },
    { key: "attendance", label: "Visits & tests" },
  ] as const;

  useEffect(() => {
    if (!patientTabMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (patientTabMenuRef.current?.contains(target)) return;
      setPatientTabMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPatientTabMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [patientTabMenuOpen]);

  const toggleRegimenWeekday = (key: "requiredVisitWeekdays" | "requiredTestWeekdays", weekday: number) => {
    setAttendanceRegimen((prev) => {
      const existing = prev[key];
      const next = existing.includes(weekday) ? existing.filter((x) => x !== weekday) : [...existing, weekday].sort((a, b) => a - b);
      return { ...prev, [key]: next };
    });
  };

  const saveAttendanceRegimen = async () => {
    const normalized: PatientAttendanceRegimen = {
      requiredVisitDaysPerWeek: Math.max(1, Math.round(attendanceRegimen.requiredVisitDaysPerWeek || 1)),
      requiredDrugTestsPerWeek: Math.max(0, Math.round(attendanceRegimen.requiredDrugTestsPerWeek || 0)),
      requiredVisitWeekdays: [...new Set(attendanceRegimen.requiredVisitWeekdays)].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b),
      requiredTestWeekdays: [...new Set(attendanceRegimen.requiredTestWeekdays)].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b),
    };
    const storageKey = `patientfinder.attendance.regimen.v1.${normalizePatientId(patient.id)}`;
    setRegimenSaving(true);
    setRegimenMessage("");
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
      setAttendanceRegimen(normalized);
      const primaryTestDay = normalized.requiredTestWeekdays[0];
      await onUpdateCompliance({
        drugTestMode: normalized.requiredDrugTestsPerWeek > 0 ? "weekly_count" : "none",
        drugTestsPerWeek: normalized.requiredDrugTestsPerWeek > 0 ? normalized.requiredDrugTestsPerWeek : undefined,
        drugTestWeekday: primaryTestDay != null ? String(primaryTestDay) : undefined,
      });
      setRegimenMessage("Saved regimen.");
    } catch {
      setRegimenMessage("Could not save regimen. Please try again.");
    } finally {
      setRegimenSaving(false);
    }
  };

  const toggleAttendancePlannerEnabled = () => {
    const next = !attendancePlannerEnabled;
    setAttendancePlannerEnabled(next);
    const enabledKey = `patientfinder.attendance.enabled.v1.${normalizePatientId(patient.id)}`;
    window.localStorage.setItem(enabledKey, next ? "1" : "0");
  };

  const scheduleQuickSession = async () => {
    const durationMinutes = parseDurationMinutes(quickSessionDuration);
    if (!quickSessionDate || !quickSessionStart || durationMinutes == null) {
      setQuickSessionMessage("Enter date, start time, and duration.");
      return;
    }
    setQuickSessionSaving(true);
    setQuickSessionMessage("");
    try {
      const result = await onQuickScheduleSession({
        serviceDate: quickSessionDate,
        startTime: quickSessionStart,
        durationMinutes,
        modality: "FF",
      });
      setQuickSessionMessage(result.message);
      if (result.ok) {
        setQuickSessionStart("9:00 am");
        setQuickSessionDuration("60");
      }
    } catch {
      setQuickSessionMessage("Could not schedule session. Please try again.");
    } finally {
      setQuickSessionSaving(false);
    }
  };

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
    if (sub) {
      return;
    }
    const emptyJson = {
      meta: { createdAt: new Date().toISOString(), source: "manual" },
      sections: {
        intake: {
          fields: {
            "s5::Full legal name": patient.displayName ?? "",
            "s5::Date of birth": patient.dateOfBirth ?? "",
          },
          radios: {
            location: patient.location ?? "",
            mat: patient.rosterDetails?.matStatus ?? "",
            referring_agency: patient.rosterDetails?.referringAgency ?? "",
            medical_eligibility: patient.rosterDetails?.medicalEligibility ?? "",
          },
          multi: {
            substances: patient.rosterDetails?.drugOfChoice ?? [],
          },
        },
        snap: {
          strengths: [],
          needs: [],
          abilities: [],
          preferences: [],
        },
      },
      consents: buildSeedConsents(patient.displayName ?? "", todayIso()),
    };
    const data = await dataClient.createIntakeSubmission({
      patient_id: patient.id,
      submitted_full_name: patient.displayName ?? null,
      submitted_dob: patient.dateOfBirth ?? null,
      submitted_location: patient.location ?? null,
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

  const uploadVaultTextPayload = async (text: string, fileName?: string) => {
    if (!text.trim()) return;
    setVaultBusy("text");
    try {
      await dataClient.uploadVaultText(patient.id, {
        documentType: vaultDocType,
        text: text.trim(),
        fileName,
      });
    } catch (error) {
      console.error("Unable to upload vault text:", error);
      window.alert("Could not save text to Vault right now.");
      throw error;
    } finally {
      setVaultBusy(false);
    }
  };

  const uploadVaultText = async () => {
    if (!vaultText.trim()) return;
    try {
      await uploadVaultTextPayload(vaultText.trim());
      setVaultText("");
    } catch (error) {
      console.error("Unable to upload vault text:", error);
    } finally {
      // handled by uploadVaultTextPayload
    }
  };

  const closeNameSlayerModal = () => {
    if (nameSlayerBusy === "extracting" || nameSlayerBusy === "saving") return;
    setNameSlayerOpen(false);
    setNameSlayerBusy(false);
    setNameSlayerStage("workflow");
    setNameSlayerFileName("");
    setNameSlayerRedactedText("");
    setNameSlayerStatus("");
    setNameSlayerExtraTermInput("");
  };

  const openNameSlayerPdf = async (file: File) => {
    setNameSlayerFileName(file.name);
    setNameSlayerRedactedText("");
    setNameSlayerStatus("Processing locally...");
    setNameSlayerExtraTermInput("");
    setNameSlayerBusy("extracting");
    setNameSlayerStage("splash");
    setNameSlayerOpen(true);
    try {
      const sourceText = await extractTextFromPdf(file);
      if (!sourceText.trim()) {
        setNameSlayerRedactedText("");
        setNameSlayerStatus("No readable text was found in that PDF.");
        return;
      }
      setNameSlayerRedactedText(applyNameSlayerRedactions(sourceText, getNameSlayerPatientTerms(patient.displayName ?? "")));
      setNameSlayerStatus("Review the redacted text and remove any missed PHI.");
    } catch (error) {
      console.error("Unable to prepare Name Slayer document:", error);
      setNameSlayerRedactedText("");
      setNameSlayerStatus(error instanceof Error ? error.message : "Could not read that PDF locally.");
    } finally {
      setNameSlayerBusy(false);
    }
  };

  useEffect(() => {
    if (!nameSlayerOpen) return;
    const timer = window.setTimeout(() => setNameSlayerStage("workflow"), 2000);
    return () => window.clearTimeout(timer);
  }, [nameSlayerOpen]);

  const saveNameSlayerResultToVault = async () => {
    if (!nameSlayerRedactedText.trim()) return;
    setNameSlayerBusy("saving");
    try {
      const baseName = nameSlayerFileName.replace(/\.[^.]+$/, "") || "redacted";
      await uploadVaultTextPayload(nameSlayerRedactedText, `${baseName}.redacted.txt`);
      setNameSlayerOpen(false);
      setNameSlayerFileName("");
      setNameSlayerRedactedText("");
      setNameSlayerStatus("");
      setNameSlayerExtraTermInput("");
      window.alert("Redacted text saved to Vault.");
    } catch {
      // uploadVaultTextPayload already showed the error.
    } finally {
      setNameSlayerBusy(false);
    }
  };

  const copyNameSlayerResult = async () => {
    if (!nameSlayerRedactedText.trim()) return;
    try {
      await navigator.clipboard.writeText(nameSlayerRedactedText);
    } catch (error) {
      console.error("Unable to copy redacted text:", error);
      window.alert("Could not copy redacted text to clipboard.");
    }
  };

  const applyNameSlayerExtraTerms = () => {
    const terms = nameSlayerExtraTermInput
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    if (!terms.length) {
      setNameSlayerStatus("Enter a name or term to redact.");
      return;
    }
    setNameSlayerRedactedText((current) => applyNameSlayerExtraTermRedactions(current, terms));
    setNameSlayerStatus(`Redacted ${terms.length === 1 ? "the selected term" : `${terms.length} terms`} throughout the text.`);
    setNameSlayerExtraTermInput("");
  };

  const generateAiNote = async (reviewContext?: { additions?: string; completions?: string }) => {
    if (aiNoteType === "problem_list" && !hasVaultAssessment) {
      window.alert("Upload an Assessment in AI Vault before generating a Problem List.");
      return;
    }
    if (aiNoteType === "problem_list_note" && (!hasVaultAssessment || !hasVaultProblemList)) {
      window.alert("Upload both Assessment and Problem List in AI Vault before generating a Problem List Note.");
      return;
    }
    if (aiNoteType === "problem_list_review" && (!hasVaultAssessment || !hasVaultProblemList)) {
      window.alert("Upload both Assessment and Problem List in AI Vault before generating a Problem List Review.");
      return;
    }
    if (aiNoteType === "treatment_plan" && (!hasVaultAssessment || !hasVaultProblemList)) {
      window.alert("Upload both Assessment and Problem List in AI Vault before generating a Treatment Plan.");
      return;
    }
    setAiGenerating(true);
    try {
      const response = await dataClient.generateAiPatientNote(patient.id, { noteType: aiNoteType, reviewContext });
      setAiGeneratedNote(response.note || "");
    } catch (error) {
      console.error("Unable to generate AI note:", error);
      window.alert(error instanceof Error ? error.message : "Could not generate note right now.");
    } finally {
      setAiGenerating(false);
    }
  };

  const saveGeneratedAiNote = async () => {
    if (!aiGeneratedNote.trim()) return;
    setVaultBusy("text");
    try {
      await dataClient.uploadVaultText(patient.id, {
        documentType: aiNoteType,
        text: aiGeneratedNote.trim(),
        fileName: `${aiNoteType}_${todayIso()}.txt`,
      });
      window.alert("Generated note saved to Vault.");
    } catch (error) {
      console.error("Unable to save generated AI note:", error);
      window.alert("Could not save generated note to Vault.");
    } finally {
      setVaultBusy(false);
    }
  };

  const copyGeneratedAiNote = async () => {
    if (!aiGeneratedNote.trim()) return;
    try {
      await navigator.clipboard.writeText(aiGeneratedNote);
    } catch (error) {
      console.error("Unable to copy generated AI note:", error);
      window.alert("Could not copy note to clipboard.");
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
    <div
      className="patientWrap"
      onClickCapture={(event) => {
        if (!event.shiftKey) return;
        if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea, a, summary, [role='button']")) return;
        event.preventDefault();
        event.stopPropagation();
        setShowHighlightModal(true);
      }}
    >
      <div className="panel" style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div className="panelHead patientPageHead">
          <span>{patient.displayName}</span>
          <IntakeChoiceSelect
            value={patient.primaryProgram ?? ""}
            options={PRIMARY_PROGRAM_OPTS}
            onChange={(value) => handlePrimaryProgramChange(value)}
            className="iChoiceSelectInline"
            buttonClassName={`${pillClass(patient.kind)} patientKindPill patientKindPillSelect`}
            disabled={programSaving}
          />
          {canHighlightPatient || canManageAssignment || canDeletePatient ? (
            <details className="patientActionMenu">
              <summary className="btn ghost btnCompact patientActionMenuTrigger" aria-label="Patient actions" title="Patient actions">⋯</summary>
              <div className="patientActionMenuList">
                {canHighlightPatient ? (
                  <button className="patientActionMenuItem" type="button" onClick={() => setShowHighlightModal(true)}>
                    Highlight
                  </button>
                ) : null}
                {canManageAssignment ? (
                  <button className="patientActionMenuItem" type="button" onClick={onAssignCase}>
                    {hasAssignment ? "Reassign Case" : "Assign Case"}
                  </button>
                ) : null}
                {canManageAssignment && hasAssignment ? (
                  <button className="patientActionMenuItem" type="button" onClick={onClearAssignment}>
                    Remove Case Assignment
                  </button>
                ) : null}
                {canDeletePatient ? (
                  <button
                    className="patientActionMenuItem danger"
                    type="button"
                    onClick={() => setShowDeleteModal(true)}
                    title="Delete patient (admin only)"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
        <div className="panelBody">
          <div className="hero">
            <div>
              <div className="heroNameRow">
              </div>
              <div className="heroMeta">
                <span style={{ color: "#d89bff" }}>SAGE # {patient.mrn ?? "—"}</span>
                {" • "}
                <span style={{ color: "#88b8ff" }}>{patient.primaryProgram ?? "—"}</span>
                {" • "}
                <span style={{ color: "#ff7a55" }}>
                  {formatSpreadsheetDrugChoices(
                    patient.rosterDetails?.drugOfChoice
                  )}
                </span>
                {" • "}
                Counselor {counselorDisplay}
              </div>
            </div>
            <div className="patientHeroActions" />
          </div>
          {unreadHighlightNote ? (
            <section className={`patientStickyNote ${unreadHighlightNote.priority === "urgent" ? "urgent" : "normal"}`}>
              <div className="patientStickyHead">
                <strong>
                  {isAutoWorkflowHighlight
                    ? unreadHighlightNote.priority === "urgent"
                      ? "Urgent PatientFinder note"
                      : "PatientFinder note"
                    : unreadHighlightNote.priority === "urgent"
                      ? "Urgent admin note"
                      : "Admin note"}
                </strong>
                <span>
                  {formatNotificationTimestamp(unreadHighlightNote.createdAt)}
                  {unreadHighlightNote.senderEmail ? ` • ${unreadHighlightNote.senderEmail}` : ""}
                </span>
              </div>
              <div className="patientStickyBody">{unreadHighlightNote.message}</div>
              {isAutoWorkflowHighlight ? (
                <div className="patientStickyLockNotice">
                  This highlight was auto-generated by PatientFinder and will clear only after the required date is set.
                </div>
              ) : null}
              {highlightReplyOpen ? (
                <div className="patientStickyReply">
                  <textarea
                    className="authInput controlCenterTextarea"
                    value={inlineReply}
                    onChange={(e) => setInlineReply(e.target.value)}
                    placeholder="Type your response back to admin"
                  />
                  <div className="patientStickyActions">
                    <button
                      className="btn ghost btnCompact"
                      disabled={highlightActionBusy !== null}
                      onClick={() => {
                        setInlineReply("");
                        setHighlightReplyOpen(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btnCompact"
                      disabled={highlightActionBusy !== null || !inlineReply.trim()}
                      onClick={async () => {
                        setHighlightActionBusy("reply");
                        try {
                          await onReplyToHighlight(unreadHighlightNote.id, inlineReply.trim());
                          setInlineReply("");
                          setHighlightReplyOpen(false);
                        } finally {
                          setHighlightActionBusy(null);
                        }
                      }}
                    >
                      {highlightActionBusy === "reply" ? "Sending..." : "Send reply"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="patientStickyActions">
                  {!isAutoWorkflowHighlight ? (
                    <>
                      <button
                        className="btn ghost btnCompact"
                        disabled={highlightActionBusy !== null}
                        onClick={async () => {
                          setHighlightActionBusy("read");
                          try {
                            await onMarkHighlightRead();
                          } finally {
                            setHighlightActionBusy(null);
                          }
                        }}
                      >
                        {highlightActionBusy === "read" ? "Marking..." : "Read"}
                      </button>
                      <button
                        className="btn btnCompact"
                        disabled={highlightActionBusy !== null}
                        onClick={() => setHighlightReplyOpen(true)}
                      >
                        Reply
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          <div className="patientTabMenu">
            <div className="patientTabMenuControl" ref={patientTabMenuRef}>
              <button
                type="button"
                className="patientTabMenuButton"
                onClick={() => setPatientTabMenuOpen((current) => !current)}
                aria-expanded={patientTabMenuOpen}
                aria-haspopup="menu"
                aria-label="Patient section"
              >
                <span className="patientTabMenuIcon" aria-hidden="true">☰</span>
                <span className="patientTabMenuCurrent">
                  {patientTabs.find((item) => item.key === tab)?.label ?? "Overview"}
                </span>
                <span className="patientTabMenuCaret" aria-hidden="true">▾</span>
              </button>
              {patientTabMenuOpen ? (
                <div className="patientTabMenuDropdown" role="menu" aria-label="Patient sections">
                {patientTabs.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={tab === item.key ? "patientTabMenuItem on" : "patientTabMenuItem"}
                      role="menuitemradio"
                      aria-checked={tab === item.key}
                      onClick={() => {
                        setTab(item.key);
                        setPatientTabMenuOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                ))}
                </div>
              ) : null}
            </div>
          </div>

          {tab === "overview" ? (
            <>
              <div className="overviewSubTabs">
                <button
                  className={overviewPane === "summary" ? "tabBtn on compact overviewTabBtn" : "tabBtn compact overviewTabBtn"}
                  onClick={() => setOverviewPane("summary")}
                >
                  Summary
                </button>
                <button
                  className={overviewPane === "roster" ? "tabBtn on compact rosterFieldsTabBtn" : "tabBtn compact rosterFieldsTabBtn"}
                  onClick={() => setOverviewPane("roster")}
                >
                  Roster Fields
                </button>
              </div>

              {overviewPane === "summary" ? (
                <>
                  <div className="tile overviewUnifiedCard">
                    <div className="overviewSignalsHead">
                      <div className="sectionTitle" style={{ marginBottom: 0 }}>Clinical Snapshot</div>
                      <button
                        className="btn ghost btnCompact"
                        onClick={() => setShowSignalPicker(true)}
                        aria-label="Choose clinical snapshot fields"
                        title="Choose clinical snapshot fields"
                      >
                        ⚙
                      </button>
                    </div>
                    <div className="overviewSignalRows">
                      {visibleSignalItems.map((item) => (
                        <div key={item.key} className={`overviewSignalRow ${getSnapshotToneClass(item.key)}`}>
                          <strong>{item.label}</strong>
                          <span>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="trajectoryRoadCard" aria-label="Patient treatment trajectory">
                    <div className="trajectoryRoad" aria-hidden="true" />
                    {trajectoryMilestones.map((milestone) => {
                      const content = (
                        <>
                          <span className="trajectoryBadgeLabel">{milestone.label}</span>
                          <span className="trajectoryBadgeDetail">{milestone.detail}</span>
                        </>
                      );
                      const className = `trajectoryBadge ${milestone.active ? "active" : "pending"} trajectoryBadge-${milestone.tone}`;
                      return milestone.onClick ? (
                        <button
                          key={milestone.key}
                          type="button"
                          className={className}
                          onClick={milestone.onClick}
                          title="Set completion date"
                        >
                          {content}
                        </button>
                      ) : (
                        <div key={milestone.key} className={className}>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {overviewPane === "roster" ? (
                <>
              <div className="controlCenterGrid">
                  <label className="addField">
                    <span className="addLabel">Primary program</span>
                    <IntakeChoiceSelect
                      value={patient.primaryProgram ?? ""}
                      options={PRIMARY_PROGRAM_OPTS}
                      onChange={(value) => handlePrimaryProgramChange(value)}
                      buttonClassName={pillClass(patient.kind)}
                      disabled={programSaving}
                    />
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
            <div className="attendanceHistorySection">
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="panelHead attendancePanelHeadRow">
                  <span>Schedule session</span>
                  <div className="attendanceHeadTiles">
                    <div className="tile attendanceHeadTile">
                      <div className="label">Last visit</div>
                      <div className="value">{fmt(patient.lastVisitDate)}</div>
                    </div>
                    <div className="tile attendanceHeadTile">
                      <div className="label">Next appointment</div>
                      <div className="value">{fmt(patient.nextApptDate)}</div>
                    </div>
                  </div>
                  <button
                    className={attendancePlannerEnabled ? "btn ghost attendanceToggleBtn on" : "btn ghost attendanceToggleBtn"}
                    onClick={toggleAttendancePlannerEnabled}
                  >
                    {attendancePlannerEnabled ? "Attendance on" : "Attendance off"}
                  </button>
                </div>
                <div className="panelBody">
                  <fieldset className="attendanceFieldset" disabled={!attendancePlannerEnabled}>
                  <div className="attendanceScheduleRow">
                    <label className="addField">
                      <span className="addLabel">Date</span>
                      <input className="authInput" type="date" value={quickSessionDate} onChange={(e) => setQuickSessionDate(e.target.value)} />
                    </label>
                    <label className="addField">
                      <span className="addLabel">Start time</span>
                      <input className="authInput" value={quickSessionStart} onChange={(e) => setQuickSessionStart(e.target.value)} placeholder="9:00 am" />
                    </label>
                    <label className="addField">
                      <span className="addLabel">Duration (minutes)</span>
                      <input className="authInput" value={quickSessionDuration} onChange={(e) => setQuickSessionDuration(e.target.value)} placeholder="60" />
                    </label>
                  </div>
                  <div className="homeTools" style={{ marginTop: 10 }}>
                    <button className="btn" onClick={() => void scheduleQuickSession()} disabled={quickSessionSaving}>
                      {quickSessionSaving ? "Scheduling..." : "Schedule session"}
                    </button>
                    {quickSessionMessage ? <span className="hintTiny">{quickSessionMessage}</span> : null}
                  </div>
                  </fieldset>
                </div>
              </div>
              <div className={attendancePlannerEnabled ? "" : "attendanceSectionDisabled"}>
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="panelHead">Regimen planner</div>
                <div className="panelBody">
                  <fieldset className="attendanceFieldset" disabled={!attendancePlannerEnabled}>
                    <div className="attendanceRegimenSplit">
                      <div className="attendanceRegimenCol">
                        <label className="addField">
                          <span className="addLabel">Days per week</span>
                          <input
                            className="authInput"
                            type="number"
                            min="1"
                            max="7"
                            value={attendanceRegimen.requiredVisitDaysPerWeek}
                            onChange={(e) =>
                              setAttendanceRegimen((prev) => ({ ...prev, requiredVisitDaysPerWeek: Number(e.target.value) || 1 }))
                            }
                          />
                        </label>
                        <div className="attendanceWeekdayRow" style={{ marginTop: 8 }}>
                          {weekdayOptions.filter((day) => day.value >= 1 && day.value <= 5).map((day) => (
                            <label key={`visit-${day.value}`} className="multiCheckItem">
                              <input
                                type="checkbox"
                                checked={attendanceRegimen.requiredVisitWeekdays.includes(day.value)}
                                onChange={() => toggleRegimenWeekday("requiredVisitWeekdays", day.value)}
                              />
                              {day.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="attendanceRegimenCol">
                        <label className="addField">
                          <span className="addLabel">Drug tests per week</span>
                          <input
                            className="authInput"
                            type="number"
                            min="0"
                            max="7"
                            value={attendanceRegimen.requiredDrugTestsPerWeek}
                            onChange={(e) =>
                              setAttendanceRegimen((prev) => ({ ...prev, requiredDrugTestsPerWeek: Number(e.target.value) || 0 }))
                            }
                          />
                        </label>
                        <div className="attendanceWeekdayRow" style={{ marginTop: 8 }}>
                          {weekdayOptions.filter((day) => day.value >= 1 && day.value <= 5).map((day) => (
                            <label key={`test-${day.value}`} className="multiCheckItem">
                              <input
                                type="checkbox"
                                checked={attendanceRegimen.requiredTestWeekdays.includes(day.value)}
                                onChange={() => toggleRegimenWeekday("requiredTestWeekdays", day.value)}
                              />
                              {day.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="homeTools" style={{ marginTop: 10 }}>
                      <button className="btn" onClick={() => void saveAttendanceRegimen()} disabled={regimenSaving}>
                        {regimenSaving ? "Saving..." : "Save regimen"}
                      </button>
                      {regimenMessage ? <span className="hintTiny">{regimenMessage}</span> : null}
                    </div>
                  </fieldset>
                </div>
              </div>
              <WeeklyAttendanceMeter patient={patient} sessions={allSessions} weekDate={attendanceWeekDate} />
              <AttendanceTrendGraph patient={patient} sessions={allSessions} />
              <div className="table attendanceHistoryTable">
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
               <SnapTab rawJson={(sub.raw_json as any)} onRawJsonUpdate={updateConsentRawJson} />}
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

          {tab === "ai" ? (
            <div className="section">
              <div className="aiWorkspace">
                <div className="aiCol aiColUpload">
                  <div className="sectionTitle aiColTitle">Upload to Vault</div>
                  <div className="aiPanelBody">
                    <div className="aiControlRow">
                      <label className="addField aiDocTypeField">
                        <span className="addLabel">Document type</span>
                        <select className="select" value={vaultDocType} onChange={(e) => setVaultDocType(e.target.value as typeof vaultDocType)}>
                          <option value="assessment">Assessment</option>
                          <option value="asam_assessment">ASAM Assessment</option>
                          <option value="problem_list">Problem List</option>
                          <option value="problem_list_note">Problem List Note</option>
                          <option value="treatment_plan">Treatment Plan</option>
                          <option value="medical_necessity_note">Medical Necessity Note</option>
                          <option value="discharge_note">Discharge Note</option>
                          <option value="session">Session</option>
                        </select>
                      </label>
                      <label className="addField aiFileField">
                        <span className="addLabel">PDF file (opens Name Slayer)</span>
                        <input
                          className="authInput aiFileInputPlain"
                          type="file"
                          accept="application/pdf"
                          disabled={vaultBusy !== false || nameSlayerBusy !== false}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            void openNameSlayerPdf(file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div className="hintTiny">PDFs are processed locally in the browser. Only the cleaned text is saved to the Vault.</div>
                    <div className="aiRequirementSlot aiRequirementSlotEmpty" aria-hidden="true" />
                    <label className="addField aiUploadTextWrap">
                      <span className="addLabel">Or paste text</span>
                      <textarea
                        className="authInput controlCenterTextarea"
                        value={vaultText}
                        onChange={(e) => setVaultText(e.target.value)}
                        placeholder="Paste or type text to store in Vault (.txt)"
                      />
                    </label>
                    <div className="aiVaultUploadWrap">
                      <button
                        className="btn aiVaultUploadFab"
                        disabled={vaultBusy !== false || !vaultText.trim()}
                        onClick={() => void uploadVaultText()}
                        aria-label={vaultBusy === "text" ? "Uploading" : "Upload text to vault"}
                        title={vaultBusy === "text" ? "Uploading..." : "Upload to Vault"}
                      >
                        {vaultBusy === "text" ? "…" : "⬆"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="aiCol aiColGenerate">
                  <div className="sectionTitle aiColTitle">Generate Note</div>
                  <div className="aiPanelBody">
                    <div className="aiControlRow aiGenerateControlRow">
                      <label className="addField aiDocTypeField">
                        <span className="addLabel">Note type</span>
                        <select className="select" value={aiNoteType} onChange={(e) => setAiNoteType(e.target.value as AiNoteType)}>
                          <option value="problem_list">Problem List</option>
                          <option value="problem_list_review">Problem List Review</option>
                          <option value="problem_list_note">Problem List Note</option>
                          <option value="treatment_plan">Treatment Plan</option>
                          <option value="medical_necessity_note">Medical Necessity Note</option>
                          <option value="discharge_summary">Discharge Form</option>
                          <option value="discharge_note">Discharge Note</option>
                        </select>
                      </label>
                    </div>
                    <div className="aiRequirementSlot">
                      {aiNoteType === "problem_list_review" ? (
                        <div className="hintTiny aiRequirementHint">
                          Problem List Review will ask what was added and what was completed before generation.
                        </div>
                      ) : null}
                      {aiNoteType === "problem_list" && !hasVaultAssessment ? (
                        <div className="hintTiny aiRequirementHint">
                          Problem List requires at least one <strong>&nbsp;Assessment&nbsp;</strong> file or text note in AI Vault first.
                        </div>
                      ) : null}
                      {aiNoteType === "problem_list_note" && (!hasVaultAssessment || !hasVaultProblemList) ? (
                        <div className="hintTiny aiRequirementHint">
                          Problem List Note requires both <strong>&nbsp;Assessment&nbsp;</strong> and <strong>&nbsp;Problem List&nbsp;</strong> in AI Vault first.
                        </div>
                      ) : null}
                      {aiNoteType === "problem_list_review" && (!hasVaultAssessment || !hasVaultProblemList) ? (
                        <div className="hintTiny aiRequirementHint">
                          Problem List Review requires both <strong>&nbsp;Assessment&nbsp;</strong> and <strong>&nbsp;Problem List&nbsp;</strong> in AI Vault first.
                        </div>
                      ) : null}
                      {aiNoteType === "treatment_plan" && (!hasVaultAssessment || !hasVaultProblemList) ? (
                        <div className="hintTiny aiRequirementHint">
                          Treatment Plan requires both <strong>&nbsp;Assessment&nbsp;</strong> and <strong>&nbsp;Problem List&nbsp;</strong> in AI Vault first.
                        </div>
                      ) : null}
                      {aiNoteType === "treatment_plan" && hasVaultAssessment && hasVaultProblemList && !hasVaultSession ? (
                        <div className="hintTiny aiRequirementHint">
                          Session upload is optional but recommended for stronger Treatment Plan detail.
                        </div>
                      ) : null}
                    </div>
                    <label className="addField aiGenerateTextWrap">
                      <span className="addLabel">Generated note</span>
                      <textarea
                        className="authInput controlCenterTextarea"
                        value={aiGeneratedNote}
                        onChange={(e) => setAiGeneratedNote(e.target.value)}
                        placeholder="Generated note will appear here."
                      />
                    </label>
                    <div className="aiGenerateActionsWrap">
                      <button
                        className="btn aiRoundActionBtn aiGenerateActionBtn"
                        disabled={
                          aiGenerating ||
                          (aiNoteType === "problem_list" && !hasVaultAssessment) ||
                          (aiNoteType === "problem_list_review" && (!hasVaultAssessment || !hasVaultProblemList)) ||
                          (aiNoteType === "problem_list_note" && (!hasVaultAssessment || !hasVaultProblemList)) ||
                          (aiNoteType === "treatment_plan" && (!hasVaultAssessment || !hasVaultProblemList))
                        }
                        onClick={() => {
                          if (aiNoteType === "problem_list_review") {
                            setShowProblemListReviewModal(true);
                            return;
                          }
                          void generateAiNote();
                        }}
                        aria-label={aiGenerating ? "Generating note" : "Generate with AI"}
                        title={aiGenerating ? "Generating..." : "Generate with AI"}
                      >
                        {aiGenerating ? "…" : "AI"}
                      </button>
                      <button
                        className="btn ghost aiRoundActionBtn aiGenerateIconBtn"
                        disabled={vaultBusy !== false || !aiGeneratedNote.trim()}
                        onClick={() => void saveGeneratedAiNote()}
                        aria-label="Save generated note to vault"
                        title="Save to Vault"
                      >
                        ⛁
                      </button>
                      <button
                        className="btn ghost aiRoundActionBtn aiGenerateIconBtn"
                        disabled={!aiGeneratedNote.trim()}
                        onClick={() => void copyGeneratedAiNote()}
                        aria-label="Copy generated note"
                        title="Copy note"
                      >
                        ⧉
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="table aiVaultTable" style={{ marginTop: 14 }}>
                <div className="thead" style={{ gridTemplateColumns: "1.2fr 2fr 0.8fr 1fr" }}>
                  <div>Type</div>
                  <div>Submitted Document</div>
                  <div>Size</div>
                  <div>Uploaded</div>
                </div>
                {vaultLoading ? <div className="empty">Loading Vault files…</div> : null}
                {!vaultLoading && !vaultDocuments.length ? <div className="empty">No Vault files yet.</div> : null}
                {!vaultLoading
                  ? vaultDocuments.map((doc) => (
                      <div key={doc.id} className="trow" style={{ gridTemplateColumns: "1.2fr 2fr 0.8fr 1fr" }}>
                        <div>{String(doc.document_type).replace(/^vault:/, "")}</div>
                        <div className="strong">{doc.original_filename}</div>
                        <div>{formatDocumentSize(doc.byte_size)}</div>
                        <div>{fmt(doc.created_at)}</div>
                      </div>
                    ))
                  : null}
              </div>
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
      {nameSlayerOpen ? (
        <div className="modalOverlay" onClick={closeNameSlayerModal}>
          <div className="modalCard redactionModalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Name Slayer</div>
              <button className="modalClose" onClick={closeNameSlayerModal}>✕</button>
            </div>
            <div className="modalBody redactionModalBody">
              {nameSlayerStage === "splash" ? (
                <div className="redactionSplash" aria-label="Name Slayer splash screen">
                  <img className="redactionSplashLogo" src={NAME_SLAYER_SPLASH_LOGO} alt="Name Slayer" />
                  <div className="redactionSplashTitle">Name Slayer</div>
                  <div className="redactionSplashSub">{nameSlayerStatus || "Processing locally..."}</div>
                </div>
              ) : (
                <>
                  <div className="hintTiny">Review required. Automatic PHI removal may miss information.</div>
                  <div className="hintTiny">
                    Patient name is automatically redacted from the current document. Use the box below for any other repeated names or terms.
                  </div>
                  <label className="addField">
                    <span className="addLabel">Extra names or terms to redact</span>
                    <div className="nameSlayerExtraRow">
                      <input
                        className="authInput"
                        value={nameSlayerExtraTermInput}
                        onChange={(event) => setNameSlayerExtraTermInput(event.target.value)}
                        placeholder={patient.displayName ? `e.g. ${patient.displayName.split(" ")[0]}` : "e.g. first name, spouse name"}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          applyNameSlayerExtraTerms();
                        }}
                      />
                      <button className="btn ghost" onClick={applyNameSlayerExtraTerms} disabled={nameSlayerBusy !== false}>
                        Redact
                      </button>
                    </div>
                  </label>
                  <div className="redactionMeta">
                    {nameSlayerFileName ? `File: ${nameSlayerFileName}` : "Local file"}
                    {nameSlayerStatus ? ` • ${nameSlayerStatus}` : ""}
                  </div>
                  <div className="redactionEditor">
                    <div className="redactionEditorHead">
                      <span className="redactionEditorTitle">Redacted document</span>
                      <span className="redactionEditorHint">Click any missed word to redact it.</span>
                    </div>
                    <div className="redactionPreview" aria-label="Redacted text editor">
                    {nameSlayerRedactedText ? (
                      tokenizeNameSlayerText(nameSlayerRedactedText).map((token) => (
                        <span
                          key={`${token.start}-${token.end}-${token.text}`}
                          className={token.text.trim() && !/\s/.test(token.text) ? "redactionToken" : "redactionSpace"}
                          onClick={() =>
                            token.text.trim() && !/\s/.test(token.text)
                              ? setNameSlayerRedactedText((current) => redactNameSlayerRange(current, token.start, token.end))
                              : null
                          }
                        >
                          {token.text}
                        </span>
                      ))
                    ) : (
                      <span className="placeholder">Redacted text will appear here.</span>
                    )}
                  </div>
                  </div>
                  <div className="nameSlayerFinalActions">
                    <button className="btn ghost" onClick={() => void copyNameSlayerResult()} disabled={!nameSlayerRedactedText.trim()}>
                      Copy
                    </button>
                    <button className="btn primary" onClick={() => void saveNameSlayerResultToVault()} disabled={nameSlayerBusy !== false || !nameSlayerRedactedText.trim()}>
                      {nameSlayerBusy === "saving" ? "Saving..." : "Save to Vault"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {showSignalPicker ? (
        <div className="modalOverlay" onClick={() => setShowSignalPicker(false)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Choose Clinical Snapshot Fields</div>
              <button className="modalClose" onClick={() => setShowSignalPicker(false)}>×</button>
            </div>
            <div className="modalBody">
              <div className="hintTiny" style={{ marginBottom: 10 }}>
                Select what should appear in this patient’s Clinical Snapshot. If nothing is selected, nothing is shown.
              </div>
              <div className="multiCheckList">
                {signalItems.map((item) => {
                  const checked = selectedSignalKeys.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`multiCheckItem${checked ? " on" : ""}`}
                      onClick={() => toggleSignalKey(item.key)}
                    >
                      <span>{item.label}</span>
                      <span aria-hidden="true">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showCompletionDatePicker ? (
        <div className="modalOverlay" onClick={() => setShowCompletionDatePicker(false)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Set Completion Date</div>
              <button className="modalClose" onClick={() => setShowCompletionDatePicker(false)}>✕</button>
            </div>
            <div className="modalBody">
              <label className="addField">
                <span className="addLabel">Completion date</span>
                <input
                  className="authInput"
                  type="date"
                  value={completionDateDraft}
                  onChange={(event) => setCompletionDateDraft(event.target.value)}
                />
              </label>
            </div>
            <div className="modalFoot">
              <button className="btn ghost" onClick={() => setShowCompletionDatePicker(false)} disabled={completionDateSaving}>Cancel</button>
              <button className="btn ghost" onClick={() => setCompletionDateDraft("")} disabled={completionDateSaving}>Clear</button>
              <button className="btn" onClick={() => void saveCompletionDate()} disabled={completionDateSaving}>
                {completionDateSaving ? "Saving..." : "Save Date"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showDeleteModal && canDeletePatient && (
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
      {showHighlightModal && canHighlightPatient ? (
        <PatientHighlightModal
          patientId={patient.id}
          patientName={patient.displayName}
          patients={patientOptions}
          counselorOptions={counselorOptions}
          currentUserEmail={currentUserEmail}
          onClose={() => setShowHighlightModal(false)}
            onSend={async ({ patientId, message, priority, recipientEmail }) => {
            const ok = await onSendHighlight({ patientId, message, priority, recipientEmail });
              if (ok) {
                setShowHighlightModal(false);
              }
            }}
        />
      ) : null}
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
      {showProblemListReviewModal ? (
        <div className="modalOverlay" onClick={() => setShowProblemListReviewModal(false)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Problem List Review Details</div>
              <button className="modalClose" onClick={() => setShowProblemListReviewModal(false)}>
                ×
              </button>
            </div>
            <div className="modalBody">
              <div className="addGrid">
                <label className="addField" style={{ gridColumn: "1 / -1" }}>
                  <span className="addLabel">Anything being added? (optional)</span>
                  <textarea
                    className="authInput controlCenterTextarea"
                    value={reviewAdditionsInput}
                    onChange={(e) => setReviewAdditionsInput(e.target.value)}
                    placeholder="Describe any new problems and how they were identified."
                  />
                </label>
                <label className="addField" style={{ gridColumn: "1 / -1" }}>
                  <span className="addLabel">Anything completed/removed? (optional)</span>
                  <textarea
                    className="authInput controlCenterTextarea"
                    value={reviewCompletionsInput}
                    onChange={(e) => setReviewCompletionsInput(e.target.value)}
                    placeholder="Describe any resolved problems and how they were resolved."
                  />
                </label>
              </div>
            </div>
            <div className="modalFoot">
              <button className="btn ghost" onClick={() => setShowProblemListReviewModal(false)} disabled={aiGenerating}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={aiGenerating}
                onClick={async () => {
                  setShowProblemListReviewModal(false);
                  await generateAiNote({
                    additions: reviewAdditionsInput.trim() || undefined,
                    completions: reviewCompletionsInput.trim() || undefined,
                  });
                }}
              >
                {aiGenerating ? "Generating…" : "Generate Review"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const [confirmText, setConfirmText] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const requiredDeleteText = `DELETE ${patient.displayName}`;
  const canSubmitDelete = confirmChecked && confirmText.trim() === requiredDeleteText && !deleting;

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
          <label className="addField" style={{ marginTop: 12 }}>
            <span className="addLabel">Type to confirm</span>
            <input
              className="authInput"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requiredDeleteText}
              autoComplete="off"
            />
            <span className="hintTiny">Enter exactly: <strong>{requiredDeleteText}</strong></span>
          </label>
          <label className="checkboxRow" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
            />
            <span>I understand this permanently deletes the patient and all associated intake data.</span>
          </label>
          {err && <div className="authErr" style={{ marginTop: 12 }}>{err}</div>}
        </div>
        <div className="modalFoot">
          <button className="btn ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button className="btn btnDanger" onClick={handleDelete} disabled={!canSubmitDelete}>
            {deleting ? "Deleting…" : "Delete Forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Intake option lists (mirrors intake.html) ---- */
const LOCATION_OPTS  = ["Van Nuys", "Santa Clarita"];
const PRIMARY_PROGRAM_OPTS = [
  "1.0 Outpatient",
  "2.1 Intensive Outpatient",
  "RSS",
  "RSS+",
  "Former Patient",
];
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
const SNAP_STRENGTHS_OPTS = [
  "Ability to ask for help", "Determined", "Good social support system", "Organized", "Honest", "Articulate",
  "Dependable", "Good physical health", "Spiritual", "Self-reliant", "Centered", "Honors commitments",
  "Enthusiastic", "Humorous", "Considerate", "Supportive of others", "Creative", "Intelligent", "Well liked by others",
];
const SNAP_NEEDS_OPTS = [
  "Advanced directives", "Grief counseling", "Relapse prevention", "Social supports", "Abuse/Trauma counseling",
  "Increase self-esteem", "Relationship skills", "Anger management", "Insomnia relief", "Boundaries",
  "Employment assistance", "HIV/AIDS counseling", "Housing/Shelter", "Stress reduction", "Education assistance",
  "Medical consultation", "Understanding diagnosis", "Impulse control", "Financial counseling", "Medication education",
  "Transportation assistance", "Public assistance", "Vocational training", "Other",
];
const SNAP_ABILITIES_OPTS = [
  "Time management", "Computer literate", "Works well with people", "Manages money well", "Artistic/Creative",
  "Has GED/Diploma", "Assertive in a positive way", "Employable", "Has empathy toward others",
  "Problem solving skills", "Follows directions", "Good parenting skills", "Makes friends easily",
  "Takes medications as prescribed", "Volunteer work", "Other",
];
const SNAP_PREFERENCES_OPTS = [
  "AA/NA appointments", "Individual therapy", "Group therapy", "Family therapy", "Male therapist",
  "Spiritual guidance", "Therapy in home", "Therapy in office", "Therapy in school", "Hearing impaired services",
  "Sign-language interpreter", "Other",
];

/* -------------------- Intake Tab -------------------- */

function IntakeTab({ rawJson, ans, onRawJsonUpdate }: {
  rawJson: any;
  ans: IntakeAnswers | undefined;
  onRawJsonUpdate?: (json: any) => Promise<void>;
}) {
  const cell       = getField(ans, "s5", "Cell phone");
  const homePhone  = getField(ans, "s5", "Home phone");
  const dob        = getField(ans, "s5", "Date of birth");
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

  return (
    <div className="intakeTabWrap">

      {/* ── Patient Data ── */}
      <div className="iSection">
        <div className="iHead iHead-blue">Patient Data</div>
        <div className="iSectionSubhead">Contact & Enrollment</div>
        <div className="iInfoGrid">
          <IInfoTile label="Cell"           value={cell}      onSave={pf("s5", "Cell phone")} />
          <IInfoTile label="Home phone"     value={homePhone} onSave={pf("s5", "Home phone")} />
          <IInfoTile label="Date of birth"  value={dob}       onSave={pf("s5", "Date of birth")} />
          <IInfoTile label="Email"          value={email}     onSave={pf("s5", "Email address")} />
          <IInfoTile label="Street address" value={address}   onSave={pf("s5", "Street address")} />
          <IInfoTile label="City"           value={city}      onSave={pf("s5", "City")} />
          <IInfoTile label="ZIP code"       value={zip}       onSave={pf("s5", "ZIP code")} />
          <IInfoTile label="Location"       value={location}  onSave={pr("location")} options={LOCATION_OPTS} />
          <IInfoTile label="Language"       value={language}  onSave={pr("language")} options={LANGUAGE_OPTS} />
          {submittedAt && <IInfoTile label="Submitted" value={new Date(submittedAt).toLocaleDateString()} />}
        </div>
        <div className="iSectionSubhead" style={{ marginTop: 14 }}>Demographics</div>
        <div className="iDemoGrid">
          <IDemoItem label="Sex at birth"             value={sex}        onSave={pr("sex")}            options={SEX_OPTS} />
          <IDemoItem label="Pregnant / breastfeeding" value={preg}       onSave={pr("preg")}           options={PREG_OPTS} />
          <IDemoItem label="Gender identity"          value={gender}     onSave={pr("gender")}         options={GENDER_OPTS} />
          <IDemoItem label="Orientation"              value={orient}     onSave={pr("orient")}         options={ORIENT_OPTS} />
          <IDemoItem label="Marital status"           value={marital}    onSave={pr("marital_status")} options={MARITAL_OPTS} />
          <IDemoItem label="Ethnicity"                value={ethnicity}  onSave={pr("ethnicity")}      options={ETHNICITY_OPTS} />
          <IDemoItem label="Race"                     value={race.join(", ")} onSave={(next) => pm("race")?.(next ? [next] : [])} options={RACE_OPTS} />
          <IDemoItem label="Veteran"                  value={veteran}    onSave={pr("veteran")}        options={VETERAN_OPTS} />
          <IDemoItem label="Employment"               value={employment} onSave={pr("employment")}     options={EMPLOY_OPTS} />
        </div>
        <div className="iSectionSubhead" style={{ marginTop: 14 }}>Add-ons</div>
        <div className="iSectionGroup">
          <div className="iSubGroup">
            <div className="iHead iHead-orange">
              Substances & MAT
              <HeadEdit enabled={Boolean(onRawJsonUpdate)} onClick={() => openMulti("Substances", SUBSTANCE_OPTS, "substances", substances)} />
            </div>
            {substances.length > 0
              ? <div className="iChips">{substances.map(s => <span key={s} className="iChip iSub">{s}</span>)}</div>
              : <span className="iDimLabel">—</span>}
            <div className="iMatRow">
              <span className="iDimLabel">Medication-Assisted Treatment</span>
              {editingMat ? (
                <IntakeChoiceSelect
                  value={matDraft}
                  options={MAT_OPTS}
                  onChange={(next) => {
                    pr("mat")?.(next);
                    setEditingMat(false);
                  }}
                />
              ) : (
                <>
                  {mat ? <span className={`iMatBadge ${matClass}`}>{mat}</span>
                       : <span className="iMatBadge iMatNo">—</span>}
                  {onRawJsonUpdate && (
                    <button type="button" className="iEditBtn" style={{ opacity: 0.55 }} title="Edit MAT"
                      onClick={() => { setMatDraft(mat); setEditingMat(true); }}>✎</button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="iSubGroup">
            <div className="iHead iHead-purple">
              Demographics Add-on
            </div>
            <div className="iDimLabel" style={{ marginTop: 6 }}>Race is editable in Demographics above.</div>
          </div>

          <div className="iSubGroup">
            <div className="iHead iHead-green">
              Public Assistance
              <HeadEdit enabled={Boolean(onRawJsonUpdate)} onClick={() => openMulti("Public Assistance", ASSIST_OPTS, "public_assistance",
                [...publicAssist, ...(getMulti(ans, "public_assistance").filter(a => a === "None"))])} />
            </div>
            {publicAssist.length > 0
              ? <div className="iChips">{publicAssist.map(a => <span key={a} className="iChip iAssist">{a}</span>)}</div>
              : <span className="iDimLabel">—</span>}
          </div>

          <div className="iSubGroup">
            <div className="iHead iHead-teal">Accommodations & Directives</div>
            <div className="iDemoGrid" style={{ marginBottom: 12 }}>
              <IDemoItem label="Accommodations needed"    value={accommodations} onSave={pr("accommodations")}   options={YN_OPTS} />
              <IDemoItem label="Advance directive on file" value={advanceDir}   onSave={pr("advance_directive")} options={YN_OPTS} />
            </div>
            {accommodations === "Yes" && (
              <div className="iNoteBlock">
                <div className="iNoteTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Accommodations list
                  <HeadEdit enabled={Boolean(onRawJsonUpdate)} onClick={() => openMulti("Accommodations", ACCOM_OPTS, "accommodations_list", accommodationsList)} />
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

          <div className="iSubGroup">
            <div className="iHead iHead-gray">Emergency Contact</div>
            <div className="iInfoGrid">
              <IInfoTile label="Name"         value={ecName}  onSave={pf("s18", "Full name")} />
              <IInfoTile label="Relationship" value={ecRel}   onSave={pf("s18", "Relationship")} />
              <IInfoTile label="Address"      value={ecAddr}  onSave={pf("s18", "Address")} />
              <IInfoTile label="Phone"        value={ecPhone} onSave={pf("s18", "Phone number")} />
            </div>
          </div>

          <div className="iSubGroup">
            <div className="iHead iHead-amber">
              Court / Care Coordination
              <HeadEdit enabled={Boolean(onRawJsonUpdate)} onClick={() => openMulti("Court / Care Coordination", COURT_OPTS, "court_involvement", courtInvolvement)} />
            </div>
            {courtInvolvement.filter(c => c !== "None").length > 0 && (
              <div className="iChips" style={{ marginBottom: 8 }}>
                {courtInvolvement.filter(c => c !== "None").map(c => <span key={c} className="iChip iSub">{c}</span>)}
              </div>
            )}
            <IInfoTile label="Contact info" value={courtDetail} onSave={pf("s19", "Name, agency, phone or email (optional)")} />
          </div>
        </div>
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
  const cancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="iInfoTile">
      <div className="iDimLabel">
        {label}
        {onSave && !editing && (
          <button type="button" className="iEditBtn" onClick={() => { setDraft(value); setEditing(true); }} title="Edit">✎</button>
        )}
      </div>
      {editing ? (
        options ? (
          <IntakeChoiceSelect
            value={draft}
            options={options}
            onChange={(next) => {
              if (onSave) onSave(next);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <input className="iEditInput" value={draft} autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            />
            <div className="iEditActions">
              <button type="button" className="iEditActionBtn" onClick={cancel}>Cancel</button>
              <button type="button" className="iEditActionBtn primary" onClick={commit}>Save</button>
            </div>
          </>
        )
      ) : (
        <button
          type="button"
          className={`iValueBtn ${value ? "" : "empty"}`.trim()}
          onClick={() => {
            if (!onSave) return;
            setDraft(value);
            setEditing(true);
          }}
          disabled={!onSave}
          title={onSave ? "Tap to edit" : undefined}
        >
          {value || "—"}
        </button>
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
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => { onSave?.(draft.trim()); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="iDemoItem">
      <div className="iDimLabel">
        {label}
        {onSave && !editing && (
          <button type="button" className="iEditBtn" onClick={() => setEditing(true)} title="Edit">✎</button>
        )}
      </div>
      {editing ? (
        options ? (
          <IntakeChoiceSelect
            value={value}
            options={options}
            onChange={(next) => {
              onSave?.(next);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <input className="iEditInput" value={draft} autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            />
            <div className="iEditActions">
              <button type="button" className="iEditActionBtn" onClick={cancel}>Cancel</button>
              <button type="button" className="iEditActionBtn primary" onClick={commit}>Save</button>
            </div>
          </>
        )
      ) : (
        <button
          type="button"
          className={`iDemoPill iValueBtn ${value ? "" : "empty"}`.trim()}
          onClick={() => {
            if (!onSave) return;
            setDraft(value);
            setEditing(true);
          }}
          disabled={!onSave}
          title={onSave ? "Tap to edit" : undefined}
        >
          {value || "—"}
        </button>
      )}
    </div>
  );
}

function MultiEditModal({ title, opts, cur, onSave, onClose }: {
  title: string; opts: string[]; cur: string[];
  onSave: (vals: string[]) => void | Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(cur);
  const [saving, setSaving] = useState(false);
  const toggle = (v: string) =>
    setDraft(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const saveAndClose = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard multiEditCard" onClick={e => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">{title}</div>
          <button type="button" className="modalClose" onClick={onClose}>✕</button>
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
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn" onClick={() => void saveAndClose()} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- SNAP Tab -------------------- */

function SnapTab({ rawJson, onRawJsonUpdate }: { rawJson: any; onRawJsonUpdate?: (json: any) => Promise<void> }) {
  const snap = rawJson?.sections?.snap ?? {};
  const [multiModal, setMultiModal] = useState<{
    title: string;
    opts: string[];
    cur: string[];
    onSave: (vals: string[]) => void | Promise<void>;
  } | null>(null);
  const groups: Array<{ label: string; key: "strengths" | "needs" | "abilities" | "preferences"; klass: string; opts: string[] }> = [
    { label: "Strengths", key: "strengths", klass: "chip-green", opts: SNAP_STRENGTHS_OPTS },
    { label: "Needs", key: "needs", klass: "chip-red", opts: SNAP_NEEDS_OPTS },
    { label: "Abilities", key: "abilities", klass: "chip-blue", opts: SNAP_ABILITIES_OPTS },
    { label: "Preferences", key: "preferences", klass: "chip-purple", opts: SNAP_PREFERENCES_OPTS },
  ];
  const openMulti = (title: string, opts: string[], key: typeof groups[number]["key"], cur: string[]) => {
    if (!onRawJsonUpdate) return;
    setMultiModal({
      title,
      opts,
      cur,
      onSave: (vals) =>
        onRawJsonUpdate({
          ...rawJson,
          sections: {
            ...rawJson?.sections,
            snap: {
              ...rawJson?.sections?.snap,
              [key]: vals,
            },
          },
        }),
    });
  };

  return (
    <div className="snapWrap">
      <div className="hintTiny" style={{ marginBottom: 10 }}>
        SNAP can be updated after admission using the edit buttons on each section.
      </div>
      {groups.map((g) => {
        const arr = (snap?.[g.key] ?? []) as string[];
        return (
          <div className="snapGroup" key={g.key}>
            <div className="snapTitle" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
              <span>{g.label}</span>
              <HeadEdit
                enabled={Boolean(onRawJsonUpdate)}
                onClick={() => openMulti(g.label, g.opts, g.key, arr)}
              />
            </div>
            <div className="snapChips">
              {arr.length ? arr.map((v, i) => <span key={`${g.key}-${i}`} className={`snapChip ${g.klass}`}>{v}</span>) : <span className="muted">—</span>}
            </div>
          </div>
        );
      })}
      {multiModal ? (
        <MultiEditModal
          title={multiModal.title}
          opts={multiModal.opts}
          cur={multiModal.cur}
          onSave={multiModal.onSave}
          onClose={() => setMultiModal(null)}
        />
      ) : null}
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
              <input
                className="authInput"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First Last"
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                autoFocus
              />
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
        <img className="authLogo" src={patientFinderLogo} alt="patientfinder logo" />
      </div>
      <AuthRosterSourcePicker />
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
        <img className="authLogo" src={patientFinderLogo} alt="patientfinder logo" />
      </div>
      <div className="authSub">Sign in with your NCADD Microsoft account.</div>
      <AuthRosterSourcePicker />
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

function AuthRosterSourcePicker() {
  const [profile, setProfile] = useState<ApiTargetProfile>(() => inferInitialApiProfile());
  const [open, setOpen] = useState(false);
  const [customUrlDraft, setCustomUrlDraft] = useState(() => {
    if (typeof window === "undefined") return LOCAL_API_BASE_URL;
    const storedCustom = window.localStorage.getItem(API_CUSTOM_URL_KEY)?.trim();
    if (storedCustom) return storedCustom;
    const override = window.localStorage.getItem(API_OVERRIDE_KEY)?.trim();
    if (override && override !== LOCAL_API_BASE_URL && override !== NCADD_API_BASE_URL) {
      return override;
    }
    return LOCAL_API_BASE_URL;
  });
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<{
    state: "loading" | "ready" | "error";
    title: string;
    detail: string;
  }>({ state: "loading", title: "Checking backend", detail: "Resolving the active API target." });
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  const persistTarget = (nextProfile: ApiTargetProfile, nextCustomUrl?: string) => {
    if (typeof window === "undefined") return;

    const nextUrl =
      nextProfile === "custom"
        ? (nextCustomUrl ?? customUrlDraft).trim()
        : getConfiguredApiBaseUrl(nextProfile, customUrlDraft);

    window.localStorage.setItem(API_PROFILE_KEY, nextProfile);
    window.localStorage.setItem(API_OVERRIDE_KEY, nextUrl);
    if (nextProfile === "custom") {
      window.localStorage.setItem(API_CUSTOM_URL_KEY, nextUrl);
    }
  };

  const selectPreset = (nextProfile: Exclude<ApiTargetProfile, "custom">) => {
    setProfile(nextProfile);
    setCustomUrlError(null);
    persistTarget(nextProfile);
    setOpen(false);
    window.location.reload();
  };

  const openCustomEditor = () => {
    setProfile("custom");
    setCustomUrlError(null);
    if (typeof window !== "undefined") {
      const currentCustom =
        window.localStorage.getItem(API_CUSTOM_URL_KEY)?.trim() ||
        window.localStorage.getItem(API_OVERRIDE_KEY)?.trim() ||
        LOCAL_API_BASE_URL;
      setCustomUrlDraft(currentCustom);
    }
    setOpen(true);
  };

  const saveCustomTarget = () => {
    const nextUrl = customUrlDraft.trim();
    if (!/^https?:\/\//i.test(nextUrl) && !(IS_LOCAL_BROWSER && nextUrl.startsWith("/"))) {
      setCustomUrlError("Enter an http(s) URL or a local path like /api.");
      return;
    }

    setProfile("custom");
    setCustomUrlError(null);
    persistTarget("custom", nextUrl);
    setOpen(false);
    window.location.reload();
  };

  useEffect(() => {
    let cancelled = false;
    setBackendHealth({ state: "loading", title: "Checking backend", detail: "Resolving the active API target." });

    void getAzureApiHealth()
      .then((payload) => {
        if (cancelled) return;
        const databaseName = payload.databaseName ?? "unknown database";
        const role =
          payload.databaseRole === "local-phi"
            ? "Local PHI"
            : payload.databaseRole === "demo"
              ? "Azure demo"
              : "Configured API";
        setBackendHealth({
          state: "ready",
          title: role,
          detail: `${payload.service ?? "API"} · ${databaseName}${payload.phase ? ` · ${payload.phase}` : ""}`,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBackendHealth({
          state: "error",
          title: "Backend unavailable",
          detail: "The selected API target did not answer /health.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (profile !== "custom" || !open) return;
    customInputRef.current?.focus();
    customInputRef.current?.select();
  }, [open, profile]);

  const selectedLogo = profile === "ncadd-azure" ? ncaddLogo : themeButtonLogo;
  const selectedAlt = `${getApiTargetLabel(profile)} API target`;

  return (
    <div className="authRosterPicker" ref={pickerRef}>
      <div className="authRosterBadge" aria-label="Roster source picker">
        <span className="authRosterBadgeLabel">API target</span>
        <div className="authRosterControl">
          <button
            type="button"
            className="authRosterLogoButton"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            <img className={`authRosterLogo${profile !== "ncadd-azure" ? " demo" : ""}`} src={selectedLogo} alt={selectedAlt} />
            <span className="authRosterChevron" aria-hidden="true">{open ? "▲" : "▼"}</span>
          </button>
          {open ? (
            <div className="authRosterDropdown" role="menu">
              <button
                type="button"
                className={profile === "local-phi" ? "authRosterOption active" : "authRosterOption"}
                onClick={() => selectPreset("local-phi")}
              >
                <img className="authRosterOptionLogo demo" src={themeButtonLogo} alt="" aria-hidden="true" />
                <span>
                  <span className="authRosterOptionTitle">Local PHI</span>
                  <span className="authRosterOptionDesc">{getApiTargetDescription("local-phi")}</span>
                </span>
              </button>
              <button
                type="button"
                className={profile === "ncadd-azure" ? "authRosterOption active" : "authRosterOption"}
                onClick={() => selectPreset("ncadd-azure")}
              >
                <img className="authRosterOptionLogo" src={ncaddLogo} alt="" aria-hidden="true" />
                <span>
                  <span className="authRosterOptionTitle">NCADD Azure</span>
                  <span className="authRosterOptionDesc">{getApiTargetDescription("ncadd-azure")}</span>
                </span>
              </button>
              <button
                type="button"
                className={profile === "custom" ? "authRosterOption active" : "authRosterOption"}
                onClick={openCustomEditor}
              >
                <img className="authRosterOptionLogo demo" src={themeButtonLogo} alt="" aria-hidden="true" />
                <span>
                  <span className="authRosterOptionTitle">Custom API</span>
                  <span className="authRosterOptionDesc">{getApiTargetDescription("custom")}</span>
                </span>
              </button>
              {profile === "custom" ? (
                <div className="authRosterCustom">
                  <label className="authRosterCustomLabel" htmlFor="authRosterCustomBaseUrl">
                    API base URL
                  </label>
                  <input
                    id="authRosterCustomBaseUrl"
                    ref={customInputRef}
                    className="authRosterCustomInput"
                    type="text"
                    spellCheck={false}
                    value={customUrlDraft}
                    onChange={(event) => setCustomUrlDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveCustomTarget();
                      }
                    }}
                    placeholder="http://localhost:3001"
                  />
                  <div className="authRosterCustomActions">
                    <button type="button" className="btn" onClick={saveCustomTarget}>
                      Save target
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setProfile("local-phi");
                        setCustomUrlError(null);
                        persistTarget("local-phi");
                        setOpen(false);
                        window.location.reload();
                      }}
                    >
                      Back to local
                    </button>
                  </div>
                  {customUrlError ? <div className="authRosterCustomError">{customUrlError}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="authRosterHint">
        <div className="authRosterHintLine">
          <span className="authRosterHintLabel">{getApiTargetLabel(profile)}</span>
          <span className={`authRosterHintBadge ${backendHealth.state}`}>{backendHealth.title}</span>
        </div>
        <div className="authRosterHintDetail">{backendHealth.detail}</div>
      </div>
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
    setDrugTestMessage(`Saved ${drugTestResult.toLowerCase()} toxicology result.`);
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
      <div className="panel attendancePanel attendancePanelVisits">
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

            <div className="attendanceSelectedList attendanceSelectedChecks">
              <label className="attendanceSelectedCard">
                <div>
                  <div className="strong">Naloxone training</div>
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

            {sessionMessage ? <div className="hintTiny">{sessionMessage}</div> : null}

            <button className="btn" onClick={saveSession} disabled={!sessionCanSave || sessionSaving}>
              {sessionSaving ? "Committing..." : "Commit to billing"}
            </button>
          </div>
        </div>
      </div>

      <div className="panel attendancePanel attendancePanelToxicology">
        <div className="panelHead">Log toxicology</div>
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
              {drugTestSaving ? "Saving..." : "Save toxicology"}
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
                    <span>{cleanPersonLabel(group.counselor_name, "Counselor")}</span>
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
        </div>
        <div className="billingToolbar">
          <label className="attendanceField">
            <span className="addLabel">Month</span>
            <input className="authInput" type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
          </label>
          <div className="workspaceResultsCount">{monthLabel(billingMonth)}</div>
        </div>
      </div>

      <div className="workspaceSheetWrap">
        <div className="workspaceSheet billingSheet" ref={billingSheetScrollRef}>
          <div className="workspaceSheetHead billingSheetHead">
            <div>Patient</div>
            <div>MRN</div>
            <div>Program</div>
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
            type="button"
            className="workspaceArrowLaneBtn"
            aria-label="Scroll left"
            onClick={() => billingSheetScrollRef.current?.scrollBy({ left: -420, behavior: "smooth" })}
          />
          <button
            type="button"
            className="workspaceArrowLaneBtn"
            aria-label="Scroll right"
            onClick={() => billingSheetScrollRef.current?.scrollBy({ left: 420, behavior: "smooth" })}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------- Add Patient Modal -------------------- */

function buildSeedConsents(patientName: string, todayIsoDate: string) {
  const events = CONSENT_FORMS.map((form) => ({
    formId: form.id,
    acknowledgedAt: new Date().toISOString(),
  }));
  const dataByForm = Object.fromEntries(
    CONSENT_FORMS.map((form) => [
      form.dataKey,
      {
        patientName,
        todayDate: todayIsoDate,
        fields: {
          patientName,
          todayDate: todayIsoDate,
        },
      },
    ])
  );
  return {
    events,
    dataByForm,
  };
}

function AddPatientModal({
  dataClient,
  counselorOptions,
  onClose,
  onAdded,
}: {
  dataClient: DataClient;
  counselorOptions: Array<{ email: string; label: string; userId?: string }>;
  onClose: () => void;
  onAdded: (p: Patient) => void;
}) {
  const today = new Date().toISOString().substring(0, 10);
  const [form, setForm] = useState({
    full_name: "",
    mrn: "",
    date_of_birth: "",
    location: "Van Nuys",
    intake_date: today,
    primary_program: "",
    counselor_email: "",
    drug_of_choice: [] as string[],
    referring_agency: "",
    medical_eligibility: "",
    mat_status: "",
    therapy_track: "",
    medical_phys_apt: "",
    med_form_status: "",
    notes: "",
    snap_strengths: [] as string[],
    snap_needs: [] as string[],
    snap_abilities: [] as string[],
    snap_preferences: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const toggleMulti = (
    field: "drug_of_choice" | "snap_strengths" | "snap_needs" | "snap_abilities" | "snap_preferences",
    option: string,
    checked: boolean
  ) =>
    setForm((prev) => ({
      ...prev,
      [field]: checked
        ? [...prev[field], option]
        : prev[field].filter((value) => value !== option),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setErr("Full name is required."); return; }
    setSaving(true);
    setErr("");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const selectedCounselor = counselorOptions.find((option) => option.email === form.counselor_email);
    const record = {
      id,
      full_name: form.full_name.trim(),
      mrn: form.mrn.trim() || null,
      date_of_birth: form.date_of_birth || null,
      status: "new",
      location: form.location || null,
      intake_date: form.intake_date || today,
      primary_program: form.primary_program.trim() || null,
      counselor_name: selectedCounselor?.label || null,
      flags: [],
      created_at: now,
      updated_at: now,
    };
    try {
      await dataClient.createPatient(record);
      const nonBlockingErrors: string[] = [];

      try {
        await dataClient.saveRosterDetails(id, {
          drug_of_choice: form.drug_of_choice.length ? form.drug_of_choice : null,
          referring_agency: form.referring_agency || null,
          medical_eligibility: form.medical_eligibility || null,
          mat_status: form.mat_status || null,
          therapy_track: form.therapy_track || null,
          medical_phys_apt: form.medical_phys_apt || null,
          med_form_status: form.med_form_status || null,
          notes: form.notes.trim() || null,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        nonBlockingErrors.push(detail.replace(/^Azure API request failed:\s*\d+\s*-\s*/i, "") || "Unable to save roster details.");
      }

      try {
        const intakeJson = {
          meta: { createdAt: new Date().toISOString(), source: "staff_add_patient" },
          sections: {
            intake: {
              fields: {
                "s5::Full legal name": record.full_name,
                "s5::Date of birth": form.date_of_birth || "",
              },
              radios: {
                location: form.location || "",
                referring_agency: form.referring_agency || "",
                medical_eligibility: form.medical_eligibility || "",
                mat: form.mat_status || "",
                primary_program: form.primary_program || "",
              },
              multi: {
                substances: form.drug_of_choice,
              },
            },
            snap: {
              strengths: form.snap_strengths,
              needs: form.snap_needs,
              abilities: form.snap_abilities,
              preferences: form.snap_preferences,
            },
          },
          consents: buildSeedConsents(record.full_name, record.intake_date),
        };
        await dataClient.createIntakeSubmission({
          patient_id: id,
          submitted_full_name: record.full_name,
          submitted_dob: form.date_of_birth || null,
          submitted_location: form.location || null,
          intake_date: record.intake_date,
          raw_json: intakeJson,
          status: "received",
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        nonBlockingErrors.push(detail.replace(/^Azure API request failed:\s*\d+\s*-\s*/i, "") || "Unable to save intake submission.");
      }

      if (nonBlockingErrors.length) {
        setErr(`Patient was added. Follow-up save issue: ${nonBlockingErrors[0]}`);
      }
    } catch (error) {
      setSaving(false);
      const detail = error instanceof Error ? error.message : "";
      setErr(detail.replace(/^Azure API request failed:\s*\d+\s*-\s*/i, "") || "Failed to add patient.");
      return;
    }
    setSaving(false);
    onAdded({
      id,
      displayName: record.full_name,
      mrn: record.mrn ?? undefined,
      dateOfBirth: record.date_of_birth ?? undefined,
      kind: derivePatientKind(record.primary_program, record.status, record.intake_date),
      intakeDate: record.intake_date,
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
              <span className="addLabel">SAGE #</span>
              <input className="authInput" value={form.mrn} onChange={f("mrn")} placeholder="Optional" />
            </label>
            <label className="addField">
              <span className="addLabel">Birthday / Date of birth</span>
              <input className="authInput" type="date" value={form.date_of_birth} onChange={f("date_of_birth")} />
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
              <span className="addLabel">Primary program</span>
              <select className="select" value={form.primary_program} onChange={f("primary_program")}>
                <option value="">Select program</option>
                {PRIMARY_PROGRAM_OPTS.map((program) => (
                  <option key={program} value={program}>{program}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Counselor</span>
              <select className="select" value={form.counselor_email} onChange={f("counselor_email")}>
                <option value="">Select counselor</option>
                {counselorOptions.map((option) => (
                  <option key={option.email} value={option.email}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Drug of choice</span>
              <div className="multiCheckList addPatientCheckList">
                {SUBSTANCE_OPTS.map((option) => (
                  <label key={option} className="multiCheckItem">
                    <input
                      type="checkbox"
                      checked={form.drug_of_choice.includes(option)}
                      onChange={(e) => toggleMulti("drug_of_choice", option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </label>
            <label className="addField">
              <span className="addLabel">Referring agency</span>
              <select className="select" value={form.referring_agency} onChange={f("referring_agency")}>
                <option value="">Select agency</option>
                {REFERRING_AGENCY_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Medical eligibility</span>
              <select className="select" value={form.medical_eligibility} onChange={f("medical_eligibility")}>
                <option value="">Select status</option>
                {MEDICAL_ELIGIBILITY_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">MAT</span>
              <select className="select" value={form.mat_status} onChange={f("mat_status")}>
                <option value="">Select status</option>
                {MAT_STATUS_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Therapy</span>
              <select className="select" value={form.therapy_track} onChange={f("therapy_track")}>
                <option value="">Select therapist</option>
                {THERAPY_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Medical/Physical appointment</span>
              <select className="select" value={form.medical_phys_apt} onChange={f("medical_phys_apt")}>
                <option value="">Select status</option>
                {MEDICAL_PHYS_APT_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Med Form</span>
              <select className="select" value={form.med_form_status} onChange={f("med_form_status")}>
                <option value="">Select status</option>
                {MED_FORM_OPTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="addField">
              <span className="addLabel">Notes</span>
              <input className="authInput" value={form.notes} onChange={f("notes")} placeholder="Free-text staff notes" />
            </label>
            <label className="addField" style={{ gridColumn: "1 / -1" }}>
              <span className="addLabel">SNAP Strengths (optional)</span>
              <div className="multiCheckList addPatientCheckList snapAddList">
                {SNAP_STRENGTHS_OPTS.map((option) => (
                  <label key={option} className="multiCheckItem">
                    <input
                      type="checkbox"
                      checked={form.snap_strengths.includes(option)}
                      onChange={(e) => toggleMulti("snap_strengths", option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </label>
            <label className="addField" style={{ gridColumn: "1 / -1" }}>
              <span className="addLabel">SNAP Needs (optional)</span>
              <div className="multiCheckList addPatientCheckList snapAddList">
                {SNAP_NEEDS_OPTS.map((option) => (
                  <label key={option} className="multiCheckItem">
                    <input
                      type="checkbox"
                      checked={form.snap_needs.includes(option)}
                      onChange={(e) => toggleMulti("snap_needs", option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </label>
            <label className="addField" style={{ gridColumn: "1 / -1" }}>
              <span className="addLabel">SNAP Abilities (optional)</span>
              <div className="multiCheckList addPatientCheckList snapAddList">
                {SNAP_ABILITIES_OPTS.map((option) => (
                  <label key={option} className="multiCheckItem">
                    <input
                      type="checkbox"
                      checked={form.snap_abilities.includes(option)}
                      onChange={(e) => toggleMulti("snap_abilities", option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </label>
            <label className="addField" style={{ gridColumn: "1 / -1" }}>
              <span className="addLabel">SNAP Preferences (optional)</span>
              <div className="multiCheckList addPatientCheckList snapAddList">
                {SNAP_PREFERENCES_OPTS.map((option) => (
                  <label key={option} className="multiCheckItem">
                    <input
                      type="checkbox"
                      checked={form.snap_preferences.includes(option)}
                      onChange={(e) => toggleMulti("snap_preferences", option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
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
