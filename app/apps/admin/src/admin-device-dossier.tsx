import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Cascader, Checkbox, Col, DatePicker, Descriptions, Divider, Drawer, Form, Input, Modal, Row, Select, Space, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api, formatApiError, type DeviceInstallation, type DeviceInstallationInput, type JsonRecord, type ListResponse } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";
import { formatInstallationAddress, installationRegions, splitInstallationAddress } from "./installation-address";

type DossierFields = Pick<DeviceInstallationInput, "organization" | "contact_name" | "contact_phone" | "project_name" | "ops_tags"> & {
  installed_on?: Dayjs | null;
  region?: string[];
  detail?: string;
  description?: string;
};
type CompletionFields = { installed_on: Dayjs; observation_mode: "default" | "custom"; observation_start_at?: Dayjs };
const deliveryLabels = {
  organization: "所属单位",
  project_name: "项目名称",
  contact_name: "联系人",
  contact_phone: "联系电话",
} as const;
type DeliveryKey = keyof typeof deliveryLabels;
type DeliveryDraft = Partial<Record<DeliveryKey, string>>;
type DossierCopy = { delivery: DeliveryDraft; location?: string };
const copyLabel = "从其他设备沿用交付信息和地址";

function installationFields(record: DeviceInstallation) {
  return {
    contact_name: record.contact_name ?? "",
    contact_phone: record.contact_phone ?? "",
    organization: record.organization ?? "",
    project_name: record.recorded_project_name ?? (record.linked_project_name ? "" : record.project_name),
    ops_tags: record.ops_tags ?? [],
  };
}

const display = (value?: string | null) => value
  ? <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{value}</span>
  : <Typography.Text type="secondary">未填写</Typography.Text>;

