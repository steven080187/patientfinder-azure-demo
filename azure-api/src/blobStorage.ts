import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";
import { env } from "./config.js";

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

let blobServiceClient: BlobServiceClient | null = null;

function getBlobServiceClient() {
  if (!env.AZURE_BLOB_CONNECTION_STRING) {
    throw new Error("AZURE_BLOB_CONNECTION_STRING is not configured.");
  }
  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(env.AZURE_BLOB_CONNECTION_STRING);
  }
  return blobServiceClient;
}

export async function uploadPatientDocumentPdf(input: {
  patientId: string;
  documentType: string;
  originalFileName: string;
  fileBuffer: Buffer;
}) {
  const service = getBlobServiceClient();
  const containerName = sanitizeSegment(env.AZURE_BLOB_CONTAINER_NAME);
  const containerClient = service.getContainerClient(containerName);
  await containerClient.createIfNotExists();

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const timestamp = now.toISOString().replace(/[:.]/g, "-");

  const extension = input.originalFileName.toLowerCase().endsWith(".pdf") ? ".pdf" : ".pdf";
  const blobName = [
    sanitizeSegment(env.AZURE_BLOB_BASE_PATH),
    yyyy,
    mm,
    dd,
    sanitizeSegment(input.patientId),
    sanitizeSegment(input.documentType.toLowerCase()),
    `${timestamp}_${randomUUID()}${extension}`,
  ].join("/");

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(input.fileBuffer, {
    blobHTTPHeaders: {
      blobContentType: "application/pdf",
    },
  });

  return {
    containerName,
    blobName,
    blobUrl: blockBlobClient.url,
  };
}

export async function downloadBlobToBuffer(input: { containerName: string; blobName: string }) {
  const service = getBlobServiceClient();
  const containerClient = service.getContainerClient(input.containerName);
  const blobClient = containerClient.getBlobClient(input.blobName);
  const response = await blobClient.download();
  if (!response.readableStreamBody) {
    throw new Error("Blob download stream was empty.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function downloadBlobStream(input: { containerName: string; blobName: string }) {
  const service = getBlobServiceClient();
  const containerClient = service.getContainerClient(input.containerName);
  const blobClient = containerClient.getBlobClient(input.blobName);
  const response = await blobClient.download();
  if (!response.readableStreamBody) {
    throw new Error("Blob download stream was empty.");
  }

  return {
    readableStreamBody: response.readableStreamBody,
    contentLength: response.contentLength ?? null,
    contentType: response.contentType ?? null,
  };
}

export async function deleteBlobIfExists(input: { containerName: string; blobName: string }) {
  const service = getBlobServiceClient();
  const containerClient = service.getContainerClient(input.containerName);
  const blobClient = containerClient.getBlobClient(input.blobName);
  await blobClient.deleteIfExists();
}
