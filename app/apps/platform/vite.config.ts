import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "admin-trailing-slash",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/admin") {
          response.statusCode = 302;
          response.setHeader("Location", "/admin/");
          response.end();
          return;
        }
        next();
      });
    }
  }],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/admin": { target: "http://127.0.0.1:5174", changeOrigin: true, ws: true },
      "/api": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
      "/readyz": "http://127.0.0.1:8080"
    }
  }
});
