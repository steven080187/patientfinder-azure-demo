import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request } from "express";
import PDFKitDocument from "pdfkit";
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { env } from "../config.js";
import { query, withTransaction } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";

export const groupsRouter = Router();

const uploadRootDir = path.resolve(env.GROUP_PDF_UPLOAD_DIR);
const fallbackUploadRootDir = path.resolve(os.tmpdir(), "patientfinder", "group-pdfs");
const groupLinkLifetimeMs = 1000 * 60 * 60 * 8;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const groupPdfTemplateCandidates = [
  path.resolve(moduleDir, "../../assets/NewPDF.pdf"),
  path.resolve(process.cwd(), "assets/NewPDF.pdf"),
  path.resolve(process.cwd(), "azure-api/assets/NewPDF.pdf"),
];

function getGroupPdfRoots() {
  return Array.from(new Set([uploadRootDir, fallbackUploadRootDir]));
}

function resolveStoredGroupPdf(pdfStoragePath: string) {
  for (const root of getGroupPdfRoots()) {
    const absolutePath = path.resolve(root, pdfStoragePath);
    const relativePath = path.relative(root, absolutePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
    if (existsSync(absolutePath)) return absolutePath;
  }
  return null;
}

async function writeGroupPdf(sessionId: string, fileName: string, pdfBuffer: Buffer) {
  const relativePath = `${sessionId}/${fileName}`;
  let lastError: unknown = null;

  for (const root of getGroupPdfRoots()) {
    try {
      const absoluteDir = path.join(root, sessionId);
      await mkdir(absoluteDir, { recursive: true });
      await writeFile(path.join(absoluteDir, fileName), pdfBuffer);
      return relativePath;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to store group PDF.");
}

const startLiveSessionSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  timeSlot: z.enum(["17:30-19:00", "19:15-20:45"]),
});

const setMatchSchema = z.object({
  entryId: z.string().uuid(),
  patientId: z.string().min(1).nullable(),
});

const finalizeSchema = z.object({
  counselorSignName: z.string().trim().min(1).max(200),
  counselorSignatureDataUrl: z.string().trim().min(20),
});

const publicSubmitSchema = z.object({
  token: z.string().trim().min(20),
  participantName: z.string().trim().min(1).max(160),
  signatureDataUrl: z.string().trim().min(20),
});

type GroupLinkPayload = {
  sid: string;
  exp: number;
  nonce: string;
};

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signGroupToken(encodedPayload: string) {
  return createHmac("sha256", env.DEMO_AUTH_SECRET).update(encodedPayload).digest("base64url");
}

function createGroupJoinToken(sessionId: string) {
  const payload: GroupLinkPayload = {
    sid: sessionId,
    exp: Date.now() + groupLinkLifetimeMs,
    nonce: randomUUID(),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signGroupToken(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyGroupJoinToken(token: string): GroupLinkPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid group sign-in link.");
  }

  const expected = signGroupToken(encodedPayload);
  if (expected.length !== signature.length) {
    throw new Error("Invalid group sign-in link.");
  }

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new Error("Invalid group sign-in link.");
  }

  const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as GroupLinkPayload;
  if (!parsed?.sid || !parsed?.exp || parsed.exp < Date.now()) {
    throw new Error("This group sign-in link has expired.");
  }

  return parsed;
}

function splitTimeSlot(timeSlot: "17:30-19:00" | "19:15-20:45") {
  return timeSlot === "17:30-19:00"
    ? { startTime: "17:30:00", endTime: "19:00:00" }
    : { startTime: "19:15:00", endTime: "20:45:00" };
}

function safePdfFileName(fileName: string) {
  const trimmed = fileName.trim();
  const withoutUnsafeChars = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const normalized = withoutUnsafeChars.toLowerCase().endsWith(".pdf")
    ? withoutUnsafeChars
    : `${withoutUnsafeChars || "group-session"}.pdf`;
  return normalized.slice(0, 160);
}

type GroupPdfSession = {
  id: string;
  topic: string;
  groupDate: string;
  startTime: string;
  endTime: string | null;
  counselorName: string;
  location: string | null;
};

type GroupPdfEntry = {
  participantName: string;
  matchedPatientName: string | null;
  sageNumber: string | null;
  signedAt: string;
  signatureDataUrl: string | null;
};

type GroupPdfRenderParams = {
  session: GroupPdfSession;
  entries: GroupPdfEntry[];
  counselorSignatureDataUrl: string;
};

type FieldRect = { x: number; y: number; width: number; height: number };

function dataUrlToBuffer(dataUrl?: string | null) {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const base64 = dataUrl.slice(comma + 1);
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

async function findTemplateBytes() {
  for (const candidate of groupPdfTemplateCandidates) {
    if (!existsSync(candidate)) continue;
    try {
      return await readFile(candidate);
    } catch {
      // Keep trying other candidates.
    }
  }
  return null;
}

function getFieldMapFromTemplate(templateDoc: PdfLibDocument) {
  const map: Record<string, FieldRect> = {};
  const form = templateDoc.getForm();
  for (const field of form.getFields()) {
    const widgets = (field as any)?.acroField?.getWidgets?.() ?? [];
    const rect = widgets[0]?.getRectangle?.();
    if (!rect) continue;
    map[field.getName()] = {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    };
  }
  return map;
}

function formatTemplateDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function formatTemplateTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const raw = value instanceof Date ? value.toISOString().slice(11, 16) : String(value).trim();
  const [hoursRaw, minutesRaw] = raw.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return raw;
  const suffix = hours >= 12 ? "pm" : "am";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function drawTextField(
  page: any,
  font: any,
  text: string,
  rect: FieldRect | undefined,
  options: { center?: boolean } = {}
) {
  if (!rect || !text) return;
  const size = Math.min(15, Math.max(11, rect.height * 0.45));
  const safeText = String(text);
  const textWidth = font.widthOfTextAtSize(safeText, size);
  const x = options.center
    ? rect.x + Math.max(2, (rect.width - textWidth) / 2)
    : rect.x + 4;
  const y = rect.y + Math.max(2, (rect.height - size) / 2);
  page.drawText(safeText, { x, y, size, font, color: rgb(0.08, 0.08, 0.08) });
}

async function drawSignatureField(
  doc: PdfLibDocument,
  page: any,
  dataUrl: string | null | undefined,
  rect: FieldRect | undefined
) {
  if (!rect) return;
  const imageData = dataUrlToBuffer(dataUrl);
  if (!imageData) return;

  let image;
  const header = dataUrl?.slice(0, dataUrl.indexOf(",")) ?? "";
  if (header.includes("image/jpeg") || header.includes("image/jpg")) {
    image = await doc.embedJpg(imageData);
  } else {
    image = await doc.embedPng(imageData);
  }

  const padX = 6;
  const padY = 4;
  const targetWidth = Math.max(1, rect.width - padX * 2);
  const targetHeight = Math.max(1, rect.height - padY * 2);
  const imgRatio = image.width / image.height;
  const targetRatio = targetWidth / targetHeight;

  const drawWidth = imgRatio > targetRatio ? targetWidth : targetHeight * imgRatio;
  const drawHeight = imgRatio > targetRatio ? targetWidth / imgRatio : targetHeight;
  const drawX = rect.x + (rect.width - drawWidth) / 2;
  const drawY = rect.y + (rect.height - drawHeight) / 2;

  page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
}

async function renderGroupSessionPdfWithTemplate(params: GroupPdfRenderParams) {
  const templateBytes = await findTemplateBytes();
  if (!templateBytes) return null;

  const templateDoc = await PdfLibDocument.load(templateBytes);
  const fieldMap = getFieldMapFromTemplate(templateDoc);
  if (!Object.keys(fieldMap).length) return null;

  const outDoc = await PdfLibDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const chunks: GroupPdfEntry[][] = [];
  for (let i = 0; i < Math.max(params.entries.length, 1); i += 12) {
    chunks.push(params.entries.slice(i, i + 12));
  }
  if (!chunks.length) chunks.push([]);

  for (const chunk of chunks) {
    const [page] = await outDoc.copyPages(templateDoc, [0]);
    outDoc.addPage(page);

    drawTextField(page, font, params.session.location ?? "Zoom", fieldMap["Location"]);
    drawTextField(page, font, formatTemplateDate(params.session.groupDate), fieldMap["Date"], { center: true });
    drawTextField(page, font, formatTemplateTime(params.session.startTime), fieldMap["Start time"], { center: true });
    drawTextField(page, font, formatTemplateTime(params.session.endTime), fieldMap["End time"], { center: true });
    drawTextField(page, font, params.session.topic, fieldMap["Group Topic"]);
    drawTextField(page, font, params.session.counselorName, fieldMap["Counselor"]);
    await drawSignatureField(outDoc, page, params.counselorSignatureDataUrl, fieldMap["Signature"]);

    for (let i = 0; i < 12; i += 1) {
      const row = chunk[i];
      if (!row) continue;
      const displayName = row.matchedPatientName ?? row.participantName;
      const suffix = String(i + 1);
      drawTextField(page, font, displayName, fieldMap[`Patient Name${suffix}`]);
      drawTextField(page, font, row.sageNumber ?? "", fieldMap[`SAGE Number${suffix}`], { center: true });
      await drawSignatureField(outDoc, page, row.signatureDataUrl, fieldMap[`Signature${suffix}`]);
    }
  }

  return Buffer.from(await outDoc.save());
}

async function renderGroupSessionPdfLegacy(params: GroupPdfRenderParams) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFKitDocument({ size: "LETTER", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error) => reject(error));

    doc.fontSize(18).text("NCADD Group Session Sign-In", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Session ID: ${params.session.id}`);
    doc.text(`Topic: ${params.session.topic}`);
    doc.text(`Date: ${params.session.groupDate}`);
    doc.text(`Time: ${params.session.startTime} - ${params.session.endTime ?? "—"}`);
    doc.text(`Counselor: ${params.session.counselorName}`);
    doc.text(`Location: ${params.session.location ?? "Zoom"}`);
    doc.moveDown(0.8);
    doc.fontSize(12).text("Participants", { underline: true });
    doc.moveDown(0.4);

    params.entries.forEach((entry, index) => {
      const line = `${index + 1}. ${entry.participantName}  |  Matched: ${entry.matchedPatientName ?? "Unmatched"}  |  Signed: ${entry.signedAt}`;
      doc.fontSize(10).text(line);
      const sig = dataUrlToBuffer(entry.signatureDataUrl);
      if (sig) {
        const x = doc.x;
        const y = doc.y + 4;
        try {
          doc.image(sig, x, y, { fit: [180, 45] });
          doc.moveDown(2.6);
        } catch {
          doc.moveDown(0.6);
        }
      } else {
        doc.moveDown(0.5);
      }
    });

    doc.moveDown(0.8);
    doc.fontSize(12).text("Counselor Signature", { underline: true });
    const counselorSig = dataUrlToBuffer(params.counselorSignatureDataUrl);
    if (counselorSig) {
      try {
        doc.image(counselorSig, doc.x, doc.y + 8, { fit: [220, 56] });
        doc.moveDown(3.2);
      } catch {
        doc.moveDown(1.0);
      }
    } else {
      doc.moveDown(1.0);
    }
    doc.fontSize(10).text(`Signed by ${params.session.counselorName} at ${new Date().toISOString()}`);
    doc.end();
  });
}

async function renderGroupSessionPdf(params: GroupPdfRenderParams) {
  try {
    const templated = await renderGroupSessionPdfWithTemplate(params);
    if (templated) return templated;
  } catch (error) {
    console.error("Group template PDF render failed, falling back to legacy layout:", error);
  }
  return renderGroupSessionPdfLegacy(params);
}

function getPublicGroupOrigin(req: Request) {
  const configured = (env.PUBLIC_GROUP_SIGN_ORIGIN ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const allowedOrigins = env.AZURE_API_ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("http://") || value.startsWith("https://"));
  if (allowedOrigins.length > 0) {
    return allowedOrigins[0].replace(/\/+$/, "");
  }

  const protocol = req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]) : req.protocol;
  const host = req.get("host");
  return host ? `${protocol}://${host}` : "";
}

async function getSessionById(sessionId: string) {
  const rows = await query<{
    id: string;
    attendance_session_id: string;
    counselor_name: string;
    counselor_email: string | null;
    location: string | null;
    group_date: string;
    start_time: string;
    end_time: string | null;
    topic: string;
    created_at: string;
    updated_at: string;
    participant_count: number;
    finalized: boolean;
  }>(
    `select
        sessions.id,
        sessions.attendance_session_id,
        sessions.counselor_name,
        sessions.counselor_email,
        sessions.location,
        sessions.group_date,
        sessions.start_time,
        sessions.end_time,
        sessions.topic,
        sessions.created_at,
        sessions.updated_at,
        sessions.pdf_storage_path,
        sessions.pdf_uploaded_at,
        count(entries.id)::int as participant_count,
        (
          sessions.pdf_storage_path is not null
          or (sessions.pdf_storage_path is null and sessions.pdf_uploaded_at is not null)
        ) as finalized
      from public.group_signin_sessions sessions
      left join public.group_signin_entries entries
        on entries.session_id = sessions.id
      where sessions.id = $1
      group by
        sessions.id,
        sessions.attendance_session_id,
        sessions.counselor_name,
        sessions.counselor_email,
        sessions.location,
        sessions.group_date,
        sessions.start_time,
        sessions.end_time,
        sessions.topic,
        sessions.created_at,
        sessions.updated_at,
        sessions.pdf_storage_path,
        sessions.pdf_uploaded_at
      limit 1`,
    [sessionId]
  );
  return rows[0] ?? null;
}

groupsRouter.get("/api/groups", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (_req, res, next) => {
  try {
    const rows = await query(
      `select
          sessions.id,
          sessions.attendance_session_id,
          sessions.counselor_name,
          sessions.counselor_email,
          sessions.location,
          sessions.group_date,
          sessions.start_time,
          sessions.end_time,
          sessions.topic,
          sessions.pdf_original_filename,
          sessions.pdf_uploaded_at,
          sessions.created_at,
          sessions.updated_at,
          (sessions.pdf_storage_path is null) as is_live_session,
          count(entries.id)::int as participant_count
       from public.group_signin_sessions sessions
        left join public.group_signin_entries entries
          on entries.session_id = sessions.id
       group by
         sessions.id,
         sessions.attendance_session_id,
         sessions.counselor_name,
         sessions.counselor_email,
         sessions.location,
         sessions.group_date,
         sessions.start_time,
         sessions.end_time,
         sessions.topic,
         sessions.pdf_original_filename,
         sessions.pdf_uploaded_at,
         sessions.created_at,
         sessions.updated_at,
         sessions.pdf_storage_path
       order by sessions.group_date desc, sessions.start_time desc, sessions.created_at desc`
    );
    res.json({ ok: true, groups: rows });
  } catch (error) {
    next(error);
  }
});

groupsRouter.delete("/api/groups", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (_req, res, next) => {
  try {
    await withTransaction(async (client) => {
      const sessionRows = await client.query<{ attendance_session_id: string | null }>(
        `select attendance_session_id
           from public.group_signin_sessions`
      );
      const attendanceIds = sessionRows.rows
        .map((row) => row.attendance_session_id)
        .filter((value): value is string => !!value);

      await client.query(`delete from public.group_signin_sessions`);

      if (attendanceIds.length) {
        await client.query(
          `delete from public.attendance_sessions
            where id = any($1::uuid[])`,
          [attendanceIds]
        );
      }
    });

    await Promise.all(
      getGroupPdfRoots().map(async (root) => {
        await rm(root, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
      })
    );

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

groupsRouter.get("/api/groups/:id/pdf", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const rows = await query<{ pdf_storage_path: string | null; pdf_original_filename: string | null }>(
      `select pdf_storage_path, pdf_original_filename
         from public.group_signin_sessions
        where id = $1
        limit 1`,
      [req.params.id]
    );

    const record = rows[0];
    if (!record?.pdf_storage_path) {
      res.status(404).json({ ok: false, error: "Group PDF not found." });
      return;
    }

    const absolutePath = resolveStoredGroupPdf(record.pdf_storage_path);
    if (!absolutePath) {
      res.status(404).json({ ok: false, error: "Group PDF file is unavailable." });
      return;
    }

    const downloadName = record.pdf_original_filename || `group-session-${req.params.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${downloadName.replace(/"/g, "")}"`);
    createReadStream(absolutePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

groupsRouter.post("/api/groups/live/start", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  const parsed = startLiveSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid group setup payload." });
    return;
  }

  try {
    const authUser = getRequestUser(req);
    if (!authUser) {
      res.status(401).json({ ok: false, error: "Sign-in is required." });
      return;
    }

    const sessionId = randomUUID();
    const { startTime, endTime } = splitTimeSlot(parsed.data.timeSlot);
    const dateOnly = new Date().toISOString().slice(0, 10);

    await withTransaction(async (client) => {
      await client.query(
        `insert into public.attendance_sessions (
          id, kind, title, date, duration_hours, location, created_by
        ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, "Group", parsed.data.topic, dateOnly, 1.5, "Zoom", authUser.id]
      );

      await client.query(
        `insert into public.group_signin_sessions (
          id,
          attendance_session_id,
          counselor_user_id,
          counselor_email,
          counselor_name,
          location,
          group_date,
          start_time,
          end_time,
          topic
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          sessionId,
          sessionId,
          authUser.id,
          authUser.email,
          authUser.name || authUser.email,
          "Zoom",
          dateOnly,
          startTime,
          endTime,
          parsed.data.topic,
        ]
      );
    });

    const token = createGroupJoinToken(sessionId);
    const origin = getPublicGroupOrigin(req);
    const joinUrl = `${origin}/group-sign/${encodeURIComponent(token)}`;
    const session = await getSessionById(sessionId);

    res.json({
      ok: true,
      session,
      joinUrl,
      tokenExpiresAt: new Date(Date.now() + groupLinkLifetimeMs).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

groupsRouter.get("/api/groups/live/:id", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const sessionId = String(req.params.id);
    const session = await getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session not found." });
      return;
    }

    const entries = await query<{
      id: string;
      participant_name: string;
      signed_at: string;
      patient_id: string | null;
      patient_name: string | null;
    }>(
      `select
          entries.id,
          entries.participant_name,
          entries.signed_at,
          entries.patient_id,
          patients.full_name as patient_name
       from public.group_signin_entries entries
       left join public.patients patients
         on patients.id = entries.patient_id
       where entries.session_id = $1
       order by entries.signed_at asc`,
      [sessionId]
    );

    res.json({ ok: true, session, entries });
  } catch (error) {
    next(error);
  }
});

groupsRouter.post("/api/groups/live/:id/match", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  const parsed = setMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid matching payload." });
    return;
  }

  try {
    const sessionId = String(req.params.id);
    const session = await getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session not found." });
      return;
    }

    if (session.finalized) {
      res.status(409).json({ ok: false, error: "This group session has already been finalized." });
      return;
    }

    await withTransaction(async (client) => {
      const existingEntry = await client.query<{ patient_id: string | null }>(
        `select patient_id
          from public.group_signin_entries
         where id = $1 and session_id = $2
         limit 1`,
        [parsed.data.entryId, sessionId]
      );
      const previousPatientId = existingEntry.rows[0]?.patient_id ?? null;
      if (!existingEntry.rows.length) {
        throw new Error("Group sign-in entry was not found.");
      }

      await client.query(
        `update public.group_signin_entries
          set patient_id = $1,
                updated_at = timezone('utc', now())
          where id = $2 and session_id = $3`,
        [parsed.data.patientId, parsed.data.entryId, sessionId]
      );

      if (previousPatientId && previousPatientId !== parsed.data.patientId) {
        await client.query(
          `delete from public.attendance_session_patients
            where session_id = $1 and patient_id = $2`,
          [session.attendance_session_id, previousPatientId]
        );
      }

      if (parsed.data.patientId) {
        await client.query(
          `insert into public.attendance_session_patients (
            session_id,
            patient_id,
            status
          ) values ($1,$2,$3)
          on conflict (session_id, patient_id) do update set
            status = excluded.status,
            updated_at = timezone('utc', now())`,
          [session.attendance_session_id, parsed.data.patientId, "Present"]
        );
      }
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

groupsRouter.delete("/api/groups/live/:id/entry/:entryId", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const sessionId = String(req.params.id);
    const entryId = String(req.params.entryId);
    const session = await getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session not found." });
      return;
    }

    if (session.finalized) {
      res.status(409).json({ ok: false, error: "This group session has already been finalized." });
      return;
    }

    await withTransaction(async (client) => {
      const existingEntry = await client.query<{ patient_id: string | null }>(
        `select patient_id
           from public.group_signin_entries
          where id = $1 and session_id = $2
          limit 1`,
        [entryId, sessionId]
      );
      const previousPatientId = existingEntry.rows[0]?.patient_id ?? null;
      if (!existingEntry.rows.length) return;

      await client.query(
        `delete from public.group_signin_entries
          where id = $1 and session_id = $2`,
        [entryId, sessionId]
      );

      if (previousPatientId) {
        await client.query(
          `delete from public.attendance_session_patients
            where session_id = $1 and patient_id = $2`,
          [session.attendance_session_id, previousPatientId]
        );
      }
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

groupsRouter.post("/api/groups/live/:id/finalize", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Counselor signature is required." });
    return;
  }

  try {
    const sessionId = String(req.params.id);
    const session = await getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session not found." });
      return;
    }

    if (session.finalized) {
      res.json({ ok: true });
      return;
    }

    const entries = await query<{
      participant_name: string;
      patient_name: string | null;
      sage_number: string | null;
      signed_at: string;
      signature_payload: string | null;
    }>(
      `select
          entries.participant_name,
          patients.full_name as patient_name,
          entries.sage_number,
          entries.signed_at,
          entries.signature_payload
       from public.group_signin_entries entries
       left join public.patients patients
         on patients.id = entries.patient_id
       where entries.session_id = $1
       order by entries.signed_at asc`,
      [sessionId]
    );

    const pdfBuffer = await renderGroupSessionPdf({
      session: {
        id: session.id,
        topic: session.topic,
        groupDate: session.group_date,
        startTime: session.start_time,
        endTime: session.end_time,
        counselorName: parsed.data.counselorSignName,
        location: session.location,
      },
      entries: entries.map((entry) => {
        let signatureDataUrl: string | null = null;
        if (entry.signature_payload) {
          try {
            const parsedSig = JSON.parse(entry.signature_payload) as { dataUrl?: string };
            signatureDataUrl = parsedSig?.dataUrl ?? null;
          } catch {
            signatureDataUrl = null;
          }
        }
        return {
          participantName: entry.participant_name,
          matchedPatientName: entry.patient_name,
          sageNumber: entry.sage_number,
          signedAt: new Date(entry.signed_at).toLocaleString(),
          signatureDataUrl,
        };
      }),
      counselorSignatureDataUrl: parsed.data.counselorSignatureDataUrl,
    });

    const fileName = safePdfFileName(`group-session-${session.id}.pdf`);
    const relativePath = await writeGroupPdf(session.id, fileName, pdfBuffer);

    await query(
      `update public.group_signin_sessions
          set counselor_name = $1,
              pdf_storage_path = $2,
              pdf_original_filename = $3,
              pdf_uploaded_at = timezone('utc', now()),
              updated_at = timezone('utc', now())
        where id = $4`,
      [parsed.data.counselorSignName, relativePath, fileName, sessionId]
    );

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

groupsRouter.get("/api/public/group-sign/:token", async (req, res, next) => {
  try {
    const parsedToken = verifyGroupJoinToken(req.params.token);
    const session = await getSessionById(parsedToken.sid);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session was not found." });
      return;
    }
    if (session.finalized) {
      res.status(409).json({ ok: false, error: "This group session has already been closed." });
      return;
    }

    res.json({
      ok: true,
      session: {
        sessionId: session.id,
        topic: session.topic,
        groupDate: session.group_date,
        startTime: session.start_time,
        endTime: session.end_time,
        counselorName: session.counselor_name,
        location: session.location,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
});

groupsRouter.post("/api/public/group-sign/submit", async (req, res, next) => {
  const parsed = publicSubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid sign-in payload." });
    return;
  }

  try {
    const tokenPayload = verifyGroupJoinToken(parsed.data.token);
    const session = await getSessionById(tokenPayload.sid);
    if (!session) {
      res.status(404).json({ ok: false, error: "Group session was not found." });
      return;
    }
    if (session.finalized) {
      res.status(409).json({ ok: false, error: "This group session has already been closed." });
      return;
    }

    await query(
      `insert into public.group_signin_entries (
          id,
          session_id,
          attendance_session_id,
          patient_id,
          participant_name,
          sage_number,
          signature_payload,
          signed_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        session.id,
        session.attendance_session_id,
        null,
        parsed.data.participantName,
        null,
        JSON.stringify({
          dataUrl: parsed.data.signatureDataUrl,
          source: "patientfinder-web",
        }),
        new Date().toISOString(),
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
});