export function AdminDeviceDossier({ deviceId, lifecycle }: { deviceId: string; lifecycle: string }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [mode, setMode] = useState<"edit" | "complete" | "copy">();
  const key = ["admin", "device", deviceId, "installation"];
  const data = useQuery({ queryKey: key, queryFn: () => api.admin.deviceInstallation(deviceId) });
  const save = useMutation({
    mutationFn: (payload: DeviceInstallationInput) => api.admin.saveDeviceInstallation(deviceId, payload),
    onSuccess: (record, payload) => {
      client.setQueryData(key, record);
      if (payload.profile) void client.invalidateQueries({ queryKey: ["admin", "device", deviceId, "profile"] });
      if (payload.complete_installation) {
        const devicesKey = ["admin", "devices"];
        client.setQueryData<ListResponse<JsonRecord>>(devicesKey, current => current && ({
          ...current,
          items: current.items.map(device => device.id === deviceId ? { ...device, lifecycle_status: "online" } : device),
        }));
        void client.invalidateQueries({ queryKey: devicesKey });
        void client.invalidateQueries({ queryKey: ["admin", "device", deviceId, "lifecycle"] });
        void client.invalidateQueries({ queryKey: ["admin", "device", deviceId, "observation-start"] });
      }
      setMode(undefined);
      void message.success(payload.complete_installation ? "安装已完成，设备进入运行中" : "安装档案已保存");
    },
  });
  const open = (value: "edit" | "complete" | "copy") => { save.reset(); setMode(value); };
  const close = () => { if (!save.isPending) setMode(undefined); };
  const editing = mode === "edit" || mode === "copy";
  const record = data.data;
  const hasDossier = !!(record?.updated_at || record?.installed_on || record?.location_text || record?.description);
  const status = lifecycle === "online" ? <Tag color="green">运行中</Tag>
    : lifecycle === "retired" ? <Tag>已退役</Tag> : <Tag color="gold">待安装</Tag>;
  const failure = save.error ? formatApiError(save.error).message : undefined;

  return <>
    <Card
      title={<Space wrap>安装与交付档案{status}</Space>}
      loading={data.isLoading}
      extra={record && <Space wrap>
        <Button onClick={() => open("copy")}>{copyLabel}</Button>
        <Button type={lifecycle === "inbound" && record.installed_on ? "default" : "primary"} onClick={() => open("edit")}>{hasDossier ? "编辑档案" : "填写档案"}</Button>
        {lifecycle === "inbound" && <Button type={record.installed_on ? "primary" : "default"} onClick={() => open("complete")}>完成安装</Button>}
      </Space>}
    >
      {data.error ? <Alert type="error" title="安装档案读取失败" description={formatApiError(data.error).message} action={<Button onClick={() => void data.refetch()}>重试</Button>} /> : record && (
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions title="安装信息" column={{ xs: 1, sm: 2, lg: 2 }} size="small" bordered items={[
            { key: "date", label: "安装日期", children: display(record.installed_on) },
            { key: "installer", label: "安装人", children: display(record.installer_name) },
            { key: "address", label: "安装地址", span: "filled", children: display(record.location_text) },
            { key: "notes", label: "安装说明", span: "filled", children: display(record.description) },
            ...(record.retired_on || record.retirement_reason ? [
              { key: "retired", label: "退役日期", children: display(record.retired_on) },
              { key: "retirement", label: "退役原因", children: display(record.retirement_reason) },
            ] : []),
          ]}/>
          <Descriptions title="交付与运维" column={{ xs: 1, sm: 2, lg: 2 }} size="small" bordered items={[
            { key: "organization", label: "所属单位", children: display(record.organization) },
            { key: "project", label: "项目名称", children: display(record.project_name) },
            { key: "contact", label: "联系人", children: display(record.contact_name) },
            { key: "phone", label: "联系电话", children: display(record.contact_phone) },
            { key: "tags", label: "运维标签", children: record.ops_tags?.length ? <Space size={[4, 4]} wrap>{record.ops_tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space> : display() },
            { key: "updated", label: "最近修改", children: record.updated_at ? opsTime(record.updated_at) : "—" },
          ]}/>
        </Space>
      )}
    </Card>
    <Drawer title={hasDossier ? "编辑安装档案" : "填写安装档案"} open={editing} onClose={close}
      size="min(600px, 100vw)" destroyOnHidden closable={!save.isPending} keyboard={!save.isPending} mask={{ closable: false }}
      footer={<Space style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button disabled={save.isPending} onClick={close}>取消</Button>
        <Button type="primary" htmlType="submit" form="installation-dossier-form" loading={save.isPending}>保存档案</Button>
      </Space>}
    >
      {record && editing && <DossierEditor record={record} pending={save.isPending} error={failure} copyInitiallyOpen={mode === "copy"} onSave={payload => save.mutate(payload)} />}
    </Drawer>
    <Modal title="完成安装" open={mode === "complete"} destroyOnHidden onCancel={close}
      closable={!save.isPending} mask={{ closable: false }} keyboard={!save.isPending}
      okText="确认完成安装" cancelText="取消" confirmLoading={save.isPending}
      cancelButtonProps={{ disabled: save.isPending }} okButtonProps={{ htmlType: "submit", form: "installation-complete-form" }}>
      {record && mode === "complete" && <Form<CompletionFields> id="installation-complete-form" layout="vertical" disabled={save.isPending}
        initialValues={{ installed_on: record.installed_on ? dayjs(record.installed_on) : null, observation_mode: "default" }}
        onFinish={values => save.mutate({
          ...installationFields(record),
          installed_on: values.installed_on.format("YYYY-MM-DD"),
          complete_installation: true,
          ...(values.observation_mode === "custom" && values.observation_start_at
            ? { observation_start_at: new Date(values.observation_start_at.format("YYYY-MM-DDTHH:mm:ss") + "+08:00").toISOString() }
            : {}),
        })}>
        <Typography.Paragraph>确认后设备进入运行中，并登记正式观测起始时间。</Typography.Paragraph>
        <Form.Item name="installed_on" label="安装日期" rules={[{ required: true, message: "请选择安装日期" }]}><DatePicker style={{ width: "100%" }}/></Form.Item>
        <Form.Item name="observation_mode" label="正式观测起始时间"><Select options={[
          { value: "default", label: "保留已有时间，未设置则使用完成安装时间" },
          { value: "custom", label: "手动指定时间" },
        ]}/></Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.observation_mode !== next.observation_mode}>
          {({ getFieldValue }) => getFieldValue("observation_mode") === "custom" && (
            <Form.Item name="observation_start_at" label="指定时间（北京时间）" rules={[{ required: true, message: "请选择正式观测起始时间" }]}>
              <DatePicker showTime style={{ width: "100%" }}/>
            </Form.Item>
          )}
        </Form.Item>
        {failure && <Alert type="error" showIcon title="无法完成安装" description={failure}/>}
      </Form>}
    </Modal>
  </>;
}

