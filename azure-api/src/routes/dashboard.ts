import { Router } from "express";
import { query } from "../db.js";
import { requireAnyRole, requireAuth } from "../entraAuth.js";

export const dashboardRouter = Router();

dashboardRouter.get("/api/dashboard", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (_req, res, next) => {
  try {
    const [
      patients,
      assignments,
      compliance,
      drugTests,
      sessions,
      attendanceSessionPatients,
      rosterDetails,
      notifications,
      billingEntries,
    ] = await Promise.all([
      query(`select * from public.patients order by full_name asc nulls last`),
      query(`select * from public.patient_case_assignments`),
      query(`select * from public.patient_compliance`),
      query(`select * from public.patient_drug_tests order by date desc`),
      query(`select * from public.attendance_sessions order by date desc, created_at desc`),
      query(`select * from public.attendance_session_patients`),
      query(`select * from public.patient_roster_details`),
      query(`select * from public.in_app_notifications order by created_at desc`),
      query(`select * from public.patient_billing_entries order by service_date desc, created_at desc`),
    ]);

    res.json({
      ok: true,
      dashboard: {
        patients,
        assignments,
        compliance,
        drugTests,
        sessions,
        attendanceSessionPatients,
        rosterDetails,
        notifications,
        billingEntries,
      },
    });
  } catch (error) {
    next(error);
  }
});
