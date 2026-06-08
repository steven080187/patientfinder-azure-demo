import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { read, utils, write } from "xlsx";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "/@fs/Users/steven/Projects/patientfinder-azure-demo/node_modules/@univerjs/preset-sheets-core/lib/index.css";
import { buildImportPlanRows, samplePatientRecords } from "./patientBridgeDomain";
import "./PatientBridgeWorkbookPage.css";

type PatientBridgeWorkbookPageProps = {
  patients: unknown[];
  onRefreshPatients: () => void;
  onBackToPatientFinder: () => void;
  onOpenPatient?: (patientId: string) => void;
  onHighlightPatient?: (payload: { patientId?: string; patientName?: string; recipientEmail?: string }) => void;
};

type WorkbookSourceMode = "live" | "imported";

type LocalSheet = {
  name: string;
  headers: string[];
  rows: string[][];
  freezeRows: number;
  freezeColumns: number;
  columnWidths: number[];
};

type WorkbookModel = {
  sourceMode: WorkbookSourceMode;
  fileName: string;
  title: string;
  sheets: LocalSheet[];
};

const HEADER_STYLE = {
  bg: { rgb: "#1f2937" },
  cl: { rgb: "#f8fafc" },
  bl: true,
  fs: 11,
};

const FIRST_COLUMN_STYLE = {
  bg: { rgb: "#e8edf3" },
  cl: { rgb: "#16202d" },
  bl: true,
  fs: 11,
};

const BODY_STYLE = {
  cl: { rgb: "#0f1720" },
  fs: 11,
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function textValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text;
}

function joinStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => textValue(item)).filter(Boolean).join(", ");
  }
  return textValue(value);
}

