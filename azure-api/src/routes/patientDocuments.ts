import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { auditLog, getRequestId, hipaaHash } from "../audit.js";
import { deleteBlobIfExists, downloadBlobStream, downloadBlobToBuffer, uploadPatientDocumentPdf } from "../blobStorage.js";
import { env } from "../config.js";
import { query } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";
import type { IntakeSubmissionRow, PatientDocumentRow, PatientRow } from "../types.js";
import { getVaultAbsolutePathFromBlobPath, writeVaultArtifact } from "../vaultStorage.js";

export const patientDocumentsRouter = Router();
const VAULT_TYPE_PREFIX = "vault:";
const VAULT_DOC_TYPES = new Set(["assessment", "asam_assessment", "problem_list", "problem_list_note", "treatment_plan", "medical_necessity_note", "discharge_note", "session", "intake", "snap"]);

const uploadSchema = z.object({
  // Demo/sandbox datasets use deterministic IDs that are not RFC UUIDs.
  // Accept any non-empty identifier and validate existence in DB below.
  patientId: z.string().min(1).max(128),
  documentType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255).optional(),
  pdfBase64: z.string().min(1),
});

const renameSchema = z.object({
  originalFileName: z.string().min(1).max(255),
});

const vaultUploadFileSchema = z.object({
  documentType: z.string().min(1).max(64),
  fileName: z.string().min(1).max(255).optional(),
  pdfBase64: z.string().min(1),
});

const vaultPasteTextSchema = z.object({
  documentType: z.string().min(1).max(64),
  text: z.string().min(1),
  fileName: z.string().min(1).max(255).optional(),
});

const aiGenerateSchema = z.object({
  noteType: z.enum([
    "problem_list",
    "problem_list_review",
    "problem_list_note",
    "treatment_plan",
    "medical_necessity_note",
    "discharge_summary",
    "discharge_note",
  ]),
  reviewContext: z
    .object({
      additions: z.string().optional(),
      completions: z.string().optional(),
    })
    .optional(),
});

const NOTE_TYPE_LABELS: Record<z.infer<typeof aiGenerateSchema>["noteType"], string> = {
  problem_list: "Problem List",
  problem_list_review: "Problem List Review",
  problem_list_note: "Problem List Note",
  treatment_plan: "Treatment Plan",
  medical_necessity_note: "Medical Necessity Note",
  discharge_summary: "Discharge Form",
  discharge_note: "Discharge Note",
};

