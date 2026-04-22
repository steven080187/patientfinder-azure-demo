import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";

export const notificationsRouter = Router();

notificationsRouter.post("/api/notifications", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user?.roles.includes("Admin")) {
      res.status(403).json({ ok: false, error: "Only admins can send in-app notifications." });
      return;
    }

    const title = String(req.body.title ?? "").trim();
    const message = String(req.body.message ?? "").trim();
    const recipientEmail = req.body.recipient_email ? String(req.body.recipient_email).trim().toLowerCase() : null;
    const patientId = req.body.patient_id ? String(req.body.patient_id).trim() : null;
    if (!title || !message || !recipientEmail || !patientId) {
      res.status(400).json({ ok: false, error: "Recipient email, patient, title, and message are required." });
      return;
    }

    await query(
      `insert into public.in_app_notifications (
          id, title, message, priority, patient_id, recipient_email, recipient_user_id, sender_user_id, sender_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.body.id ?? randomUUID(),
        title,
        message,
        req.body.priority ?? "normal",
        patientId,
        recipientEmail,
        req.body.recipient_user_id ?? null,
        user?.id ?? null,
        req.body.sender_email ?? user?.email ?? null,
      ]
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/api/notifications/:notificationId/read", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      res.status(400).json({ ok: false, error: "Notification id is required." });
      return;
    }

    const rows = user?.roles.includes("Admin")
      ? await query(
          `update public.in_app_notifications
              set read_at = coalesce(read_at, timezone('utc', now())),
                  updated_at = timezone('utc', now())
            where id = $1
            returning id`,
          [notificationId]
        )
      : await query(
          `update public.in_app_notifications
              set read_at = coalesce(read_at, timezone('utc', now())),
                  updated_at = timezone('utc', now())
            where id = $1
              and (
                lower(coalesce(recipient_email, '')) = lower($2)
                or recipient_user_id::text = $3
              )
            returning id`,
          [notificationId, user?.email ?? "", user?.id ?? ""]
        );

    if (!rows.length) {
      res.status(404).json({ ok: false, error: "Notification not found." });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/api/notifications/:notificationId/reply", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: "Sign-in is required." });
      return;
    }

    const notificationId = String(req.params.notificationId ?? "").trim();
    const message = String(req.body.message ?? "").trim();
    if (!notificationId || !message) {
      res.status(400).json({ ok: false, error: "Notification id and message are required." });
      return;
    }

    const [original] = await query<{
      id: string;
      title: string;
      patient_id: string | null;
      sender_email: string | null;
      recipient_email: string | null;
      recipient_user_id: string | null;
    }>(
      `select id, title, patient_id, sender_email, recipient_email, recipient_user_id
         from public.in_app_notifications
        where id = $1
        limit 1`,
      [notificationId]
    );

    if (!original) {
      res.status(404).json({ ok: false, error: "Notification not found." });
      return;
    }

    const isAdmin = user.roles.includes("Admin");
    const isRecipient = (original.recipient_email ?? "").toLowerCase() === user.email.toLowerCase() || original.recipient_user_id === user.id;
    if (!isAdmin && !isRecipient) {
      res.status(403).json({ ok: false, error: "You can only reply to notifications sent to you." });
      return;
    }

    const replyRecipientEmail = original.sender_email?.trim().toLowerCase();
    if (!replyRecipientEmail) {
      res.status(400).json({ ok: false, error: "That notification cannot be replied to because the sender is unknown." });
      return;
    }

    await query(
      `insert into public.in_app_notifications (
          id, title, message, priority, patient_id, recipient_email, recipient_user_id, sender_user_id, sender_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        `Re: ${original.title}`,
        message,
        "normal",
        original.patient_id,
        replyRecipientEmail,
        null,
        user.id,
        user.email.toLowerCase(),
      ]
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});
