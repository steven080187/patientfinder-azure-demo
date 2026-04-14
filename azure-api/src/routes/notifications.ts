import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";

export const notificationsRouter = Router();

notificationsRouter.post("/api/notifications", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    await query(
      `insert into public.in_app_notifications (
          id, title, message, priority, patient_id, recipient_email, recipient_user_id, sender_email, created_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.body.id ?? randomUUID(),
        req.body.title,
        req.body.message,
        req.body.priority ?? "normal",
        req.body.patient_id ?? null,
        req.body.recipient_email ?? null,
        req.body.recipient_user_id ?? null,
        req.body.sender_email ?? user?.email ?? null,
        user?.id ?? null,
      ]
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});
