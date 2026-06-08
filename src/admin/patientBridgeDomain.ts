export type PatientBridgePatientRecord = {
  id: string;
  fullName: string;
  mrn: string;
  dateOfBirth: string;
  location: string;
  status: string;
  counselor: string;
  primaryProgram: string;
  rosterDetails?: {
    drugOfChoice?: string[];
  };
  compliance: {
    problemListDate: string;
    problemListReviewDate: string;
    problemListUpdateDate: string;
    treatmentPlanDate: string;
    treatmentPlanUpdateDate: string;
    reauthSapcDate: string;
  };
};

export type PatientBridgeRosterRow = {
  rowId: string;
  linkedPatientId: string | null;
  patientName: string;
  mrn: string;
  dateOfBirth: string;
  status: string;
  counselor: string;
  location: string;
  lastVisitDate: string;
  nextApptDate: string;
  primaryProgram: string;
  drugOfChoice: string;
  medicalPhysApt: string;
  medFormStatus: string;
  referringAgency: string;
  reauthSapcDate: string;
  medicalEligibility: string;
  matStatus: string;
  therapyTrack: string;
  notes: string;
};

export type PatientBridgeRowLink = {
  matchedPatient: PatientBridgePatientRecord | null;
  suggestedPatients: PatientBridgePatientRecord[];
  confidence: "exact" | "strong" | "likely" | "manual";
};

export type PatientBridgeComplianceStatus = {
  problemListStatus: "ok" | "due";
  treatmentPlanStatus: "ok" | "due";
  reauthStatus: "ok" | "due";
  clinicalSummary: string;
};

export type PatientBridgeImportPlanRow = {
  sourceField: string;
  workbookField: string;
  patientRecordTarget: string;
  notes: string;
  status: "mapped" | "manual-review" | "planned";
};

const FULL_NAMES = [
  "Alyssa Grant",
  "Ben Navarro",
  "Carla Diaz",
  "Darnell Brooks",
  "Evelyn Shaw",
  "Frank Lee",
  "Giselle Romero",
  "Hector Kim",
  "Iris Patel",
  "Jonah Reed",
  "Kara Chen",
  "Liam Price",
];

const LOCATIONS = ["Van Nuys", "North Hollywood", "Reseda", "San Fernando"];
const COUNSELORS = ["M. Ortega", "L. Chen", "S. Patel", "T. Nguyen"];
const PROGRAMS = ["OP", "IOP", "MAT", "Aftercare"];

export const samplePatientRecords: PatientBridgePatientRecord[] = FULL_NAMES.map((fullName, index) => {
  const n = index + 1;
  return {
    id: `patient-${String(n).padStart(3, "0")}`,
    fullName,
    mrn: `MRN-${4100 + n}`,
    dateOfBirth: `198${index % 10}-0${(index % 6) + 1}-1${index % 9}`,
    location: LOCATIONS[index % LOCATIONS.length],
    status: index % 4 === 0 ? "Current" : index % 4 === 1 ? "Intake" : index % 4 === 2 ? "Hold" : "Current",
    counselor: COUNSELORS[index % COUNSELORS.length],
    primaryProgram: PROGRAMS[index % PROGRAMS.length],
    rosterDetails: {
      drugOfChoice: index % 3 === 0 ? ["Fentanyl"] : index % 3 === 1 ? ["Alcohol"] : ["Cannabis"],
    },
    compliance: {
      problemListDate: `2026-0${(index % 6) + 1}-0${(index % 9) + 1}`,
      problemListReviewDate: `2026-0${(index % 6) + 1}-1${index % 9}`,
      problemListUpdateDate: `2026-0${(index % 6) + 2}-0${(index % 8) + 2}`,
      treatmentPlanDate: `2026-0${(index % 6) + 1}-0${(index % 7) + 3}`,
      treatmentPlanUpdateDate: `2026-0${(index % 6) + 2}-1${index % 8}`,
      reauthSapcDate: `2026-0${(index % 6) + 2}-2${index % 7}`,
    },
  };
});

export const sampleRosterRows: PatientBridgeRosterRow[] = samplePatientRecords.map((patient, index) => {
  const linkedPatientId = index % 5 === 3 ? null : patient.id;
  const formatter = (monthOffset: number, dayOffset: number) => `2026-0${((index + monthOffset) % 6) + 1}-1${(index + dayOffset) % 8}`;

  return {
    rowId: `row-${String(index + 1).padStart(3, "0")}`,
    linkedPatientId,
    patientName: patient.fullName,
    mrn: patient.mrn,
    dateOfBirth: patient.dateOfBirth,
    status: patient.status,
    counselor: patient.counselor,
    location: patient.location,
    lastVisitDate: formatter(1, 2),
    nextApptDate: formatter(2, 3),
    primaryProgram: patient.primaryProgram,
    drugOfChoice: index % 3 === 0 ? "Fentanyl" : index % 3 === 1 ? "Alcohol" : "Cannabis",
    medicalPhysApt: index % 4 === 0 ? "Scheduled" : index % 4 === 1 ? "Needs follow-up" : "Complete",
    medFormStatus: index % 4 === 2 ? "Pending" : "On file",
    referringAgency: index % 2 === 0 ? "County referral" : "Community partner",
    reauthSapcDate: patient.compliance.reauthSapcDate,
    medicalEligibility: index % 4 === 0 ? "Verified" : index % 4 === 1 ? "Pending" : "Needs review",
    matStatus: index % 3 === 0 ? "Yes" : index % 3 === 1 ? "No" : "Unknown",
    therapyTrack: index % 3 === 0 ? "Early Recovery" : index % 3 === 1 ? "Maintenance" : "Stabilization",
    notes:
      index % 2 === 0
        ? "Keep on weekly review; no issues reported."
        : "Follow up on insurance and document scan upload.",
  };
});

