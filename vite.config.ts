import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const env = loadEnv(mode, process.cwd(), "");
  const devProxyTarget = env.VITE_DEV_AZURE_PROXY_TARGET ?? "https://pfsbx-api-0412346.azurewebsites.net";
  const allowedHosts = [".ngrok-free.dev", ".trycloudflare.com", ".ts.net"];

  return {
    plugins: [react()],
    server: {
      ...(isDev ? { allowedHosts } : {}),
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: true,
        },
        "/health": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    preview: {
      allowedHosts,
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: true,
        },
        "/health": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
