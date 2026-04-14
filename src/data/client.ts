import { azureApiDataClient } from "./azureApiDataClient";
import type { BackendProvider, DataClient } from "./types";

export function getBackendProvider(): BackendProvider {
  return "azure-api";
}

export function getDataClient(): DataClient {
  return azureApiDataClient;
}
