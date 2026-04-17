import { Router } from "express";
import { query } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";

export const dashboardRouter = Router();

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "42P01";
}

async function queryOptionalDashboardTable(sql: string, tableName: string, params?: unknown[]) {
  try {
    return await query(sql, params);
  } catch (error) {
    if (isMissingRelationError(error)) {
      console.warn(`[dashboard] Optional relation missing (${tableName}); returning empty dataset.`);
      return [];
    }
    throw error;
  }
}

dashboardRouter.get("/api/dashboard", requireAuth, requireAnyRole("Admin", "Counselor", "Intake"), async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    const canSeeAllNotifications = Boolean(user?.roles.includes("Admin"));
    const includePatients = String(req.query.include_patients ?? "1") !== "0";

    const notificationsPromise = canSeeAllNotifications
      ? queryOptionalDashboardTable(`select * from public.in_app_notifications order by created_at desc`, "in_app_notifications")
      : queryOptionalDashboardTable(
          `select *
             from public.in_app_notifications
            where lower(coalesce(recipient_email, '')) = lower($1)
               or recipient_user_id::text = $2
            order by created_at desc`,
          "in_app_notifications",
          [user?.email ?? "", user?.id ?? ""]
        );

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
      includePatients ? query(`select * from public.patients order by full_name asc nulls last`) : Promise.resolve([]),
      queryOptionalDashboardTable(`select * from public.patient_case_assignments`, "patient_case_assignments"),
      queryOptionalDashboardTable(`select * from public.patient_compliance`, "patient_compliance"),
      queryOptionalDashboardTable(`select * from public.patient_drug_tests order by date desc`, "patient_drug_tests"),
      queryOptionalDashboardTable(`select * from public.attendance_sessions order by date desc, created_at desc`, "attendance_sessions"),
      queryOptionalDashboardTable(`select * from public.attendance_session_patients`, "attendance_session_patients"),
      queryOptionalDashboardTable(`select * from public.patient_roster_details`, "patient_roster_details"),
      notificationsPromise,
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