function dateValue(value: unknown) {
  const text = textValue(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function attendancePlannerEnabledForPatient(patientId: string) {
  if (typeof window === "undefined") return false;
  const key = `patientfinder.attendance.enabled.v1.${normalizeId(patientId)}`;
  return window.localStorage.getItem(key) === "1";
}

function summarizeProblemList(record: Record<string, unknown>, compliance: Record<string, unknown>) {
  const patientKind = textValue(record.kind);
  if (patientKind === "Former Patient") return "Ended";

  const problemListDate = dateValue(compliance.problemListDate ?? record.problemListDate);
  if (problemListDate) return problemListDate;

  const intakeDate = dateValue(record.intakeDate);
  const dueDate = intakeDate ? addDaysIso(intakeDate, 7) : "";
  return dueDate ? `Due ${dueDate}` : "Problem list date not set";
}

function summarizeTreatmentPlan(record: Record<string, unknown>, compliance: Record<string, unknown>) {
  const patientKind = textValue(record.kind);
  if (patientKind === "Former Patient" || patientKind === "RSS" || patientKind === "RSS+") return "Ended";

  const treatmentPlanDate = dateValue(compliance.treatmentPlanDate ?? record.treatmentPlanDate);
  if (treatmentPlanDate) return treatmentPlanDate;

  const intakeDate = dateValue(record.intakeDate);
  const dueDate = intakeDate ? addDaysIso(intakeDate, 30) : "";
  return dueDate ? `Due ${dueDate}` : "Treatment plan date not set";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function patientToRosterRow(patient: unknown): string[] {
  const record = asRecord(patient);
  const roster = asRecord(record.rosterDetails);
  const rawRoster = asRecord(record.roster_details);
  const compliance = asRecord(record.compliance);
  const flags = Array.isArray(record.flags) ? record.flags.map((flag) => textValue(flag)).filter(Boolean).join(", ") : "";
  const name = textValue(record.displayName) || textValue(record.fullName) || "Unknown patient";
  const status = textValue(record.status) || textValue(record.kind) || "Unknown";
  const counselor = textValue(record.counselor);
  const location = textValue(record.location);
  const primaryProgram = textValue(record.primaryProgram);
  const doc =
    joinStringList(roster.drugOfChoice) ||
    joinStringList(rawRoster.drug_of_choice) ||
    joinStringList(record.drugOfChoice) ||
    joinStringList(record.drug_of_choice) ||
    joinStringList(record.substances) ||
    joinStringList(rawRoster.substances);
  const notes = textValue(roster.notes);
  const patientId = textValue(record.id);
  const scheduleVisible = patientId ? attendancePlannerEnabledForPatient(patientId) : false;
  const lastVisit = scheduleVisible ? dateValue(record.lastVisitDate) : "";
  const nextAppt = scheduleVisible ? dateValue(record.nextApptDate) : "";
  const problemList = summarizeProblemList(record, compliance);
  const treatmentPlan = summarizeTreatmentPlan(record, compliance);
  const complianceSnapshot = [
    `PL ${problemList}`,
    `TP ${treatmentPlan}`,
    `Reauth ${dateValue(compliance.reauthSapcDate ?? roster.reauthSapcDate) || "n/a"}`,
  ].join(" | ");

  return [
    name,
    textValue(record.mrn),
    dateValue(record.dateOfBirth),
    status,
    counselor,
    location,
    primaryProgram,
    doc,
    lastVisit,
    nextAppt,
    problemList,
    treatmentPlan,
    textValue(compliance.reauthSapcDate ?? roster.reauthSapcDate),
    notes,
    flags,
    complianceSnapshot,
  ];
}

function buildLiveWorkbookModel(patients: unknown[]): WorkbookModel {
  const sourcePatients = patients.length > 0 ? patients : samplePatientRecords;

  const rosterHeaders = [
    "Patient",
    "MRN",
    "DOB",
    "Status",
    "Counselor",
    "Location",
    "Program",
    "DOC",
    "Last Visit",
    "Next Appt",
    "Problem List",
    "Treatment Plan",
    "Reauth SAPC",
    "Notes",
    "Flags",
    "Compliance Snapshot",
  ];

  const rosterRows = sourcePatients.map((patient) => patientToRosterRow(patient));
  const importPlanRows = buildImportPlanRows().map((row) => [
    row.sourceField,
    row.workbookField,
    row.patientRecordTarget,
    row.notes,
    row.status,
  ]);

  return {
    sourceMode: "live",
    fileName: "patientbridge-live-roster.xlsx",
    title: "patientbridge",
    sheets: [
      {
        name: "Roster",
        headers: rosterHeaders,
        rows: rosterRows,
        freezeRows: 1,
        freezeColumns: 1,
        columnWidths: rosterHeaders.map((_, index) => (index === 0 ? 220 : index >= 13 ? 180 : 132)),
      },
      {
        name: "Import Plan",
        headers: ["Source Field", "Workbook Field", "Patient Target", "Notes", "Status"],
        rows: importPlanRows,
        freezeRows: 1,
        freezeColumns: 0,
        columnWidths: [180, 160, 220, 360, 120],
      },
    ],
  };
}

function buildImportedWorkbookModel(fileName: string, workbook: any): WorkbookModel {
  const sheetNames = workbook.SheetNames.slice(0, 4);
  const sheets: LocalSheet[] = sheetNames.map((sheetName: string) => {
    const worksheet = workbook.Sheets[sheetName];
    const grid = utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as unknown[][];
    const [headerRow = [], ...dataRows] = grid;
    const headers = headerRow.map((header, index) => {
      const text = textValue(header);
      return text || `Column ${index + 1}`;
    });
    const rows = dataRows
      .filter((row) => row.some((cell) => textValue(cell)))
      .map((row) => headers.map((_, index) => textValue(row[index])));

    return {
      name: sheetName,
      headers: headers.length ? headers : ["Column 1"],
      rows,
      freezeRows: 1,
      freezeColumns: 1,
      columnWidths: headers.map((_, index) => (index === 0 ? 220 : 140)),
    };
  });

  return {
    sourceMode: "imported",
    fileName,
    title: "patientbridge",
    sheets: sheets.length ? sheets : [buildLiveWorkbookModel(samplePatientRecords).sheets[0]],
  };
}

function buildWorkbookData(sheet: LocalSheet, workbookName: string) {
  const cellData: Record<string, Record<string, { v: string; s?: Record<string, unknown> }>> = {};
  const rowCount = Math.max(sheet.rows.length + 32, 120);
  const columnCount = Math.max(sheet.headers.length + 4, 16);

  cellData[0] = {};
  sheet.headers.forEach((header, columnIndex) => {
    cellData[0][columnIndex] = {
      v: header,
      s: columnIndex === 0 ? { ...HEADER_STYLE, bg: { rgb: "#0f1621" } } : HEADER_STYLE,
    };
  });

  sheet.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    cellData[rowNumber] = {};
    row.forEach((value, columnIndex) => {
      if (!value) return;
      cellData[rowNumber][columnIndex] = {
        v: value,
        s: columnIndex === 0 ? FIRST_COLUMN_STYLE : BODY_STYLE,
      };
    });
  });

  return {
    id: `patientbridge-${sheet.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: workbookName,
    appVersion: "1.0.0",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [sheet.name],
    sheets: {
      [sheet.name]: {
        id: sheet.name,
        name: sheet.name,
        hidden: 0,
        freeze: {
          xSplit: sheet.freezeColumns,
          ySplit: sheet.freezeRows,
          startRow: sheet.freezeRows,
          startColumn: sheet.freezeColumns,
        },
        rowCount,
        columnCount,
        defaultColumnWidth: 140,
        defaultRowHeight: 28,
        cellData,
        rowData: [],
        columnData: sheet.columnWidths.map((width, index) => ({ width, custom: { index } })),
        rowHeader: { width: 56 },
        columnHeader: { height: 30 },
        showGridlines: 1,
        defaultStyle: {
          bg: { rgb: "#f7f8fb" },
          cl: { rgb: "#13202f" },
          fs: 11,
        },
      },
    },
  };
}

function workbookToXlsxBlob(model: WorkbookModel) {
  const workbook = utils.book_new();
  model.sheets.forEach((sheet) => {
    const aoa = [sheet.headers, ...sheet.rows];
    const worksheet = utils.aoa_to_sheet(aoa);
    utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31) || "Sheet1");
  });
  const buffer = write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function PatientBridgeWorkbookPage({
  patients,
  onRefreshPatients,
  onBackToPatientFinder,
  onOpenPatient,
  onHighlightPatient,
}: PatientBridgeWorkbookPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCellRef = useRef<{ row: number; column: number } | null>(null);
  const [sourceMode, setSourceMode] = useState<WorkbookSourceMode>("live");
  const [importedModel, setImportedModel] = useState<WorkbookModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>("Live roster mirrored from PatientFinder");
  const [showSplash, setShowSplash] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; patientId: string; patientName: string } | null>(
    null,
  );

  const liveModel = useMemo(() => buildLiveWorkbookModel(patients), [patients]);
  const activeModel = sourceMode === "live" ? liveModel : importedModel ?? liveModel;
  const livePatients = sourceMode === "live" ? patients : [];

  useEffect(() => {
    if (sourceMode !== "live") return undefined;
    const sync = () => onRefreshPatients();
    const interval = window.setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [onRefreshPatients, sourceMode]);

  useEffect(() => {
    setContextMenu(null);
    lastCellRef.current = null;
  }, [activeModel, sourceMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const host = document.createElement("div");
    host.className = "patientBridgeWorkbookHost";
    host.style.width = "100%";
    host.style.height = "100%";
    container.appendChild(host);

    try {
      univerRef.current?.dispose?.();
    } catch {
      // ignore stale instance cleanup failures
    }

    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
      },
      presets: [
        UniverSheetsCorePreset({
          container: host,
          header: false,
          toolbar: false,
          footer: {
            sheetBar: true,
            statisticBar: false,
          } as any,
          disableAutoFocus: true,
          ribbonType: "simple" as any,
        } as any),
      ],
    } as any);

    univerRef.current = univerAPI;
    const workbookData = buildWorkbookData(activeModel.sheets[0], activeModel.title);
    univerAPI.createWorkbook(workbookData as any);

    const cellPointerDownDisposable = univerAPI.addEvent(univerAPI.Event.CellPointerDown, (params: any) => {
      if (params?.worksheet?.getSheetName?.() !== "Roster") return;
      lastCellRef.current = { row: params.row, column: params.column };
    });

    const cellClickedDisposable = univerAPI.addEvent(univerAPI.Event.CellClicked, (params: any) => {
      if (params?.worksheet?.getSheetName?.() !== "Roster") return;
      lastCellRef.current = { row: params.row, column: params.column };
    });

    const handleShiftClick = (event: MouseEvent) => {
      if (!onHighlightPatient) return;
      if (!event.shiftKey) return;
      if (!(event.target instanceof Element) || !event.target.closest('canvas[data-u-comp="render-canvas"]')) return;
      const currentSelection = univerAPI.getActiveWorkbook?.()?.getActiveSheet?.()?.getSelection?.();
      const currentCell = currentSelection?.getCurrentCell?.();
      const row = lastCellRef.current?.row ?? currentCell?.actualRow;
      event.preventDefault();
      event.stopPropagation();
      if (typeof row !== "number" || row < 1) {
        onHighlightPatient({});
        return;
      }
      const patient = asRecord(livePatients[row - 1]);
      const patientId = textValue(patient.id);
      if (!patientId) {
        onHighlightPatient({});
        return;
      }

      onHighlightPatient({
        patientId,
        patientName: textValue(patient.displayName) || textValue(patient.fullName) || "Unknown patient",
      });
    };

    const closeContextMenu = () => setContextMenu(null);
    container.addEventListener("click", handleShiftClick, true);
    document.addEventListener("click", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);

    return () => {
      cellPointerDownDisposable?.dispose?.();
      cellClickedDisposable?.dispose?.();
      container.removeEventListener("click", handleShiftClick, true);
      document.removeEventListener("click", closeContextMenu);
      window.removeEventListener("blur", closeContextMenu);
      try {
        univerRef.current?.dispose?.();
      } catch {
        // ignore dispose issues in hot reload / teardown
      } finally {
        univerRef.current = null;
        if (host.parentNode === container) {
          container.removeChild(host);
        }
      }
    };
  }, [activeModel, livePatients, onHighlightPatient, sourceMode]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const imported = buildImportedWorkbookModel(file.name, read(buffer, { type: "array", cellDates: true, dense: true }));
      setSourceMode("imported");
      setImportedModel(imported);
      setLastAction(`Imported ${file.name} locally`);
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import workbook.");
    }
  };

  const handleExport = () => {
    try {
      const blob = workbookToXlsxBlob(activeModel);
      const safeName = activeModel.fileName || "patientbridge-local-workbook.xlsx";
      downloadBlob(safeName, blob);
      setLastAction(`Exported ${safeName}`);
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export workbook.");
    }
  };

  const displayedRows = activeModel.sheets[0]?.rows.length ?? 0;
  const displayedColumns = activeModel.sheets[0]?.headers.length ?? 0;
  const workbookLabel = sourceMode === "live" ? "Live mirror" : "Imported local workbook";

  return (
    <div className="patientBridgeWorkbookShell">
      {showSplash ? (
        <div className="patientBridgeSplash" aria-live="polite" aria-label="patientbridge loading splash">
          <div className="patientBridgeSplashCard">
            <img className="patientBridgeSplashLogo" src="/patientbridge-logo.png" alt="patientbridge" />
          </div>
        </div>
      ) : null}
      <div className="patientBridgeTopBar">
        <div className="patientBridgeBrandBlock">
          <img className="patientBridgeLogo" src="/patientbridge-logo.png" alt="patientbridge" />
          <div className="patientBridgeBrandCopy">
            <div className="patientBridgeBrandName">patientbridge</div>
            <div className="patientBridgeBrandMeta">{workbookLabel}</div>
          </div>
        </div>

        <div className="patientBridgeMenuBar">
          <button className="patientBridgeButton" type="button" onClick={onBackToPatientFinder}>
            back
          </button>
          <button className="patientBridgeButton" type="button" onClick={handleExport}>
            export
          </button>
          <button className="patientBridgeButton" type="button" onClick={handleImportClick}>
            import
          </button>
        </div>
      </div>

      <div className="patientBridgeBody">
        <div className="patientBridgeSheetChrome">
          <div className="patientBridgeSheetStatus">
            <span>{displayedRows} rows</span>
            <span>{displayedColumns} columns</span>
            <span>{sourceMode === "live" ? "linked to PatientFinder" : "local-only import"}</span>
          </div>
          {error ? <div className="patientBridgeStatus patientBridgeStatusError">{error}</div> : null}
          {lastAction ? <div className="patientBridgeStatus patientBridgeStatusOk">{lastAction}</div> : null}
        </div>

        <div className="patientBridgeWorkbookFrame">
          <div ref={containerRef} className="patientBridgeWorkbookMount" />
        </div>
      </div>

      {contextMenu && onHighlightPatient ? (
        <div
          className="patientBridgeContextMenu"
          style={{
            left: `${Math.min(contextMenu.x, Math.max(12, window.innerWidth - 248))}px`,
            top: `${Math.min(contextMenu.y, Math.max(12, window.innerHeight - 146))}px`,
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="patientBridgeContextMeta">Patient</div>
          <div className="patientBridgeContextName">{contextMenu.patientName}</div>
          {onOpenPatient ? (
            <button
              className="patientBridgeContextAction patientBridgeContextActionSecondary"
              type="button"
              onClick={() => {
                onOpenPatient(contextMenu.patientId);
                setContextMenu(null);
              }}
            >
              open patient
            </button>
          ) : null}
          <button
            className="patientBridgeContextAction"
            type="button"
            onClick={() => {
              onHighlightPatient({ patientId: contextMenu.patientId, patientName: contextMenu.patientName });
              setContextMenu(null);
            }}
          >
            highlight patient for counselor
          </button>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        className="patientBridgeHiddenInput"
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => void handleFileSelected(event)}
      />
    </div>
  );
}
