import { useEffect, useMemo, useState } from "react";
import { read, utils, writeFile } from "xlsx";
import type { ChangeEvent } from "react";
import type {
  AdminSheetDetail,
  AdminSheetPatientField,
  AdminSheetSummary,
  DataClient,
} from "../data/types";
import type { Patient } from "../App";

type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, ParsedSheet>;
};

type ParsedSheet = {
  headers: string[];
  rows: Array<Record<string, string>>;
  previewRows: Array<Record<string, string>>;
};

type LinkMode = "exact" | "suggested" | "manual" | "unlinked";

type BridgeRowDraft = {
  sourceRowIndex: number;
  linkedPatientId: string | null;
  linkMode: LinkMode;
  suggestedPatientId: string | null;
  values: Record<string, string>;
};

type BridgeDraft = {
  sheetName: string;
  sourceSheetName: string;
  fileName: string;
  columns: Array<{
    columnName: string;
    mappedPatientField: AdminSheetPatientField | null;
    columnType: string | null;
    sortOrder: number;
  }>;
  rows: BridgeRowDraft[];
};

const FIELD_LABELS: Record<AdminSheetPatientField, string> = {
  full_name: "Patient name",
  date_of_birth: "DOB",
  mrn: "MRN",
  external_id: "External ID",
  status: "Status",
  location: "Location",
  intake_date: "Admission date",
  last_visit_date: "Last visit date",
  next_appt_date: "Next appt date",
  primary_program: "Program",
  counselor_name: "Counselor",
  drug_of_choice: "DOC / drug of choice",
  medical_phys_apt: "Medical physical appt",
  med_form_status: "Medication form status",
  notes: "Roster notes",
  referring_agency: "Referring agency",
  reauth_sapc_date: "Reauth SAPC date",
  medical_eligibility: "Medical eligibility",
  mat_status: "MAT status",
  therapy_track: "Therapy track",
  drug_test_mode: "Drug test mode",
  drug_tests_per_week: "Drug tests / week",
  drug_test_weekday: "Drug test weekday",
  problem_list_date: "Problem list date",
  last_problem_list_review: "Last problem list review",
  last_problem_list_update: "Last problem list update",
  treatment_plan_date: "Treatment plan date",
  treatment_plan_update: "Treatment plan update",
};

