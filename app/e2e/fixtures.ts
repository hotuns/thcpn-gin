import { test as base, expect, type Page } from '@playwright/test';

export const stamp = '2026-11-02T12:00:00Z';
export const longName = '森林长期生态观测标准站—超长名称与多指标移动验收ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const device = { id: 'device-1', name: longName, serial_no: 'E2E-STANDARD-001', workspace_id: 'workspace-1', project_id: 'project-1', site_id: 'site-1', status: 'active', lifecycle_status: 'online', device_type: 'standalone', topology_role: 'standalone', source_family: 'thcpn', capabilities: ['telemetry'], features: ['telemetry'], child_count: 0, tags: ['长期观测'], created_at: stamp, updated_at: stamp };
export const gateway = { ...device, id: 'gateway-1', name: '多节点生态网关', serial_no: 'E2E-GATEWAY-001', device_type: 'gateway', topology_role: 'gateway', child_count: 3 };
export const nodes = [1, 2, 3].map(n => ({ ...device, id: `node-${n}`, name: `林下节点 ${n} ${n === 3 ? longName : ''}`, serial_no: `E2E-NODE-00${n}`, device_type: 'gateway_node', topology_role: 'gateway_node', parent_device_id: gateway.id, node_index: n }));
export const devices = [device, gateway, ...nodes, ...Array.from({ length: 6 }, (_, i) => ({ ...device, id: `extra-${i}`, serial_no: `E2E-EXTRA-${i}`, name: i === 5 ? '末尾观测站' : `样地观测站 ${i + 1}` }))];
export const streams = [{ id: 'stream-temperature', code: 'temperature', name: '空气温度', unit: '°C', type: 'telemetry' }, { id: 'stream-humidity', code: 'humidity', name: '土壤湿度长期观测超长指标名称', unit: '%', type: 'telemetry' }, { id: 'stream-image', code: 'image', name: '冠层图像', unit: '', type: 'image' }].map(s => ({ ...s, device_id: device.id, status: 'active', computed: false, purpose: 'measurement', created_by: 'user-e2e', created_at: stamp, updated_at: stamp }));
const workspace = { id: 'workspace-1', name: '森林生态长期观测联合实验室超长组织名称', organization_type: 'research', status: 'active', created_at: stamp, updated_at: stamp };
const environment = { observation_objects: [], purposes: [], research_tags: ['长期观测'] };
export const plan = { id: 'plan-1', code: 'canopy', name: '冠层图像处理方案', description: '测试固定处理方案', status: 'published', current_version: 1, published_version: 1, processor_code: 'canopy', processor_version: '1.0', processor_manifest: { category: 'image', inputs: [{ code: 'image', name: '冠层图像', kind: 'image', required: true }], outputs: [{ code: 'cover', name: '覆盖率', kind: 'metric', unit: '%' }] }, parameters: {}, trigger: { mode: 'each_input' }, target_types: ['device'], created_at: stamp, updated_at: stamp };
const task = { id: 'task-1', workspace_id: workspace.id, name: `冠层处理任务 ${longName}`, description: '固定样本', target_type: 'device', target_id: device.id, target_name: device.name, status: 'active', current_version: 1, plan_id: plan.id, plan_name: plan.name, processor_code: plan.processor_code, processor_version: plan.processor_version, processor_manifest: plan.processor_manifest, config: {}, trigger: { mode: 'each_input' }, inputs: [], outputs: [], start_at: stamp, created_at: stamp, updated_at: stamp };
const rule = { id: 'rule-1', workspace_id: workspace.id, name: '空气温度高温持续预警', type: 'telemetry_threshold', severity: 'warning', device_id: device.id, device_name: device.name, data_stream_id: streams[0].id, data_stream_name: streams[0].name, unit: '°C', condition_mode: 'above', upper: 30, duration_seconds: 300, recovery_delta: 1, channels: ['in_app'], recipient_user_ids: ['user-e2e'], enabled: true, effective_status: 'active', evaluation_state: 'normal', created_at: stamp, updated_at: stamp };
const dataset = { id: 'dataset-1', workspace_id: workspace.id, project_id: 'project-1', name: `固定数据集 ${longName}`, description: '已保存的设备来源', data_type: 'telemetry', status: 'draft', time_start: '2026-11-01T00:00:00Z', time_end: stamp, sources: [{ source_type: 'device', source_id: device.id }], created_at: stamp, updated_at: stamp };
const list = (items: unknown[]) => ({ items, total: items.length });
export type Harness = { unmatched: string[]; requests: { method: string; path: string; body: unknown }[]; mode: 'data' | 'empty' | 'error' };

