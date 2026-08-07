import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FileText,
  FolderKanban,
  ImagePlus,
  Leaf,
  MapPin,
  MapPinned,
  Pencil,
  Star,
  Tags,
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
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { renderPhotoToolbar } from "./device-media";
import { DeviceMetadataPanel } from "./device-computed-data";

const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);

export function DeviceProfileTab({
  workspaceId,
  device,
  projects,
  sites,
}: {
  workspaceId: string;
  device: Device;
  projects: JsonRecord[];
  sites: JsonRecord[];
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [placementEditing, setPlacementEditing] = useState(false);
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
      <div className="device-profile-layout">
        <Panel className="device-profile-info">
          <div className="panel-header compact-panel-header">
            <div>
              <h2 className="panel-title">设备资料</h2>
              <div className="panel-kicker">归属、位置与观测信息</div>
            </div>
            {profile.can_configure && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} />
                编辑
              </Button>
            )}
          </div>
          <div className="device-profile-summary">
            <span>设备描述</span>
            <p className={profile.description ? "" : "is-empty"}>
              {profile.description || "尚未填写设备描述"}
            </p>
          </div>
          <div className="device-profile-content">
            <section className="device-profile-group device-profile-placement">
              <div className="device-profile-group-heading">
                <div>
                  <MapPinned size={16} />
                  <h3>归属与位置</h3>
                </div>
                {profile.can_configure ? (
                  <button
                    className="device-profile-group-action"
                    type="button"
                    onClick={() => setPlacementEditing(true)}
                  >
                    <Pencil size={13} />
                    调整归属
                  </button>
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
            <EnvironmentOverview
              environment={environmentQuery.data}
              loading={environmentQuery.isLoading}
            />
          </div>
        </Panel>
        <Panel className="device-profile-gallery">
          <div className="panel-header compact-panel-header">
            <div>
              <h2 className="panel-title">资产图片</h2>
              <div className="panel-kicker">设备外观、铭牌与安装环境</div>
            </div>
            <div className="header-actions">
              <Badge tone="info">{images.length} / 12</Badge>
              {profile.can_configure && images.length < 12 && (
                <label className="btn btn-secondary device-image-upload">
                  <ImagePlus size={14} />
                  上传
                  <input
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
            <div className="device-profile-image-grid">
              {images.map((image, index) => (
                <div key={image.id} className="device-profile-image-card">
                  <button type="button" onClick={() => setPreviewIndex(index)}>
                    <img src={image.preview_url} alt={image.caption || image.original_filename} />
                    {image.is_cover && <span className="image-cover-badge">封面</span>}
                  </button>
                  <input
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
                      ><ArrowUp size={14} /></button>
                      <button
                        title="下移"
                        disabled={index === images.length - 1 || busy}
                        onClick={() => void moveImage(images, index, 1, device.id, run)}
                      ><ArrowDown size={14} /></button>
                      <button
                        title="设为封面"
                        disabled={image.is_cover || busy}
                        onClick={() => void run(() => api.devices.updateProfileImage(device.id, image.id, { is_cover: true }), "已设为封面")}
                      ><Star size={14} /></button>
                      <button
                        className="danger"
                        title="删除"
                        disabled={busy}
                        onClick={() =>
                          window.confirm("确认删除这张设备图片？") &&
                          void run(() => api.devices.deleteProfileImage(device.id, image.id), "设备图片已删除")
                        }
                      ><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <StateView
              type="empty"
              title="暂无设备图片"
              description="可上传设备外观、铭牌或安装环境图片。"
            />
          )}
        </Panel>
      </div>
      <div className="section-gap">
        <DeviceMetadataPanel
          workspaceId={workspaceId}
          deviceId={device.id}
          canConfigure={profile.can_configure}
        />
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
          profile={profile}
          environment={environmentQuery.data}
          terms={taxonomyQuery.data?.items ?? []}
          busy={busy}
          onClose={() => setEditing(false)}
          onSubmit={async (payload, environmentPayload) => {
            const success = await run(
              () => Promise.all([api.devices.updateProfile(device.id, payload), api.devices.updateEnvironment(device.id, environmentPayload)]),
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

function EnvironmentOverview({ environment, loading }: { environment?: DeviceEnvironment; loading: boolean }) {
  const values = environment?.effective;
  return (
    <section className="device-profile-group device-profile-observation">
      <div className="device-profile-group-heading">
        <Leaf size={16} />
        <h3>观测资料</h3>
      </div>
      {loading ? (
        <div className="device-profile-observation-loading">正在加载观测资料…</div>
      ) : (
        <>
          <div className="device-profile-ecosystem">
            <span>生态类型</span>
            <strong>{values?.ecosystem?.name_zh ?? "未分类"}</strong>
          </div>
          <div className="device-profile-taxonomy-row">
            <span><Target size={14} />观测对象</span>
            <TaxonomyTags values={values?.observation_objects.map((term) => term.name_zh) ?? []} />
          </div>
          <div className="device-profile-observation-meta">
            <ProfileDatum
              label="投运年份"
              value={values?.commissioned_year ? String(values.commissioned_year) : "未设置"}
            />
          </div>
          {values?.research_tags?.length ? (
            <div className="device-profile-taxonomy-row device-profile-research-tags">
              <span>研究方向 / 标签</span>
              <TaxonomyTags values={values.research_tags} />
            </div>
          ) : null}
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
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div className="access-drawer-layer">
      <button className="access-drawer-backdrop" aria-label="关闭设备归属编辑" onClick={onClose} />
      <div className="access-editor device-placement-editor" role="dialog" aria-modal="true">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">调整设备归属</h2>
              <div className="panel-kicker">{device.name} · {device.serial_no}</div>
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
            <div className="form-section access-profile-fields">
              <label className="field profile-editor-field">
                <span className="field-label">所属项目</span>
                <select
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
                </select>
              </label>
              <label className="field profile-editor-field">
                <span className="field-label">所属站点</span>
                <select
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
                </select>
              </label>
            </div>
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存归属"}</Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function ProfileEditor({ profile, environment, terms, busy, onClose, onSubmit }: {
  profile: Awaited<ReturnType<typeof api.devices.profile>>;
  environment?: DeviceEnvironment;
  terms: DeviceTaxonomyTerm[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: JsonRecord, environmentPayload: JsonRecord) => Promise<void>;
}) {
  const [description, setDescription] = useState(profile.description ?? "");
  const [locationText, setLocationText] = useState(profile.location_text ?? "");
  const direct=environment?.direct;
  const effective=environment?.effective;
  const [overrides,setOverrides]=useState(()=>new Set((environment?.overridden_fields??[]).filter((field)=>field!=="altitude_m")));
  const [ecosystem,setEcosystem]=useState(direct?.ecosystem?.id??effective?.ecosystem?.id??"");
  const [observations,setObservations]=useState(direct?.observation_objects.map((term)=>term.id)??effective?.observation_objects.map((term)=>term.id)??[]);
  const [year,setYear]=useState(String(direct?.commissioned_year??effective?.commissioned_year??""));
  const [tags,setTags]=useState((direct?.research_tags??effective?.research_tags??[]).join(", "));
  const byKind=(kind:string)=>terms.filter((term)=>term.kind===kind&&term.status==="active");
  const toggle=(field:string)=>setOverrides((current)=>{const next=new Set(current);if(next.has(field))next.delete(field);else next.add(field);return next});
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      description: description.trim() || null,
      location_text: locationText.trim() || null,
    },{ecosystem_term_id:ecosystem||null,observation_object_ids:observations,purpose_ids:direct?.purposes.map((term)=>term.id)??[],management_term_id:direct?.management?.id??null,deployment_term_id:direct?.deployment?.id??null,commissioned_year:year?Number(year):null,research_tags:tags.split(",").map((value)=>value.trim()).filter(Boolean),overridden_fields:Array.from(overrides)});
  };
  return (
    <div className="access-drawer-layer">
      <button className="access-drawer-backdrop" aria-label="关闭设备资料编辑" onClick={onClose} />
      <div className="access-editor" role="dialog" aria-modal="true">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div><h2 className="panel-title">编辑设备资料</h2><div className="panel-kicker">经纬度由设备源库实时提供</div></div>
            <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
          </div>
          <form className="access-form" onSubmit={submit}>
            <div className="form-section access-profile-fields">
              <div className="profile-editor-section-head">
                <span><FileText size={16} /></span>
                <div><h3>基础资料</h3><p>补充便于识别和检索的设备信息</p></div>
              </div>
              <label className="field profile-editor-field">
                <span className="field-label">设备描述 <small>{description.length}/500</small></span>
                <textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="说明设备的安装环境、观测任务或维护备注" />
                <span className="field-hint">仅工作区成员可见，不会写回设备源库。</span>
              </label>
              <label className="field profile-editor-field">
                <span className="field-label">地址或位置说明</span>
                <div className="profile-editor-input-with-icon"><MapPin size={15} /><input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="例如：北京森林站东侧样地" /></div>
              </label>
              <div className="profile-editor-source-note"><MapPin size={15} /><span>经纬度由设备实时上报，地图和详情页直接读取 THCPN 源库；这里仅维护便于理解的位置文字。</span></div>
            </div>
            <div className="form-section environment-form-section">
              <div className="profile-editor-section-head">
                <span><Tags size={16} /></span>
                <div><h3>观测资料</h3><p>用于地图筛选、统计分析和设备归类</p></div>
              </div>
              <div className="profile-editor-inheritance-note">开启“设备覆盖”后使用当前设备设置；关闭后继续继承网关或站点。</div>
              <EnvironmentField label="生态类型" field="ecosystem" overrides={overrides} toggle={toggle}><select disabled={!overrides.has("ecosystem")} value={ecosystem} onChange={(event)=>setEcosystem(event.target.value)}><option value="">未设置</option>{byKind("ecosystem").map((term)=><option key={term.id} value={term.id}>{term.name_zh}</option>)}</select></EnvironmentField>
              <EnvironmentMultiField label="观测对象" field="observation_objects" overrides={overrides} toggle={toggle} options={byKind("observation_object")} value={observations} onChange={setObservations} />
              <EnvironmentField label="投运年份" field="commissioned_year" overrides={overrides} toggle={toggle}><input type="number" min="1900" max="2200" disabled={!overrides.has("commissioned_year")} value={year} onChange={(event)=>setYear(event.target.value)}/></EnvironmentField>
              <EnvironmentField label="研究方向 / 标签（逗号分隔）" field="research_tags" overrides={overrides} toggle={toggle}><input disabled={!overrides.has("research_tags")} value={tags} onChange={(event)=>setTags(event.target.value)}/></EnvironmentField>
            </div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存资料"}</Button></div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function EnvironmentField({label,field,overrides,toggle,children}:{label:string;field:string;overrides:Set<string>;toggle:(field:string)=>void;children:ReactNode}) {
  const enabled=overrides.has(field);
  return <div className={`field environment-field ${enabled?"is-overridden":""}`}><div className="field-label"><span>{label}</span><label className="environment-override"><input type="checkbox" checked={enabled} onChange={()=>toggle(field)}/><i aria-hidden="true"/><b>设备覆盖</b></label></div>{children}</div>;
}

function EnvironmentMultiField({label,field,overrides,toggle,options,value,onChange}:{label:string;field:string;overrides:Set<string>;toggle:(field:string)=>void;options:DeviceTaxonomyTerm[];value:string[];onChange:(value:string[])=>void}) {
  const enabled=overrides.has(field);
  const change=(id:string,checked:boolean)=>onChange(checked?Array.from(new Set([...value,id])):value.filter((item)=>item!==id));
  return <div className={`field environment-field environment-multi-field ${enabled?"is-overridden":""}`}><span className="field-label">{label}<label className="environment-override"><input type="checkbox" checked={enabled} onChange={()=>toggle(field)}/><i aria-hidden="true"/><b>设备覆盖</b></label></span><div className="taxonomy-choice-grid" aria-disabled={!enabled}>{options.map((term)=><label key={term.id} className={value.includes(term.id)?"selected":""}><input type="checkbox" disabled={!enabled} checked={value.includes(term.id)} onChange={(event)=>change(term.id,event.target.checked)}/><span>{term.name_zh}</span></label>)}</div>{!options.length&&<span className="field-hint">暂无可用分类选项</span>}</div>;
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
