import { DeviceCombobox } from "../../shared/data/device-combobox";
import { usePolicyLimit } from "../../shared/config/system-policy";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { hongliulin } from "../digital-plot/digital-plot-imagery";
import { useObservatoryMotion } from "../../shared/observatory/observatory-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  Copy,
  Trash2,
  Layers3,
  RefreshCw,
  Save,
  Settings2,
} from "lucide-react";
import {
  api,
  formatApiError,
  type DeviceMapItem,
  type AtlasView,
} from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextInput,
  SearchInput,
  SelectInput,
  Switch,
} from "../../shared/ui";
import { AtlasEmpty, AtlasError } from "./atlas-device";
import { Card } from "../../shared/ui/primitives/card";
import {
  ATLAS_TEMPLATE,
  defaultAtlasConfig,
  filterDevices,
  type AtlasConfig,
} from "./atlas-model";
import { AtlasMetricDefaultsEditor } from "./atlas-metric-settings";
import { EcoScreen } from "./eco-screen";
import { ResearchScreen } from "./research-screen";
import { ExpeditionScreen } from "./expedition-screen";
import type { AtlasScreenProps } from "./atlas-screen-props";
import "./atlas.css";
import "./atlas-templates.css";
import "../../shared/observatory/observatory.css";
import "../../shared/observatory/observatory-decoration.css";
import "./atlas-management.css";
import {
  atlasTemplate,
  atlasTemplates,
  AtlasTemplatePreview,
  AtlasTemplateChoices,
  type AtlasPresentation,
} from "./atlas-templates";

const AtlasMap = lazy(() =>
  import("./atlas-map").then((m) => ({ default: m.AtlasMap })),
);
export function AtlasPage() {
  const { currentId } = useWorkspace();
  const { id } = useParams();
  const { t } = useLocale();
  return currentId ? (
    id ? (
      <AtlasWorkspace
        key={`${currentId}:${id ?? "default"}`}
        workspaceId={currentId}
        id={id}
      />
    ) : (
      <AtlasHome key={currentId} workspaceId={currentId} />
    )
  ) : (
    <AtlasEmpty text={t("atlas.noWorkspace")} />
  );
}

