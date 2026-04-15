import { Router } from "express";
import { query } from "../db.js";
import { requireAnyRole, requireAuth } from "../entraAuth.js";

export const dashboardRouter = Router();

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "42P01";
}

async function queryOptionalDashboardTable(sql: string, tableName: string) {
  try {
    return await query(sql);
  } catch (error) {
    if (isMissingRelationError(error)) {
      console.warn(`[dashboard] Optional relation missing (${tableName}); returning empty dataset.`);
      return [];
    }
    throw error;
  }
}

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
      queryOptionalDashboardTable(`select * from public.patient_case_assignments`, "patient_case_assignments"),
      queryOptionalDashboardTable(`select * from public.patient_compliance`, "patient_compliance"),
      queryOptionalDashboardTable(`select * from public.patient_drug_tests order by date desc`, "patient_drug_tests"),
      queryOptionalDashboardTable(`select * from public.attendance_sessions order by date desc, created_at desc`, "attendance_sessions"),
      queryOptionalDashboardTable(`select * from public.attendance_session_patients`, "attendance_session_patients"),
      queryOptionalDashboardTable(`select * from public.patient_roster_details`, "patient_roster_details"),
      queryOptionalDashboardTable(`select * from public.in_app_notifications order by created_at desc`, "in_app_notifications"),
      queryOptionalDashboardTable(`select * from public.patient_billing_entries order by service_date desc, created_at desc`, "patient_billing_entries"),
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
