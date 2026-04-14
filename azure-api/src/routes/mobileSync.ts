import { Router } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { query, withTransaction } from "../db.js";
import { findDemoUser } from "../demoAuth.js";

export const mobileSyncRouter = Router();

const uploadRootDir = path.resolve(env.GROUP_PDF_UPLOAD_DIR);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const sessionSchema = z.object({
  sessionId: z.string().uuid(),
  setup: z.object({
    location: z.string().min(1),
    topic: z.string().min(1),
    counselorName: z.string().min(1),
    date: z.string().min(1),
    startTime: z.string().min(1),
  }),
  sessionEnd: z
    .object({
      endTime: z.string().min(1),
      counselorSignName: z.string().optional().nullable(),
    })
    .nullable()
    .optional(),
  pdf: z
    .object({
      fileName: z.string().min(1),
      dataBase64: z.string().min(1),
    })
    .nullable()
    .optional(),
});

const participantSchema = z.object({
  signIn: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    sageNumber: z.string().optional().default(""),
    signedAt: z.string().min(1),
    signature: z.any(),
  }),
  sessionId: z.string().uuid(),
  patientId: z.string().min(1).nullable().optional(),
});

const deleteParticipantSchema = z.object({
  signInId: z.string().uuid(),
  sessionId: z.string().uuid(),
  patientId: z.string().min(1).nullable().optional(),
});

function sessionPayload(user: { id: string; email: string | null | undefined }) {
  return {
    accessToken: env.DEMO_MOBILE_TOKEN,
    refreshToken: env.DEMO_MOBILE_TOKEN,
    expiresIn: 60 * 60 * 24 * 30,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  };
}

function requireMobileAuth(request: Request, response: Response) {
  const auth = request.headers.authorization ?? "";
  if (auth !== `Bearer ${env.DEMO_MOBILE_TOKEN}`) {
    response.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function safePdfFileName(fileName: string) {
  const trimmed = fileName.trim();
  const withoutUnsafeChars = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const normalized = withoutUnsafeChars.toLowerCase().endsWith(".pdf")
    ? withoutUnsafeChars
    : `${withoutUnsafeChars || "group-session"}.pdf`;
  return normalized.slice(0, 160);
}

mobileSyncRouter.post("/api/mobile/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid login payload." });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const demoUser = findDemoUser(normalizedEmail, password);
  const matchesLegacyStaffUser =
    normalizedEmail === env.DEMO_STAFF_EMAIL.toLowerCase() && password === env.DEMO_STAFF_PASSWORD;

  if (!demoUser && !matchesLegacyStaffUser) {
    res.status(401).json({ ok: false, error: "Invalid demo credentials." });
    return;
  }

  const user = demoUser ?? {
    id: env.DEMO_STAFF_USER_ID,
    email: env.DEMO_STAFF_EMAIL,
  };

  res.json(sessionPayload(user));
});

