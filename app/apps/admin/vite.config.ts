import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5174, proxy: { "/api": "http://127.0.0.1:8080", "/healthz": "http://127.0.0.1:8080", "/readyz": "http://127.0.0.1:8080" } }
});
