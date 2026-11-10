import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { api, formatApiError, type InspectionEvent, type InspectionKind, type InspectionTemplate } from "@thcpn/api";
import { sourceDateValue } from "./source-date";

const queryKey = ["admin", "device-inspection"];
const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" });
const formatTime = (value?: string | null) => value ? formatter.format(new Date(value)) : "—";
const kinds: Record<InspectionKind, string> = { late: "上报超时", missing: "指标缺值", range: "超出量程", invalid: "协议无效值", zero: "疑似卡零" };
const families: Record<string,string> = { thcpn: "标准站 / THCPN 组网", carbon: "碳汇" };
const deviceTypes: Record<string,string> = {all:"全部类型",standalone:"标准站",gateway:"组网网关",gateway_node:"组网节点"};
const eventPath = (item: InspectionEvent, tab: string) => {
  const at = new Date(item.started_at).getTime();
  const end = Math.min(Date.now(), at + 3_600_000);
  const params = new URLSearchParams({ tab, start: new Date(at - 3 * 3_600_000).toISOString(), end: new Date(end).toISOString() });
  if (item.data_stream_id) params.set("stream",item.data_stream_id);
  if (item.node_index) params.set("node_id", String(item.node_index));
  const field = item.family === "carbon" ? item.metric.match(/^(.+) 地块 · /)?.[1] : undefined;
  if (field) params.set("field", field);
  return `/admin/devices/${item.device_id}?${params}`;
};
const renderError = (error: unknown) => error ? <Alert type="error" showIcon title={formatApiError(error).message} /> : null;

export function AdminInspectionPage() {
  const cache = useQueryClient();
  const [tab, setTab] = useState("events");
  const [date, setDate] = useState(() => sourceDateValue(new Date()));
  const overview = useQuery({ queryKey: [...queryKey,"overview",date], queryFn: () => api.admin.inspectionOverview(date) });
  const counts = overview.data?.counts;
  return <Space orientation="vertical" size="middle" style={{ width:"100%" }}>
    <Row justify="space-between" align="middle">
      <Typography.Title level={3} style={{ margin:0 }}>设备巡检</Typography.Title>
      <Button onClick={() => void cache.invalidateQueries({ queryKey })}>刷新结果</Button>
    </Row>
    {renderError(overview.error)}
    <Row gutter={[12,12]}>
      {[
        ["纳入巡检",counts?.eligible],["已检查",counts?.checked],["周期未知",counts?.unknown_schedule],
        ["检查有误",counts?.failed],["检查积压",counts?.overdue],["当前待处理",counts?.unacknowledged],
      ].map(([label,value]) => <Col key={label} xs={12} sm={8} xl={4}><Card size="small" loading={overview.isLoading}><Statistic title={label} value={value ?? "—"}/></Card></Col>)}
    </Row>
    <Card size="small" title="每日汇总（北京时间）" extra={<DatePicker value={dayjs(date)} allowClear={false} onChange={(value) => { if (value) setDate(value.format("YYYY-MM-DD")); }}/>}>
      <Space size="large"><Statistic title="新增异常" value={counts?.new_events ?? "—"}/><Statistic title="已恢复" value={counts?.resolved_events ?? "—"}/></Space>
    </Card>
    <Card size="small"><Tabs activeKey={tab} onChange={setTab} items={[
      {key:"events", label:"巡检事件", children:<InspectionEvents />},
      {key:"devices", label:"覆盖状态", children:tab==="devices"?<InspectionDevices/>:null},
      {key:"templates", label:"巡检模板", children:tab==="templates"?<InspectionTemplates/>:null},
    ]}/></Card>
  </Space>;
}