export const test = base.extend<{ apiMock: Harness }>({
  apiMock: [async ({ page }, use, testInfo) => {
    const state: Harness = { unmatched: [], requests: [], mode: 'data' };
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const en = testInfo.project.name.includes('en-dark');
    await page.addInitScript(({ en }) => {
      const tokens = JSON.stringify({ accessToken: 'e2e-intercepted-only', refreshToken: 'e2e-intercepted-only' });
      localStorage.setItem('thcpn.auth.tokens', tokens);
      localStorage.setItem('thcpn.admin.auth.tokens', tokens);
      localStorage.setItem('thcpn.workspace.current', 'workspace-1');
      localStorage.setItem('ecocloud:onboarding-completed:user-e2e', 'true');
      localStorage.setItem('thcpn.locale', en ? 'en-US' : 'zh-CN');
      localStorage.setItem('thcpn.theme', en ? 'dark' : 'light');
    }, { en });
    await page.route('**/api/v1/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace('/api/v1', '');
      const method = request.method();
      state.requests.push({ method, path: path + url.search, body: request.postDataJSON() });
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const empty = state.mode === 'empty' || url.searchParams.get('workspace_id') === 'workspace-2';
      if (method === 'GET') {
        if (path === '/me') return reply({ user: { id: 'user-e2e', name: '浏览器验收用户', email: 'test@example.invalid', status: 'active' } });
        if (path === '/admin/me') return reply({ admin: { id: 'admin-e2e', name: '浏览器验收管理员', email: 'admin@example.invalid', status: 'active' } });
        if (path === '/system/policy') return reply({ values: {} });
        if (path === '/workspaces') return reply(list([workspace, { ...workspace, id: 'workspace-2', name: '空数据测试工作区' }].map(w => ({ workspace: w, membership: { id: `member-${w.id}`, workspace_id: w.id, user_id: 'user-e2e', role: 'owner', status: 'active' } }))));
        if (/^\/workspaces\/workspace-[12]\/dashboard$/.test(path)) {
          if (state.mode === 'error') return reply({ error: { code: 'E2E_UNAVAILABLE', message: '验收模拟统计暂不可用', request_id: 'e2e-dashboard' } }, 503);
          const isEmpty = state.mode === 'empty' || path.includes('workspace-2');
          const days = Number(url.searchParams.get('days') ?? 7);
          const count = (value: number | null) => ({ value: isEmpty ? 0 : value, complete: isEmpty, covered_devices: isEmpty ? 0 : value == null ? 0 : 1, total_devices: isEmpty ? 0 : 2 });
          return reply({ generated_at: stamp, statistics_updated_at: isEmpty ? null : stamp, timezone: 'Asia/Shanghai', days, refresh_interval_seconds: 30,
            records: { total: count(125430), today: count(120), first_observed_at: isEmpty ? null : '2025-01-01T00:00:00Z' },
            images: { total: count(null), today: count(null) },
            trend: Array.from({ length: days }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 3 - days + i)).toISOString().slice(0, 10), records: isEmpty ? 0 : i === 0 ? null : i === 1 ? 0 : 120 + i * 3, images: isEmpty ? 0 : null, records_complete: isEmpty, images_complete: isEmpty })),
            devices: { total: isEmpty ? 0 : 2, reporting: 0, delayed: isEmpty ? 0 : 1, no_data: 0, unknown: isEmpty ? 0 : 1, inactive: 0 },
            attention: isEmpty ? [] : [{ id: 'delayed:device-1', device_id: 'device-1', name: device.name, kind: 'delayed', last_observed_at: stamp, threshold_seconds: 1200 }], active_alerts: isEmpty ? 0 : 2 });
        }
        if (path === '/notifications') return reply({ items: [], unread_count: 0 });
        if (path === '/announcements') return reply({ items: [] });
        if (path === '/projects' || path === '/admin/projects') return reply(list([{ id: 'project-1', name: '长期生态研究项目', workspace_id: workspace.id }]));
        if (path === '/sites' || path === '/admin/sites') return reply(list([{ id: 'site-1', name: '森林样地', project_id: 'project-1', workspace_id: workspace.id }]));
        if (path === '/devices' || path === '/admin/devices') {
          if (state.mode === 'error') return reply({ error: { code: 'E2E_UNAVAILABLE', message: '验收模拟设备服务暂不可用', request_id: 'e2e-error' } }, 503);
          return reply(list(empty ? [] : devices));
        }
        if (path === '/device-map' || path === '/admin/device-map') return reply({ items: empty ? [] : devices.map(d => ({ device_id: d.id, name: d.name, serial_no: d.serial_no, device_type: d.device_type, status: d.status, child_count: d.child_count, environment, location_source: 'unconfigured' })), total: empty ? 0 : devices.length, located: 0, unlocated: devices.length, unclassified: devices.length });
        if (path === '/device-taxonomy/catalog') return reply(list([]));
        if (path === '/devices/runtime') return reply({ items: devices.map(d => ({ device_id: d.id, source_device: { updated_at: stamp, online: true }, online: true, battery: 95, last_reported_at: stamp, attributes: [] })), failures: [], refreshed_at: stamp });
        if (path === '/admin/data-sources') return reply(list([]));
        if (path === '/admin/workspaces') return reply(list([workspace]));
        if (path === '/admin/metadata') return reply({ capabilities: [], device_types: [], lifecycle_statuses: [] });
        if (path === '/datasets') return reply(list(empty ? [] : [dataset]));
        if (path === '/export-jobs') return reply(list([]));
        if (path === '/processing/plans') return reply(list([plan]));
        if (/^\/workspaces\/workspace-[12]\/processing-tasks$/.test(path)) return reply(list(empty ? [] : [task]));
        if (/^\/workspaces\/workspace-[12]\/alert-rules$/.test(path)) return reply(list(empty ? [] : [rule]));
        if (/^\/workspaces\/workspace-[12]\/alert-events$/.test(path)) return reply(list([]));
        if (/^\/workspaces\/workspace-[12]\/members$/.test(path)) return reply(list([{ status: 'active', user: { id: 'user-e2e', name: '验收接收成员', email: 'test@example.invalid' } }]));
        const deviceMatch = path.match(/^\/devices\/([^/]+)$/);
        if (deviceMatch && devices.some(d => d.id === deviceMatch[1])) return reply(devices.find(d => d.id === deviceMatch[1]));
        if (/^\/devices\/gateway-1\/children$/.test(path)) return reply(list(nodes.map(n => ({ ...n, child_device_id: n.id, child_device: n, device: n, relation: { child_device_id: n.id, parent_device_id: gateway.id, node_index: n.node_index } }))));
        if (path === '/devices/gateway-1/nodes') return reply(list(nodes.map(n => ({ key: `device:${n.id}`, name: n.name, target: { kind: 'device', device_id: n.id }, streams: streams.filter(s => s.type === 'telemetry') }))));
        if (path === '/devices/gateway-1/nodes/runtime') return reply({ items: nodes.map(n => ({ key: `device:${n.id}`, battery: 3.7, rssi: -72, snr: 8, sampled_at: stamp })), refreshed_at: stamp });
        if (/^\/devices\/[^/]+\/data-streams$/.test(path)) return reply(list(streams));
        if (path === '/data-streams') return reply(list(streams));
        // This fixture's image channel intentionally has no captured frames.
        if (path === '/data-streams/stream-image/media') return reply({ items: [], total: 0, page: 1, page_size: 24, has_more: false });
        if (/^\/data-streams\/stream-[^/]+$/.test(path)) return reply(streams.find(s => s.id === path.split('/').at(-1)));
        if (/^\/(devices\/[^/]+|data-streams\/stream-[^/]+)\/telemetry$/.test(path)) {
          const selected = (url.searchParams.get('data_stream_ids') ?? '').split(',').filter(Boolean);
          const end = Date.parse(url.searchParams.get('end_time') ?? stamp);
          return reply({ device_id: device.id, start_time: url.searchParams.get('start_time'), end_time: url.searchParams.get('end_time'), limit: 500, series: streams.filter(s => s.type === 'telemetry' && (!selected.length || selected.includes(s.id))).map(s => ({ data_stream_id: s.id, device_id: device.id, code: s.code, name: s.name, unit: s.unit, source_count: 12, returned_count: 12, sampled: false, complete: true, points: Array.from({ length: 12 }, (_, n) => ({ ts: new Date(end - (12 - n) * 3600000).toISOString(), value: 20 + n / 2 })) })) });
        }
      }
      // A deliberate save rejection exercises payload validation without any real write.
      if (method === 'POST' && path === '/admin/cameras') return reply({ error: { code: 'CONFLICT', message: '验收模拟序列号冲突', request_id: 'e2e-admin-save' } }, 409);
      if (method === 'POST' && path === '/datasets') return reply({ ...dataset, ...(request.postDataJSON() ?? {}), id: 'dataset-created' });
      if (method === 'POST' && path === '/workspaces/workspace-1/processing-tasks') return reply({ ...task, ...(request.postDataJSON() ?? {}), id: 'task-created' });
      if (method === 'POST' && path === '/workspaces/workspace-1/alert-rules') return reply({ ...rule, ...(request.postDataJSON() ?? {}), id: 'rule-created' });
      if (method === 'PATCH' && path === '/workspaces/workspace-1/alert-rules/rule-1') return reply({ ...rule, ...(request.postDataJSON() ?? {}) });
      state.unmatched.push(`${method} ${path}${url.search}`);
      return reply({ error: { code: 'E2E_UNMATCHED_API', message: `Unmatched fixture: ${method} ${path}` } }, 501);
    });
    await use(state);
    await testInfo.attach('api-requests.json', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    expect(state.unmatched, 'Every API request must have an explicit contract fixture').toEqual([]);
    expect(pageErrors, 'No uncaught browser exception').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function noPageOverflow(page: Page) {
  // Radix/AntD leave exiting portals mounted during the close animation.
  // Wait only for transitions to settle; the width tolerance remains one CSS pixel.
  await expect.poll(async () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth), { timeout: 1500, message: 'Settled page must not overflow horizontally' }).toBeLessThanOrEqual(1).catch(async error => {
    const offenders = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => ({ tag: e.tagName, class: e.className, text: e.textContent?.slice(0, 100), right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width, overflow: getComputedStyle(e).overflow, minWidth: getComputedStyle(e).minWidth, whiteSpace: getComputedStyle(e).whiteSpace })).slice(0, 30));
    await test.info().attach('overflow-offenders.json', { body: JSON.stringify(offenders, null, 2), contentType: 'application/json' });
    throw error;
  });
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1; }).slice(0, 12).map(e => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right })) }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}
