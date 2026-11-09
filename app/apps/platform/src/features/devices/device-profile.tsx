import { usePolicyLimit } from "../../shared/config/system-policy";
import { LoRaWANGatewayDetails } from "./lorawan-gateway-details";
import { DeviceDossier } from "./device-dossier";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ExternalLink,
  FolderKanban,
  ImagePlus,
  Leaf,
  MapPin,
  MapPinned,
  Pencil,
  Plus,
  Star,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  formatApiError,
  type Device,
  type DeviceEnvironment,
  type DeviceTaxonomyTerm,
  type DeviceProfileImage,
  type JsonRecord,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CheckboxInput, Input, Panel, SelectInput, Sheet, SheetContent, SheetTitle, StateView, Switch, Textarea } from "../../shared/ui";
import { DeviceProfileGallery } from "./device-profile-gallery";
import { iconifyIconUrl } from "@thcpn/device-map";
import { renderPhotoToolbar } from "./device-media";

const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);

export function DeviceProfileTab({
  workspaceId,
  device,
  projects,
  sites,
  operational,
}: {
  workspaceId: string;
  device: Device;
  projects: JsonRecord[];
  sites: JsonRecord[];
  operational?: ReactNode;
}) {
  const maxImages=usePolicyLimit("profile_images",12);
  const client = useQueryClient();
  const [editing, setEditing] = useState<false | "basic" | "observation">(false);
  const [placementEditing, setPlacementEditing] = useState(false);
  const [managingImages, setManagingImages] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const queryKey = workspaceQueryKey(
    workspaceId,
    "device",
    device.id,
    "profile",
  );
  const query = useQuery({
    queryKey,
    queryFn: () => api.devices.profile(device.id),
  });
  const environmentQuery = useQuery({ queryKey: workspaceQueryKey(workspaceId,"device",device.id,"environment"), queryFn:()=>api.devices.environment(device.id) });
  const taxonomyQuery = useQuery({ queryKey:["device-taxonomy"], queryFn:api.devices.taxonomy });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: ["device", device.id, "detail"] }),
      client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "devices") }),
      client.invalidateQueries({queryKey:workspaceQueryKey(workspaceId,"device",device.id,"environment")}),
      client.invalidateQueries({queryKey:workspaceQueryKey(workspaceId,"device-map")}),
    ]);
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback("");
    setBusy(true);
    try {
      await action();
      setFeedback(message);
      await refresh();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (query.isLoading)
    return (
      <Panel>
        <StateView
          type="loading"
          title="正在加载设备资料"
          description="正在读取位置与资产图片。"
        />
      </Panel>
    );
  if (query.error || !query.data)
    return (
      <Panel>
        <StateView
          type="error"
          title="设备资料加载失败"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      </Panel>
    );
  const profile = query.data;
  const location = profile.effective_location;
  const images = profile.images ?? [];
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const projectName = projects.find((item) => String(item.id) === device.project_id)?.name;
  return (
    <>
      {feedback && <div className="command-note device-feedback">{feedback}</div>}
      <div className="device-profile-layout device-profile-standard">
        <Panel className="device-profile-info">
          <div className="panel-header compact-panel-header">
            <div>
              <h2 className="panel-title">基本信息</h2>

            </div>
            {profile.can_configure && (
              <Button variant="secondary" onClick={() => setEditing("basic")}>
                <Pencil size={14} />
                编辑资料
              </Button>
            )}
          </div>
          <div className="device-profile-basic-grid">
            <ProfileDatum label="设备名称" value={device.name} />
            <ProfileDatum label="资产编号" value={device.asset_no || device.serial_no} mono />
            <ProfileDatum label="数据源" value={({thcpn: "THCPN", lorawan_v2: "LoRaWAN V2", carbon: "碳汇"} as Record<string, string>)[device.source_family ?? ""] ?? value(device.source_family)} />
            <ProfileDatum label="设备 ID" value={device.id} mono />
          </div>
          <div className="device-profile-summary">
            <span>设备描述</span>
            <p className={profile.description ? "" : "is-empty"}>
              {profile.description || "尚未填写设备描述"}
            </p>
          </div>
        </Panel>
        <Panel className="device-profile-placement-card">
            <section className="device-profile-group device-profile-placement">
              <div className="device-profile-group-heading">
                <div>
                  <MapPinned size={16} />
                  <h3>归属与位置</h3>
                </div>
                {profile.can_manage_placement ? (
                  <Button variant="secondary" onClick={() => setPlacementEditing(true)}>
                    <Pencil size={13} />
                    编辑归属
                  </Button>
                ) : null}
              </div>
              <div className="device-profile-placement-grid">
                <ProfileDatum
                  icon={<FolderKanban size={15} />}
                  label="所属项目"
                  value={value(projectName, "未分配")}
                />
                <ProfileDatum
                  icon={<MapPin size={15} />}
                  label="所属站点"
                  value={profile.site?.name ?? "未分配"}
                />
                <ProfileDatum
                  className="device-profile-datum-wide"
                  label="地址"
                  value={value(location?.location_text, "未设置")}
                />
                <ProfileDatum
                  label="纬度"
                  value={value(latitude)}
                  mono
                />
                <ProfileDatum
                  label="经度"
                  value={value(longitude)}
                  mono
                />
              </div>
              <div className="device-profile-location-source">
                <span>位置来源</span>
                <Badge tone={profile.location_source === "device" ? "info" : "neutral"}>
                  {profile.location_source === "device"
                    ? "设备实时上报"
                    : profile.location_source === "site"
                      ? `继承自站点${profile.site?.name ? ` · ${profile.site.name}` : ""}`
                      : "未设置"}
                </Badge>
              </div>
              {latitude !== undefined && longitude !== undefined ? (
                <a
                  className="device-location-link"
                  href={`https://api.map.baidu.com/marker?location=${latitude},${longitude}&title=${encodeURIComponent(device.name)}&content=${encodeURIComponent(location?.location_text || device.name)}&output=html&coord_type=wgs84&src=webapp.thcpn.research-network`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={16} />
                  <span>
                    在百度地图打开
                    <small>{latitude}, {longitude}</small>
                  </span>
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </section>
        </Panel>
        <DeviceDossier deviceId={device.id} workspaceId={workspaceId} canEdit={Boolean(profile.can_configure)}/>
        {device.source_family==="lorawan_v2"&&device.device_type==="gateway"&&<LoRaWANGatewayDetails deviceId={device.id}/>}
        <Panel className="device-profile-observation-card">
            <EnvironmentOverview
              environment={environmentQuery.data}
              loading={environmentQuery.isLoading}
              onEdit={profile.can_configure && environmentQuery.data ? () => setEditing("observation") : undefined}
            />
        </Panel>
        {operational && <details className="device-profile-connection"><summary>设备接入信息</summary>{operational}</details>}
        <Panel className="device-profile-gallery">
          <div className="panel-header compact-panel-header">
            <div>
              <h2 className="panel-title">资产图片</h2>

            </div>
            <div className="header-actions">
              <Badge tone="info">已上传 {images.length} 张图片</Badge>
              {profile.can_configure && images.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => setManagingImages((current) => !current)}
                >
                  <Pencil size={14} />
                  {managingImages ? "完成" : "管理图片"}
                </Button>
              )}
              {profile.can_configure && images.length < maxImages && (
                <label className="btn btn-secondary device-image-upload">
                  <ImagePlus size={14} />
                  上传
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={busy}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      if (files.length)
                        void run(
                          () => api.devices.uploadProfileImages(device.id, files),
                          "设备图片已上传",
                        );
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {images.length ? (
            managingImages ? <div className="device-profile-image-grid">
              {images.map((image, index) => (
                <div key={image.id} className="device-profile-image-card">
                  <button type="button" onClick={() => setPreviewIndex(index)}>
                    <img src={image.preview_url} alt={image.caption || image.original_filename} />
                    {image.is_cover && <span className="image-cover-badge">封面</span>}
                  </button>
                  <Input
                    aria-label="图片说明"
                    defaultValue={image.caption ?? ""}
                    placeholder="添加图片说明"
                    disabled={!profile.can_configure || busy}
                    onBlur={(event) => {
                      if (event.target.value !== (image.caption ?? ""))
                        void run(
                          () =>
                            api.devices.updateProfileImage(device.id, image.id, {
                              caption: event.target.value,
                            }),
                          "图片说明已更新",
                        );
                    }}
                  />
                  {profile.can_configure && (
                    <div className="device-profile-image-actions">
                      <button
                        title="上移"
                        disabled={index === 0 || busy}
                        onClick={() => void moveImage(images, index, -1, device.id, run)}
                      ><ArrowUp size={13} /><span>前移</span></button>
                      <button
                        title="下移"
                        disabled={index === images.length - 1 || busy}
                        onClick={() => void moveImage(images, index, 1, device.id, run)}
                      ><ArrowDown size={13} /><span>后移</span></button>
                      <button
                        title={image.is_cover ? "当前首图" : "设为首图"}
                        disabled={image.is_cover || busy}
                        onClick={() => void run(() => api.devices.updateProfileImage(device.id, image.id, { is_cover: true }), "已设为封面")}
                      ><Star size={13} /><span>{image.is_cover ? "当前首图" : "设为首图"}</span></button>
                      <button
                        className="danger"
                        title="删除"
                        disabled={busy}
                        onClick={() =>
                          window.confirm("确认删除这张设备图片？") &&
                          void run(() => api.devices.deleteProfileImage(device.id, image.id), "设备图片已删除")
                        }
                      ><Trash2 size={13} /><span>删除</span></button>
                    </div>
                  )}
                </div>
              ))}
            </div> : <DeviceProfileGallery images={images} onPreview={setPreviewIndex} />
          ) : (
            <StateView
              type="empty"
              title="暂无设备图片"
              description="可上传设备外观、铭牌或安装环境图片。"
            />
          )}
        </Panel>
      </div>
      <PhotoSlider
        visible={previewIndex >= 0}
        onClose={() => setPreviewIndex(-1)}
        photoWrapClassName="thcpn-photo-wrap"
        index={Math.max(0, previewIndex)}
        onIndexChange={setPreviewIndex}
        images={images.map((image) => ({
          key: image.id,
          src: image.preview_url,
          overlay: (
            <div className="photo-preview-caption">
              <strong>{image.caption || device.name}</strong>
              <span>{image.original_filename}</span>
            </div>
          ),
        }))}
        loop={images.length > 1}
        maskClosable
        toolbarRender={renderPhotoToolbar}
      />
      {editing && (
        <ProfileEditor
          section={editing}
          profile={profile}
          environment={environmentQuery.data}
          terms={taxonomyQuery.data?.items ?? []}
          busy={busy}
          onClose={() => setEditing(false)}
          onSubmit={async (payload, environmentPayload) => {
            const success = await run(
              () => editing === "basic" ? api.devices.updateProfile(device.id, payload) : api.devices.updateEnvironment(device.id, environmentPayload),
              "设备资料已更新",
            );
            if (success) setEditing(false);
          }}
        />
      )}
      {placementEditing ? (
        <PlacementEditor
          device={device}
          projects={projects}
          sites={sites}
          busy={busy}
          onClose={() => setPlacementEditing(false)}
          onSubmit={async (projectId, siteId) => {
            const success = await run(
              () => api.devices.update(device.id, {
                project_id: projectId || null,
                site_id: siteId || null,
              }),
              "设备归属已更新",
            );
            if (success) setPlacementEditing(false);
          }}
        />
      ) : null}
    </>
  );
}

function ProfileDatum({ icon, label, value: datumValue, mono = false, className = "" }: {
  icon?: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`device-profile-datum ${className}`}>
      <span>{icon}{label}</span>
      <strong className={mono ? "mono" : ""}>{datumValue}</strong>
    </div>
  );
}

function TaxonomyTags({ values, empty = "未设置" }: { values: string[]; empty?: string }) {
  if (!values.length) return <span className="device-profile-empty-value">{empty}</span>;
  return <div className="device-profile-tag-list">{values.map((item) => <span key={item}>{item}</span>)}</div>;
}

function EnvironmentOverview({ environment, loading, onEdit }: { environment?: DeviceEnvironment; loading: boolean; onEdit?: () => void }) {
  const values = environment?.effective;
  const deviceTypeIcon = iconifyIconUrl(values?.ecosystem?.icon);
  return (
    <section className="device-profile-group device-profile-observation">
      <div className="device-profile-group-heading">
        <div>
          <Leaf size={16} />
          <h3>应用场景与分类</h3>
        </div>
        {onEdit && <Button variant="secondary" onClick={onEdit}><Pencil size={14} />编辑资料</Button>}
      </div>
      {loading ? (
        <div className="device-profile-observation-loading">正在加载应用场景与分类…</div>
      ) : (
        <>
          <div className="device-profile-ecosystem">
            <span>生态分类</span>
            <strong>{deviceTypeIcon ? <img src={deviceTypeIcon} width={14} height={14} alt="" /> : <Leaf size={14} />}{values?.ecosystem?.name_zh ?? "未分类"}</strong>
          </div>
          <div className="device-profile-taxonomy-row">
            <span><Target size={14} />观测对象</span>
            <TaxonomyTags values={values?.observation_objects.map((term) => term.name_zh) ?? []} />
          </div>
          <div className="device-profile-taxonomy-row"><span>应用场景</span><TaxonomyTags values={values?.purposes.map(term=>term.name_zh)??[]}/></div>
        </>
      )}
    </section>
  );
}

function PlacementEditor({ device, projects, sites, busy, onClose, onSubmit }: {
  device: Device;
  projects: JsonRecord[];
  sites: JsonRecord[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (projectId: string, siteId: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(device.project_id ?? "");
  const [siteId, setSiteId] = useState(device.site_id ?? "");
  const availableSites = sites.filter(
    (item) => !projectId || String(item.project_id) === projectId,
  );
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="access-editor device-profile-editor device-placement-editor">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div>
              <SheetTitle className="panel-title">编辑归属</SheetTitle>
              <div className="panel-kicker">{device.name} · 资产编号 {device.asset_no || device.serial_no}</div>
            </div>
            <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
          </div>
          <form
            className="access-form device-placement-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit(projectId, siteId);
            }}
          >
            <div className="device-editor-body"><div className="form-section access-profile-fields">
              <label className="field profile-editor-field">
                <span className="field-label">所属项目</span>
                <SelectInput
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setSiteId("");
                  }}
                >
                  <option value="">不分配项目</option>
                  {projects.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)}
                    </option>
                  ))}
                </SelectInput>
              </label>
              <label className="field profile-editor-field">
                <span className="field-label">所属站点</span>
                <SelectInput
                  value={siteId}
                  disabled={!projectId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  <option value="">不分配站点</option>
                  {availableSites.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)}
                    </option>
                  ))}
                </SelectInput>
              </label>
            </div>
            </div>
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存归属"}</Button>
            </div>
          </form>
        </Panel>
      </SheetContent>
    </Sheet>
  );
}

