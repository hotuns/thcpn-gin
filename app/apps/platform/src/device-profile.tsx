import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  MapPin,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  formatApiError,
  type Device,
  type DeviceProfileImage,
  type JsonRecord,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { renderPhotoToolbar } from "./device-media";

const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);

export function DeviceProfileTab({
  workspaceId,
  device,
}: {
  workspaceId: string;
  device: Device;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
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
  const refresh = async () => {
    await client.invalidateQueries({ queryKey });
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
  return (
    <>
      {feedback && <div className="command-note device-feedback">{feedback}</div>}
      <div className="device-profile-layout">
        <Panel className="device-profile-info">
          <div className="panel-header compact-panel-header">
            <div>
              <h2 className="panel-title">设备资料</h2>
              <div className="panel-kicker">设备自有信息与安装位置</div>
            </div>
            {profile.can_configure && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} />
                编辑
              </Button>
            )}
          </div>
          <div className="device-profile-description">
            {profile.description || "尚未填写设备描述。"}
          </div>
          <div className="device-profile-fields">
            <div>
              <span>位置来源</span>
              <strong>
                <Badge tone={profile.location_source === "device" ? "info" : "neutral"}>
                  {profile.location_source === "device"
                    ? "设备自定义"
                    : profile.location_source === "site"
                      ? `继承自站点${profile.site?.name ? ` · ${profile.site.name}` : ""}`
                      : "未设置"}
                </Badge>
              </strong>
            </div>
            <div>
              <span>地址</span>
              <strong>{value(location?.location_text)}</strong>
            </div>
            <div>
              <span>纬度</span>
              <strong className="mono">{value(latitude)}</strong>
            </div>
            <div>
              <span>经度</span>
              <strong className="mono">{value(longitude)}</strong>
            </div>
          </div>
          {latitude !== undefined && longitude !== undefined ? (
            <a
              className="device-location-link"
              href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={16} />
              <span>
                在地图中查看
                <small>{latitude}, {longitude}</small>
              </span>
              <ExternalLink size={14} />
            </a>
          ) : null}
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
          busy={busy}
          onClose={() => setEditing(false)}
          onSubmit={async (payload) => {
            const success = await run(
              () => api.devices.updateProfile(device.id, payload),
              "设备资料已更新",
            );
            if (success) setEditing(false);
          }}
        />
      )}
    </>
  );
}

function ProfileEditor({ profile, busy, onClose, onSubmit }: {
  profile: Awaited<ReturnType<typeof api.devices.profile>>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: JsonRecord) => Promise<void>;
}) {
  const [description, setDescription] = useState(profile.description ?? "");
  const [locationText, setLocationText] = useState(profile.location_text ?? "");
  const [latitude, setLatitude] = useState(profile.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(profile.longitude?.toString() ?? "");
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const coordinatesInvalid = Boolean(latitude) !== Boolean(longitude);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (coordinatesInvalid) return;
    void onSubmit({
      description: description.trim() || null,
      location_text: locationText.trim() || null,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
    });
  };
  return (
    <div className="access-drawer-layer">
      <button className="access-drawer-backdrop" aria-label="关闭设备资料编辑" onClick={onClose} />
      <div className="access-editor" role="dialog" aria-modal="true">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div><h2 className="panel-title">编辑设备资料</h2><div className="panel-kicker">清空设备位置后将恢复继承站点位置</div></div>
            <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
          </div>
          <form className="access-form" onSubmit={submit}>
            <div className="form-section access-profile-fields">
            <label className="field"><span className="field-label">设备描述</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} /></label>
            <label className="field"><span className="field-label">地址</span><input value={locationText} onChange={(e) => setLocationText(e.target.value)} /></label>
            <div className="access-form-grid">
              <label className="field"><span className="field-label">纬度</span><input type="number" min="-90" max="90" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label>
              <label className="field"><span className="field-label">经度</span><input type="number" min="-180" max="180" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label>
            </div>
            {coordinatesInvalid && <div className="form-error">经纬度必须同时填写或同时清空。</div>}
            </div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || coordinatesInvalid}>{busy ? "保存中…" : "保存资料"}</Button></div>
          </form>
        </Panel>
      </div>
    </div>
  );
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