const BUILT_IN_TEMPLATES: Record<z.infer<typeof aiGenerateSchema>["noteType"], string> = {
  problem_list: [
    "Return only the best-fit Z55-Z65 ICD-10 SDOH codes from the approved list.",
    "Keep code selection focused and clinically defensible, but include all clinically supported codes from the approved list when documentation supports them.",
    "For each selected code include:",
    "1) Code",
    "2) Label",
    "3) Why it fits this patient (1-2 sentences grounded in provided data).",
    "Select at least 1 code whenever any psychosocial, housing, employment, legal, education, family/social, or support barrier is documented.",
    "Prefer specific codes over unspecified codes whenever the documentation supports a specific option in the same category.",
    "Use unspecified codes (e.g., Z59.9, Z60.9, Z63.9, Z65.9) only as a last resort when category-level signal exists but specificity is truly not documented.",
    "Do not overstate certainty. If evidence is limited, say so briefly in the rationale instead of forcing an imprecise code.",
    "Only return 'No matching Z55-Z65 code identified from available documentation.' when documentation truly has no social determinant signal at all.",
  ].join("\n"),
  problem_list_note: [
    "Keep it simple and concise. Use one paragraph.",
    "Include all of the following:",
    "1) Basic demographics and precipitating event. Include sex wording (male/female) when available.",
    "2) Use this exact framing style: 'Based on patient-identified problems, review of the ASAM assessment, and engagement with patient, a Problem List was entered into the Problem List/Treatment Plan form.'",
    "If recent session content is available, incorporate it naturally but keep the same framing style.",
    "3) Substance use history: each substance, duration, frequency, and last use.",
    "For substance duration: if age at first use and current age are available in any uploaded document, calculate and state estimated duration (current age - start age).",
    "Use all uploaded documents (especially assessment + recent sessions) before deciding a duration/frequency/last-use detail is unavailable.",
    "4) Functional impairments.",
    "5) Primary treatment goal over the next 90 days.",
    "6) Initial treatment course: include program plus group/individual counseling frequency and coping-skills focus.",
    "Do not invent details. If unknown, use neutral language without saying 'Not documented'.",
    "Use MM/DD/YYYY for dates.",
    "Prefer concise phrasing similar to: 'Patient reported methamphetamine use for the last 5 years.' when supported by source data.",
  ].join("\n"),
  problem_list_review: [
    "Create a Problem List Development/Review Note.",
    "Do not output markdown.",
    "Include: basic demographics and precipitating event. Include sex wording (male/female) when available.",
    "Include statement using this logic:",
    "- If recent session content is available, use: 'Based on recent sessions, patient-identified problems, and review of ASAM...'",
    "- If recent session content is not available, use: 'Based on patient-identified problems and ASAM...'",
    "- State that the Problem List was reviewed/updated in the Problem List and Treatment Plan form.",
    "Include substance use history for each substance with duration, frequency, and last use when available.",
    "Include functional impairments and primary treatment goal.",
    "Include course of treatment quantity/frequency (groups, individual sessions) and coping-skills purpose.",
    "Use REVIEW CONTEXT to document newly added problems (how identified, action steps, direct quote if provided) and completed/removed problems (how resolved).",
    "Include paraphrased statement that other problem-list items were reviewed and no further updates were made when applicable.",
    "Include Case Conference summary (progress, barriers, and plan for next 30 days) when context supports it.",
    "After the review/update narrative, include these exact headings and content:",
    "Dimension 1:",
    "Dimension 2:",
    "Dimension 3:",
    "Dimension 4:",
    "Dimension 5:",
    "Dimension 6:",
    "Under each Dimension heading, provide concise progress + current plan content grounded in available data.",
    "Use neutral clinical phrasing for missing details; do not use the phrase 'Not documented'.",
    "Do not fabricate facts, quotes, dates, diagnoses, legal status, attendance, or medication details.",
  ].join("\n"),
  treatment_plan: [
    "Use this exact output format and headings (all caps + colon) based on clinic template:",
    "SNAP:",
    "Strengths:",
    "Needs:",
    "Abilities:",
    "Preferences:",
    "Diagnosis determined by the ASAM and the LPHA:",
    "Short-Term Goal #1:",
    "Short-Term Goal Added by:",
    "Short-Term Goal Start Date:",
    "Short-Term Goal Target Date:",
    "ACTION STEPS:",
    "Short-Term Goal #2:",
    "Short-Term Goal Added by:",
    "Short-Term Goal Start Date:",
    "Short-Term Goal Target Date:",
    "ACTION STEPS:",
    "Short-Term Goal #3:",
    "Short-Term Goal Added by:",
    "Short-Term Goal Start Date:",
    "Short-Term Goal Target Date:",
    "ACTION STEPS:",
    "Short-Term Goal #4:",
    "Short-Term Goal Added by:",
    "Short-Term Goal Start Date:",
    "Short-Term Goal Target Date:",
    "ACTION STEPS:",
    "Generate 5 short-term goals by default when documentation supports them; include a 6th goal when clearly supported.",
    "If documentation supports fewer goals, stop numbering at the last supported goal (do not emit 'Not documented' goal shells).",
    "Each Short-Term Goal should follow SMART style wording and include a brief patient quote when documented and clinically appropriate.",
    "Under each ACTION STEPS heading, output numbered steps using plain text numbering format '1. ...', '2. ...', etc.",
    "Each ACTION STEPS block should include 4-6 concrete, measurable steps.",
    "Keep goal wording in the same style as provided SMART goal samples.",
    "For each goal, fill Added by / Start Date / Target Date whenever possible using NOTE AUTHOR METADATA and available timeline context.",
    "If Start Date is not explicitly documented, use NOTE AUTHOR METADATA.noteDate as Start Date.",
    "If Target Date is not explicitly documented, set Target Date to 90 days after Start Date.",
    "Maximum timeline for any goal or action step is 90 days from the goal Start Date.",
    "Do not use 180-day, 6-month, or longer timelines in treatment-plan goals/action steps.",
    "Avoid 'Not documented' for goal metadata unless NOTE AUTHOR METADATA is missing or invalid.",
    "Do not invent diagnosis or credentials.",
    "Do not add extra headings outside this template.",
  ].join("\n"),
  medical_necessity_note: [
    "Create a Medical Necessity Note for ongoing outpatient services.",
    "Include program as either 1.0 or 2.1 based on available program data; if unclear write 'Not documented'.",
    "Use exact section headings:",
    "Dimension 1",
    "Dimension 2",
    "Dimension 3",
    "Dimension 4",
    "Dimension 5",
    "Dimension 6",
    "Dimension 1 must include: demographics (age, sex, marital status, sexual orientation, ethnicity), time in outpatient treatment, sobriety duration with toxicology evidence, relapse/continued use details, diagnosis.",
    "Dimension 2 must include: biomedical conditions/complications (diagnosed or symptoms), concurrent treatment or referral details (who/where/when), medications and compliance, physical exam completed/scheduled date.",
    "Dimension 3 must include: mental health conditions/complications (diagnosed or symptoms), concurrent treatment or referral details (where/who/when), MH medications and compliance, statement about SI/HI denial or documentation status.",
    "Dimension 4 must include: motivation/readiness and willingness to comply vs resistance/mandate factors, acknowledgement of SUD, and functional impairment domains affected.",
    "Dimension 5 must include: stage of change, interventions worked on, barriers, progress, and next focus plan.",
    "Dimension 6 must include: housing status/details and housing support plan, employment status/details and employment support plan, education/training needs and plan, legal history/mandate status, social/sober support participation, sponsor status/12-step stance.",
    "Use concise clinical prose. If data is missing, write 'Not documented'.",
  ].join("\n"),
  discharge_summary: [
    "Create a Discharge and Transfer Form using these exact headings:",
    "1) Description of Each Relapse Trigger, and a Relapse Prevention Plan for Each Trigger",
    "2) Justification for Transfer or Discharge",
    "3) Narrative Summary of the Treatment Episode Including Prognosis",
    "4) Summary of Dimensions 1 through 6 and Progress Made in Each Dimension",
    "5) Referrals/Resources",
    "6) Recommendations for Follow Up",
    "7) Patient Comments",
    "Required details:",
    "- Use every available uploaded document, including assessment, SNAP/treatment plan, problem list, discharge note, sessions, and other vault/patient documents.",
    "- Do not rely only on the newest document. Consider the full treatment trajectory from first document through most recent document.",
    "- Section 1 must list each relapse trigger separately with a specific relapse prevention plan for that trigger. Use triggers from assessment, SNAP, problem list, treatment plan, session notes, and discharge documents.",
    "- Include admission date, discharge date, admitted program, and total calendar days completed.",
    "- Include whether discharge/transfer was voluntary or involuntary and whether completion was successful for this program.",
    "- Section 3 must include SNAP in this exact structure when source data supports it: Strengths: ... Needs: ... Abilities: ... Preferences: ...",
    "- Use SNAP from uploaded SNAP/treatment plan/intake/assessment content when present; do not omit SNAP if it appears anywhere in the documents.",
    "- Include prognosis, progress/gains, and functional recovery details.",
    "- Section 4 must include Dimension 1, Dimension 2, Dimension 3, Dimension 4, Dimension 5, and Dimension 6 with progress made in each dimension.",
    "- Always include vocational and educational achievements/next steps.",
    "- Include social support/sponsor/recovery meeting plan.",
    "- Include referrals/resources when available, including outpatient/RBH/sober living/recovery supports, community resources, employment resources, medical/MH follow-up, and recovery meeting resources.",
    "- Do not invent facts, but do not write 'Not documented'. Work around missing details with neutral clinical phrasing.",
    "Patient Comments section must always appear; if unavailable state: 'Patient was not available for comment.'",
  ].join("\n"),
  discharge_note: [
    "Create a Discharge and Transfer Note using concise narrative clinical language.",
    "Required sections (with headings):",
    "1) Presenting Condition and Functional Impairments",
    "2) Justification for Transfer or Discharge",
    "3) Course of Treatment",
    "4) Goals and Objectives Achieved",
    "5) Progress and Dimension 1-6 Summary",
    "6) Recommendations for Services and Support",
    "7) Medications and Prescriber Information",
    "Requirements:",
    "- Presenting condition must include the core SUD problem(s) and resulting functional impairments.",
    "- Justification must align with discharge/transfer form facts: admission/discharge dates, program, duration, completion/transfer status when available.",
    "- Course of treatment should summarize groups, individual counseling, care coordination, and recovery supports.",
    "- Progress section must include Dimension 1 through Dimension 6 narrative updates.",
    "- Recommendations section should include follow-up services and recovery-support plan.",
    "- Medications section must list prescriber name(s), medication(s), and dose(s) if documented.",
    "- If data is missing, write 'Not documented'.",
  ].join("\n"),
};

