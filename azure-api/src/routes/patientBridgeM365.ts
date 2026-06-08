import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { query, withTransaction } from "../db.js";
import { getRequestUser, requireAnyRole, requireAuth } from "../entraAuth.js";

export const patientBridgeM365Router = Router();

const uploadSchema = z.object({
  fileName: z.string().trim().min(1),
  fileBase64: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  folderPath: z.string().trim().min(1).optional(),
  contentType: z.string().trim().min(1).optional(),
  source: z.enum(["upload", "sample"]).optional(),
});

const summarySelect = `
  select id, name, original_file_name, storage_mode, graph_site_id, graph_drive_id, graph_item_id,
         graph_path, graph_web_url, graph_embed_url, file_size_bytes, uploaded_by_email, created_at, updated_at
    from public.patient_bridge_workbooks
`;

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeFolderPath(pathValue: string | null | undefined) {
  const text = normalizeText(pathValue);
  if (!text) return "";
  return text.replace(/^\/+|\/+$/g, "").replace(/\.\.+/g, ".");
}

function encodeDrivePath(pathValue: string) {
  return pathValue
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeWorkbookBytes(fileBase64: string) {
  const cleaned = fileBase64.includes(",") ? fileBase64.split(",").pop() ?? fileBase64 : fileBase64;
  return Buffer.from(cleaned, "base64");
}

function summarizeWorkbook(row: {
  id: string;
  name: string;
  original_file_name: string;
  storage_mode: string;
  graph_site_id: string | null;
  graph_drive_id: string | null;
  graph_item_id: string | null;
  graph_path: string | null;
  graph_web_url: string | null;
  graph_embed_url: string | null;
  file_size_bytes: string | number | null;
  uploaded_by_email: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    original_file_name: row.original_file_name,
    storage_mode: row.storage_mode as "m365" | "demo",
    graph_site_id: row.graph_site_id,
    graph_drive_id: row.graph_drive_id,
    graph_item_id: row.graph_item_id,
    graph_path: row.graph_path,
    graph_web_url: row.graph_web_url,
    graph_embed_url: row.graph_embed_url,
    file_size_bytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    uploaded_by_email: row.uploaded_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseJsonRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function getGraphAccessToken() {
  if (
    !env.M365_GRAPH_TENANT_ID ||
    !env.M365_GRAPH_CLIENT_ID ||
    !env.M365_GRAPH_CLIENT_SECRET
  ) {
    return null;
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${env.M365_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.M365_GRAPH_CLIENT_ID,
      client_secret: env.M365_GRAPH_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Unable to acquire Microsoft Graph token (${tokenResponse.status}): ${text.slice(0, 160)}`);
  }

  const payload = (await tokenResponse.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Microsoft Graph token response did not include an access token.");
  }

  return payload.access_token;
}

async function graphJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGraphAccessToken();
  if (!token) {
    throw new Error("Microsoft 365 workbook storage is not configured.");
  }
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Microsoft Graph request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

async function ensureWorkbookAudit(workbookId: string | null, action: string, summary: string, details: Record<string, unknown>, actorEmail: string | null) {
  await query(
    `insert into public.patient_bridge_workbook_audit_logs (id, workbook_id, action, summary, details, actor_email)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [randomUUID(), workbookId, action, summary, JSON.stringify(details), actorEmail]
  );
}

async function loadWorkbookSummaryRows() {
  return query<{
    id: string;
    name: string;
    original_file_name: string;
    storage_mode: string;
    graph_site_id: string | null;
    graph_drive_id: string | null;
    graph_item_id: string | null;
    graph_path: string | null;
    graph_web_url: string | null;
    graph_embed_url: string | null;
    file_size_bytes: string | number | null;
    uploaded_by_email: string | null;
    created_at: string;
    updated_at: string;
  }>(summarySelect + " order by created_at desc");
}

async function loadWorkbookDetail(workbookId: string) {
  const rows = await query<{
    id: string;
    name: string;
    original_file_name: string;
    storage_mode: string;
    graph_site_id: string | null;
    graph_drive_id: string | null;
    graph_item_id: string | null;
    graph_path: string | null;
    graph_web_url: string | null;
    graph_embed_url: string | null;
    file_size_bytes: string | number | null;
    uploaded_by_email: string | null;
    created_at: string;
    updated_at: string;
  }>(`${summarySelect} where id = $1`, [workbookId]);
  const workbook = rows[0];
  if (!workbook) return null;

  const auditLogs = await query<{
    id: string;
    workbook_id: string | null;
    action: string;
    summary: string;
    details: unknown;
    actor_email: string | null;
    created_at: string;
  }>(
    `select id, workbook_id, action, summary, details, actor_email, created_at
       from public.patient_bridge_workbook_audit_logs
      where workbook_id = $1
      order by created_at desc
      limit 50`,
    [workbookId]
  );

  return {
    ...summarizeWorkbook(workbook),
    audit_logs: auditLogs.map((log) => ({
      id: log.id,
      workbook_id: log.workbook_id,
      action: log.action,
      summary: log.summary,
      details: parseJsonRecord(log.details),
      actor_email: log.actor_email,
      created_at: log.created_at,
    })),
    preview: null,
  };
}

async function getWorkbookPreview(workbook: {
  storage_mode: string;
  graph_drive_id: string | null;
  graph_item_id: string | null;
}) {
  if (workbook.storage_mode !== "m365" || !workbook.graph_drive_id || !workbook.graph_item_id) {
    return null;
  }

  const [sheetsResponse, tablesResponse] = await Promise.all([
    graphJson<{ value: Array<{ id: string; name: string }> }>(
      `/drives/${workbook.graph_drive_id}/items/${workbook.graph_item_id}/workbook/worksheets`
    ),
    graphJson<{ value: Array<{ id: string; name: string }> }>(
      `/drives/${workbook.graph_drive_id}/items/${workbook.graph_item_id}/workbook/tables`
    ),
  ]);

  const tables = [];
  for (const table of tablesResponse.value.slice(0, 8)) {
    try {
      const range = await graphJson<{ address?: string; values?: Array<Array<string | null>> }>(
        `/drives/${workbook.graph_drive_id}/items/${workbook.graph_item_id}/workbook/tables/${table.id}/range`
      );
      tables.push({
        name: table.name,
        range_address: range.address ?? null,
        values: range.values ?? null,
      });
    } catch {
      tables.push({
        name: table.name,
        range_address: null,
        values: null,
      });
    }
  }

  const sheets = sheetsResponse.value.map((sheet) => ({
    name: sheet.name,
    used_range: null,
  }));

  return { sheets, tables };
}

async function uploadWorkbookToGraph(fileName: string, fileBytes: Buffer, folderPath: string) {
  const driveId = env.M365_GRAPH_DRIVE_ID;
  if (!driveId) {
    throw new Error("M365_GRAPH_DRIVE_ID is required to upload workbooks to Microsoft 365.");
  }

  const safeName = fileName.replace(/[^\w.\- ]+/g, "-").replace(/\s+/g, " ").trim() || `patientbridge-${Date.now()}.xlsx`;
  const uniqueName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName}`;
  const relativePath = folderPath ? `${folderPath}/${uniqueName}` : uniqueName;
  const createSessionPath = `/drives/${driveId}/root:/${encodeDrivePath(relativePath)}:/createUploadSession`;
  const session = await graphJson<{ uploadUrl: string }>(createSessionPath, {
    method: "POST",
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
        name: uniqueName,
      },
    }),
  });

  const chunkSize = 10 * 1024 * 1024;
  let offset = 0;
  while (offset < fileBytes.length) {
    const end = Math.min(offset + chunkSize, fileBytes.length);
    const chunk = fileBytes.subarray(offset, end);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${end - 1}/${fileBytes.length}`,
      },
      body: new Uint8Array(chunk) as unknown as BodyInit,
    });
    if (!(response.ok || response.status === 202)) {
      const body = await response.text();
      throw new Error(`Microsoft Graph upload failed (${response.status}): ${body.slice(0, 200)}`);
    }
    offset = end;
  }

  const uploadedItem = await graphJson<{
    id: string;
    name: string;
    webUrl: string;
    sharepointIds?: { siteId?: string | null };
  }>(`/drives/${driveId}/root:/${encodeDrivePath(relativePath)}`);

  const webUrl = uploadedItem.webUrl;
  const embedUrl = webUrl.includes("?")
    ? `${webUrl}&action=embedview&wdbipreview=true&wdAllowInteractivity=True`
    : `${webUrl}?action=embedview&wdbipreview=true&wdAllowInteractivity=True`;

  return {
    driveId,
    itemId: uploadedItem.id,
    webUrl,
    embedUrl,
    graphPath: relativePath,
    graphSiteId: uploadedItem.sharepointIds?.siteId ?? env.M365_GRAPH_SITE_ID ?? null,
  };
}

