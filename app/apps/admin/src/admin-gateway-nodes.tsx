import { Navigate, useParams } from "react-router-dom";
// Preserve old bookmarks while removing the extra workbench navigation layer.
export function AdminGatewayNodesPage(){const {deviceId}=useParams();return <Navigate replace to={`/admin/devices/${deviceId}?tab=nodes`}/>;}