function InspectionEvents() {
  const cache = useQueryClient();
  const { message } = App.useApp();
  const [status, setStatus] = useState("pending");
  const [q, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<InspectionEvent>();
  const [note, setNote] = useState("");
  const query = useQuery({ queryKey:[...queryKey,"events",status,q,page], queryFn:()=>api.admin.inspectionEvents({status,q,page}) });
  const save = useMutation({mutationFn:(item:InspectionEvent)=>api.admin.acknowledgeInspection(item.id,note), onSuccess:()=>{
    setOpen(undefined); void message.success("已确认"); void cache.invalidateQueries({queryKey});
  }});
  return <Space orientation="vertical" style={{ width:"100%" }}>
    <Space wrap>
      <Select aria-label="事件状态" value={status} onChange={(value)=>{setStatus(value);setPage(1);}} options={[
        {value:"pending",label:"待处理"},{value:"active",label:"仍在持续"},{value:"resolved",label:"已恢复"},{value:"all",label:"全部记录"},
      ]}/>
      <Input.Search aria-label="搜索事件" allowClear placeholder="设备名称、资产编号或指标" onSearch={(value)=>{setSearch(value.trim());setPage(1);}}/>
    </Space>
    {renderError(query.error)}
    <Table<InspectionEvent> size="small" rowKey="id" loading={query.isFetching} dataSource={query.data?.items ?? []} scroll={{x:900}}
      pagination={{current:page,total:query.data?.total??0,pageSize:50,showSizeChanger:false,onChange:setPage}}
      columns={[
        {title:"设备",render:(_,item)=><><Link to={`/admin/devices/${item.device_id}`}>{item.device_name}</Link><br/><Typography.Text type="secondary">{item.asset_no}{item.node_index ? ` · 节点 ${item.node_index}` : ""}</Typography.Text></>},
        {title:"异常",render:(_,item)=><><Tag color={item.kind==="zero"?"gold":"orange"}>{kinds[item.kind]}</Tag>{item.metric}<br/><Typography.Text type="secondary">{item.detail}</Typography.Text></>},
        {title:"首次异常",dataIndex:"started_at",render:formatTime},
        {title:"状态",render:(_,item)=>item.resolved_at?<Tag color="green">已恢复</Tag>:item.acknowledged_at?<Tag color="blue">已确认</Tag>:<Tag color="orange">待处理</Tag>},
        {title:"操作",render:(_,item)=><Space wrap>
          <Link to={eventPath(item,"data")}>查看数据</Link>
          {item.family==="thcpn"&&<Link to={eventPath(item,"logs")}>设备日志</Link>}
          <Button type="link" size="small" onClick={()=>{save.reset();setOpen(item);setNote("");}}>详情</Button>
        </Space>},
      ]}/>
    <Modal title="巡检事件" open={!!open} okText="确认事件" cancelText="关闭" onCancel={()=>setOpen(undefined)}
      footer={open?.acknowledged_at ? null : undefined} confirmLoading={save.isPending} onOk={()=>{if(open)save.mutate(open);}}>
      {open&&<Space orientation="vertical" style={{width:"100%"}}>
        <Descriptions column={1} size="small" items={[
          {key:"issue",label:"异常",children:`${kinds[open.kind]} · ${open.metric}`},
          {key:"evidence",label:"依据",children:open.detail},
          {key:"since",label:"首次异常",children:formatTime(open.started_at)},
          {key:"last",label:"最近确认异常",children:formatTime(open.last_seen_at)},
          {key:"resolved",label:"恢复时间",children:formatTime(open.resolved_at)},
          ...(open.acknowledged_at?[{key:"ack",label:"确认记录",children:[open.acknowledged_by,formatTime(open.acknowledged_at),open.note].filter(Boolean).join(" · ")}]:[]),
        ]}/>
        {!open.acknowledged_at&&<Input.TextArea aria-label="处理备注" placeholder="处理备注（选填）" maxLength={500} value={note} onChange={(e)=>setNote(e.target.value)}/>}
        {renderError(save.error)}
      </Space>}
    </Modal>
  </Space>;
}

function InspectionDevices() {
  const [state,setState]=useState("attention");
  const [q,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:[...queryKey,"devices",state,q,page],queryFn:()=>api.admin.inspectionDevices({state,q,page})});
  return <Space orientation="vertical" style={{width:"100%"}}>
    <Space wrap><Select aria-label="巡检覆盖状态" value={state} onChange={(v)=>{setState(v);setPage(1);}} options={[
      {value:"attention",label:"待关注"},{value:"all",label:"全部设备"},{value:"pending",label:"等待首次检查"},{value:"unknown",label:"周期未知"},{value:"error",label:"检查有误"},{value:"overdue",label:"检查积压"},
    ]}/><Input.Search aria-label="搜索设备" placeholder="设备名称或资产编号" allowClear onSearch={(v)=>{setSearch(v.trim());setPage(1);}}/></Space>
    {renderError(query.error)}
    <Table size="small" rowKey="device_id" dataSource={query.data?.items??[]} loading={query.isFetching} scroll={{x:730}}
      pagination={{current:page,total:query.data?.total??0,pageSize:50,showSizeChanger:false,onChange:setPage}}
      columns={[
        {title:"设备",render:(_,d)=><Link to={`/admin/devices/${d.device_id}`}>{d.name} · {d.asset_no}</Link>},
        {title:"设备体系",render:(_,d)=>families[d.family]??d.family},
        {title:"状态",render:(_,d)=>!d.checked_at?<Tag>等待首次检查</Tag>:d.error?<><Tag color="red">检查有误</Tag>{d.error}</>:d.overdue?<Tag color="gold">检查积压</Tag>:d.schedule_known?<Tag color="green">已检查</Tag>:<Tag color="gold">周期未知</Tag>},
        {title:"最近采样",dataIndex:"latest_sample_at",render:formatTime},
        {title:"检查时间",dataIndex:"checked_at",render:formatTime},
      ]}/>
  </Space>;
}

type TemplateForm = Omit<InspectionTemplate, "family"|"metric_code"|"unit"> & { metric: string };
const metricKey = (item: {family:string; metric_code:string; unit:string}) => JSON.stringify([item.family,item.metric_code,item.unit]);

