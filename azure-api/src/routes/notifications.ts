import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { getRequestUser, requireAuth } from "../entraAuth.js";
import { invalidateDashboardCache } from "./dashboard.js";

export const notificationsRouter = Router();

notificationsRouter.post("/api/notifications", requireAuth, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: "Sign-in is required." });
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

    const id = String(req.body.id ?? randomUUID());
    const threadId = String(req.body.thread_id ?? id).trim() || id;
    const parentNotificationId = req.body.parent_notification_id ? String(req.body.parent_notification_id).trim() : null;

    await query(
      `insert into public.in_app_notifications (
          id, thread_id, parent_notification_id, title, message, priority, patient_id,
          recipient_email, recipient_user_id, sender_user_id, sender_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        threadId,
        parentNotificationId,
        title,
        message,
        req.body.priority ?? "normal",
        patientId,
        recipientEmail,
        req.body.recipient_user_id ?? null,
        user.id,
        req.body.sender_email ?? user.email ?? null,
      ]
    );
    invalidateDashboardCache();

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/api/notifications/:notificationId/read", requireAuth, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      res.status(400).json({ ok: false, error: "Notification id is required." });
      return;
    }

    const updated = await withTransaction(async (client) => {
      const visibleResult = user?.roles.includes("Admin")
        ? await client.query<{
            id: string;
            title: string;
            message: string;
            priority: string;
            patient_id: string | null;
            recipient_email: string | null;
            recipient_user_id: string | null;
            sender_email: string | null;
            sender_user_id: string | null;
            thread_id: string | null;
            read_at: string | null;
          }>(
            `select id, title, message, priority, patient_id, recipient_email, recipient_user_id, sender_email, sender_user_id, thread_id, read_at
               from public.in_app_notifications
              where id = $1
              limit 1`,
            [notificationId]
          )
        : await client.query<{
            id: string;
            title: string;
            message: string;
            priority: string;
            patient_id: string | null;
            recipient_email: string | null;
            recipient_user_id: string | null;
            sender_email: string | null;
            sender_user_id: string | null;
            thread_id: string | null;
            read_at: string | null;
          }>(
            `select id, title, message, priority, patient_id, recipient_email, recipient_user_id, sender_email, sender_user_id, thread_id, read_at
               from public.in_app_notifications
              where id = $1
                and (
                  lower(coalesce(recipient_email, '')) = lower($2)
                  or lower(coalesce(recipient_user_id::text, '')) = lower($3)
                )
              limit 1`,
            [notificationId, user?.email ?? "", user?.id ?? ""]
          );
      const target = visibleResult.rows[0];
      if (!target) return false;

      const updated = await client.query(
        `update public.in_app_notifications
            set read_at = coalesce(read_at, timezone('utc', now())),
                updated_at = timezone('utc', now())
          where id = $1
          returning id`,
        [notificationId]
      );

      if (updated.rowCount && !target.read_at && target.sender_email && user?.email) {
        const senderEmail = target.sender_email.trim().toLowerCase();
        if (senderEmail && senderEmail !== user.email.toLowerCase()) {
          await client.query(
            `insert into public.in_app_notifications (
                id, thread_id, parent_notification_id, title, message, priority, patient_id,
                recipient_email, recipient_user_id, sender_user_id, sender_email
              ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              randomUUID(),
              target.thread_id ?? target.id,
              target.id,
              `Highlight read: ${target.title}`,
              `${user.name ?? user.email} marked this highlight as read.`,
              target.priority === "urgent" ? "urgent" : "normal",
              target.patient_id,
              senderEmail,
              target.sender_user_id ?? null,
              user.id ?? null,
              user.email.toLowerCase(),
            ]
          );
        }
      }

      return Boolean(updated.rowCount);
    });

    if (!updated) {
      res.status(404).json({ ok: false, error: "Notification not found." });
      return;
    }
    invalidateDashboardCache();

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/api/notifications/:notificationId/reply", requireAuth, async (req, res, next) => {
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
      thread_id: string | null;
      title: string;
      patient_id: string | null;
      sender_email: string | null;
      recipient_email: string | null;
      recipient_user_id: string | null;
    }>(
      `select id, thread_id, title, patient_id, sender_email, recipient_email, recipient_user_id
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
    const isRecipient =
      (original.recipient_email ?? "").toLowerCase() === user.email.toLowerCase() ||
      (original.recipient_user_id ?? "").toLowerCase() === user.id.toLowerCase();
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
          id, thread_id, parent_notification_id, title, message, priority, patient_id,
          recipient_email, recipient_user_id, sender_user_id, sender_email
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(),
        original.thread_id ?? original.id,
        original.id,
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
    invalidateDashboardCache();

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.delete("/api/notifications/:notificationId/thread", requireAuth, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      res.status(400).json({ ok: false, error: "Notification id is required." });
      return;
    }

    const [original] = await query<{
      id: string;
      thread_id: string | null;
      sender_email: string | null;
      recipient_email: string | null;
      recipient_user_id: string | null;
    }>(
      `select id, thread_id, sender_email, recipient_email, recipient_user_id
         from public.in_app_notifications
        where id = $1
        limit 1`,
      [notificationId]
    );

    if (!original) {
      res.status(404).json({ ok: false, error: "Notification not found." });
      return;
    }

    const canDeleteThread =
      user?.roles.includes("Admin") ||
      (original.sender_email ?? "").toLowerCase() === (user?.email ?? "").toLowerCase() ||
      (original.recipient_email ?? "").toLowerCase() === (user?.email ?? "").toLowerCase() ||
      String(original.recipient_user_id ?? "").toLowerCase() === String(user?.id ?? "").toLowerCase();

    if (!canDeleteThread) {
      res.status(403).json({ ok: false, error: "You can only delete highlights that involve you." });
      return;
    }

    await query(`delete from public.in_app_notifications where thread_id = $1 or id = $1`, [original.thread_id ?? original.id]);
    invalidateDashboardCache();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