function DossierEditor({ record, pending, error, copyInitiallyOpen, onSave }: {
  record: DeviceInstallation;
  pending: boolean;
  error?: string;
  copyInitiallyOpen: boolean;
  onSave: (payload: DeviceInstallationInput) => void;
}) {
  const [form] = Form.useForm<DossierFields>();
  const [copyOpen, setCopyOpen] = useState(copyInitiallyOpen);
  const [copiedAddress, setCopiedAddress] = useState<string>();
  const { message } = App.useApp();
  const address = splitInstallationAddress(record.location_text);
  const initialValues: DossierFields = {
    ...installationFields(record),
    ...address,
    installed_on: record.installed_on ? dayjs(record.installed_on) : null,
    description: record.description ?? "",
  };
  return <Form<DossierFields> id="installation-dossier-form" form={form} layout="vertical" disabled={pending} initialValues={initialValues} onFinish={values => {
    // Keep the original or copied address as stored unless the operator edits it.
    const baseAddress = copiedAddress ?? record.location_text ?? "";
    const baseFields = copiedAddress === undefined ? address : splitInstallationAddress(copiedAddress);
    const addressEdited = (values.region ?? []).join(",") !== baseFields.region.join(",") || (values.detail ?? "") !== baseFields.detail;
    const location = addressEdited ? formatInstallationAddress(values.region, values.detail) : baseAddress;
    const addressChanged = location !== (record.location_text ?? "");
    const description = values.description?.trim() ?? "";
    if (addressChanged && Array.from(location).length > 500) {
      form.setFields([{ name: "detail", errors: ["省市区县与详细地址合计最多 500 个字符"] }]);
      return;
    }
    onSave({
      installed_on: values.installed_on?.format("YYYY-MM-DD") ?? null,
      organization: values.organization,
      contact_name: values.contact_name,
      contact_phone: values.contact_phone,
      project_name: record.linked_project_name ? initialValues.project_name : values.project_name,
      ops_tags: values.ops_tags,
      ...(addressChanged || description !== (record.description ?? "") ? { profile: { location_text: location, description } } : {}),
    });
  }}>
    <Space orientation="vertical" style={{ display: "flex", marginBottom: 24 }}>
      <Button aria-expanded={copyOpen} onClick={() => setCopyOpen(!copyOpen)}>{copyOpen ? "收起来源设备选择" : copyLabel}</Button>
      {copyOpen && <DossierSource record={record} onApply={({ delivery, location }) => {
        form.setFieldsValue(delivery);
        if (location !== undefined) {
          setCopiedAddress(location);
          form.setFieldsValue(splitInstallationAddress(location));
        }
        setCopyOpen(false);
        requestAnimationFrame(() => form.scrollToField(location !== undefined ? "region" : "organization", { block: "nearest" }));
        void message.success("已带入所选内容，保存档案后生效");
      }} />}
    </Space>
    <Form.Item name="installed_on" label="安装日期"><DatePicker style={{ width: "100%" }}/></Form.Item>
    <Form.Item name="region" label="省 / 市 / 区县">
      <Cascader options={installationRegions} changeOnSelect showSearch placeholder="请选择省、市和区县" style={{ width: "100%" }}/>
    </Form.Item>
    <Form.Item name="detail" label="详细地址"><Input maxLength={500} placeholder="街道门牌、园区、样地或其他地址"/></Form.Item>
    <Form.Item name="description" label="安装说明"><Input.TextArea rows={3} maxLength={4000}/></Form.Item>
    <Divider titlePlacement="start">交付与运维</Divider>
    <Row gutter={16}>
      <Col xs={24} sm={12}><Form.Item name="organization" label="所属单位"><Input maxLength={200}/></Form.Item></Col>
      <Col xs={24} sm={12}>{record.linked_project_name
        ? <Form.Item label="关联项目"><Input value={record.linked_project_name} readOnly/></Form.Item>
        : <Form.Item name="project_name" label="项目名称"><Input maxLength={200}/></Form.Item>}
      </Col>
      <Col xs={24} sm={12}><Form.Item name="contact_name" label="联系人"><Input maxLength={200}/></Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="contact_phone" label="联系电话"><Input maxLength={200} inputMode="tel"/></Form.Item></Col>
    </Row>
    <Form.Item name="ops_tags" label="运维标签"><Select mode="tags" tokenSeparators={[",", "，"]} maxCount={30}/></Form.Item>
    {error && <Alert type="error" showIcon title="安装档案未保存" description={error}/>}
  </Form>;
}