const APPROVED_SDOH_Z_CODES = [
  "Z55.0 Illiteracy and low-level literacy",
  "Z55.1 Schooling unavailable and unattainable",
  "Z55.2 Failed school examinations",
  "Z55.3 Underachievement in school",
  "Z55.4 Educational maladjustment and discord with teachers and classmates",
  "Z55.8 Other problems related to education and literacy",
  "Z55.9 Problems related to education and literacy, unspecified",
  "Z56.0 Unemployment, unspecified",
  "Z56.1 Change of job",
  "Z56.2 Threat of job loss",
  "Z56.3 Stressful work schedule",
  "Z56.4 Discord with boss and workmates",
  "Z56.5 Uncongenial work environment",
  "Z56.6 Other physical and mental strain related to work",
  "Z56.8 Other problems related to employment",
  "Z56.81 Sexual harassment on the job",
  "Z56.82 Military deployment status",
  "Z56.89 Other problems related to employment",
  "Z56.9 Unspecified problems related to employment",
  "Z57.0 Occupational exposure to noise",
  "Z57.1 Occupational exposure to radiation",
  "Z57.2 Occupational exposure to dust",
  "Z57.3 Occupational exposure to other air contaminants",
  "Z57.31 Occupational exposure to environmental tobacco smoke",
  "Z57.39 Occupational exposure to other air contaminants",
  "Z57.4 Occupational exposure to toxic agents in agriculture",
  "Z57.5 Occupational exposure to toxic agents in other industries",
  "Z57.6 Occupational exposure to extreme temperatures",
  "Z57.7 Occupational exposure to vibration",
  "Z57.8 Occupational exposure to other risk factors",
  "Z57.9 Occupational exposure to unspecified risk factors",
  "Z58.6 Inadequate drinking water supply",
  "Z59.0 Homelessness",
  "Z59.00 Homelessness unspecified",
  "Z59.01 Sheltered homelessness",
  "Z59.02 Unsheltered homelessness",
  "Z59.1 Inadequate housing (lack of heating/space, unsatisfactory surroundings)",
  "Z59.2 Discord with neighbors, lodgers, and landlord",
  "Z59.3 Problems related to the living in residential institution",
  "Z59.4 Lack of adequate food",
  "Z59.41 Food insecurity",
  "Z59.48 Other specified lack of adequate food",
  "Z59.5 Extreme poverty",
  "Z59.6 Low income",
  "Z59.7 Insufficient social insurance and welfare support",
  "Z59.8 Other problems related to housing and economic circumstances",
  "Z59.81 Housing instability, housed",
  "Z59.811 Housing instability, housed, with risk of homelessness",
  "Z59.812 Housing instability, housed, homelessness in past 12 months",
  "Z59.819 Housing instability, housed unspecified",
  "Z59.89 Other problems related to housing and economic circumstances",
  "Z59.9 Problem related to housing and economic circumstances, unspecified",
  "Z60.0 Problems of adjustment to life-cycle transitions",
  "Z60.2 Problems related to living alone",
  "Z60.3 Acculturation difficulty",
  "Z60.4 Social exclusion and rejection (physical appearance, illness or behavior)",
  "Z60.5 Target of (perceived) adverse discrimination and persecution",
  "Z60.8 Other problems related to social environment",
  "Z60.9 Problem related to social environment, unspecified",
  "Z62.0 Inadequate parental supervision and control",
  "Z62.1 Parental overprotection",
  "Z62.2 Upbringing away from parents",
  "Z62.21 Child in welfare custody",
  "Z62.22 Institutional upbringing",
  "Z62.29 Other upbringing away from parents",
  "Z62.3 Hostility towards and scapegoating of child",
  "Z62.6 Inappropriate (excessive) parental pressure",
  "Z62.8 Other specified problems related to upbringing",
  "Z62.81 Personal history of abuse in childhood",
  "Z62.810 Personal history of physical and sexual abuse in childhood",
  "Z62.811 Personal history of psychological abuse in childhood",
  "Z62.812 Personal history of neglect in childhood",
  "Z62.813 Personal history of forced labor or sexual exploitation in childhood",
  "Z62.819 Personal history of unspecified abuse in childhood",
  "Z62.82 Parent-child conflict",
  "Z62.820 Parent-biological child conflict",
  "Z62.821 Parent-adopted child conflict",
  "Z62.822 Parent-foster child conflict",
  "Z62.89 Other specified problems related to upbringing",
  "Z62.890 Parent-child estrangement NEC",
  "Z62.891 Sibling rivalry",
  "Z62.898 Other specified problems related to upbringing",
  "Z62.9 Problems related to upbringing, unspecified",
  "Z63.0 Problems in relationship with spouse or partner",
  "Z63.1 Problems in relationship with in-laws",
  "Z63.3 Absence of family member",
  "Z63.31 Absence of family member due to military deployment",
  "Z63.32 Other absence of family member",
  "Z63.4 Disappearance and death of family member (assumed death, bereavement)",
  "Z63.5 Disruption of family by separation and divorce (marital estrangement)",
  "Z63.6 Dependent relative needing care at home",
  "Z63.7 Other stressful life events affecting family and household",
  "Z63.71 Stress on family due to return of family member from military deployment",
  "Z63.72 Alcoholism and drug addiction in family",
  "Z63.79 Other stressful life events affecting family and household",
  "Z63.8 Other specified problems related to primary support group",
  "Z63.9 Problem related to primary support group, unspecified",
  "Z64.0 Problems related to unwanted pregnancy",
  "Z64.1 Problems related to multiparity",
  "Z64.4 Discord with counselors",
  "Z65.0 Conviction in civil and criminal proceedings without imprisonment",
  "Z65.1 Imprisonment and other incarceration",
  "Z65.2 Problems related to release from prison",
  "Z65.3 Problems related to other legal circumstances",
  "Z65.4 Victim of crime and terrorism",
  "Z65.5 Exposure to disaster, war, and other hostilities",
  "Z65.8 Other specified problems related to psychosocial circumstances (religious or spiritual problem)",
  "Z65.9 Problem related to unspecified psychosocial circumstances",
];

const APPROVED_Z_CODE_LABEL_BY_CODE = new Map(
  APPROVED_SDOH_Z_CODES.map((entry) => {
    const match = entry.match(/^([A-Z]\d{2}(?:\.\d{1,3})?)\s+(.+)$/);
    return [match?.[1] ?? entry, match?.[2] ?? entry] as const;
  })
);

function buildHeuristicProblemListCodes(input: {
  intakeRawJson: unknown | null;
  vaultTextBlocks: string[];
  pdfTextBlocks: string[];
  factSheet?: string;
}) {
  const corpus = [
    JSON.stringify(input.intakeRawJson ?? {}),
    ...(input.vaultTextBlocks ?? []),
    ...(input.pdfTextBlocks ?? []),
    input.factSheet ?? "",
  ]
    .join("\n")
    .toLowerCase();

  type Rule = {
    code: string;
    patterns: RegExp[];
    rationale: string;
  };
  const rules: Rule[] = [
    {
      code: "Z59.0",
      patterns: [/\bhomeless\b/, /\bunsheltered\b/, /\bshelter(ed)?\b/, /\bcouch[- ]surf/],
      rationale: "Documentation indicates homelessness or unstable shelter status.",
    },
    {
      code: "Z59.41",
      patterns: [/\bfood insecurity\b/, /\bhungry\b/, /\bskipping meals\b/, /\bno food\b/],
      rationale: "Documentation indicates inadequate or unreliable access to food.",
    },
    {
      code: "Z56.0",
      patterns: [/\bunemploy(ed|ment)\b/, /\bjobless\b/, /\bno job\b/],
      rationale: "Documentation indicates unemployment.",
    },
    {
      code: "Z59.6",
      patterns: [/\blow income\b/, /\bfinancial (hardship|stress|strain)\b/, /\bcan'?t afford\b/, /\bbills?\b/],
      rationale: "Documentation indicates financial strain / low-income circumstances.",
    },
    {
      code: "Z65.3",
      patterns: [/\bprobation\b/, /\bparole\b/, /\bcourt\b/, /\blegal\b/, /\bincarcerat/],
      rationale: "Documentation indicates legal-system involvement affecting care.",
    },
    {
      code: "Z63.9",
      patterns: [/\bfamily conflict\b/, /\brelationship conflict\b/, /\bdomestic conflict\b/, /\bno family support\b/],
      rationale: "Documentation indicates family / primary-support-group stressors.",
    },
    {
      code: "Z60.9",
      patterns: [/\bsocial isolation\b/, /\bisolated\b/, /\blimited support\b/, /\blonely\b/],
      rationale: "Documentation indicates social-environment/support limitations.",
    },
  ];

  const matches = rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(corpus)))
    .slice(0, 3);

  if (!matches.length) return null;

  return matches
    .map((rule, idx) => {
      const label = APPROVED_Z_CODE_LABEL_BY_CODE.get(rule.code) ?? rule.code;
      return [
        `${idx + 1}) Code: ${rule.code}`,
        `Label: ${label}`,
        `Why it fits: ${rule.rationale}`,
      ].join("\n");
    })
    .join("\n\n");
}

