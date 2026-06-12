import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, "dist");
const localApiBaseUrl = String(process.env.LOCAL_API_PROXY_TARGET || "http://127.0.0.1:3001").trim().replace(/\/+$/, "");

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function proxyToLocalApi(req, res, next) {
  if (!req.path.startsWith("/api/") && req.path !== "/health") return next();

  try {
    const targetUrl = new URL(req.originalUrl, localApiBaseUrl);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      const lower = key.toLowerCase();
      if (["host", "connection", "content-length"].includes(lower)) continue;
      if (Array.isArray(value)) {
        headers.set(key, value.join(","));
      } else {
        headers.set(key, value);
      }
    }

    const init = {
      method: req.method,
      headers,
      redirect: "manual",
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = await readRequestBody(req);
      if (body.length) {
        init.body = body;
      }
    }

    const response = await fetch(targetUrl, init);
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (["transfer-encoding", "content-encoding", "content-length", "connection"].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    next(error);
  }
}

app.use(proxyToLocalApi);
app.use(express.static(distDir, { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`patientfinder web server listening on ${port}`);
});
