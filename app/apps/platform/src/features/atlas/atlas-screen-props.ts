import type { ReactNode } from "react";
import type { AtlasConfig, DeviceMapItem } from "@thcpn/api";

/** Shared data/interaction contract; each template owns its entire visual composition. */
export type AtlasScreenProps = {
  title: string;
  workspaceId: string;
  boardId?: string;
  config: AtlasConfig;
  devices: DeviceMapItem[];
  selectedDevice?: DeviceMapItem;
  selectedNodeKey: string;
  kind: string;
  onKindChange: (kind: string) => void;
  onSelect: (id: string) => void;
  onSelectNode: (key: string) => void;
  map: ReactNode;
  settings?: ReactNode;
  warning?: ReactNode;
  canManage: boolean;
  onEdit: () => void;
  onBack: () => void;
  presenting: boolean;
  onFullscreen: () => void;
  motion: { enabled: boolean; paused: boolean; reduced: boolean; toggle: () => void };
};
