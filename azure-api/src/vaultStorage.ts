import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { uploadVaultArtifact } from "./blobStorage.js";
import { env } from "./config.js";

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function getVaultRootDir() {
  return path.join(os.homedir(), ".patientfinder", "vault");
}

export async function writeVaultArtifact(input: {
  patientId: string;
  artifactType: string;
  fileName: string;
  buffer: Buffer;
}) {
  if (env.AZURE_BLOB_CONNECTION_STRING) {
    try {
      const uploaded = await uploadVaultArtifact({
        patientId: input.patientId,
        artifactType: input.artifactType,
        originalFileName: input.fileName,
        fileBuffer: input.buffer,
        contentType: guessVaultContentType(input.fileName),
      });
      return {
        storageProvider: "azure_blob",
        storageContainer: uploaded.containerName,
        storageBlobPath: uploaded.blobName,
        storageUrl: uploaded.blobUrl,
        byteSize: input.buffer.byteLength,
      };
    } catch (error) {
      console.warn("Falling back to local vault storage after blob upload failed:", error instanceof Error ? error.message : error);
    }
  }

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
    storageUrl: null,
    byteSize: input.buffer.byteLength,
  };
}

function guessVaultContentType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function getVaultAbsolutePathFromBlobPath(blobPath: string) {
  return path.join(getVaultRootDir(), blobPath);
}
