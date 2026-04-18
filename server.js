import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, "dist");

app.use(express.static(distDir, { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Patient Finder web server listening on ${port}`);
});