function InspectionTemplates() {
  const cache=useQueryClient();
  const {message}=App.useApp();
  const [active,setActive]=useState<InspectionTemplate|null|undefined>();
  const [form]=Form.useForm<TemplateForm>();
  const kind=Form.useWatch("kind",form);
  const selectedMetric=Form.useWatch("metric",form);
  const items=useQuery({queryKey:[...queryKey,"templates"],queryFn:api.admin.inspectionTemplates});
  const catalog=useQuery({queryKey:[...queryKey,"metrics"],queryFn:api.admin.inspectionMetrics});
  const metrics=new Map((catalog.data?.items??[]).map((m)=>[metricKey(m),m]));
  const save=useMutation({mutationFn:api.admin.saveInspectionTemplate,onSuccess:()=>{
    void message.success("巡检模板已保存");setActive(undefined);void cache.invalidateQueries({queryKey});
  }});
  const edit=(item:InspectionTemplate|null)=>{
    save.reset();form.resetFields();
    form.setFieldsValue(item?{...item,metric:metricKey(item)}:{consecutive:3,enabled:true,kind:"range",device_type:"all"});
    setActive(item);
  };
  return <Space orientation="vertical" style={{width:"100%"}}>
    <Button type="primary" onClick={()=>edit(null)}>新建巡检模板</Button>
    {renderError(items.error)}
    <Table size="small" rowKey={(item)=>item.id??metricKey(item)} dataSource={items.data?.items??[]} loading={items.isFetching} scroll={{x:700}}
      columns={[
        {title:"适用设备",render:(_,item)=>`${families[item.family]}${item.device_type==="all"?"":` · ${deviceTypes[item.device_type]}`}`},
        {title:"指标",render:(_,item)=><>{metrics.get(metricKey(item))?.name??item.metric_code} · {item.unit||"无单位"}</>},
        {title:"判定",render:(_,item)=>`${kinds[item.kind]}${item.kind==="range"?` · ${item.lower_value??"不限"} 至 ${item.upper_value??"不限"}`:item.kind==="invalid"?` · ${item.invalid_value}`:""} · 连续 ${item.consecutive} 条`},
        {title:"状态",render:(_,item)=><Tag color={item.enabled?"green":undefined}>{item.enabled?"启用":"停用"}</Tag>},
        {title:"操作",render:(_,item)=><Button type="link" onClick={()=>edit(item)}>编辑</Button>},
      ]}/>
    <Modal title={active?"编辑巡检模板":"新建巡检模板"} open={active!==undefined} okText="保存" cancelText="取消"
      onCancel={()=>setActive(undefined)} onOk={()=>form.submit()} confirmLoading={save.isPending}>
      {renderError(catalog.error)}
      {renderError(save.error)}
      <Form form={form} layout="vertical" onFinish={(values)=>{
        const metric=active??metrics.get(values.metric);
        if(!metric)return;
        save.mutate({id:active?.id,family:metric.family,metric_code:metric.metric_code,unit:metric.unit,device_type:metric.family==="carbon"?"all":values.device_type,kind:values.kind,consecutive:values.consecutive,enabled:values.enabled,
          lower_value:values.kind==="range"?values.lower_value:null,upper_value:values.kind==="range"?values.upper_value:null,invalid_value:values.kind==="invalid"?values.invalid_value:null});
      }}>
        <Form.Item label="指标类型" name="metric" rules={[{required:true,message:"请选择指标"}]}>
          <Select showSearch optionFilterProp="label" disabled={!!active} loading={catalog.isLoading}
            options={active?[{value:metricKey(active),label:`${families[active.family]} · ${metrics.get(metricKey(active))?.name??active.metric_code} · ${active.unit||"无单位"}`}]:[...metrics].map(([value,m])=>({value,label:`${families[m.family]} · ${m.name} (${m.metric_code}${m.unit?` · ${m.unit}`:""})`}))}/>
        </Form.Item>
        {(active?.family ?? metrics.get(selectedMetric)?.family)==="thcpn"&&<Form.Item label="适用设备类型" name="device_type">
          <Select disabled={!!active} options={Object.entries(deviceTypes).map(([value,label])=>({value,label}))}/>
        </Form.Item>}
        <Form.Item label="判定方式" name="kind"><Select disabled={!!active} options={(["range","invalid","zero"] as const).map((value)=>({value,label:kinds[value]}))}/></Form.Item>
        {kind==="range"&&<Row gutter={12}><Col span={12}><Form.Item name="lower_value" label="下限"><InputNumber style={{width:"100%"}}/></Form.Item></Col><Col span={12}><Form.Item name="upper_value" label="上限"><InputNumber style={{width:"100%"}}/></Form.Item></Col></Row>}
        {kind==="invalid"&&<Form.Item name="invalid_value" label="无效值" rules={[{required:true,message:"请输入协议规定的无效值"}]}><InputNumber style={{width:"100%"}}/></Form.Item>}
        {kind==="zero"&&<Alert type="info" title="曾有非零读数，之后连续收到零值时标记为待核查。"/>}
        <Form.Item name="consecutive" label="连续有效采样数" rules={[{required:true}]}><InputNumber min={2} max={100} precision={0}/></Form.Item>
        <Form.Item name="enabled" label="启用模板" valuePropName="checked"><Switch/></Form.Item>
      </Form>
    </Modal>
  </Space>;
}
