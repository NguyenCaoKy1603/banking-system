import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function resolveAdminApiUpstream(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("ADMIN_API_UPSTREAM is required for the Vite development proxy.");
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("ADMIN_API_UPSTREAM must be an absolute HTTP(S) origin."); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("ADMIN_API_UPSTREAM must be an origin without credentials, path, query or fragment.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export default defineConfig(({ command, mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const upstream = command === "serve"
    ? resolveAdminApiUpstream(process.env.ADMIN_API_UPSTREAM ?? fileEnv.ADMIN_API_UPSTREAM)
    : undefined;
  return {
    plugins: [react()],
    server: upstream ? {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: upstream,
          changeOrigin: false,
          secure: upstream.startsWith("https:"),
          proxyTimeout: 15_000,
          timeout: 15_000,
        },
      },
    } : undefined,
    build: { outDir: "dist", sourcemap: false },
  };
});
