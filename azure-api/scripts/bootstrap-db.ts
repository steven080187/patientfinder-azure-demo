import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execute, pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(repoRoot, "sql", "001_bootstrap_schema.sql");

async function main() {
  const schemaSql = await fs.readFile(schemaPath, "utf8");
  await execute(schemaSql);
  console.log(`Applied schema from ${schemaPath}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
