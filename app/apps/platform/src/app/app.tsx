import { formatApiError } from "@thcpn/api";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspacesPage } from "../features/workspaces/workspaces-page";
import { useSystemPolicy } from "../shared/config/system-policy";
import { Button, StateView } from "../shared/ui";
import { RequirePlatform, RootRedirect } from "./route-guards";
import { Shell } from "./shell";
import { DataHubPage, MorePage } from "./mobile-pages";

const DevicesPage = lazy(() =>
  import("../features/devices/devices-page").then((module) => ({ default: module.DevicesPage })),
);
const DeviceClaimPage = lazy(() =>
  import("../features/devices/device-claim-page").then((module) => ({ default: module.DeviceClaimPage })),
);
const DeviceMapPage = lazy(() => import("../features/devices/device-map-page").then((module) => ({ default: module.DeviceMapPage })));
const DeviceCenterDetailPage = lazy(() =>
  import("../features/devices/device-center-detail-page").then((module) => ({
    default: module.DeviceCenterDetailPage,
  })),
);
const LegacyDeviceDataRedirect = lazy(() =>
  import("../features/devices/legacy-device-data-redirect").then((module) => ({
    default: module.LegacyDeviceDataRedirect,
  })),
);
const DatasetsPage = lazy(() =>
  import("../features/datasets/datasets-page").then((module) => ({
    default: module.DatasetsPage,
  })),
);
const DatasetDetailPage = lazy(() =>
  import("../features/datasets/dataset-detail-page").then((module) => ({
    default: module.DatasetDetailPage,
  })),
);
const DatasetEditorPage = lazy(() =>
  import("../features/datasets/dataset-editor-page").then((module) => ({
    default: module.DatasetEditorPage,
  })),
);
const ExportsPage = lazy(() =>
  import("../features/exports/exports-page").then((module) => ({ default: module.ExportsPage })),
);
const ExportEditorPage = lazy(() =>
  import("../features/exports/export-editor-page").then((module) => ({ default: module.ExportEditorPage })),
);
const ProcessingPage = lazy(() => import("../features/processing/processing-page").then((module) => ({ default: module.ProcessingPage })));
const ProcessingTaskDetailPage = lazy(() => import("../features/processing/processing-page").then((module) => ({ default: module.ProcessingTaskDetailPage })));
const AtlasPage = lazy(() => import("../features/atlas/atlas-page").then((module) => ({ default: module.AtlasPage })));
const DigitalPlotPage = lazy(() => import("../features/digital-plot/digital-plot-page").then((module) => ({ default: module.DigitalPlotPage })));
const DataComparisonPage = lazy(() =>
  import("../features/comparison/data-comparison-page").then((module) => ({
    default: module.DataComparisonPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/settings").then((module) => ({ default: module.SettingsPage })),
);
const SubscriptionPage = lazy(() =>
  import("../features/subscription/subscription-page").then((module) => ({ default: module.SubscriptionPage })),
);
const NotificationsPage = lazy(() =>
  import("../features/notifications/notifications-page").then((module) => ({ default: module.NotificationsPage })),
);
const AlertsPage = lazy(() => import("../features/alerts/alerts-page").then((module) => ({ default: module.AlertsPage })));
const AccountPage = lazy(() =>
  import("../features/account/account-page").then((module) => ({ default: module.AccountPage })),
);
const AuthPage = lazy(() =>
  import("../features/auth/auth-pages").then((module) => ({ default: module.AuthPage })),
);
const DashboardPage = lazy(() =>
  import("../features/dashboard/dashboard-page").then((module) => ({
    default: module.DashboardPage,
  })),
);
const PublicDevicePage = lazy(() =>
  import("../features/devices/public-device-page").then((module) => ({ default: module.PublicDevicePage })),
);

export function PlatformApp() {
  const policy = useSystemPolicy();
  const billingEnabled=policy.data?.billing_enabled;
  if (policy.isPending) return <div className="app-loading">正在加载系统配置…</div>;
  if (!policy.data) return <div className="app-loading"><StateView type="error" title="系统配置加载失败" description={formatApiError(policy.error).message} /><Button onClick={() => void policy.refetch()}>重试</Button></div>;
  return (
    <Suspense fallback={<div className="app-loading t-shimmer" data-text="正在加载页面…">正在加载页面…</div>}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/demo-login" element={<Navigate to="/login?demo=1" replace />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route path="/public/devices/:publicSlug" element={<PublicDevicePage />} />
        <Route element={<RequirePlatform />}>
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/data" element={<DataHubPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/device-map" element={<DeviceMapPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/claim" element={<DeviceClaimPage />} />
            <Route path="/claim/:claimSlug" element={<DeviceClaimPage />} />
            <Route
              path="/devices/:deviceId"
              element={<DeviceCenterDetailPage />}
            />
            <Route path="/device-data" element={<LegacyDeviceDataRedirect />} />
            <Route path="/data-compare" element={<DataComparisonPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/datasets/new" element={<DatasetEditorPage />} />
            <Route
              path="/datasets/:datasetId/edit"
              element={<DatasetEditorPage />}
            />
            <Route
              path="/datasets/:datasetId"
              element={<DatasetDetailPage />}
            />
            <Route path="/exports" element={<ExportsPage key="export-list" />} />
            <Route path="/exports/new" element={<ExportEditorPage />} />
            <Route path="/processing" element={<ProcessingPage />} />
            <Route path="/processing/:taskId" element={<ProcessingTaskDetailPage />} />
            <Route path="/atlas" element={<AtlasPage />} />
            <Route path="/atlas/topics/digital-plot" element={<DigitalPlotPage />} />
            <Route path="/atlas/:id" element={<AtlasPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {billingEnabled ? (
              <Route path="/subscription" element={<SubscriptionPage />} />
            ) : null}
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="*" element={<RootRedirect />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