function DossierSource({ record, onApply }: {
  record: DeviceInstallation;
  onApply: (fields: DossierCopy) => void;
}) {
  const [sourceId, setSourceId] = useState<string>();
  const [copyDelivery, setCopyDelivery] = useState(true);
  const [copyAddress, setCopyAddress] = useState(true);
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: api.admin.devices, staleTime: 30_000 });
  const source = useQuery({
    queryKey: ["admin", "device", sourceId, "installation"],
    queryFn: () => api.admin.deviceInstallation(sourceId!),
    enabled: !!sourceId,
  });
  const options = (devices.data?.items ?? []).filter(device => device.id && device.id !== record.device_id).map(device => ({
    value: String(device.id),
    label: [String(device.name || "未命名设备"), device.asset_no || device.serial_no].filter(Boolean).join(" · "),
  }));
  const fields: DeliveryDraft = {};
  if (source.data) {
    const { organization, project_name, contact_name, contact_phone } = source.data;
    if (organization?.trim()) fields.organization = organization.trim();
    if (!record.linked_project_name && project_name?.trim()) fields.project_name = project_name.trim();
    if (contact_name?.trim() || contact_phone?.trim()) {
      // Bring over the pair together, including a missing name or phone.
      fields.contact_name = contact_name?.trim() ?? "";
      fields.contact_phone = contact_phone?.trim() ?? "";
    }
  }
  const deliveryPreview = (Object.keys(deliveryLabels) as DeliveryKey[]).filter(key => fields[key] !== undefined).map(key => ({
    key, label: deliveryLabels[key], children: display(fields[key]),
  }));
  const location = source.data?.location_text?.trim() ? source.data.location_text : undefined;
  const preview = location ? [
    ...deliveryPreview, { key: "address", label: "安装地址", span: "filled" as const, children: display(location) },
  ] : deliveryPreview;
  const includeDelivery = copyDelivery && deliveryPreview.length > 0;
  const includeAddress = copyAddress && location !== undefined;
  const error = devices.error ?? source.error;

  return <Space orientation="vertical" style={{ width: "100%" }}>
    <Select
      aria-label="来源设备"
      showSearch
      optionFilterProp="label"
      allowClear
      placeholder="搜索其他设备的名称或资产编号"
      loading={devices.isLoading}
      options={options}
      value={sourceId}
      onChange={value => { setSourceId(value); setCopyDelivery(true); setCopyAddress(true); }}
      style={{ width: "100%" }}
    />
    {error ? <Alert type="error" title="来源档案读取失败" description={formatApiError(error).message}
      action={<Button size="small" onClick={() => void (devices.error ? devices.refetch() : source.refetch())}>重试</Button>} />
      : preview.length > 0 ? <>
        <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={preview}/>
        <Space wrap>
          {deliveryPreview.length > 0 && <Checkbox checked={copyDelivery} onChange={event => setCopyDelivery(event.target.checked)}>交付信息</Checkbox>}
          {location && <Checkbox checked={copyAddress} onChange={event => setCopyAddress(event.target.checked)}>安装地址</Checkbox>}
        </Space>
      </> : source.data && <Alert type="info" title="这台设备没有可沿用的交付信息或安装地址" />}
    <Button disabled={(!includeDelivery && !includeAddress) || !!error} loading={!!sourceId && source.isLoading}
      onClick={() => onApply({ delivery: includeDelivery ? fields : {}, location: includeAddress ? location : undefined })}>带入表单</Button>
  </Space>;
}

