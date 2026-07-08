import { Navigate, Route, Routes } from "react-router-dom";
import { AdminShell } from "./AdminShell";
import { AppShell } from "./AppShell";
import { AdminRouteGuard, ProtectedRoute, PublicOnlyRoute, RootRedirect } from "./RouteGuards";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LoginPage, RegisterPage } from "../features/auth/AuthPages";
import { AdminDataSourcesPage, AdminDeviceAssetsPage, AdminOverviewPage } from "../features/admin/AdminPages";
import { SettingsPage } from "../features/settings/SettingsPage";
import { DeviceDataPage } from "../features/telemetry/DeviceDataPage";
import { WorkspacesPage } from "../features/workspaces/WorkspacesPage";
import {
  DataStreamsPage,
  DatasetsPage,
  DevicesPage,
  ExportJobsPage,
} from "../features/resources/ResourcePages";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route element={<LoginPage />} path="/login" />
        <Route element={<RegisterPage />} path="/register" />
      </Route>

      <Route element={<AdminRouteGuard />} path="/admin">
        <Route element={<AdminShell />}>
          <Route element={<AdminOverviewPage />} index />
          <Route element={<AdminDataSourcesPage />} path="data-sources" />
          <Route element={<AdminDeviceAssetsPage />} path="devices" />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route element={<Navigate replace to="/dashboard" />} index />
          <Route element={<DashboardPage />} path="/dashboard" />
          <Route element={<WorkspacesPage />} path="/workspaces" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<Navigate replace to="/settings?tab=members" />} path="/members" />
          <Route element={<Navigate replace to="/settings?tab=account" />} path="/security" />
          <Route element={<Navigate replace to="/settings?tab=basics" />} path="/projects" />
          <Route element={<Navigate replace to="/settings?tab=basics" />} path="/sites" />
          <Route element={<DevicesPage />} path="/devices" />
          <Route element={<DataStreamsPage />} path="/data-streams" />
          <Route element={<DeviceDataPage />} path="/device-data" />
          <Route element={<DatasetsPage />} path="/datasets" />
          <Route element={<ExportJobsPage />} path="/export-jobs" />
          <Route element={<Navigate replace to="/settings?tab=grants" />} path="/access-grants" />
          <Route element={<Navigate replace to="/settings?tab=invitations" />} path="/invitations" />
          <Route element={<Navigate replace to="/settings?tab=audit" />} path="/audit-logs" />
        </Route>
      </Route>

      <Route element={<RootRedirect />} path="/" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}