function ProfileEditor({ section, profile, environment, terms, busy, onClose, onSubmit }: {
  section: "basic" | "observation";
  profile: Awaited<ReturnType<typeof api.devices.profile>>;
  environment?: DeviceEnvironment;
  terms: DeviceTaxonomyTerm[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: JsonRecord, environmentPayload: JsonRecord) => Promise<void>;
}) {
  const [description, setDescription] = useState(profile.description ?? "");
  const descriptionMax=usePolicyLimit("device_description",500);
  const [locationText, setLocationText] = useState(profile.location_text ?? "");
  const direct=environment?.direct;
  const effective=environment?.effective;
  const [overrides,setOverrides]=useState(()=>new Set((environment?.overridden_fields??[]).filter((field)=>field!=="altitude_m")));
  const [ecosystem,setEcosystem]=useState(direct?.ecosystem?.id??effective?.ecosystem?.id??"");
  const [observations,setObservations]=useState(direct?.observation_objects.map((term)=>term.id)??effective?.observation_objects.map((term)=>term.id)??[]);
  const [year,setYear]=useState(String(direct?.commissioned_year??effective?.commissioned_year??""));
  const tags=direct?.research_tags??[];
  const [purposes,setPurposes]=useState<string[]>(direct?.purposes.map(term=>term.id)??effective?.purposes.map(term=>term.id)??[]);
  const byKind=(kind:string)=>terms.filter((term)=>term.kind===kind&&term.status==="active");
  const toggle=(field:string)=>setOverrides((current)=>{const next=new Set(current);if(next.has(field))next.delete(field);else next.add(field);return next});
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      description: description.trim() || null,
      location_text: locationText.trim() || null,
    },{ecosystem_term_id:ecosystem||null,observation_object_ids:observations,purpose_ids:purposes,management_term_id:direct?.management?.id??null,deployment_term_id:direct?.deployment?.id??null,commissioned_year:year?Number(year):null,research_tags:tags,overridden_fields:Array.from(overrides)});
  };
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="access-editor device-profile-editor">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div><SheetTitle className="panel-title">{section === "basic" ? "编辑基本信息" : "编辑应用场景与分类"}</SheetTitle></div>
            <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
          </div>
          <form className="access-form" onSubmit={submit}>
            <div className="device-editor-body">
            {section === "basic" && <div className="form-section access-profile-fields">
              <label className="field profile-editor-field">
                <span className="field-label">设备描述 <small>{Array.from(description).length}/{descriptionMax}</small></span>
                <Textarea maxLength={descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="说明设备的安装环境、观测任务或维护备注" />

              </label>
              <label className="field profile-editor-field">
                <span className="field-label">地址或位置说明</span>
                <div className="profile-editor-input-with-icon"><MapPin size={15} /><Input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="例如：北京森林站东侧样地" /></div>
              </label>
              <div className="profile-editor-source-note"><MapPin size={15} /><span>经纬度由设备数据源或所属站点提供；这里维护地址和位置说明。</span></div>
            </div>}
            {section === "observation" && <div className="form-section environment-form-section">
              <label className="field"><span className="field-label">分类来源</span><SelectInput value={["ecosystem","observation_objects","purposes"].some(key=>overrides.has(key))?"custom":"inherit"} onChange={event=>setOverrides(current=>{const next=new Set(current);for(const key of ["ecosystem","observation_objects","purposes"]){if(event.target.value==="custom")next.add(key);else next.delete(key);}return next;})}><option value="inherit">沿用网关／站点资料</option><option value="custom">为此设备单独设置</option></SelectInput></label>
              <EnvironmentField label="生态分类" field="ecosystem" overrides={overrides} toggle={toggle}><DeviceTypeSelect disabled={!overrides.has("ecosystem")} options={byKind("ecosystem")} value={ecosystem} onChange={setEcosystem}/></EnvironmentField>
              <EnvironmentMultiField label="观测对象" field="observation_objects" overrides={overrides} toggle={toggle} options={byKind("observation_object")} value={observations} onChange={setObservations}/>
              <EnvironmentMultiField label="应用场景" field="purposes" overrides={overrides} toggle={toggle} options={byKind("purpose")} value={purposes} onChange={setPurposes}/>

            </div>}
            </div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存资料"}</Button></div>
          </form>
        </Panel>
      </SheetContent>
    </Sheet>
  );
}