patientBridgeM365Router.get("/api/admin/patientbridge/m365/workbooks", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const workbooks = await loadWorkbookSummaryRows();
    await ensureWorkbookAudit(null, "workbook_listed", "Listed PatientBridge workbooks", { count: workbooks.length }, getRequestUser(req)?.email ?? null);
    res.json({ ok: true, workbooks: workbooks.map(summarizeWorkbook) });
  } catch (error) {
    next(error);
  }
});

patientBridgeM365Router.get("/api/admin/patientbridge/m365/workbooks/:workbookId", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const workbook = await loadWorkbookDetail(String(req.params.workbookId));
    if (!workbook) {
      return res.status(404).json({ ok: false, error: "Workbook not found." });
    }
    await ensureWorkbookAudit(workbook.id, "workbook_opened", `Opened ${workbook.name}`, { workbookId: workbook.id }, getRequestUser(req)?.email ?? null);
    res.json({ ok: true, workbook });
  } catch (error) {
    next(error);
  }
});

patientBridgeM365Router.get("/api/admin/patientbridge/m365/workbooks/:workbookId/preview", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      name: string;
      original_file_name: string;
      storage_mode: string;
      graph_site_id: string | null;
      graph_drive_id: string | null;
      graph_item_id: string | null;
      graph_path: string | null;
      graph_web_url: string | null;
      graph_embed_url: string | null;
      file_size_bytes: string | number | null;
      uploaded_by_email: string | null;
      created_at: string;
      updated_at: string;
    }>(`${summarySelect} where id = $1`, [String(req.params.workbookId)]);
    const workbook = rows[0];
    if (!workbook) {
      return res.status(404).json({ ok: false, error: "Workbook not found." });
    }
    const preview = await getWorkbookPreview(workbook);
    await ensureWorkbookAudit(workbook.id, "workbook_previewed", `Previewed ${workbook.name}`, { previewAvailable: Boolean(preview) }, getRequestUser(req)?.email ?? null);
    res.json({ ok: true, preview });
  } catch (error) {
    next(error);
  }
});