const daysSince = (dateText: string) => {
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000));
};

const normalize = (value: string) => value.trim().toLowerCase();

export function linkRosterRowToPatient(row: PatientBridgeRosterRow): PatientBridgeRowLink {
  const exactByMrn = samplePatientRecords.find((patient) => normalize(patient.mrn) === normalize(row.mrn));
  if (exactByMrn) {
    return {
      matchedPatient: exactByMrn,
      suggestedPatients: [exactByMrn],
      confidence: "exact",
    };
  }

  const exactByNameAndDob = samplePatientRecords.find(
    (patient) => normalize(patient.fullName) === normalize(row.patientName) && patient.dateOfBirth === row.dateOfBirth
  );
  if (exactByNameAndDob) {
    return {
      matchedPatient: exactByNameAndDob,
      suggestedPatients: [exactByNameAndDob],
      confidence: "strong",
    };
  }

  const suggestions = samplePatientRecords
    .map((patient) => {
      let score = 0;
      if (normalize(patient.fullName).includes(normalize(row.patientName)) || normalize(row.patientName).includes(normalize(patient.fullName))) {
        score += 40;
      }
      if (normalize(patient.mrn).includes(normalize(row.mrn))) {
        score += 50;
      }
      if (patient.dateOfBirth === row.dateOfBirth) {
        score += 35;
      }
      if (normalize(patient.location) === normalize(row.location)) {
        score += 15;
      }
      if (normalize(patient.counselor) === normalize(row.counselor)) {
        score += 10;
      }
      return { patient, score };
    })
    .filter((entry) => entry.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.patient);

  return {
    matchedPatient: suggestions[0] ?? null,
    suggestedPatients: suggestions,
    confidence: suggestions.length ? "likely" : "manual",
  };
}

export function deriveComplianceStatus(row: PatientBridgeRosterRow): PatientBridgeComplianceStatus {
  const problemListStatus = daysSince(row.lastVisitDate) > 30 ? "due" : "ok";
  const treatmentPlanStatus = daysSince(row.reauthSapcDate) > 120 ? "due" : "ok";
  const reauthStatus = daysSince(row.reauthSapcDate) > 60 ? "due" : "ok";

  const parts = [
    problemListStatus === "due" ? "Problem list review due" : "Problem list up to date",
    treatmentPlanStatus === "due" ? "Treatment plan update due" : "Treatment plan current",
    reauthStatus === "due" ? "Reauth SAP-C overdue" : "Reauth SAP-C current",
  ];

  return {
    problemListStatus,
    treatmentPlanStatus,
    reauthStatus,
    clinicalSummary: parts.join(" • "),
  };
}

export function buildImportPlanRows(): PatientBridgeImportPlanRow[] {
  return [
    {
      sourceField: "Client Name",
      workbookField: "patientName",
      patientRecordTarget: "patient.fullName",
      notes: "Stable identity field. Prefer exact row linking.",
      status: "mapped",
    },
    {
      sourceField: "Program",
      workbookField: "primaryProgram",
      patientRecordTarget: "patient.primaryProgram",
      notes: "Keep the level-of-care/program column separate from DOC.",
      status: "mapped",
    },
    {
      sourceField: "DOC",
      workbookField: "drugOfChoice",
      patientRecordTarget: "patient.rosterDetails.drugOfChoice",
      notes: "Matches the patient drug-of-choice field as its own column.",
      status: "mapped",
    },
    {
      sourceField: "MRN / Sage ID",
      workbookField: "mrn",
      patientRecordTarget: "patient.mrn",
      notes: "Best canonical key for an exact patient match.",
      status: "mapped",
    },
    {
      sourceField: "Date of Birth",
      workbookField: "dateOfBirth",
      patientRecordTarget: "patient.dateOfBirth",
      notes: "Useful for disambiguation when names collide.",
      status: "mapped",
    },
    {
      sourceField: "Counselor",
      workbookField: "counselor",
      patientRecordTarget: "patient.counselor",
      notes: "Operational metadata only; not used as identity.",
      status: "planned",
    },
    {
      sourceField: "Last Visit",
      workbookField: "lastVisitDate",
      patientRecordTarget: "compliance.lastVisitDate",
      notes: "Drives follow-up and overdue tracking.",
      status: "planned",
    },
    {
      sourceField: "Treatment Plan",
      workbookField: "treatmentPlanDate",
      patientRecordTarget: "compliance.treatmentPlanDate",
      notes: "Used to calculate plan freshness and due dates.",
      status: "mapped",
    },
    {
      sourceField: "Reauth SAP-C",
      workbookField: "reauthSapcDate",
      patientRecordTarget: "compliance.reauthSapcDate",
      notes: "Separate from raw spreadsheet storage; governs due logic.",
      status: "manual-review",
    },
    {
      sourceField: "Notes",
      workbookField: "notes",
      patientRecordTarget: "patientBridge.noteDraft",
      notes: "Free text stays in the spreadsheet layer until promoted.",
      status: "manual-review",
    },
  ];
}

export function rosterExportColumns() {
  return [
    "patientName",
    "mrn",
    "dateOfBirth",
    "status",
    "counselor",
    "location",
    "lastVisitDate",
    "nextApptDate",
    "primaryProgram",
    "drugOfChoice",
    "medicalPhysApt",
    "medFormStatus",
    "referringAgency",
    "reauthSapcDate",
    "medicalEligibility",
    "matStatus",
    "therapyTrack",
    "notes",
  ] as const;
}