const SMART_GOAL_STYLE_SAMPLES = [
  "Client will maintain abstinence, 7 days a week, from all non-prescribed substances for 90 days as evidenced by self-report, collateral reports, and random UAs.",
  "Client will decrease substance use from 5 days a week to 0 days a week over 90 days as evidenced by self-report and toxicology screens.",
  "Client will increase attendance from 50% to 90% of scheduled OP sessions over 90 days as evidenced by attendance logs.",
  "Client will maintain 100% compliance with all probation, court, and legal requirements throughout the 90-day treatment episode.",
  "Client will increase sober support engagement from 0 meetings a week to 4-5 meetings per week sustained over 90 days.",
  "Client will maintain medication adherence at 100% throughout 90-day treatment episode.",
];

const PATIENTFINDER_CLINICAL_STYLE_RULES = [
  "Write all clinical documentation in Steven NCADD/PatientFinder style.",
  "Use the terms 'patient' and 'counselor'. Avoid pronouns when possible.",
  "Never use patient names in generated notes.",
  "Always refer to the client as exactly 'patient' (lowercase), not 'the patient'.",
  "Do not use lead-in labels like 'Adult male patient', 'Adult female patient', or similar demographic noun phrases.",
  "When demographics are needed, write them in sentence form while still using 'patient' (for example: 'patient is a 57-year-old...').",
  "When sex is available in source data, include sex wording (male/female) in demographics statements when clinically relevant.",
  "Format all dates in generated notes as MM/DD/YYYY.",
  "Write in a clear, concise, professional clinical tone with practical detail.",
  "Always add clinical substance: include what was addressed, why it matters clinically, what intervention was used, how intervention links to treatment goals, how patient responded, observed progress/barriers, and next steps.",
  "Never fabricate diagnoses, quotes, toxicology results, attendance, medications, SI/HI status, legal details, dates, program, or completion status.",
  "If information is missing, use neutral clinical language and work around the gap without fabrication. Do not use the phrase 'Not documented'.",
  "Use active clinical phrasing: Patient reported/identified/processed/explored; Counselor provided psychoeducation; Counselor used Motivational Interviewing; Counselor used CBT-based interventions.",
  "Use evidence-based practices when clinically appropriate: Motivational Interviewing, CBT, Relapse Prevention Therapy, Psychoeducation, Harm Reduction, Trauma-informed care, Solution-Focused Brief Therapy.",
  "Use ASAM Dimensions 1 through 6 framing whenever relevant.",
  "For GIRP: output Goal, Intervention, Response, Plan, and begin Plan with 'Patient to...'.",
  "For Treatment Plan: include SNAP, diagnosis determined by ASAM and LPHA when provided, SMART measurable short-term goals, added-by, start date, target date, and 3-5 action steps beginning with 'Patient to...'.",
  "For Problem List documentation: follow NCADD-style development/review framing using patient-identified problems, ASAM review, recent sessions when available, substance history, functional impairments, primary treatment goal, course of treatment, and ASAM progress updates.",
  "Return only the drafted note body with no markdown and no preface.",
].join("\n");

const TREATMENT_PLAN_REQUIRED_HEADINGS = [
  "SNAP:",
  "STRENGTHS:",
  "NEEDS:",
  "ABILITIES:",
  "PREFERENCES:",
  "DIAGNOSIS DETERMINED BY THE ASAM AND THE LPHA:",
  "SHORT-TERM GOAL #1:",
  "SHORT-TERM GOAL ADDED BY:",
  "SHORT-TERM GOAL START DATE:",
  "SHORT-TERM GOAL TARGET DATE:",
  "ACTION STEPS:",
];

function looksLikeStrictTreatmentPlan(note: string) {
  const upper = note.toUpperCase();
  return TREATMENT_PLAN_REQUIRED_HEADINGS.every((heading) => upper.includes(heading));
}

function looksLikeDischargeForm(note: string) {
  const upper = note.toUpperCase();
  return [
    "DESCRIPTION OF EACH RELAPSE TRIGGER",
    "JUSTIFICATION FOR TRANSFER OR DISCHARGE",
    "NARRATIVE SUMMARY",
    "DIMENSION 1",
    "DIMENSION 2",
    "DIMENSION 3",
    "DIMENSION 4",
    "DIMENSION 5",
    "DIMENSION 6",
    "STRENGTHS:",
    "NEEDS:",
    "ABILITIES:",
    "PREFERENCES:",
    "RECOMMENDATIONS FOR FOLLOW UP",
    "PATIENT COMMENTS",
  ].every((piece) => upper.includes(piece));
}