const FIELD_OPTIONS: Array<{ value: AdminSheetPatientField | ""; label: string }> = [
  { value: "", label: "Custom admin column" },
  { value: "full_name", label: "Patient name" },
  { value: "date_of_birth", label: "DOB" },
  { value: "mrn", label: "MRN" },
  { value: "external_id", label: "External ID" },
  { value: "status", label: "Status" },
  { value: "location", label: "Location" },
  { value: "intake_date", label: "Admission date" },
  { value: "last_visit_date", label: "Last visit date" },
  { value: "next_appt_date", label: "Next appointment date" },
  { value: "primary_program", label: "Program" },
  { value: "counselor_name", label: "Counselor" },
  { value: "drug_of_choice", label: "DOC / drug of choice" },
  { value: "medical_phys_apt", label: "Medical physical appt" },
  { value: "med_form_status", label: "Medication form status" },
  { value: "notes", label: "Roster notes" },
  { value: "referring_agency", label: "Referring agency" },
  { value: "reauth_sapc_date", label: "Reauth SAPC date" },
  { value: "medical_eligibility", label: "Medical eligibility" },
  { value: "mat_status", label: "MAT status" },
  { value: "therapy_track", label: "Therapy track" },
  { value: "drug_test_mode", label: "Drug test mode" },
  { value: "drug_tests_per_week", label: "Drug tests / week" },
  { value: "drug_test_weekday", label: "Drug test weekday" },
  { value: "problem_list_date", label: "Problem list date" },
  { value: "last_problem_list_review", label: "Last problem list review" },
  { value: "last_problem_list_update", label: "Last problem list update" },
  { value: "treatment_plan_date", label: "Treatment plan date" },
  { value: "treatment_plan_update", label: "Treatment plan update" },
];

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDate(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

function normalizeName(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function patientLabel(patient: Patient) {
  const parts = [patient.displayName];
  if (patient.mrn) parts.push(`MRN ${patient.mrn}`);
  if (patient.dateOfBirth) parts.push(patient.dateOfBirth);
  return parts.join(" • ");
}

function autoMapField(header: string): AdminSheetPatientField | null {
  const lower = header.toLowerCase();
  if (/(^|\b)(patient\s*name|client\s*name|full\s*name|name)(\b|$)/i.test(lower)) return "full_name";
  if (/(^|\b)(dob|date\s+of\s+birth|birth\s+date)(\b|$)/i.test(lower)) return "date_of_birth";
  if (/(^|\b)(mrn|sage|medical\s*record\s*number)(\b|$)/i.test(lower)) return "mrn";
  if (/(^|\b)(external\s*id|client\s*id|patient\s*id|case\s*number)(\b|$)/i.test(lower)) return "external_id";
  if (/(^|\b)(location|site|facility|program\s*site)(\b|$)/i.test(lower)) return "location";
  if (/(admission|admit|intake)/i.test(lower)) return "intake_date";
  if (/(last\s*visit|last\s*seen|last\s*contact)/i.test(lower)) return "last_visit_date";
  if (/(next\s*appt|next\s*appointment|appointment\s*date|follow\s*up)/i.test(lower)) return "next_appt_date";
  if (/counselor/i.test(lower)) return "counselor_name";
  if (/(level\s+of\s+care|loc|program)/i.test(lower)) return "primary_program";
  if (/status/i.test(lower)) return "status";
  if (/\b(doc|drug\s*of\s*choice|substances?|substance\s*use)\b/i.test(lower)) return "drug_of_choice";
  if (/(physical\s*appt|medical\s*phys|phys\s*appt)/i.test(lower)) return "medical_phys_apt";
  if (/(med\s*form|medication\s*form)/i.test(lower)) return "med_form_status";
  if (/(referring\s*agency|referral\s*source)/i.test(lower)) return "referring_agency";
  if (/(reauth|sapc)/i.test(lower)) return "reauth_sapc_date";
  if (/(medical\s*eligibility|eligibility)/i.test(lower)) return "medical_eligibility";
  if (/\bmat\b/i.test(lower)) return "mat_status";
  if (/(therapy\s*track|track)/i.test(lower)) return "therapy_track";
  if (/(drug\s*test\s*mode|test\s*mode)/i.test(lower)) return "drug_test_mode";
  if (/(drug\s*tests?\s*per\s*week|tests?\s*per\s*week)/i.test(lower)) return "drug_tests_per_week";
  if (/(drug\s*test\s*weekday|test\s*weekday|weekday)/i.test(lower)) return "drug_test_weekday";
  if (/(problem\s*list\s*date)/i.test(lower)) return "problem_list_date";
  if (/(last\s*problem\s*list\s*review)/i.test(lower)) return "last_problem_list_review";
  if (/(last\s*problem\s*list\s*update)/i.test(lower)) return "last_problem_list_update";
  if (/(treatment\s*plan\s*date)/i.test(lower)) return "treatment_plan_date";
  if (/(treatment\s*plan\s*update)/i.test(lower)) return "treatment_plan_update";
  return null;
}

function inferColumnType(values: string[]) {
  const samples = values.map((value) => value.trim()).filter(Boolean).slice(0, 25);
  if (!samples.length) return null;
  const dateCount = samples.filter((value) => !Number.isNaN(new Date(value).getTime()) || /^\d{4}-\d{2}-\d{2}$/.test(value)).length;
  if (dateCount / samples.length >= 0.7) return "date";
  const numericCount = samples.filter((value) => /^-?\d+(\.\d+)?$/.test(value)).length;
  if (numericCount / samples.length >= 0.8) return "number";
  return "text";
}

function parseWorkbook(buffer: ArrayBuffer, fileName: string): ParsedWorkbook {
  const workbook = read(buffer, { type: "array", cellDates: true, dense: true });
  const sheets: Record<string, ParsedSheet> = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as unknown[][];

    const [headerRow = [], ...dataRows] = rawRows;
    const headers = headerRow.map((header, index) => {
      const text = normalizeText(header);
      return text || `Column ${index + 1}`;
    });

    const rows = dataRows
      .filter((row) => row.some((cell) => normalizeText(cell)))
      .map((row) => {
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          record[header] = normalizeText(row[index]);
        });
        return record;
      });

    sheets[sheetName] = {
      headers,
      rows,
      previewRows: rows.slice(0, 8),
    };
  }

  return {
    fileName,
    sheetNames: workbook.SheetNames,
    sheets,
  };
}

