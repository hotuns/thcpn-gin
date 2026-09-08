import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  envDir: "../../..",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "../../node_modules/ezuikit-js/ezuikit_static", dest: "." },
        { src: "../../node_modules/cesium/Build/Cesium/{Workers,Assets,Widgets,ThirdParty}", dest: "cesium" },
      ],
    }),
    {
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
      },
    },
  ],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/admin": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
        ws: true,
      },
      "/api": apiTarget,
      "/healthz": apiTarget,
      "/readyz": apiTarget,
    },
  },
});