function normalizePdfFileName(fileName?: string) {
  const fallback = `scan_${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
  if (!fileName) return fallback;
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function normalizePathFileName(fileName: string) {
  const withForwardSlashes = fileName.replace(/\\/g, "/");
  const rawSegments = withForwardSlashes
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!rawSegments.length) {
    return normalizePdfFileName(fileName);
  }
  const sanitized = rawSegments.map((segment) =>
    segment
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/^\.+/, "")
      .trim()
  );
  const finalName = sanitized[sanitized.length - 1] || "document.pdf";
  sanitized[sanitized.length - 1] = normalizePdfFileName(finalName);
  return sanitized.join("/");
}

function getDownloadSafeFileName(fileName: string) {
  const basename = fileName
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.trim();
  const fallback = normalizePdfFileName("document.pdf");
  return normalizePdfFileName(basename || fallback);
}

function normalizeVaultDocumentType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return VAULT_DOC_TYPES.has(normalized) ? normalized : "assessment";
}

function normalizeTextFileName(fileName?: string) {
  const fallback = `note_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  if (!fileName) return fallback;
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith(".txt") ? cleaned : `${cleaned}.txt`;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function toSortableEpoch(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  const epoch = date.getTime();
  return Number.isFinite(epoch) ? epoch : 0;
}

function documentPriority(row: PatientDocumentRow) {
  const docType = row.document_type.replace(/^vault:/, "");
  if (docType === "assessment" || docType === "asam_assessment") return 0;
  if (docType === "problem_list") return 1;
  if (docType === "session") return 2;
  return 3;
}

function prioritizeRows(rows: PatientDocumentRow[]) {
  return [...rows].sort((a, b) => {
    const aPriority = documentPriority(a);
    const bPriority = documentPriority(b);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return toSortableEpoch(b.created_at) - toSortableEpoch(a.created_at);
  });
}

async function readVaultTextDocuments(rows: PatientDocumentRow[]) {
  const textDocs = prioritizeRows(rows.filter((row) => row.content_type.toLowerCase().includes("text/plain")));
  const blocks: string[] = [];
  for (const row of textDocs) {
    try {
      const absolutePath = getVaultAbsolutePathFromBlobPath(row.storage_blob_path);
      const text = await fs.readFile(absolutePath, "utf8");
      const normalized = text.replace(/\r\n/g, "\n").trim().slice(0, 10_000);
      if (!normalized) continue;
      blocks.push(`FILE: ${row.original_filename}\n${normalized}`);
    } catch {
      continue;
    }
  }
  return blocks;
}

async function readPdfDocuments(rows: PatientDocumentRow[], label: "vault" | "patient") {
  let PDFParse: typeof import("pdf-parse").PDFParse;
  try {
    ({ PDFParse } = await import("pdf-parse"));
  } catch {
    return [];
  }

  const pdfRows = prioritizeRows(
    rows.filter(
      (row) =>
        row.content_type.toLowerCase().includes("pdf") ||
        row.original_filename.toLowerCase().endsWith(".pdf")
    )
  );
  const blocks: string[] = [];
  for (const row of pdfRows) {
    try {
      let buffer: Buffer;
      if (row.storage_provider === "local_fs" && row.storage_container === "vault") {
        const absolutePath = getVaultAbsolutePathFromBlobPath(row.storage_blob_path);
        buffer = await fs.readFile(absolutePath);
      } else {
        buffer = await downloadBlobToBuffer({
          containerName: row.storage_container,
          blobName: row.storage_blob_path,
        });
      }
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      const normalized = String(parsed.text ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
      if (!normalized) continue;
      blocks.push(`${label.toUpperCase()} PDF: ${row.original_filename}\n${normalized}`);
    } catch {
      continue;
    }
  }
  return blocks;
}

function getVaultFileSummary(rows: PatientDocumentRow[]) {
  return rows.slice(0, 20).map((row) => ({
    type: row.document_type.replace(/^vault:/, ""),
    fileName: row.original_filename,
    contentType: row.content_type,
    createdAt: row.created_at,
  }));
}

async function generateClinicalNote(input: {
  noteType: z.infer<typeof aiGenerateSchema>["noteType"];
  patient: PatientRow | null;
  intakeRawJson: unknown | null;
  vaultTextBlocks: string[];
  pdfTextBlocks: string[];
  vaultFileSummary: unknown[];
  patientDocumentSummary: unknown[];
  reviewContext?: { additions?: string; completions?: string };
  noteAuthor: {
    name: string;
    noteDate: string;
  };
}) {
  const template = BUILT_IN_TEMPLATES[input.noteType];
  const systemPrompt = [
    "You are a clinical documentation assistant for SUD counseling workflows.",
    PATIENTFINDER_CLINICAL_STYLE_RULES,
  ].join("\n");
  const buildUserPrompt = (forceBestFit: boolean, forceStrictTemplate: boolean) => [
    `Generate a ${NOTE_TYPE_LABELS[input.noteType]} note using the built-in template below.`,
    "",
    "TEMPLATE:",
    template,
    "",
    "APPROVED Z55-Z65 CODES (ONLY use from this list if note type is problem_list):",
    input.noteType === "problem_list" ? APPROVED_SDOH_Z_CODES.join("\n") : "N/A",
    "",
    "SMART GOAL STYLE EXAMPLES (for treatment_plan tone/wording):",
    input.noteType === "treatment_plan" ? SMART_GOAL_STYLE_SAMPLES.join("\n") : "N/A",
    "",
    "PATIENT CONTEXT JSON:",
    JSON.stringify(
      {
        patient: input.patient,
        intakeRawJson: input.intakeRawJson,
        vaultFiles: input.vaultFileSummary,
        patientFiles: input.patientDocumentSummary,
      },
      null,
      2
    ),
    "",
    "VAULT TEXT CONTENT:",
    input.vaultTextBlocks.length ? input.vaultTextBlocks.join("\n\n---\n\n") : "No text vault documents available.",
    "",
    "PDF EXTRACTED CONTENT:",
    input.pdfTextBlocks.length ? input.pdfTextBlocks.join("\n\n---\n\n") : "No readable PDF text extracted.",
    "",
    "NOTE AUTHOR METADATA:",
    JSON.stringify(input.noteAuthor, null, 2),
    "",
    "REVIEW CONTEXT (for problem_list_review):",
    input.reviewContext ? JSON.stringify(input.reviewContext, null, 2) : "None provided.",
    "",
    "OUTPUT POLICY:",
    forceBestFit && input.noteType === "problem_list"
      ? "For this run, do not return 'no matching code'. Pick the closest 1-3 codes from the approved list using best clinical fit and note any uncertainty."
      : forceStrictTemplate && input.noteType === "treatment_plan"
        ? "For this run, strictly follow the exact treatment-plan heading order from TEMPLATE with no extra headings. If data is missing, write 'Not documented' under the relevant heading."
        : "Follow template rules above.",
  ].join("\n");

  const requestCompletion = async (userPrompt: string, temperature: number) => {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_DEPLOYMENT) {
      const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
      const url = `${endpoint}/openai/deployments/${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions?api-version=${encodeURIComponent(env.AZURE_OPENAI_API_VERSION)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": env.AZURE_OPENAI_API_KEY,
        },
        body: JSON.stringify({
          messages,
          temperature,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Azure OpenAI request failed: ${response.status} ${detail}`);
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Azure OpenAI returned empty content.");
      return content;
    }

    if (env.OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          messages,
          temperature,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("OpenAI returned empty content.");
      return content;
    }

    throw new Error("AI provider is not configured. Set Azure OpenAI or OPENAI_API_KEY variables.");
  };

  const hasMissingDataLanguage = (text: string) =>
    /\bnot documented\b|\bnot specified\b|\bnot available\b|\bunknown\b/i.test(text);

  const shouldUseTwoPass =
    input.noteType === "treatment_plan" ||
    input.noteType === "medical_necessity_note" ||
    input.noteType === "discharge_summary" ||
    input.noteType === "discharge_note";

  if (!shouldUseTwoPass) {
    const singlePassPrompt = [
      buildUserPrompt(false, false),
      "",
      "Prioritize concrete facts from assessment + recent session content before using generic phrasing.",
    ].join("\n");
    const singlePass = await requestCompletion(singlePassPrompt, 0.2);
    if (
      (input.noteType === "problem_list_note" || input.noteType === "problem_list_review") &&
      hasMissingDataLanguage(singlePass)
    ) {
      return requestCompletion(
        [
          buildUserPrompt(false, false),
          "",
          "CRITICAL CORRECTION:",
          "- Do not use any missing-data language such as 'not documented', 'not specified', or 'unknown'.",
          "- Re-read all provided documents and extract substance duration/frequency/last use from available records.",
          "- If age at first use and current age are present in records, calculate duration from those values and state it directly.",
          "- Keep phrasing concise and definitive, grounded in available records.",
        ].join("\n"),
        0.15
      );
    }
    if (input.noteType === "problem_list" && /^No matching Z55-Z65 code identified/i.test(singlePass.trim())) {
      const forced = await requestCompletion(
        [
          buildUserPrompt(true, false),
          "",
          "Prioritize concrete facts from assessment + recent session content before using generic phrasing.",
        ].join("\n"),
        0.2
      );
      if (!/^No matching Z55-Z65 code identified/i.test(forced.trim())) return forced;
      const heuristic = buildHeuristicProblemListCodes({
        intakeRawJson: input.intakeRawJson,
        vaultTextBlocks: input.vaultTextBlocks,
        pdfTextBlocks: input.pdfTextBlocks,
      });
      if (heuristic) return heuristic;
    }
    return singlePass;
  }

  const synthesisPrompt = [
    "Extract only clinically relevant facts from the provided patient context for documentation.",
    "Output plain text with these headings only:",
    "DEMOGRAPHICS",
    ...(input.noteType === "discharge_summary"
      ? [
          "ADMISSION / DISCHARGE / TRANSFER FACTS",
          "RELAPSE TRIGGERS AND PREVENTION PLANS",
          "SNAP",
        ]
      : []),
    "SUBSTANCE USE HISTORY",
    "FUNCTIONAL IMPAIRMENTS",
    "MENTAL HEALTH / BIOMEDICAL",
    "LEGAL / SOCIAL DETERMINANTS",
    "TREATMENT PARTICIPATION",
    ...(input.noteType === "discharge_summary"
      ? [
          "TREATMENT PROGRESS AND GAINS",
          "VOCATIONAL / EDUCATIONAL ACHIEVEMENTS AND NEXT STEPS",
          "REFERRALS / RESOURCES / FOLLOW UP",
          "PATIENT COMMENTS",
        ]
      : []),
    "DIAGNOSIS",
    "MISSING DATA",
    "Use concise bullet points. No narrative paragraph.",
    input.noteType === "discharge_summary"
      ? "For discharge form extraction, search every source document for SNAP, relapse triggers, coping plans, recovery supports, discharge/transfer facts, prognosis, Dimension 1-6 progress, referrals, vocational/educational items, and patient comments."
      : "",
    "",
    "PATIENT CONTEXT JSON:",
    JSON.stringify(
      {
        patient: input.patient,
        intakeRawJson: input.intakeRawJson,
        vaultFiles: input.vaultFileSummary,
        patientFiles: input.patientDocumentSummary,
      },
      null,
      2
    ),
    "",
    "VAULT TEXT CONTENT:",
    input.vaultTextBlocks.length ? input.vaultTextBlocks.join("\n\n---\n\n") : "No text vault documents available.",
    "",
    "PDF EXTRACTED CONTENT:",
    input.pdfTextBlocks.length ? input.pdfTextBlocks.join("\n\n---\n\n") : "No readable PDF text extracted.",
  ].join("\n");

  const factSheet = await requestCompletion(synthesisPrompt, 0.1);

  const noteDraftPrompt = [
    buildUserPrompt(false, false),
    "",
    "USE THIS EXTRACTED FACT SHEET AS PRIMARY SOURCE OF TRUTH:",
    factSheet,
  ].join("\n");
  const firstPass = await requestCompletion(noteDraftPrompt, 0.25);
  if (
    input.noteType === "problem_list" &&
    /^No matching Z55-Z65 code identified/i.test(firstPass.trim())
  ) {
    const forced = await requestCompletion(
      [
        buildUserPrompt(true, false),
        "",
        "USE THIS EXTRACTED FACT SHEET AS PRIMARY SOURCE OF TRUTH:",
        factSheet,
      ].join("\n"),
      0.25
    );
    if (!/^No matching Z55-Z65 code identified/i.test(forced.trim())) return forced;
    const heuristic = buildHeuristicProblemListCodes({
      intakeRawJson: input.intakeRawJson,
      vaultTextBlocks: input.vaultTextBlocks,
      pdfTextBlocks: input.pdfTextBlocks,
      factSheet,
    });
    if (heuristic) return heuristic;
    return forced;
  }
  if (input.noteType === "treatment_plan" && !looksLikeStrictTreatmentPlan(firstPass)) {
    return requestCompletion(
      [
        buildUserPrompt(false, true),
        "",
        "USE THIS EXTRACTED FACT SHEET AS PRIMARY SOURCE OF TRUTH:",
        factSheet,
      ].join("\n"),
      0.2
    );
  }
  if (input.noteType === "discharge_summary" && !looksLikeDischargeForm(firstPass)) {
    return requestCompletion(
      [
        buildUserPrompt(false, false),
        "",
        "CRITICAL DISCHARGE FORM CORRECTION:",
        "- Follow all seven discharge form headings from the template.",
        "- Include SNAP with Strengths, Needs, Abilities, and Preferences when source documents contain SNAP information.",
        "- Include each relapse trigger with a matching prevention plan.",
        "- Include Dimension 1 through Dimension 6 progress.",
        "- Use every provided document and the extracted fact sheet. Do not rely only on the newest document.",
        "",
        "USE THIS EXTRACTED FACT SHEET AS PRIMARY SOURCE OF TRUTH:",
        factSheet,
      ].join("\n"),
      0.18
    );
  }
  return firstPass;
}