function compareRowsForOverwrite(
  row: BridgeRowDraft,
  columns: BridgeDraft["columns"],
  patientsById: Map<string, Patient>
) {
  if (!row.linkedPatientId) return 0;
  const patient = patientsById.get(row.linkedPatientId);
  if (!patient) return 0;

  let changes = 0;
  for (const column of columns) {
    if (!column.mappedPatientField) continue;
    const value = row.values[column.columnName];
    const patientValue = getComparablePatientFieldValue(patient, column.mappedPatientField);
    const imported = normalizeText(value)?.toLowerCase() ?? "";
    const existing = normalizeText(patientValue)?.toLowerCase() ?? "";
    if (imported && imported !== existing) {
      changes += 1;
    }
  }
  return changes;
}

function getComparablePatientFieldValue(patient: Patient, field: AdminSheetPatientField) {
  const roster = patient.rosterDetails ?? {};
  const compliance = (patient as Patient & { compliance?: { [key: string]: unknown } }).compliance ?? {};
  switch (field) {
    case "full_name":
      return patient.displayName ?? "";
    case "date_of_birth":
      return patient.dateOfBirth ?? "";
    case "mrn":
      return patient.mrn ?? "";
    case "external_id":
      return (patient as Patient & { externalId?: string }).externalId ?? "";
    case "status":
      return patient.kind ?? patient.status ?? "";
    case "location":
      return patient.location ?? "";
    case "intake_date":
      return patient.intakeDate ?? "";
    case "last_visit_date":
      return patient.lastVisitDate ?? "";
    case "next_appt_date":
      return patient.nextApptDate ?? "";
    case "primary_program":
      return patient.primaryProgram ?? "";
    case "counselor_name":
      return patient.counselor ?? "";
    case "drug_of_choice":
      return (roster.drugOfChoice ?? []).join(", ");
    case "medical_phys_apt":
      return roster.medicalPhysApt ?? "";
    case "med_form_status":
      return roster.medFormStatus ?? "";
    case "notes":
      return roster.notes ?? "";
    case "referring_agency":
      return roster.referringAgency ?? "";
    case "reauth_sapc_date":
      return roster.reauthSapcDate ?? "";
    case "medical_eligibility":
      return roster.medicalEligibility ?? "";
    case "mat_status":
      return roster.matStatus ?? "";
    case "therapy_track":
      return roster.therapyTrack ?? "";
    case "drug_test_mode":
      return (compliance as any).drugTestMode ?? "";
    case "drug_tests_per_week":
      return (compliance as any).drugTestsPerWeek != null ? String((compliance as any).drugTestsPerWeek) : "";
    case "drug_test_weekday":
      return (compliance as any).drugTestWeekday != null ? String((compliance as any).drugTestWeekday) : "";
    case "problem_list_date":
      return (compliance as any).problemListDate ?? "";
    case "last_problem_list_review":
      return (compliance as any).lastProblemListReview ?? "";
    case "last_problem_list_update":
      return (compliance as any).lastProblemListUpdate ?? "";
    case "treatment_plan_date":
      return (compliance as any).treatmentPlanDate ?? "";
    case "treatment_plan_update":
      return (compliance as any).lastTreatmentPlanUpdate ?? "";
    default:
      return "";
  }
}

