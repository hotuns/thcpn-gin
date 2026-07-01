import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { ProtectedRoute, PublicOnlyRoute } from "./RouteGuards";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LoginPage, RegisterPage } from "../features/auth/AuthPages";
import { MembersPage } from "../features/members/MembersPage";
import { SecurityPage } from "../features/security/SecurityPage";
import { WorkspacesPage } from "../features/workspaces/WorkspacesPage";
import {
  AccessGrantsPage,
  AuditLogsPage,
  DataSourcesPage,
  DataStreamsPage,
  DatasetsPage,
  DevicesPage,
  ExportJobsPage,
  InvitationsPage,
  ProjectsPage,
  SitesPage
} from "../features/resources/ResourcePages";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route element={<LoginPage />} path="/login" />
        <Route element={<RegisterPage />} path="/register" />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route element={<Navigate replace to="/dashboard" />} index />
          <Route element={<DashboardPage />} path="/dashboard" />
          <Route element={<WorkspacesPage />} path="/workspaces" />
          <Route element={<MembersPage />} path="/members" />
          <Route element={<SecurityPage />} path="/security" />
          <Route element={<ProjectsPage />} path="/projects" />
          <Route element={<SitesPage />} path="/sites" />
          <Route element={<DevicesPage />} path="/devices" />
          <Route element={<DataStreamsPage />} path="/data-streams" />
          <Route element={<DataSourcesPage />} path="/data-sources" />
          <Route element={<DatasetsPage />} path="/datasets" />
          <Route element={<ExportJobsPage />} path="/export-jobs" />
          <Route element={<AccessGrantsPage />} path="/access-grants" />
          <Route element={<InvitationsPage />} path="/invitations" />
          <Route element={<AuditLogsPage />} path="/audit-logs" />
        </Route>
      </Route>

      <Route element={<Navigate replace to="/dashboard" />} path="/" />
      <Route element={<Navigate replace to="/dashboard" />} path="*" />
    </Routes>
  );
}
