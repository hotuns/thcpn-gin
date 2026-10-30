import { Navigate, Outlet, useLocation } from "react-router-dom";
import { platformHomePath, platformPathAvailable } from "./features";

export function EditionRoute() {
  const { pathname } = useLocation();
  return platformPathAvailable(pathname) ? <Outlet /> : <Navigate to={platformHomePath} replace />;
}