patientBridgeM365Router.post("/api/admin/patientbridge/m365/workbooks", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const payload = uploadSchema.parse(req.body);
    const actor = getRequestUser(req)?.email ?? null;
    const fileBytes = decodeWorkbookBytes(payload.fileBase64);
    const originalFileName = payload.fileName;
    const displayName = normalizeText(payload.displayName) ?? originalFileName.replace(/\.xlsx$/i, "");
    const folderPath = normalizeFolderPath(payload.folderPath) || normalizeFolderPath(env.M365_GRAPH_FOLDER_PATH);
    const source = payload.source ?? "upload";

    const graphConfigured = Boolean(env.M365_GRAPH_TENANT_ID && env.M365_GRAPH_CLIENT_ID && env.M365_GRAPH_CLIENT_SECRET && env.M365_GRAPH_DRIVE_ID);
    const graphMeta = graphConfigured
      ? await uploadWorkbookToGraph(originalFileName, fileBytes, folderPath)
      : null;

    const workbookId = randomUUID();
    const workbook = await withTransaction(async (client) => {
      const insertRows = await client.query<{
        id: string;
        name: string;
        original_file_name: string;
        storage_mode: string;
        graph_site_id: string | null;
        graph_drive_id: string | null;
        graph_item_id: string | null;
        graph_path: string | null;
        graph_web_url: string | null;
        graph_embed_url: string | null;
        file_size_bytes: string | number | null;
        uploaded_by_email: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `insert into public.patient_bridge_workbooks (
           id, name, original_file_name, storage_mode, graph_site_id, graph_drive_id, graph_item_id,
           graph_path, graph_web_url, graph_embed_url, file_size_bytes, uploaded_by_email
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id, name, original_file_name, storage_mode, graph_site_id, graph_drive_id, graph_item_id,
                   graph_path, graph_web_url, graph_embed_url, file_size_bytes, uploaded_by_email, created_at, updated_at`,
        [
          workbookId,
          displayName,
          originalFileName,
          graphMeta ? "m365" : "demo",
          graphMeta?.graphSiteId ?? env.M365_GRAPH_SITE_ID ?? null,
          graphMeta?.driveId ?? env.M365_GRAPH_DRIVE_ID ?? null,
          graphMeta?.itemId ?? null,
          graphMeta?.graphPath ?? null,
          graphMeta?.webUrl ?? null,
          graphMeta?.embedUrl ?? null,
          fileBytes.length,
          actor,
        ]
      );

      await client.query(
        `insert into public.patient_bridge_workbook_audit_logs (id, workbook_id, action, summary, details, actor_email)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          randomUUID(),
          workbookId,
          graphMeta ? "workbook_uploaded" : "workbook_staged",
          graphMeta ? "Uploaded workbook to Microsoft 365" : "Stored workbook metadata locally while Microsoft 365 is unavailable",
          JSON.stringify({
            fileName: originalFileName,
            displayName,
            folderPath,
            source,
            storageMode: graphMeta ? "m365" : "demo",
          }),
          actor,
        ]
      );

      return insertRows.rows[0];
    });

    const detail = await loadWorkbookDetail(workbook.id);
    res.status(201).json({ ok: true, workbook: detail });
  } catch (error) {
    next(error);
  }
});

patientBridgeM365Router.get("/api/admin/patientbridge/m365/workbooks/:workbookId/download", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      graph_drive_id: string | null;
      graph_item_id: string | null;
      graph_web_url: string | null;
      original_file_name: string;
    }>(
      `select id, graph_drive_id, graph_item_id, graph_web_url, original_file_name
         from public.patient_bridge_workbooks
        where id = $1`,
      [String(req.params.workbookId)]
    );
    const workbook = rows[0];
    if (!workbook) {
      return res.status(404).json({ ok: false, error: "Workbook not found." });
    }
    if (!workbook.graph_drive_id || !workbook.graph_item_id) {
      return res.status(409).json({ ok: false, error: "This workbook does not have Microsoft 365 storage yet." });
    }
    const item = await graphJson<{ "@microsoft.graph.downloadUrl"?: string }>(
      `/drives/${workbook.graph_drive_id}/items/${workbook.graph_item_id}?$select=@microsoft.graph.downloadUrl`
    );
    await ensureWorkbookAudit(workbook.id, "workbook_downloaded", `Downloaded ${workbook.original_file_name}`, {}, getRequestUser(req)?.email ?? null);
    res.json({ ok: true, downloadUrl: item["@microsoft.graph.downloadUrl"] ?? null });
  } catch (error) {
    next(error);
  }
});

patientBridgeM365Router.get("/api/admin/patientbridge/m365/workbooks/:workbookId/graph-preview", requireAuth, requireAnyRole("Admin"), async (req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      storage_mode: string;
      graph_drive_id: string | null;
      graph_item_id: string | null;
    }>(`select id, storage_mode, graph_drive_id, graph_item_id from public.patient_bridge_workbooks where id = $1`, [
      String(req.params.workbookId),
    ]);
    const workbook = rows[0];
    if (!workbook) {
      return res.status(404).json({ ok: false, error: "Workbook not found." });
    }
    const preview = await getWorkbookPreview(workbook);
    await ensureWorkbookAudit(workbook.id, "workbook_graph_previewed", "Read workbook tables and ranges", { previewAvailable: Boolean(preview) }, getRequestUser(req)?.email ?? null);
    res.json({ ok: true, preview });
  } catch (error) {
    next(error);
  }
});