mobileSyncRouter.get("/api/mobile/patients", async (req, res, next) => {
  if (!requireMobileAuth(req, res)) return;
  try {
    const rows = await query(
      `select id, full_name, mrn
         from public.patients
        where coalesce(full_name, '') <> ''
        order by full_name asc nulls last`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

mobileSyncRouter.post("/api/mobile/group-session", async (req, res, next) => {
  if (!requireMobileAuth(req, res)) return;
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid group session payload." });
    return;
  }

  try {
    const { sessionId, setup, sessionEnd, pdf } = parsed.data;
    const dateOnly = setup.date.slice(0, 10);
    const startTime = setup.startTime.length >= 8 ? setup.startTime : `${setup.startTime}:00`;
    const endTime = sessionEnd?.endTime ? (sessionEnd.endTime.length >= 8 ? sessionEnd.endTime : `${sessionEnd.endTime}:00`) : null;
    let pdfStoragePath: string | null = null;
    let pdfOriginalFilename: string | null = null;
    let pdfUploadedAt: string | null = null;

    if (pdf) {
      await mkdir(uploadRootDir, { recursive: true });
      const fileName = safePdfFileName(pdf.fileName);
      const fileBuffer = Buffer.from(pdf.dataBase64, "base64");
      if (!fileBuffer.length) {
        res.status(400).json({ ok: false, error: "Uploaded group PDF was empty." });
        return;
      }

      pdfStoragePath = `${sessionId}/${fileName}`;
      pdfOriginalFilename = fileName;
      pdfUploadedAt = new Date().toISOString();

      const absoluteDir = path.join(uploadRootDir, sessionId);
      await mkdir(absoluteDir, { recursive: true });
      await writeFile(path.join(absoluteDir, fileName), fileBuffer);
    }

    await withTransaction(async (client) => {
      await client.query(
        `insert into public.attendance_sessions (
          id, kind, title, date, duration_hours, location, created_by
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update set
          kind = excluded.kind,
          title = excluded.title,
          date = excluded.date,
          duration_hours = excluded.duration_hours,
          location = excluded.location,
          created_by = excluded.created_by,
          updated_at = timezone('utc', now())`,
        [sessionId, "Group", setup.topic, dateOnly, 1.5, setup.location, env.DEMO_STAFF_USER_ID]
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
          topic,
          pdf_storage_path,
          pdf_original_filename,
          pdf_uploaded_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict (id) do update set
          attendance_session_id = excluded.attendance_session_id,
          counselor_user_id = excluded.counselor_user_id,
          counselor_email = excluded.counselor_email,
          counselor_name = excluded.counselor_name,
          location = excluded.location,
          group_date = excluded.group_date,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          topic = excluded.topic,
          pdf_storage_path = coalesce(excluded.pdf_storage_path, public.group_signin_sessions.pdf_storage_path),
          pdf_original_filename = coalesce(excluded.pdf_original_filename, public.group_signin_sessions.pdf_original_filename),
          pdf_uploaded_at = coalesce(excluded.pdf_uploaded_at, public.group_signin_sessions.pdf_uploaded_at),
          updated_at = timezone('utc', now())`,
        [
          sessionId,
          sessionId,
          env.DEMO_STAFF_USER_ID,
          env.DEMO_STAFF_EMAIL,
          sessionEnd?.counselorSignName || setup.counselorName,
          setup.location,
          dateOnly,
          startTime,
          endTime,
          setup.topic,
          pdfStoragePath,
          pdfOriginalFilename,
          pdfUploadedAt,
        ]
      );
    });

    res.json(sessionPayload({ id: env.DEMO_STAFF_USER_ID, email: env.DEMO_STAFF_EMAIL }));
  } catch (error) {
    next(error);
  }
});

mobileSyncRouter.post("/api/mobile/participant", async (req, res, next) => {
  if (!requireMobileAuth(req, res)) return;
  const parsed = participantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid participant payload." });
    return;
  }

  try {
    const { signIn, sessionId, patientId } = parsed.data;
    await withTransaction(async (client) => {
      const previousEntry = await client.query<{ patient_id: string | null }>(
        `select patient_id
           from public.group_signin_entries
          where id = $1
          limit 1`,
        [signIn.id]
      );
      const previousPatientId = previousEntry.rows[0]?.patient_id ?? null;

      await client.query(
        `insert into public.group_signin_entries (
          id,
          session_id,
          attendance_session_id,
          patient_id,
          participant_name,
          sage_number,
          signature_payload,
          signed_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (id) do update set
          session_id = excluded.session_id,
          attendance_session_id = excluded.attendance_session_id,
          patient_id = excluded.patient_id,
          participant_name = excluded.participant_name,
          sage_number = excluded.sage_number,
          signature_payload = excluded.signature_payload,
          signed_at = excluded.signed_at,
          updated_at = timezone('utc', now())`,
        [
          signIn.id,
          sessionId,
          sessionId,
          patientId ?? null,
          signIn.name,
          signIn.sageNumber || null,
          JSON.stringify(signIn.signature),
          signIn.signedAt,
        ]
      );

      if (previousPatientId && previousPatientId !== patientId) {
        await client.query(
          `delete from public.attendance_session_patients where session_id = $1 and patient_id = $2`,
          [sessionId, previousPatientId]
        );
      }

      if (patientId) {
        await client.query(
          `insert into public.attendance_session_patients (
            session_id,
            patient_id,
            status
          ) values ($1,$2,$3)
          on conflict (session_id, patient_id) do update set
            status = excluded.status,
            updated_at = timezone('utc', now())`,
          [sessionId, patientId, "Present"]
        );
      }
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

mobileSyncRouter.delete("/api/mobile/participant", async (req, res, next) => {
  if (!requireMobileAuth(req, res)) return;
  const parsed = deleteParticipantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid delete payload." });
    return;
  }

  try {
    const { signInId, sessionId, patientId } = parsed.data;
    await withTransaction(async (client) => {
      await client.query(`delete from public.group_signin_entries where id = $1`, [signInId]);
      if (patientId) {
        await client.query(
          `delete from public.attendance_session_patients where session_id = $1 and patient_id = $2`,
          [sessionId, patientId]
        );
      }
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