function EnvironmentField({label,field,overrides,toggle,children}:{label:string;field:string;overrides:Set<string>;toggle:(field:string)=>void;children:ReactNode}) {
  const enabled=overrides.has(field);
  return <div className={`field environment-field ${enabled?"is-overridden":""}`}><div className="field-label"><span>{label}</span></div>{children}</div>;
}

function DeviceTypeSelect({disabled,options,value,onChange}:{disabled:boolean;options:DeviceTaxonomyTerm[];value:string;onChange:(value:string)=>void}) {
  return <SelectInput disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}><option value="">未设置</option>{options.map(term=><option key={term.id} value={term.id}>{term.name_zh}</option>)}</SelectInput>;
}

function EnvironmentMultiField({label,field,overrides,toggle,options,value,onChange}:{label:string;field:string;overrides:Set<string>;toggle:(field:string)=>void;options:DeviceTaxonomyTerm[];value:string[];onChange:(value:string[])=>void}) {
  const enabled=overrides.has(field);
  const change=(id:string,checked:boolean)=>onChange(checked?Array.from(new Set([...value,id])):value.filter((item)=>item!==id));
  return <div className={`field environment-field environment-multi-field ${enabled?"is-overridden":""}`}><span className="field-label">{label}</span><div className="taxonomy-choice-grid" aria-disabled={!enabled}>{options.map((term)=><label key={term.id} className={value.includes(term.id)?"selected":""}><CheckboxInput disabled={!enabled} checked={value.includes(term.id)} onChange={(event)=>change(term.id,event.target.checked)}/><span>{term.name_zh}</span></label>)}</div>{!options.length&&<span className="field-hint">暂无可用分类选项</span>}</div>;
}

async function moveImage(
  images: DeviceProfileImage[],
  index: number,
  offset: number,
  deviceId: string,
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>,
) {
  const ids = images.map((image) => image.id);
  [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
  await run(() => api.devices.reorderProfileImages(deviceId, ids), "图片顺序已更新");
}
