import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execute, pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function main() {
  const sqlDir = path.join(repoRoot, "sql");
  const schemaFiles = (await fs.readdir(sqlDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of schemaFiles) {
    const filePath = path.join(sqlDir, file);
    const schemaSql = await fs.readFile(filePath, "utf8");
    await execute(schemaSql);
    console.log(`Applied schema from ${filePath}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
