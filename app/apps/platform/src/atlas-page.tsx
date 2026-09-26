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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Compass,
  Crosshair,
  Globe2,
  Layers3,
  MapPin,
  MapPinOff,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Search,
  Settings2,
} from "lucide-react";
import {
  api,
  deviceTopologyRoleLabel,
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
  Input,
  TextInput,
  SearchInput,
  SelectInput,
  Switch,
} from "./platform-ui";
import { AtlasDevice, AtlasEmpty, AtlasError } from "./atlas-device";
import { AtlasHealth } from "./atlas-health";
import { Card } from "./components/ui/card";
import {
  ATLAS_TEMPLATE,
  defaultAtlasConfig,
  filterDevices,
  located,
  type AtlasConfig,
} from "./atlas-model";
import "./atlas.css";
import "./atlas-templates.css";
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
  const { currentId, current } = useWorkspace();
  const { id } = useParams();
  const { t } = useLocale();
  return currentId ? (
    id ? (
      <AtlasWorkspace
        key={`${currentId}:${id ?? "default"}`}
        workspaceId={currentId}
        workspaceName={current?.name ?? ""}
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
  const [creating, setCreating] = useState<AtlasPresentation>();
  const [editing, setEditing] = useState<AtlasView>();
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
  return (
    <div className="atlas-home">
      <header className="atlas-home-heading">
        <div>
          <h1>{a("title")}</h1>
          <p>{a("homeHint")}</p>
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
      <ol className="atlas-creation-steps" aria-label={a("creationSteps")}>
        {["chooseTemplate", "configure", "save"].map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            {a(step)}
          </li>
        ))}
      </ol>
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
      <section className="atlas-home-saved" aria-labelledby="atlas-saved-title">
        <header>
          <h2 id="atlas-saved-title">{a("savedViews")}</h2>
          <span>{saved.length}</span>
        </header>
        {boards.data && !saved.length && (
          <Card className="atlas-home-empty">
            <Layers3 size={24} />
            <strong>{a("noSavedViews")}</strong>
            <p>{a("noSavedViewsHint")}</p>
          </Card>
        )}
        <div className="atlas-saved-grid">
          {saved.map((view) => (
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
              </div>
            </Card>
          ))}
        </div>
      </section>
      {(creating || editing) && boards.data?.can_manage && devices.data && (
        <AtlasSettings
          workspaceId={workspaceId}
          board={editing}
          initialConfig={
            editing?.config ?? {
              ...defaultAtlasConfig,
              presentation: creating ?? defaultAtlasConfig.presentation,
            }
          }
          devices={devices.data.items}
          selectedMetrics={[]}
          onClose={() => {
            setCreating(undefined);
            setEditing(undefined);
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
  workspaceName,
  id,
}: {
  workspaceId: string;
  workspaceName: string;
  id?: string;
}) {
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const navigate = useNavigate();
  const client = useQueryClient();
  // Open with real observations ready; an explicit map reset can still clear focus.
  const [selection, setSelection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [present, setPresent] = useState(false);
  const [reset, setReset] = useState(0);
  const [error, setError] = useState("");
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
  const config: AtlasConfig = {
    ...defaultAtlasConfig,
    ...board.data?.config,
  };
  const template = atlasTemplate(config.presentation);
  const Layout = template.Layout;
  const rows = devices.data?.items ?? [];
  const scoped = useMemo(
    () => filterDevices(rows, config.device_ids ?? [], "", "all"),
    [devices.data, board.data],
  );
  const visible = filterDevices(scoped, [], search, kind);
  const selected =
    scoped.find((d) => d.device_id === selection) ??
    (selection === null ? scoped[0] : undefined);
  const kinds = [...new Set(scoped.map((d) => d.device_type))];
  const onSelect = useCallback((next: string) => {
    setSelection(next);
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
  const refresh = () =>
    client.invalidateQueries({
      queryKey: workspaceQueryKey(workspaceId, "atlas"),
    });
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
  return (
    <div
      className={`atlas-shell ${present ? "is-presenting" : ""} atlas-layout-${config.layout} atlas-template-${template.id}`}
    >
      <header className="atlas-header">
        <div className="atlas-brand-mark">
          <Globe2 size={25} />
        </div>
        <div className="atlas-title">
          <span className="atlas-overline">
            IN-SITU ECOCLOUD / {a("title")}
          </span>
          <h1>{board.data?.name ?? a("defaultName")}</h1>
          {config.description && <p>{config.description}</p>}
        </div>
        <div className="atlas-header-actions">
          <Button
            className="atlas-fullscreen-button"
            variant="ghost"
            title={a(present ? "exit" : "presentation")}
            aria-label={a(present ? "exit" : "presentation")}
            onClick={() => void toggleFullscreen()}
          >
            {present ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </Button>
        </div>
      </header>
      <AtlasHealth
        workspaceId={workspaceId}
        deviceIds={scoped.map((device) => device.device_id)}
        loading={devices.isLoading}
      />
      {(devices.error || error) && (
        <div className="atlas-top-warning" role="alert">
          {error ||
            `${devices.data ? a("retained") : a("failed")}: ${formatApiError(devices.error).message}`}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            {a("retry")}
          </Button>
        </div>
      )}
      <Layout
        directory={
          <aside className="atlas-directory">
            <header>
              <h2>
                <Layers3 size={16} />
                {a("deviceList")}
              </h2>
              <span>{visible.length}</span>
            </header>
            <div className="atlas-directory-filters">
              <div className="atlas-search">
                <Search size={14} />
                <Input
                  placeholder={a("search")}
                  aria-label={a("search")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <SelectInput
                aria-label={a("scope")}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">{a("all")}</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {deviceTopologyRoleLabel(k)}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div className="atlas-device-list">
              {devices.isLoading ? (
                <AtlasEmpty text={a("loading")} />
              ) : !visible.length ? (
                <AtlasEmpty text={a("noDevices")} />
              ) : (
                visible.map((d, index) => (
                  <Button
                    variant="ghost"
                    key={d.device_id}
                    className={`atlas-device-row ${d.device_id === selected?.device_id ? "is-selected" : ""}`}
                    aria-pressed={d.device_id === selected?.device_id}
                    onClick={() => onSelect(d.device_id)}
                  >
                    <span className="atlas-device-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{d.name}</strong>
                      <small>{d.serial_no}</small>
                      <em>{deviceTopologyRoleLabel(d.device_type)}</em>
                    </span>
                    {located(d) ? (
                      <MapPin size={13} />
                    ) : (
                      <MapPinOff size={13} />
                    )}
                  </Button>
                ))
              )}
            </div>
            <footer>
              <Compass size={13} />
              {a("mapNote")}
            </footer>
          </aside>
        }
        map={
          <section className="atlas-map-region" aria-label={a("overview")}>
            <MapBoundary fallback={<AtlasEmpty text={a("mapUnavailable")} />}>
              <Suspense fallback={<AtlasEmpty text={a("loading")} />}>
                <AtlasMap
                  points={visible}
                  selectedId={selected?.device_id ?? ""}
                  onSelect={onSelect}
                  reset={reset}
                />
              </Suspense>
            </MapBoundary>
            <div className="atlas-map-heading">
              <span className="atlas-overline">OBSERVATION NETWORK</span>
              <h2>{workspaceName}</h2>
            </div>
            <div className="atlas-map-tools">
              <Button
                variant="secondary"
                onClick={() => {
                  onSelect("");
                  setReset(reset + 1);
                }}
              >
                <Crosshair size={15} />
                {a("resetMap")}
              </Button>
            </div>
            <div className="atlas-map-caption">
              <i />
              {a("located")} <b>{visible.filter(located).length}</b>
              <span>·</span>
              {a("unlocated")}{" "}
              <b>{visible.filter((d) => !located(d)).length}</b>
            </div>
          </section>
        }
        inspector={
          <div className="atlas-inspector">
            {selected ? (
              <AtlasDevice
                key={`${selected.device_id}:${board.data?.updated_at ?? "default"}:${template.id}`}
                device={selected}
                workspaceId={workspaceId}
                config={config}
                onSelection={() => {}}
                initialTab={template.initialTab}
              />
            ) : (
              <div className="atlas-welcome">
                <div className="atlas-orbit">
                  <Globe2 size={52} />
                  <span />
                  <i />
                </div>
                <span className="atlas-overline">CONNECTED OBSERVATIONS</span>
                <h2>{a("selectDevice")}</h2>
                <p>{a("deviceHint")}</p>
                <div className="atlas-welcome-rule" />
                <small>{a("source")}</small>
              </div>
            )}
          </div>
        }
      />
      <footer className="atlas-footer">
        <span>{a("source")}</span>
        <span>
          IN-SITU <b>ATLAS</b> / 01
        </span>
      </footer>
    </div>
  );
}

function AtlasSettings({
  workspaceId,
  board,
  initialConfig,
  devices,
  selectedMetrics,
  onClose,
  onSaved,
  onDelete,
}: {
  workspaceId: string;
  board?: AtlasView;
  initialConfig: AtlasConfig;
  devices: DeviceMapItem[];
  selectedMetrics: string[];
  onClose: () => void;
  onSaved: (board: AtlasView) => void | Promise<void>;
  onDelete?: () => void;
}) {
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const [name, setName] = useState(board?.name ?? a("defaultName"));
  const [config, setConfig] = useState<AtlasConfig>({
    ...defaultAtlasConfig,
    ...initialConfig,
  });
  const [query, setQuery] = useState("");
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
        board && !copy
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
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {a("description")}
            <TextInput
              maxLength={300}
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
              <option value="24">{a("day")}</option>
              <option value="168">{a("week")}</option>
              <option value="720">{a("month")}</option>
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
          <SearchInput
            placeholder={a("search")}
            aria-label={a("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div>
            {devices
              .filter((d) => `${d.name} ${d.serial_no}`.includes(query))
              .map((d) => (
                <label key={d.device_id}>
                  <Checkbox
                    checked={config.device_ids?.includes(d.device_id) ?? false}
                    disabled={
                      !config.device_ids?.includes(d.device_id) &&
                      (config.device_ids?.length ?? 0) >= 50
                    }
                    onCheckedChange={(v) =>
                      setConfig({
                        ...config,
                        device_ids: v
                          ? [...(config.device_ids ?? []), d.device_id]
                          : (config.device_ids ?? []).filter(
                              (id) => id !== d.device_id,
                            ),
                      })
                    }
                  />
                  <span>
                    {d.name}
                    <small>{d.serial_no}</small>
                  </span>
                </label>
              ))}
          </div>
        </div>
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