export function AdminDeviceScenes({deviceId}:{deviceId:string}){
 const client=useQueryClient();const {message}=App.useApp();const [form]=Form.useForm();const [busy,setBusy]=useState(false);
 const data=useQuery({queryKey:["admin","device",deviceId,"environment"],queryFn:()=>api.admin.deviceEnvironment(deviceId)});
 const catalog=useQuery({queryKey:["admin","device-taxonomy"],queryFn:api.admin.deviceTaxonomy});
 const independent=Form.useWatch("independent",form);
 useEffect(()=>{if(data.data)form.setFieldsValue({independent:["purposes","ecosystem","observation_objects"].some(field=>data.data!.overridden_fields.includes(field)),purpose_ids:data.data.effective.purposes.map(t=>t.id),ecosystem_term_id:data.data.effective.ecosystem?.id,observation_object_ids:data.data.effective.observation_objects.map(t=>t.id)});},[data.data,form]);
 const options=(kind:string)=>(catalog.data?.items??[]).filter(term=>term.kind===kind&&term.status==="active").map(term=>({value:term.id,label:term.name_zh}));
 return <Card title="应用场景与观测分类" loading={data.isLoading||catalog.isLoading}>
 {data.error||catalog.error?<Alert type="error" title="分类读取失败" description={formatApiError(data.error||catalog.error).message}/>:<Form form={form} layout="vertical" onFinish={async values=>{if(!data.data)return;setBusy(true);try{const old=data.data.direct;const keys=["purposes","ecosystem","observation_objects"];await api.admin.updateDeviceEnvironment(deviceId,{purpose_ids:values.purpose_ids??[],ecosystem_term_id:values.ecosystem_term_id??null,observation_object_ids:values.observation_object_ids??[],management_term_id:old.management?.id??null,deployment_term_id:old.deployment?.id??null,commissioned_year:old.commissioned_year??null,research_tags:old.research_tags,overridden_fields:[...data.data.overridden_fields.filter(k=>!keys.includes(k)),...(values.independent?keys:[])]});await client.invalidateQueries({queryKey:["admin","device"]});void message.success("应用场景已保存");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}}>
 <Form.Item name="independent" label="分类来源"><Select options={[{value:false,label:"沿用网关／站点资料"},{value:true,label:"为此设备单独设置"}]}/></Form.Item>
 <Form.Item name="purpose_ids" label="应用场景"><Select mode="multiple" disabled={!independent} options={options("purpose")}/></Form.Item>
 <Form.Item name="ecosystem_term_id" label="生态分类（可选）"><Select allowClear disabled={!independent} options={options("ecosystem")}/></Form.Item>
 <Form.Item name="observation_object_ids" label="观测对象（可选）"><Select mode="multiple" disabled={!independent} options={options("observation_object")}/></Form.Item>
 <Button type="primary" htmlType="submit" loading={busy}>保存分类</Button>
 </Form>}
 </Card>;
}
