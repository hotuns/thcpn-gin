import { test, expect, stamp, streams, gateway, device, nodes, noPageOverflow } from './fixtures';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const artifactDir = path.resolve('e2e/artifacts/atlas');

test('atlas management, deep blue display and personal metric settings', async ({ page }, testInfo) => {
  await mkdir(artifactDir, { recursive: true });
  const view = { id: 'atlas-blue', workspace_id: 'workspace-1', name: '生态观测一张图', template_code: 'atlas-tech', template_version: 1, template_name: '一张图', component_key: 'atlas', status: 'active', config: { presentation: 'deep-blue', layout: 'balanced', trend_hours: 24, show_images: true, show_trends: true }, created_by: 'user-e2e', created_at: stamp, updated_at: stamp };
  await page.route('**/api/v1/workspaces/workspace-1/wallboards**', route => {
    const isItem = new URL(route.request().url()).pathname.endsWith('/atlas-blue');
    const body = route.request().method() === 'PUT' ? { ...view, ...route.request().postDataJSON() } : isItem ? view : { items: [view], total: 1, can_manage: true };
    return route.fulfill({ json: body });
  });
  const environment = { observation_objects: [], purposes: [], research_tags: [] };
  const positions = [
    { ...gateway, name: '青山组网观测站', latitude: 30.10, longitude: 119.10 },
    { ...device, name: '青山标准站', latitude: 30.13, longitude: 119.12 },
    ...nodes.map((node, index) => ({ ...node, name: `林下节点 ${index + 1}`, latitude: 30.08 + index * .03, longitude: 119.04 + index * .04 })),
  ].map(item => ({ ...item, device_id: item.id, environment, location_source: 'device' }));
  await page.route('**/api/v1/device-map?**', route => route.fulfill({ json: { items: positions, total: positions.length, located: positions.length, unlocated: 0, unclassified: 0 } }));
  await page.route('**/api/v1/devices/gateway-1/nodes?**', route => route.fulfill({ json: { items: nodes.map((node, index) => ({ key: `device:${node.id}`, name: `林下节点 ${index + 1}`, custom_name: '', can_rename: true, target: { kind: 'device', device_id: node.id }, latitude: 30.08 + index * .03, longitude: 119.04 + index * .04, streams: streams.map(stream => ({ ...stream, id: `${stream.id}-${node.id}`, device_id: node.id })) })), total: nodes.length } }));
  await page.route('**/api/v1/devices/*/media/images?**', route => route.fulfill({ json: { items: [{ id: 'image-1', data_stream_id: 'stream-image', preview_url: '/digital-plot/hongliulin-preview.jpg', thumbnail_url: '/digital-plot/hongliulin-preview.jpg', captured_at: stamp }], total: 1, page: 1, page_size: 2, has_more: false } }));
  await page.route('**/api/v1/data-streams/*/telemetry?**', route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-2)!;
    const stream = streams.find(stream => id.startsWith(stream.id))!;
    const end = Date.parse(url.searchParams.get('end_time') ?? stamp);
    return route.fulfill({ json: { series: [{ data_stream_id: id, code: stream.code, name: stream.name, unit: stream.unit, complete: true, points: Array.from({ length: 24 }, (_, index) => ({ ts: new Date(end - (24 - index) * 3600000).toISOString(), value: stream.code === 'humidity' ? 65 + (index % 5) : 22 + (index % 7) / 2 })) }] } });
  });
  await page.route('**/api/v1/devices/*/profile', route => route.fulfill({ json: { images: [] } }));
  // The browser test uses a neutral raster tile to isolate layout from external map services.
  const raster = await readFile(path.resolve('e2e/fixtures/atlas-raster.png'));
  await page.route('https://server.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/png', body: raster }));
  await page.route('https://*.tianditu.gov.cn/**', route => route.fulfill({ contentType: 'image/png', body: raster }));
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', route => route.abort());
  await page.goto('/atlas');
  await expect(page.getByRole('heading', { name: '一张图管理' })).toBeVisible();
  await expect(page.locator('.atlas-saved-card')).toHaveCount(1);
  await noPageOverflow(page);
  await page.screenshot({ path: path.join(artifactDir, `management-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: '打开视图', exact: true }).click();
  await expect(page.locator('.eco-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: /全部指标 ·/ })).toBeVisible();
  await page.getByRole('combobox', { name: '选择节点', exact: true }).selectOption({ label: '林下节点 1' });
  await expect(page.locator('.eco-observation-row')).toHaveCount(2);
  await expect(page.locator('.atlas-network-overlay')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('.atlas-network-node')).toHaveCount(3);
  await expect(page.locator('.eco-map-status')).toHaveCount(0);
  await expect(page.locator('.eco-device-inspector')).toBeVisible();
  await expect(page.locator('.atlas-shell, .atlas-template-deep-blue')).toHaveCount(0);
  let previousCamera = ''; let stable = 0;
  await expect.poll(async () => {
    const next = await page.locator('.atlas-network-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')).join('|'));
    stable = next === previousCamera ? stable + 1 : 0;
    previousCamera = next; return stable;
  }, { intervals: [250], timeout: 5000 }).toBeGreaterThanOrEqual(2);
  const nodeSpread = await page.locator('.atlas-network-node').evaluateAll(nodes => {
    const xs = nodes.map(node => Number(node.getAttribute('transform')?.match(/translate\(([-\d.]+)/)?.[1]));
    return Math.max(...xs) - Math.min(...xs);
  });
  expect(nodeSpread, 'Gateway camera must finish fitting nodes after terrain falls back').toBeGreaterThan(100);
  await noPageOverflow(page);
  await page.screenshot({ path: path.join(artifactDir, `deep-blue-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: /全部指标 ·/ }).click();
  await expect(page.getByRole('heading', { name: '指标展示设置' })).toBeVisible();
  await expect.poll(async () => page.locator('.eco-metric-popover').evaluate(node => node.getBoundingClientRect().left), { timeout: 3000 }).toBeGreaterThan(400);
  await noPageOverflow(page);
  await page.screenshot({ path: path.join(artifactDir, `metric-settings-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '指标展示设置' })).not.toBeVisible();
});
