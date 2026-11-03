import { setWorkerUrl } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/reset.css";
import "@thcpn/ui/styles.css";
import "./styles/scale.css";
import "./styles/platform.css";
import "./styles/shadcn.css";
import "./styles/platform-refinement.css";
import "./styles/mobile.css";
import { PlatformApp } from "./app/app";
import { AppProviders } from "./app/providers";

// Bundle the MapLibre v6 worker and its shared chunk before any map mounts.
setWorkerUrl(mapWorkerUrl);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <PlatformApp />
    </AppProviders>
  </StrictMode>,
);
