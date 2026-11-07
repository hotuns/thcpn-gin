import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Space, Typography } from "antd";
import { api, formatApiError } from "@thcpn/api";

const settingsKey = ["admin", "system-settings"];
const addressLabel = (value?: string) => value || "使用前端默认地址，未配置时随当前访问地址";

function normalizeAddress(value: string) {
  const input = value.trim();
  if (!input) return "";
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入完整的 http:// 或 https:// 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("请输入完整的 http:// 或 https:// 地址");
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("只填写协议、域名或 IP 及端口，不包含路径、账号或查询参数");
  }
  return url.origin;
}

export function AdminDeploymentSettings({ onHistory }: { onHistory: () => void }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<{ public_base_url: string }>();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const query = useQuery({ queryKey: settingsKey, queryFn: api.admin.settings.get });
  const current = query.data?.public_base_url ?? "";
  const defaultAddress = query.data?.default_public_base_url ?? "";
  useEffect(() => { form.setFieldValue("public_base_url", current); }, [current, form]);

  const review = (next: string) => { setReason(""); setConfirmation(next); };
  const submit = async () => {
    try {
      const values = await form.validateFields();
      const next = normalizeAddress(values.public_base_url || "");
      if (next === current && next) { void message.info("部署地址没有变化"); return; }
      review(next);
    } catch { /* Form validation displays the input error. */ }
  };
  const save = async () => {
    if (confirmation === null) return;
    setSaving(true);
    try {
      const result = await api.admin.settings.updateDeployment(confirmation, reason.trim());
      client.setQueryData(settingsKey, result);
      client.setQueryData(["system-policy"], result);
      await client.invalidateQueries({ queryKey: [...settingsKey, "history"] });
      form.setFieldValue("public_base_url", result.public_base_url);
      setConfirmation(null);
      void message.success("部署地址已保存，新生成的访问链接使用新地址");
    } catch (error) { void message.error(formatApiError(error).message); }
    finally { setSaving(false); }
  };

  return <Card title="部署地址" loading={query.isLoading} extra={<Button onClick={onHistory}>修改记录</Button>}>
    {query.error ? <Alert type="error" title={formatApiError(query.error).message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Descriptions size="small" column={1} items={[
        { key: "current", label: "当前生效地址", children: <Typography.Text copyable={!!current}>{addressLabel(current)}</Typography.Text> },
        { key: "default", label: "部署默认地址", children: addressLabel(defaultAddress) },
      ]} />
      <Form form={form} layout="vertical" style={{ width: "100%", maxWidth: 760 }} onFinish={() => void submit()}>
        <Form.Item name="public_base_url" label="用户端访问地址" extra="用于返回用户端、认领铭牌、公开访问和预警邮件链接。留空恢复部署默认值。" rules={[
          { max: 2048, message: "地址不能超过 2048 个字符" },
          { validator: async (_, value: string) => { normalizeAddress(value || ""); } },
        ]}>
          <Input placeholder="https://ieswatch.com" disabled={saving || !query.data} autoComplete="url" />
        </Form.Item>
        <Space wrap>
          <Button type="primary" htmlType="submit" disabled={!query.data} loading={saving}>保存部署地址</Button>
          <Button disabled={!query.data || saving} onClick={() => review("")}>恢复部署默认值</Button>
        </Space>
      </Form>
      <Alert type="info" title="此设置只修改平台生成的访问链接，域名 DNS、HTTPS 证书和服务器入口需另行配置。" />
    </Space>}
    <Modal open={confirmation !== null} title={confirmation === "" ? "确认恢复部署默认地址" : "确认修改部署地址"} width={700}
      onCancel={() => !saving && setConfirmation(null)} onOk={() => void save()} confirmLoading={saving}
      okText="确认保存" cancelText="取消" okButtonProps={{ disabled: reason.trim().length < 5 }}>
      <Descriptions bordered size="small" column={1} items={[
        { key: "before", label: "修改前", children: addressLabel(current) },
        { key: "after", label: "修改后", children: addressLabel(confirmation || defaultAddress) },
      ]} />
      <Form layout="vertical" style={{ marginTop: 16 }}><Form.Item required label="修改原因（至少 5 个字符）">
        <Input.TextArea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={500} showCount />
      </Form.Item></Form>
    </Modal>
  </Card>;
}