function AtlasHome({ workspaceId }: { workspaceId: string }) {
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [section, setSection] = useState("views");
  const [viewSearch, setViewSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [creating, setCreating] = useState<AtlasPresentation>();
  const [editing, setEditing] = useState<AtlasView>();
  const [copying, setCopying] = useState<AtlasView>();
  const [deleting, setDeleting] = useState<AtlasView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await api.atlas.archive(workspaceId, deleting.id);
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(workspaceId, "atlas", "views"),
      });
      setDeleting(undefined);
    } catch (e) {
      setError(formatApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const boards = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "views"),
    queryFn: () => api.atlas.list(workspaceId),
    staleTime: 30000,
    retry: false,
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "map"),
    queryFn: () => api.devices.map(workspaceId),
    enabled: boards.data?.can_manage === true,
    staleTime: 60000,
    retry: false,
  });
  const saved =
    boards.data?.items.filter(
      (view) =>
        view.status === "active" && view.template_code === ATLAS_TEMPLATE,
    ) ?? [];
  const matching = saved.filter(view =>
    `${view.name} ${view.config.description ?? ""}`.toLocaleLowerCase().includes(viewSearch.toLocaleLowerCase()) &&
    (templateFilter === "all" || atlasTemplate(view.config.presentation).id === templateFilter));
  return (
    <div className="atlas-home atlas-management">
      <header className="atlas-home-heading">
        <div>
          <span className="atlas-management-eyebrow">ECOLOGICAL OBSERVATION</span>
          <h1>{a("manageTitle")}</h1>
          <p>{a("manageHint")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            void client.invalidateQueries({
              queryKey: workspaceQueryKey(workspaceId, "atlas"),
            })
          }
        >
          <RefreshCw size={15} />
          {a("refresh")}
        </Button>
      </header>
      {boards.isLoading && <AtlasEmpty text={a("loading")} />}
      {boards.data?.can_manage && devices.isLoading && (
        <p role="status">{a("loading")}</p>
      )}
      {boards.error && (
        <AtlasError error={boards.error} retry={() => void boards.refetch()} />
      )}
      {devices.error && (
        <AtlasError
          error={devices.error}
          retry={() => void devices.refetch()}
        />
      )}
      {boards.data && !boards.data.can_manage && (
        <p className="atlas-home-note">{a("readOnlyHint")}</p>
      )}
      <nav className="atlas-management-tabs" aria-label={a("title")}>
        {[["views", "myViews", saved.length], ["templates", "templates", atlasTemplates.length], ["topics", "topics", 1]].map(([key, label, count]) => <Button key={key} variant="ghost" aria-pressed={section === key} onClick={() => setSection(String(key))}>{a(String(label))}<span>{count}</span></Button>)}
      </nav>
      <div hidden={section !== "topics"}>
      <section className="atlas-custom-showcase" aria-labelledby="atlas-custom-title">
        <div><span id="atlas-custom-title">{t("digitalPlot.category")}</span><h2>{t("digitalPlot.title")}</h2><p>{t("digitalPlot.description")}</p><Button onClick={() => navigate("/atlas/topics/digital-plot")}>{t("digitalPlot.enter")} ↗</Button></div>
        <img src={hongliulin.preview} alt="" />
        <span className="atlas-custom-badge">{t("digitalPlot.demo")}</span>
      </section>
      </div>
      <div hidden={section !== "templates"}>
      <ol className="atlas-creation-steps" aria-label={a("creationSteps")}>
        {["chooseTemplate", "configure", "save"].map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            {a(step)}
          </li>
        ))}
      </ol>
      <section
        aria-label={a("chooseTemplate")}
        className="atlas-home-templates"
      >
        {atlasTemplates.map((template) => (
          <Card key={template.id} className="atlas-home-template">
            <AtlasTemplatePreview id={template.id} />
            <div>
              <h2>{a(template.titleKey)}</h2>
              <p>{a(template.descriptionKey)}</p>
              <Button
                aria-label={`${a("useTemplate")} · ${a(template.titleKey)}`}
                disabled={
                  !boards.data?.can_manage || !devices.data || devices.isError
                }
                onClick={() => setCreating(template.id)}
              >
                <Settings2 size={15} />
                {a("useTemplate")}
              </Button>
            </div>
          </Card>
        ))}
      </section>
      </div>
      <section hidden={section !== "views"} className="atlas-home-saved" aria-labelledby="atlas-saved-title">
        <header>
          <h2 id="atlas-saved-title">{a("myViews")}</h2>
          <span>{saved.length}</span>
        </header>
        <div className="atlas-management-toolbar">
          <SearchInput aria-label={a("searchViews")} placeholder={a("searchViews")} value={viewSearch} onChange={event => setViewSearch(event.target.value)} />
          <SelectInput aria-label={a("displayTemplate")} value={templateFilter} onChange={event => setTemplateFilter(event.target.value)}><option value="all">{a("displayTemplate")} · {a("allTypes")}</option>{atlasTemplates.map(template => <option key={template.id} value={template.id}>{a(template.titleKey)}</option>)}</SelectInput>
          {boards.data?.can_manage && <Button onClick={() => setSection("templates")}><Plus size={16} />{a("newView")}</Button>}
        </div>
        {boards.data && !saved.length && (
          <Card className="atlas-home-empty">
            <Layers3 size={24} />
            <strong>{a("noSavedViews")}</strong>
            <p>{a("noSavedViewsHint")}</p>
          </Card>
        )}
        {saved.length > 0 && !matching.length && <AtlasEmpty text={a("noMatchingViews")} />}
        <div className="atlas-saved-grid">
          {matching.map((view) => (
            <Card key={view.id} className="atlas-saved-card">
              <AtlasTemplatePreview
                id={atlasTemplate(view.config.presentation).id}
              />
              <div>
                <span>
                  {a(atlasTemplate(view.config.presentation).titleKey)}
                </span>
                <h3>{view.name}</h3>
                {view.config.description && <p>{view.config.description}</p>}
                <small>{a("savedAt")} {new Date(view.updated_at).toLocaleDateString()}</small>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/atlas/${view.id}`)}
                >
                  {a("openView")}
                </Button>
                {boards.data?.can_manage && (
                  <Button
                    variant="ghost"
                    disabled={!devices.data || devices.isError}
                    onClick={() => setEditing(view)}
                  >
                    <Settings2 size={15} />
                    {a("configure")}
                  </Button>
                )}
                {boards.data?.can_manage && <div className="atlas-management-card-actions">
                  <Button variant="ghost" disabled={!devices.data} onClick={() => { setCreating(atlasTemplate(view.config.presentation).id); setCopying(view); }}><Copy size={14} />{a("saveAs")}</Button>
                  <Button variant="ghost" onClick={() => { setDeleting(view); setError(""); }}><Trash2 size={14} />{a("delete")}</Button>
                </div>}
              </div>
            </Card>
          ))}
        </div>
      </section>
      {(creating || editing) && boards.data?.can_manage && devices.data && (
        <AtlasSettings
          workspaceId={workspaceId}
          board={editing}
          initialName={copying ? `${copying.name} · ${a("saveAs")}` : undefined}
          initialConfig={
            editing?.config ?? copying?.config ?? {
              ...defaultAtlasConfig,
              presentation: creating ?? defaultAtlasConfig.presentation,
            }
          }
          devices={devices.data.items.filter(device => !device.gateway_device_id)}
          selectedMetrics={[]}
          onClose={() => {
            setCreating(undefined);
            setEditing(undefined);
            setCopying(undefined);
          }}
          onDelete={
            editing
              ? () => {
                  setDeleting(editing);
                  setEditing(undefined);
                  setError("");
                }
              : undefined
          }
          onSaved={async (view) => {
            client.setQueryData(
              workspaceQueryKey(workspaceId, "atlas", "view", view.id),
              view,
            );
            await client.invalidateQueries({
              queryKey: workspaceQueryKey(workspaceId, "atlas", "views"),
            });
            navigate(`/atlas/${view.id}`);
          }}
        />
      )}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && !busy && setDeleting(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{a("confirmDelete")}</DialogTitle>
            <DialogDescription>{a("deleteHint")}</DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              {a("cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              {a("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function AtlasWorkspace({
  workspaceId,
  id,
}: {
  workspaceId: string;
  id?: string;
}) {
  const motion = useObservatoryMotion();
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const navigate = useNavigate();
  const client = useQueryClient();
  // Open with real observations ready; an explicit map reset can still clear focus.
  const [selection, setSelection] = useState<string | null>(null);
  const [kind, setKind] = useState("all");
  const [editingScreen, setEditingScreen] = useState(false);
  const [nodeKey, setNodeKey] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [reset, setReset] = useState(0);
  const devices = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "map"),
    queryFn: () => api.devices.map(workspaceId),
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  });
  const board = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "view", id ?? ""),
    queryFn: () => api.atlas.get(workspaceId, id!),
    enabled: Boolean(id),
    retry: false,
  });
  const views = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "views"),
    queryFn: () => api.atlas.list(workspaceId),
    staleTime: 30000,
  });
  const config: AtlasConfig = {
    ...defaultAtlasConfig,
    ...board.data?.config,
  };
  const template = atlasTemplate(config.presentation);
  const rows = devices.data?.items ?? [];
  const scoped = useMemo(
    () => filterDevices(rows, config.device_ids ?? [], "", "all"),
    [devices.data, board.data],
  );
  const visible = filterDevices(scoped, [], "", "all").filter(device =>
    kind === "all" || (kind === "network" ? ["gateway", "gateway_node"].includes(device.device_type) : device.device_type === kind));
  const selected =
    scoped.find((d) => d.device_id === selection) ??
    (selection === "" ? undefined : visible[0]);
  const selectedGateway = selected?.gateway_device_id ? rows.find(device => device.device_id === selected.gateway_device_id) : undefined;
  const inspectorDevice = selectedGateway ?? selected;
  const activeNodeKey = nodeKey ?? (selected?.gateway_device_id && selected.node_index != null ? `gateway:${selected.gateway_device_id}:node:${selected.node_index}` : "gateway");
  const onSelect = useCallback((next: string) => {
    setSelection(next);
    setNodeKey(null);
  }, []);
  useEffect(() => {
    document.body.classList.add("atlas-route");
    return () => {
      document.body.classList.remove("atlas-route");
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!present) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPresent(false);
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => {});
      }
    };
    const sync = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("fullscreenchange", sync);
    };
  }, [present]);
  const toggleFullscreen = async () => {
    if (present) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setPresent(false);
    } else {
      setPresent(true);
      // Embedded browsers may not support native fullscreen; retain the full-window view.
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        /* full-window fallback */
      }
    }
  };
  if (
    id &&
    (board.isLoading ||
      !board.data ||
      board.data.status !== "active" ||
      board.data.template_code !== ATLAS_TEMPLATE)
  )
    return (
      <section className="atlas-shell">
        {board.error ? (
          <AtlasError error={board.error} retry={() => void board.refetch()} />
        ) : (
          <AtlasEmpty
            text={board.isLoading ? a("loading") : a("viewUnavailable")}
          />
        )}
        <Button onClick={() => navigate("/atlas")}>{a("back")}</Button>
      </section>
    );
  const onSelectNode = (key: string) => {
    if (inspectorDevice && scoped.some(device => device.device_id === inspectorDevice.device_id)) setSelection(inspectorDevice.device_id);
    setNodeKey(key);
  };
  const settingsDialog = editingScreen && views.data?.can_manage ? <AtlasSettings workspaceId={workspaceId} board={board.data} initialConfig={config} devices={rows.filter(device => !device.gateway_device_id)} selectedMetrics={[]} onClose={() => setEditingScreen(false)} onSaved={async view => {
    client.setQueryData(workspaceQueryKey(workspaceId, "atlas", "view", view.id), view);
    await client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "atlas", "views") });
    setEditingScreen(false);
    if (view.id !== id) navigate(`/atlas/${view.id}`);
  }} /> : null;
  const Screen = template.id === "deep-blue" ? EcoScreen : template.id === "technology" ? ResearchScreen : ExpeditionScreen;
  const appearance = template.id === "technology" ? "research" : template.id === "panorama" ? "expedition" : "deep-blue";
  const screenProps: AtlasScreenProps = {
    title: board.data?.name ?? a("defaultName"), workspaceId, boardId: id, config,
    devices: scoped, selectedDevice: inspectorDevice, selectedNodeKey: activeNodeKey, kind,
    onKindChange: kind => { setKind(kind); setSelection(null); setNodeKey(null); },
    onSelect, onSelectNode, canManage: views.data?.can_manage === true,
    onEdit: () => setEditingScreen(true), onBack: () => navigate("/atlas"), motion,
    presenting: present, onFullscreen: () => void toggleFullscreen(), settings: settingsDialog,
    warning: devices.error ? formatApiError(devices.error).message : undefined,
    map: <MapBoundary fallback={<AtlasEmpty text={a("mapUnavailable")} />}><Suspense fallback={<div role="status">{a("loading")}</div>}>
      <AtlasMap appearance={appearance} workspaceId={workspaceId} panorama={template.id !== "technology"}
        points={selectedGateway && !visible.some(device => device.device_id === selectedGateway.device_id) ? [...visible, selectedGateway] : visible}
        networkDevices={rows} selectedId={inspectorDevice?.device_id ?? ""} selectedNodeKey={activeNodeKey}
        onSelect={onSelect} onSelectNode={onSelectNode} motionEnabled={motion.enabled}
        reset={reset} onReset={() => { onSelect(""); setReset(value => value + 1); }} />
    </Suspense></MapBoundary>,
  };
  return <Screen {...screenProps} />;
}

function AtlasSettings({
  workspaceId,
  board,
  initialConfig,
  devices,
  selectedMetrics,
  initialName,
  onClose,
  onSaved,
  onDelete,
}: {
  workspaceId: string;
  board?: AtlasView;
  initialConfig: AtlasConfig;
  devices: DeviceMapItem[];
  selectedMetrics: string[];
  initialName?: string;
  onClose: () => void;
  onSaved: (board: AtlasView) => void | Promise<void>;
  onDelete?: () => void;
}) {
  const maxName=usePolicyLimit("atlas_name",120);
  const maxDescription=usePolicyLimit("atlas_description",300);
  const maxDevices=usePolicyLimit("atlas_devices",50);
  const trendHours=usePolicyLimit("atlas_trend_hours",720);
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const [name, setName] = useState(initialName ?? board?.name ?? a("defaultName"));
  const [config, setConfig] = useState<AtlasConfig>({
    ...defaultAtlasConfig,
    ...initialConfig,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (copy = false) => {
    if (!name.trim()) {
      setError(a("nameRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        template_code: ATLAS_TEMPLATE as typeof ATLAS_TEMPLATE,
        config,
      };
      const saved =
        board?.id && !copy
          ? await api.atlas.update(workspaceId, board.id, payload)
          : await api.atlas.create(workspaceId, payload);
      await onSaved(saved);
    } catch (e) {
      setError(formatApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="atlas-settings">
        <DialogHeader>
          <DialogTitle>{a(board ? "configure" : "createView")}</DialogTitle>
          <DialogDescription>{a("settingsHint")}</DialogDescription>
        </DialogHeader>
        <AtlasTemplateChoices
          value={config.presentation}
          onChange={(presentation) => setConfig({ ...config, presentation })}
        />
        <div className="atlas-settings-fields">
          <label>
            {a("name")}
            <TextInput
              maxLength={maxName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {a("description")}
            <TextInput
              maxLength={maxDescription}
              value={config.description ?? ""}
              onChange={(e) =>
                setConfig({ ...config, description: e.target.value })
              }
            />
          </label>
          {config.presentation !== "panorama" && (
            <label>
              {a("layout")}
              <SelectInput
                value={config.layout}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    layout: e.target.value as AtlasConfig["layout"],
                  })
                }
              >
                <option value="balanced">{a("balanced")}</option>
                <option value="map">{a("mapFocus")}</option>
              </SelectInput>
            </label>
          )}
          <label>
            {a("trend")}
            <SelectInput
              value={config.trend_hours}
              onChange={(e) =>
                setConfig({ ...config, trend_hours: Number(e.target.value) })
              }
            >
              {![24,168,720].includes(trendHours)&&<option value={trendHours}>{trendHours} 小时</option>}
              {trendHours>=24&&<option value="24">{a("day")}</option>}
              {trendHours>=168&&<option value="168">{a("week")}</option>}
              {trendHours>=720&&<option value="720">{a("month")}</option>}
            </SelectInput>
          </label>
          <label className="atlas-setting-switch">
            {a("showImages")}
            <Switch
              checked={config.show_images !== false}
              onCheckedChange={(v) => setConfig({ ...config, show_images: v })}
            />
          </label>
          <label className="atlas-setting-switch">
            {a("showTrends")}
            <Switch
              checked={config.show_trends !== false}
              onCheckedChange={(v) => setConfig({ ...config, show_trends: v })}
            />
          </label>
        </div>
        <div className="atlas-settings-scope">
          <strong>
            {a("scope")} · {config.device_ids?.length ?? 0}
          </strong>
          <p>{a("deviceLimit")}</p>
          <DeviceCombobox
            devices={devices.map((device) => ({ ...device, id: device.device_id, research_tags: device.environment.research_tags }))}
            variant="inline"
            multiple
            value={config.device_ids ?? []}
            onChange={(device_ids) => setConfig({ ...config, device_ids })}
            maxSelected={maxDevices}
            disabled={busy}
            ariaLabel="选择一张图设备范围"
          />
        </div>
        <AtlasMetricDefaultsEditor workspaceId={workspaceId} devices={devices} value={config.metric_defaults} onChange={metric_defaults => setConfig({ ...config, metric_defaults })} />
        {selectedMetrics.length > 0 && (
          <>
            <label className="atlas-setting-switch">
              {a("saveSelection")}
              <Checkbox
                checked={
                  config.telemetry_stream_ids?.join(",") ===
                    selectedMetrics.join(",") && selectedMetrics.length > 0
                }
                disabled={!selectedMetrics.length}
                onCheckedChange={(v) =>
                  setConfig({
                    ...config,
                    telemetry_stream_ids: v ? selectedMetrics : [],
                  })
                }
              />
            </label>
            <small>{a("defaultMetricsHint")}</small>
          </>
        )}
        {error && (
          <p className="atlas-warning" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          {onDelete && (
            <Button variant="ghost" disabled={busy} onClick={onDelete}>
              {a("delete")}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {a("cancel")}
          </Button>
          {board && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {a("saveAs")}
            </Button>
          )}
          <Button disabled={busy} onClick={() => void save()}>
            <Save size={14} />
            {a(busy ? "saving" : "save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
class MapBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