patientDocumentsRouter.post(
  "/api/patients/:id/ai/generate-note",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const parsed = aiGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid AI note payload." });
      return;
    }
    try {
      const patientId = String(req.params.id);
      const [patient] = await query<PatientRow>(
        `select id, full_name, mrn, external_id, date_of_birth, status, location, intake_date, last_visit_date, next_appt_date,
                primary_program, counselor_name, flags, created_at, updated_at
           from public.patients
          where id = $1
          limit 1`,
        [patientId]
      );
      if (!patient) {
        res.status(404).json({ ok: false, error: "Patient not found." });
        return;
      }
      const [intake] = await query<Pick<IntakeSubmissionRow, "raw_json">>(
        `select raw_json
           from public.intake_submissions
          where patient_id = $1
          order by created_at desc
          limit 1`,
        [patientId]
      );
      const vaultRows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
            and document_type like 'vault:%'
          order by created_at desc`,
        [patientId]
      );
      const patientRows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
            and document_type not like 'vault:%'
          order by created_at desc`,
        [patientId]
      );
      if (parsed.data.noteType === "problem_list") {
        const hasAssessment = vaultRows.some((row) => row.document_type === "vault:assessment" || row.document_type === "vault:asam_assessment");
        if (!hasAssessment) {
          res.status(400).json({
            ok: false,
            error: "Problem List generation requires an Assessment upload in the AI Vault first.",
          });
          return;
        }
      }
      if (parsed.data.noteType === "problem_list_note") {
        const hasAssessment = vaultRows.some((row) => row.document_type === "vault:assessment" || row.document_type === "vault:asam_assessment");
        const hasProblemList = vaultRows.some((row) => row.document_type === "vault:problem_list");
        if (!hasAssessment || !hasProblemList) {
          res.status(400).json({
            ok: false,
            error: "Problem List Note generation requires both Assessment and Problem List uploads in the AI Vault first.",
          });
          return;
        }
      }
      if (parsed.data.noteType === "problem_list_review") {
        const hasAssessment = vaultRows.some((row) => row.document_type === "vault:assessment" || row.document_type === "vault:asam_assessment");
        const hasProblemList = vaultRows.some((row) => row.document_type === "vault:problem_list");
        if (!hasAssessment || !hasProblemList) {
          res.status(400).json({
            ok: false,
            error: "Problem List Review generation requires both Assessment and Problem List uploads in the AI Vault first.",
          });
          return;
        }
      }
      if (parsed.data.noteType === "treatment_plan") {
        const hasAssessment = vaultRows.some((row) => row.document_type === "vault:assessment" || row.document_type === "vault:asam_assessment");
        const hasProblemList = vaultRows.some((row) => row.document_type === "vault:problem_list");
        if (!hasAssessment || !hasProblemList) {
          res.status(400).json({
            ok: false,
            error: "Treatment Plan generation requires both Assessment and Problem List uploads in the AI Vault first.",
          });
          return;
        }
      }
      const note = await generateClinicalNote({
        noteType: parsed.data.noteType,
        patient,
        intakeRawJson: intake?.raw_json ?? null,
        vaultTextBlocks: await readVaultTextDocuments(vaultRows),
        pdfTextBlocks: [
          ...(await readPdfDocuments(vaultRows, "vault")),
          ...(await readPdfDocuments(patientRows, "patient")),
        ],
        vaultFileSummary: getVaultFileSummary(vaultRows),
        patientDocumentSummary: getVaultFileSummary(patientRows),
        reviewContext: parsed.data.reviewContext,
        noteAuthor: {
          name:
            patient.counselor_name?.trim() ||
            getRequestUser(req)?.name?.trim() ||
            getRequestUser(req)?.email ||
            "Counselor",
          noteDate: new Date().toISOString().slice(0, 10),
        },
      });
      res.json({ ok: true, noteType: parsed.data.noteType, note, templateName: NOTE_TYPE_LABELS[parsed.data.noteType] });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.post(
  "/api/patient-documents/upload",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      auditLog("patient_document_upload_rejected", {
        requestId,
        route: "/api/patient-documents/upload",
        reason: "invalid_payload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
      });
      res.status(400).json({ ok: false, error: "Invalid upload payload." });
      return;
    }

    try {
      const { patientId, documentType, fileName, pdfBase64 } = parsed.data;
      const originalFileName = normalizePdfFileName(fileName);
      const fileBuffer = Buffer.from(pdfBase64, "base64");

      if (!fileBuffer.length) {
        res.status(400).json({ ok: false, error: "PDF data is empty." });
        return;
      }

      const patientCheckStartedAt = Date.now();
      const patientExists = await query<{ id: string }>(
        `select id from public.patients where id = $1 limit 1`,
        [patientId]
      );
      const patientCheckMs = Date.now() - patientCheckStartedAt;
      if (!patientExists[0]) {
        auditLog("patient_document_upload_patient_not_found", {
          requestId,
          route: "/api/patient-documents/upload",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          patientHash: hipaaHash(patientId),
          patientCheckMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Patient not found." });
        return;
      }

      const blobUploadStartedAt = Date.now();
      const blob = await uploadPatientDocumentPdf({
        patientId,
        documentType,
        originalFileName,
        fileBuffer,
      });
      const blobUploadMs = Date.now() - blobUploadStartedAt;

      const requestUser = getRequestUser(req);
      const documentId = randomUUID();
      const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

      const insertStartedAt = Date.now();
      const rows = await query<PatientDocumentRow>(
        `insert into public.patient_documents (
          id,
          patient_id,
          document_type,
          original_filename,
          content_type,
          byte_size,
          sha256,
          storage_provider,
          storage_container,
          storage_blob_path,
          storage_url,
          uploaded_by_user_id,
          uploaded_by_email
        ) values ($1,$2,$3,$4,$5,$6,$7,'azure_blob',$8,$9,$10,$11,$12)
        returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url,
          uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [
          documentId,
          patientId,
          documentType,
          originalFileName,
          "application/pdf",
          String(fileBuffer.byteLength),
          sha256,
          blob.containerName,
          blob.blobName,
          blob.blobUrl,
          requestUser?.id ?? null,
          requestUser?.email ?? null,
        ]
      );
      const insertMs = Date.now() - insertStartedAt;

      auditLog("patient_document_upload_ok", {
        requestId,
        route: "/api/patient-documents/upload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(patientId),
        documentHash: hipaaHash(rows[0]?.id ?? null),
        byteSize: fileBuffer.byteLength,
        patientCheckMs,
        blobUploadMs,
        insertMs,
        totalMs: Date.now() - startedAt,
      });

      res.status(201).json({
        ok: true,
        document: rows[0],
      });
    } catch (error) {
      auditLog("patient_document_upload_error", {
        requestId,
        route: "/api/patient-documents/upload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patients/:id/documents",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
            and document_type not like 'vault:%'
          order by created_at desc`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;
      auditLog("patient_document_list_ok", {
        requestId,
        route: "/api/patients/:id/documents",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(req.params.id),
        count: rows.length,
        dbMs,
        totalMs: Date.now() - startedAt,
      });

      res.json({ ok: true, documents: rows });
    } catch (error) {
      auditLog("patient_document_list_error", {
        requestId,
        route: "/api/patients/:id/documents",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        patientHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patients/:id/vault-documents",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    try {
      const rows = await query<PatientDocumentRow>(
        `select id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                storage_provider, storage_container, storage_blob_path, storage_url,
                uploaded_by_user_id, uploaded_by_email, created_at, updated_at
           from public.patient_documents
          where patient_id = $1
            and document_type like 'vault:%'
          order by created_at desc`,
        [req.params.id]
      );
      res.json({ ok: true, documents: rows });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.post(
  "/api/patients/:id/vault/upload-file",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const parsed = vaultUploadFileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid vault upload payload." });
      return;
    }
    try {
      const patientId = String(req.params.id);
      const documentType = normalizeVaultDocumentType(parsed.data.documentType);
      const originalFileName = normalizePdfFileName(parsed.data.fileName ?? `${documentType}.pdf`);
      const fileBuffer = Buffer.from(parsed.data.pdfBase64, "base64");
      if (!fileBuffer.length) {
        res.status(400).json({ ok: false, error: "Uploaded PDF is empty." });
        return;
      }
      const stored = await writeVaultArtifact({
        patientId,
        artifactType: documentType,
        fileName: originalFileName,
        buffer: fileBuffer,
      });
      const requestUser = getRequestUser(req);
      const rows = await query<PatientDocumentRow>(
        `insert into public.patient_documents (
          id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url, uploaded_by_user_id, uploaded_by_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url,
          uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [
          randomUUID(),
          patientId,
          `${VAULT_TYPE_PREFIX}${documentType}`,
          originalFileName,
          "application/pdf",
          String(stored.byteSize),
          createHash("sha256").update(fileBuffer).digest("hex"),
          "local_fs",
          "vault",
          stored.storageBlobPath,
          null,
          requestUser?.id ?? null,
          requestUser?.email ?? null,
        ]
      );
      res.status(201).json({ ok: true, document: rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.post(
  "/api/patients/:id/vault/paste-text",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const parsed = vaultPasteTextSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid vault text payload." });
      return;
    }
    try {
      const patientId = String(req.params.id);
      const documentType = normalizeVaultDocumentType(parsed.data.documentType);
      const originalFileName = normalizeTextFileName(parsed.data.fileName ?? `${documentType}.txt`);
      const fileBuffer = Buffer.from(parsed.data.text, "utf8");
      const stored = await writeVaultArtifact({
        patientId,
        artifactType: documentType,
        fileName: originalFileName,
        buffer: fileBuffer,
      });
      const requestUser = getRequestUser(req);
      const rows = await query<PatientDocumentRow>(
        `insert into public.patient_documents (
          id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url, uploaded_by_user_id, uploaded_by_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
          storage_provider, storage_container, storage_blob_path, storage_url,
          uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [
          randomUUID(),
          patientId,
          `${VAULT_TYPE_PREFIX}${documentType}`,
          originalFileName,
          "text/plain; charset=utf-8",
          String(stored.byteSize),
          createHash("sha256").update(fileBuffer).digest("hex"),
          "local_fs",
          "vault",
          stored.storageBlobPath,
          null,
          requestUser?.id ?? null,
          requestUser?.email ?? null,
        ]
      );
      res.status(201).json({ ok: true, document: rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

patientDocumentsRouter.patch(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      auditLog("patient_document_rename_rejected", {
        requestId,
        route: "/api/patient-documents/:id",
        reason: "invalid_payload",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
      });
      res.status(400).json({ ok: false, error: "Invalid rename payload." });
      return;
    }
    try {
      const dbStartedAt = Date.now();
      const nextName = normalizePathFileName(parsed.data.originalFileName);
      const rows = await query<PatientDocumentRow>(
        `update public.patient_documents
            set original_filename = $2,
                updated_at = timezone('utc', now())
          where id = $1
          returning id, patient_id, document_type, original_filename, content_type, byte_size, sha256,
                    storage_provider, storage_container, storage_blob_path, storage_url,
                    uploaded_by_user_id, uploaded_by_email, created_at, updated_at`,
        [req.params.id, nextName]
      );
      const dbMs = Date.now() - dbStartedAt;
      if (!rows[0]) {
        auditLog("patient_document_rename_not_found", {
          requestId,
          route: "/api/patient-documents/:id",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }
      auditLog("patient_document_rename_ok", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(rows[0].id),
        patientHash: hipaaHash(rows[0].patient_id),
        dbMs,
        totalMs: Date.now() - startedAt,
      });
      res.json({ ok: true, document: rows[0] });
    } catch (error) {
      auditLog("patient_document_rename_error", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.delete(
  "/api/patient-documents/:id",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "storage_container" | "storage_blob_path">
      >(
        `delete from public.patient_documents
          where id = $1
          returning id, storage_container, storage_blob_path`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;
      const deleted = rows[0];
      if (!deleted) {
        auditLog("patient_document_delete_not_found", {
          requestId,
          route: "/api/patient-documents/:id",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      const blobStartedAt = Date.now();
      await deleteBlobIfExists({
        containerName: deleted.storage_container,
        blobName: deleted.storage_blob_path,
      });
      const blobMs = Date.now() - blobStartedAt;

      auditLog("patient_document_delete_ok", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(deleted.id),
        dbMs,
        blobMs,
        totalMs: Date.now() - startedAt,
      });

      res.json({ ok: true, deletedId: deleted.id });
    } catch (error) {
      auditLog("patient_document_delete_error", {
        requestId,
        route: "/api/patient-documents/:id",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);

patientDocumentsRouter.get(
  "/api/patient-documents/:id/download",
  requireAuth,
  requireAnyRole("Admin", "Counselor", "Intake"),
  async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req, res);
    try {
      const dbStartedAt = Date.now();
      const rows = await query<
        Pick<PatientDocumentRow, "id" | "original_filename" | "content_type" | "storage_provider" | "storage_container" | "storage_blob_path">
      >(
        `select id, original_filename, content_type, storage_provider, storage_container, storage_blob_path
           from public.patient_documents
          where id = $1
          limit 1`,
        [req.params.id]
      );
      const dbMs = Date.now() - dbStartedAt;

      const document = rows[0];
      if (!document) {
        auditLog("patient_document_download_not_found", {
          requestId,
          route: "/api/patient-documents/:id/download",
          actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
          documentHash: hipaaHash(req.params.id),
          dbMs,
          totalMs: Date.now() - startedAt,
        });
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }

      const blobStartedAt = Date.now();
      let file: { readableStreamBody: NodeJS.ReadableStream; contentLength: number | null; contentType: string | null };
      if (document.storage_provider === "local_fs" && document.storage_container === "vault") {
        const localPath = getVaultAbsolutePathFromBlobPath(document.storage_blob_path);
        const stats = await fs.stat(localPath);
        file = {
          readableStreamBody: createReadStream(localPath),
          contentLength: stats.size,
          contentType: document.content_type || null,
        };
      } else {
        file = await downloadBlobStream({
          containerName: document.storage_container,
          blobName: document.storage_blob_path,
        });
      }
      const blobMs = Date.now() - blobStartedAt;

      res.setHeader("Content-Type", document.content_type || file.contentType || "application/pdf");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      const downloadName = getDownloadSafeFileName(document.original_filename);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${downloadName.replace(/"/g, "")}"`
      );
      if (typeof file.contentLength === "number" && Number.isFinite(file.contentLength)) {
        res.setHeader("Content-Length", String(file.contentLength));
      }
      auditLog("patient_document_download_stream_start", {
        requestId,
        route: "/api/patient-documents/:id/download",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(document.id),
        dbMs,
        blobMs,
        contentLength: file.contentLength,
        totalMsBeforeStream: Date.now() - startedAt,
      });
      file.readableStreamBody.pipe(res);
    } catch (error) {
      auditLog("patient_document_download_error", {
        requestId,
        route: "/api/patient-documents/:id/download",
        actorHash: hipaaHash(getRequestUser(req)?.email ?? null),
        documentHash: hipaaHash(req.params.id),
        totalMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown_error",
      });
      next(error);
    }
  }
);
