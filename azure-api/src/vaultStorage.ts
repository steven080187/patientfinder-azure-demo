import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function getVaultRootDir() {
  return path.join(os.tmpdir(), "patientfinder", "vault");
}

export async function writeVaultArtifact(input: {
  patientId: string;
  artifactType: string;
  fileName: string;
  buffer: Buffer;
}) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const dirPath = path.join(
    getVaultRootDir(),
    sanitizePathSegment(input.patientId),
    yyyy,
    mm,
    dd,
    sanitizePathSegment(input.artifactType)
  );
  await fs.mkdir(dirPath, { recursive: true });
  const storedFileName = `${now.toISOString().replace(/[:.]/g, "-")}_${randomUUID()}_${sanitizePathSegment(input.fileName)}`;
  const fullPath = path.join(dirPath, storedFileName);
  await fs.writeFile(fullPath, input.buffer);
  return {
    storageProvider: "local_fs",
    storageContainer: "vault",
    storageBlobPath: path.relative(getVaultRootDir(), fullPath).replace(/\\/g, "/"),
    byteSize: input.buffer.byteLength,
  };
}

export function getVaultAbsolutePathFromBlobPath(blobPath: string) {
  return path.join(getVaultRootDir(), blobPath);
}