function csvEscape(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function buildExportRows(detail: AdminSheetDetail) {
  return detail.rows.map((row) => {
    const record: Record<string, string> = {};
    detail.columns.forEach((column) => {
      record[column.column_name] = row.cells[column.id] ?? "";
    });
    return record;
  });
}

function makeSheetLabel(sheet: AdminSheetSummary) {
  return `${sheet.name} (${sheet.row_count} rows)`;
}

function buildDraftRows(
  sheet: ParsedSheet,
  columns: BridgeDraft["columns"],
  patientsByExactKey: Map<string, string>,
  patientsByName: Map<string, string[]>
): BridgeRowDraft[] {
  const fullNameColumn = columns.find((column) => column.mappedPatientField === "full_name");
  const dobColumn = columns.find((column) => column.mappedPatientField === "date_of_birth");

  return sheet.rows.map((values, index) => {
    const rowName = fullNameColumn ? normalizeText(values[fullNameColumn.columnName]) : "";
    const rowDob = dobColumn ? normalizeDate(values[dobColumn.columnName]) : "";
    const exactMatchId = rowName && rowDob ? patientsByExactKey.get(`${normalizeName(rowName)}::${rowDob}`) ?? null : null;
    const suggestedPatientId = !exactMatchId && rowName && !rowDob ? (patientsByName.get(normalizeName(rowName))?.length === 1 ? patientsByName.get(normalizeName(rowName))?.[0] ?? null : null) : null;
    const linkMode: LinkMode = exactMatchId ? "exact" : suggestedPatientId ? "suggested" : "unlinked";
    return {
      sourceRowIndex: index + 2,
      linkedPatientId: exactMatchId,
      linkMode,
      suggestedPatientId,
      values,
    };
  });
}

export function PatientBridgePage({
  isAdmin,
  dataClient,
  patients,
  onRefreshPatients,
  onOpenPatient,
}: {
  isAdmin: boolean;
  dataClient: DataClient;
  patients: Patient[];
  onRefreshPatients: () => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const [sheets, setSheets] = useState<AdminSheetSummary[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<AdminSheetDetail | null>(null);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState<string>("");
  const [sheetTitle, setSheetTitle] = useState("");
  const [applyPatientFieldUpdates, setApplyPatientFieldUpdates] = useState(true);
  const [draft, setDraft] = useState<BridgeDraft | null>(null);
  const [savingImport, setSavingImport] = useState(false);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [savingLinkKey, setSavingLinkKey] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);

  const patientsById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients]);
  const exactPatientIndex = useMemo(() => {
    const map = new Map<string, string>();
    patients.forEach((patient) => {
      if (patient.displayName && patient.dateOfBirth) {
        map.set(`${normalizeName(patient.displayName)}::${patient.dateOfBirth}`, patient.id);
      }
    });
    return map;
  }, [patients]);
  const namePatientIndex = useMemo(() => {
    const map = new Map<string, string[]>();
    patients.forEach((patient) => {
      const key = normalizeName(patient.displayName);
      if (!key) return;
      const bucket = map.get(key) ?? [];
      bucket.push(patient.id);
      map.set(key, bucket);
    });
    return map;
  }, [patients]);

  const activeParsedSheet = parsedWorkbook && selectedSheetName ? parsedWorkbook.sheets[selectedSheetName] : null;

  const previewStats = useMemo(() => {
    if (!draft) {
      return { rows: 0, exactMatches: 0, suggestedMatches: 0, unmatched: 0, overwriteWarnings: 0 };
    }
    const exactMatches = draft.rows.filter((row) => row.linkMode === "exact").length;
    const suggestedMatches = draft.rows.filter((row) => row.linkMode === "suggested").length;
    const unmatched = draft.rows.filter((row) => !row.linkedPatientId).length;
    const overwriteWarnings = draft.rows.reduce((sum, row) => sum + compareRowsForOverwrite(row, draft.columns, patientsById), 0);
    return { rows: draft.rows.length, exactMatches, suggestedMatches, unmatched, overwriteWarnings };
  }, [draft, patientsById]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!isAdmin) return;
      setLoadingSheets(true);
      try {
        const response = await dataClient.listAdminSheets();
        if (cancelled) return;
        setSheets(response);
        setError(null);
      } catch (error) {
        if (cancelled) return;
        setError(String(error));
      } finally {
        if (!cancelled) setLoadingSheets(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [dataClient, isAdmin]);

  useEffect(() => {
    if (!activeSheetId) {
      setActiveSheet(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingDetail(true);
      try {
        const sheet = await dataClient.getAdminSheet(activeSheetId);
        if (cancelled) return;
        setActiveSheet(sheet);
        setError(null);
      } catch (error) {
        if (cancelled) return;
        setError(String(error));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeSheetId, dataClient]);

  useEffect(() => {
    setShowSplash(true);
    const splashTimer = window.setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => window.clearTimeout(splashTimer);
  }, []);

  const buildDraftForSheet = (workbook: ParsedWorkbook, sheetName: string, importTitle?: string) => {
    const sheet = workbook.sheets[sheetName];
    if (!sheet) return null;
    const headers = sheet.headers;
    const columns = headers.map((header, index) => ({
      columnName: header,
      mappedPatientField: autoMapField(header),
      columnType: inferColumnType(sheet.rows.map((row) => row[header] ?? "")),
      sortOrder: index,
    }));
    const rows = buildDraftRows(sheet, columns, exactPatientIndex, namePatientIndex);

    return {
      sheetName: importTitle?.trim() || sheetName,
      sourceSheetName: sheetName,
      fileName: workbook.fileName,
      columns,
      rows,
    } satisfies BridgeDraft;
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbook(buffer, file.name);
      const firstSheet = workbook.sheetNames[0] ?? "";
      setUploadFile(file);
      setParsedWorkbook(workbook);
      setSelectedSheetName(firstSheet);
      const importTitle = file.name.replace(/\.(xlsx|csv)$/i, "");
      setSheetTitle(importTitle);
      const nextDraft = buildDraftForSheet(workbook, firstSheet, importTitle);
      if (!nextDraft) {
        throw new Error("The selected workbook does not contain any usable sheets.");
      }
      setDraft(nextDraft);
      setError(null);
    } catch (error) {
      setError(String(error));
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheetName(sheetName);
    if (parsedWorkbook) {
      const nextDraft = buildDraftForSheet(parsedWorkbook, sheetName, sheetTitle);
      if (nextDraft) setDraft(nextDraft);
    }
  };

  const updateColumnMapping = (columnName: string, mapped: AdminSheetPatientField | "") => {
    setDraft((current) => {
      if (!current) return current;
      const next = {
        ...current,
        columns: current.columns.map((column) =>
          column.columnName === columnName
            ? { ...column, mappedPatientField: mapped || null }
            : column
        ),
      };
      if (parsedWorkbook && selectedSheetName) {
        const sheet = parsedWorkbook.sheets[selectedSheetName];
        next.rows = buildDraftRows(sheet, next.columns, exactPatientIndex, namePatientIndex);
      }
      return next;
    });
  };

  const updateRowLink = async (rowId: string, linkedPatientId: string | null) => {
    if (!activeSheet) return;
    const row = activeSheet.rows.find((entry) => entry.id === rowId);
    if (!row) return;
    const key = `${row.id}::link`;
    setSavingLinkKey(key);
    try {
      await dataClient.updateAdminSheetRowLink(activeSheet.id, { rowId: row.id, linkedPatientId });
      setActiveSheet(await dataClient.getAdminSheet(activeSheet.id));
      onRefreshPatients();
    } catch (error) {
      setError(String(error));
    } finally {
      setSavingLinkKey(null);
    }
  };

  const updateCell = async (rowId: string, columnId: string, value: string) => {
    if (!activeSheet) return;
    const key = `${rowId}::${columnId}`;
    setSavingCellKey(key);
    try {
      await dataClient.updateAdminSheetCell(activeSheet.id, { rowId, columnId, value });
      setActiveSheet(await dataClient.getAdminSheet(activeSheet.id));
      onRefreshPatients();
    } catch (error) {
      setError(String(error));
    } finally {
      setSavingCellKey(null);
    }
  };

  const importSheet = async () => {
    if (!draft) return;
    if (applyPatientFieldUpdates && previewStats.overwriteWarnings > 0) {
      const confirmed = window.confirm(
        `This import may update ${previewStats.overwriteWarnings} existing patient field value(s) across ${previewStats.rows} row(s). Continue?`
      );
      if (!confirmed) return;
    }
    setSavingImport(true);
    try {
      const sheet = await dataClient.createAdminSheet({
        name: draft.sheetName,
        original_file_name: draft.fileName,
        source_sheet_name: draft.sourceSheetName,
        apply_patient_field_updates: applyPatientFieldUpdates,
        columns: draft.columns.map((column) => ({
          column_name: column.columnName,
          mapped_patient_field: column.mappedPatientField,
          column_type: column.columnType,
          sort_order: column.sortOrder,
        })),
        rows: draft.rows.map((row) => ({
          row_order: row.sourceRowIndex,
          linked_patient_id: row.linkedPatientId,
          values: row.values,
        })),
      });
      setActiveSheet(sheet);
      setActiveSheetId(sheet.id);
      onRefreshPatients();
      const refreshed = await dataClient.listAdminSheets();
      setSheets(refreshed);
      setParsedWorkbook(null);
      setDraft(null);
      setUploadFile(null);
      setError(null);
    } catch (error) {
      setError(String(error));
    } finally {
      setSavingImport(false);
    }
  };

  const exportCsv = () => {
    if (!activeSheet) return;
    const rows = buildExportRows(activeSheet);
    const headerLine = activeSheet.columns.map((column) => csvEscape(column.column_name)).join(",");
    const bodyLines = rows.map((row) => activeSheet.columns.map((column) => csvEscape(row[column.column_name] ?? "")).join(","));
    const blob = new Blob([`\ufeff${[headerLine, ...bodyLines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeSheet.name}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    if (!activeSheet) return;
    const rows = buildExportRows(activeSheet);
    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, activeSheet.name.slice(0, 31) || "Sheet1");
    writeFile(workbook, `${activeSheet.name}.xlsx`);
  };

  if (!isAdmin) {
    return (
      <div className="panel patientBridgePanel">
        <div className="panelHead">patientbridge</div>
        <div className="panelBody">This area is available to admins only.</div>
      </div>
    );
  }

  return (
    <>
      {showSplash ? (
        <div className="patientBridgeSplash" aria-live="polite" aria-label="patientbridge loading splash">
          <div className="patientBridgeSplashCard">
            <img className="patientBridgeSplashLogo" src="/patientbridgelogo.png" alt="patientbridge" />
          </div>
        </div>
      ) : null}

      <div className="patientBridgeLayout">
        <div className="panel patientBridgePanel">
          <div className="panelHead">Upload Excel Spreadsheet</div>
          <div className="panelBody">
          <div className="patientBridgeIntro">
            Upload an `.xlsx` or `.csv` file, choose the sheet/tab, map columns, and import it as a saved admin sheet.
          </div>
          <div className="patientBridgeUploadRow">
            <label className="btn">
              Choose file
              <input type="file" accept=".xlsx,.csv" hidden onChange={handleFileChange} />
            </label>
            <div className="patientBridgeFileName">{uploadFile?.name ?? "No file selected yet"}</div>
          </div>

          {parsedWorkbook ? (
            <>
              {parsedWorkbook.sheetNames.length > 1 ? (
                <label className="patientBridgeField">
                  <span className="addLabel">Choose sheet/tab</span>
                  <select className="select" value={selectedSheetName} onChange={(e) => handleSheetChange(e.target.value)}>
                    {parsedWorkbook.sheetNames.map((sheetName) => (
                      <option key={sheetName} value={sheetName}>
                        {sheetName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {activeParsedSheet ? (
                <>
                  <label className="patientBridgeField">
                    <span className="addLabel">Import name</span>
                    <input className="authInput" value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} />
                  </label>

                  <div className="patientBridgeStats">
                    <div className="patientBridgeStat">
                      <strong>{draft?.rows.length ?? activeParsedSheet.rows.length}</strong>
                      <span>Rows to import</span>
                    </div>
                    <div className="patientBridgeStat">
                      <strong>{previewStats.exactMatches + previewStats.suggestedMatches}</strong>
                      <span>Rows linked or ready to confirm</span>
                    </div>
                    <div className="patientBridgeStat">
                      <strong>{previewStats.unmatched}</strong>
                      <span>Rows not linked yet</span>
                    </div>
                    <div className="patientBridgeStat">
                      <strong>{previewStats.overwriteWarnings}</strong>
                      <span>Potential patient field overwrites</span>
                    </div>
                  </div>

                  <div className="patientBridgeWarning">
                    Only mapped fields update real patient records. Extra columns stay in the admin sheet.
                  </div>

                  <div className="patientBridgePreview">
                    <div className="patientBridgePreviewHead">Preview Import</div>
                    <div className="patientBridgePreviewTableWrap">
                      <table className="patientBridgePreviewTable">
                        <thead>
                          <tr>
                            <th>Column</th>
                            <th>Mapped To</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeParsedSheet.headers.map((header, index) => {
                            const column = draft?.columns[index];
                            return (
                              <tr key={header}>
                                <td>{header}</td>
                                <td>
                                  <select
                                    className="select"
                                    value={column?.mappedPatientField ?? ""}
                                    onChange={(e) => updateColumnMapping(header, e.target.value as AdminSheetPatientField | "")}
                                  >
                                    {FIELD_OPTIONS.map((option) => (
                                      <option key={option.label} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>{column?.columnType ?? "text"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="patientBridgePreview">
                    <div className="patientBridgePreviewHead">Preview Rows</div>
                    <div className="patientBridgePreviewTableWrap">
                      <table className="patientBridgePreviewTable">
                        <thead>
                          <tr>
                            <th>Linked Patient</th>
                            {activeParsedSheet.headers.map((header) => (
                              <th key={header}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {draft?.rows.map((row, index) => {
                            const exactMode = row.linkMode === "exact";
                            const suggestedLabel = row.suggestedPatientId ? patientsById.get(row.suggestedPatientId)?.displayName ?? "Suggested patient" : "Unlinked";
                            return (
                              <tr key={`${row.sourceRowIndex}-${index}`}>
                                <td>
                                  <select
                                    className="select"
                                    value={row.linkedPatientId ?? ""}
                                    onChange={(e) => {
                                      const nextId = e.target.value || null;
                                      setDraft((current) => {
                                        if (!current) return current;
                                        return {
                                          ...current,
                                          rows: current.rows.map((draftRow) =>
                                            draftRow.sourceRowIndex === row.sourceRowIndex
                                              ? {
                                                  ...draftRow,
                                                  linkedPatientId: nextId,
                                                  linkMode: nextId
                                                    ? "manual"
                                                    : draftRow.linkMode === "exact"
                                                      ? "exact"
                                                      : draftRow.suggestedPatientId
                                                        ? "suggested"
                                                        : "unlinked",
                                                }
                                              : draftRow
                                          ),
                                        };
                                      });
                                    }}
                                  >
                                    <option value="">Unlinked</option>
                                    {patients
                                      .slice()
                                      .sort((a, b) => a.displayName.localeCompare(b.displayName))
                                      .map((patient) => (
                                        <option key={patient.id} value={patient.id}>
                                          {patientLabel(patient)}
                                        </option>
                                      ))}
                                  </select>
                                  <div className="patientBridgeRowHint">
                                    {exactMode ? "Auto-linked by name + DOB" : row.suggestedPatientId ? `Suggested: ${suggestedLabel}` : "Admin-only row for now"}
                                  </div>
                                </td>
                                {activeParsedSheet.headers.map((header) => (
                                  <td key={header}>{row.values[header] || "—"}</td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <label className="patientBridgeCheckbox">
                    <input
                      type="checkbox"
                      checked={applyPatientFieldUpdates}
                      onChange={(e) => setApplyPatientFieldUpdates(e.target.checked)}
                    />
                    Apply mapped field updates to linked patient records
                  </label>

                  <div className="patientBridgeActions">
                    <button className="btn ghost" type="button" onClick={() => { setParsedWorkbook(null); setDraft(null); setUploadFile(null); }}>
                      Cancel
                    </button>
                    <button className="btn" type="button" onClick={() => void importSheet()} disabled={savingImport}>
                      {savingImport ? "Importing..." : "Import as Admin Sheet"}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {error ? <div className="authErr" style={{ marginTop: 12 }}>{error}</div> : null}
          </div>
        </div>

        <div className="panel patientBridgePanel">
          <div className="panelHead">Saved Admin Sheets</div>
          <div className="panelBody">
          {loadingSheets ? <div className="workspaceEmptyState">Loading saved sheets...</div> : null}
          {!loadingSheets && !sheets.length ? <div className="workspaceEmptyState">No admin sheets saved yet.</div> : null}
          <div className="patientBridgeSavedList">
            {sheets.map((sheet) => (
              <button key={sheet.id} className={activeSheetId === sheet.id ? "patientBridgeSavedItem active" : "patientBridgeSavedItem"} onClick={() => setActiveSheetId(sheet.id)}>
                <div className="patientBridgeSavedTitle">{makeSheetLabel(sheet)}</div>
                <div className="patientBridgeSavedMeta">
                  <span>{sheet.original_file_name}</span>
                  <span>{sheet.linked_patient_count} linked</span>
                  <span>{sheet.unmatched_row_count} unlinked</span>
                </div>
              </button>
            ))}
          </div>
          </div>
        </div>

        {activeSheet ? (
          <div className="panel patientBridgePanel wide">
            <div className="panelHead">Import Sheet</div>
            <div className="panelBody">
            <div className="patientBridgeSheetActions">
              <div className="patientBridgeSavedMeta">
                <span>{activeSheet.original_file_name}</span>
                <span>{activeSheet.row_count} rows</span>
                <span>{activeSheet.linked_patient_count} linked</span>
                <span>{activeSheet.unmatched_row_count} unlinked</span>
              </div>
              <div className="patientBridgeExportActions">
                <button className="btn ghost" onClick={exportCsv}>Export to CSV</button>
                <button className="btn ghost" onClick={exportXlsx}>Export to Excel</button>
              </div>
            </div>

            {loadingDetail ? <div className="workspaceEmptyState">Loading sheet...</div> : null}

            {activeSheet.columns.length && activeSheet.rows.length ? (
              <div className="patientBridgeGridWrap">
                <table className="patientBridgeGrid">
                  <thead>
                    <tr>
                      <th>Linked Patient</th>
                      {activeSheet.columns.map((column) => (
                        <th key={column.id}>
                          <div>{column.column_name}</div>
                          <div className="patientBridgeColMeta">
                            {column.mapped_patient_field ? FIELD_LABELS[column.mapped_patient_field as AdminSheetPatientField] : "Custom admin column"}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="patientBridgeLinkCell">
                          <select
                            className="select"
                            value={row.linked_patient_id ?? ""}
                            onChange={(e) => void updateRowLink(row.id, e.target.value || null)}
                            disabled={savingLinkKey === `${row.id}::link`}
                          >
                            <option value="">Unlinked</option>
                            {patients.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)).map((patient) => (
                              <option key={patient.id} value={patient.id}>
                                {patientLabel(patient)}
                              </option>
                            ))}
                          </select>
                          <div className="patientBridgeRowHint">
                            {row.linked_patient_name ? `Linked Patient: ${row.linked_patient_name}` : "Admin-only row"}
                          </div>
                          {row.linked_patient_id ? (
                            <button className="btn ghost" type="button" onClick={() => onOpenPatient(row.linked_patient_id!)}>
                              Open patient
                            </button>
                          ) : null}
                        </td>
                        {activeSheet.columns.map((column) => {
                          const currentValue = row.cells[column.id] ?? "";
                          const cellKey = `${row.id}::${column.id}`;
                          return (
                            <td key={column.id}>
                              <input
                                className="authInput patientBridgeCellInput"
                                value={currentValue}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setActiveSheet((current) => {
                                    if (!current) return current;
                                    return {
                                      ...current,
                                      rows: current.rows.map((sheetRow) =>
                                        sheetRow.id === row.id
                                          ? {
                                              ...sheetRow,
                                              cells: {
                                                ...sheetRow.cells,
                                                [column.id]: nextValue,
                                              },
                                            }
                                          : sheetRow
                                      ),
                                    };
                                  });
                                }}
                                onBlur={(e) => {
                                  if (e.target.value !== currentValue) {
                                    void updateCell(row.id, column.id, e.target.value);
                                  }
                                }}
                                disabled={savingCellKey === cellKey}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
