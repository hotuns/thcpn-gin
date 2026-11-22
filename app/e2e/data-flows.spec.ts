import { test, expect, device, gateway, stamp, noPageOverflow } from "./fixtures";

test("canceling dataset creation from device data restores the applied filters", async ({ page }, { project }) => {
  const start = "2026-11-01T09:00";
  const end = "2026-11-02T09:00";
  await page.goto(`/devices/${device.id}?tab=data`);
  const humidity = page.locator(".device-query-editor").getByRole("button", { name: /^土壤湿度长期观测/ });
  const showConditions = async () => {
    if (project.name === "mobile") await page.getByRole("button", { name: "编辑条件", exact: true }).click();
  };
  await showConditions();
  await page.getByLabel("开始时间", { exact: true }).fill(start);
  await page.getByLabel("结束时间", { exact: true }).fill(end);
  await humidity.click();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "保存为数据集", exact: true }).click();
  await expect(page).toHaveURL(/\/datasets\/new\?/);
  expect(new URL(page.url()).searchParams.get("sources")).toEqual("stream-temperature");
  await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue(start);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/\/devices\/device-1\?tab=data/);
  await showConditions();
  await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue(start);
  await expect(page.getByLabel("结束时间", { exact: true })).toHaveValue(end);
  await expect(humidity).toHaveAttribute("aria-pressed", "false");
});

test("canceling a group export returns to the gateway and its applied selection", async ({ page }, { project }) => {
  const start = "2026-11-01T11:00";
  await page.route("**/api/v1/devices/*/observation-start?*", (route) => route.fulfill({ json: { effective_start_at: null, items: [] } }));
  await page.goto(`/devices/${gateway.id}?tab=data`);
  const humidity = page.locator(".device-query-editor").getByRole("button", { name: /^土壤湿度长期观测/ });
  const showConditions = async () => {
    if (project.name === "mobile") await page.getByRole("button", { name: "编辑条件", exact: true }).click();
  };
  await showConditions();
  await page.getByLabel("开始时间", { exact: true }).fill(start);
  await page.getByLabel("结束时间", { exact: true }).fill("2026-11-02T11:00");
  await humidity.click();
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.getByRole("link", { name: "导出", exact: true }).click();
  await expect(page).toHaveURL(/\/exports\/new\?system=group/);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/\/devices\/gateway-1\?tab=data/);
  await showConditions();
  await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue(start);
  await expect(humidity).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeVisible();
});

test("the legacy export entry prefills a standard station and reveals the new job", async ({ page }) => {
  let job: Record<string, unknown> | undefined;
  await page.route("**/api/v1/export-jobs**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      job = { ...request.postDataJSON(), id: "new-export-job", status: "pending", created_at: stamp, expires_at: stamp };
      await route.fulfill({ json: job });
    } else {
      await route.fulfill({ json: { items: job ? [job] : [], total: job ? 1 : 0 } });
    }
  });

  const prefill = new URLSearchParams({ system: "standard", nodes: `device:${device.id}`, start: "2026-11-01T09:00", end: "2026-11-02T09:00" });
  await page.goto(`/exports?${prefill}`);
  await expect(page).toHaveURL(/\/exports\/new\?system=standard/);
  await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue("2026-11-01T09:00");
  await page.getByRole("button", { name: "创建 ZIP 导出", exact: true }).click();
  await expect(page).toHaveURL(/\/exports$/);
  await expect(page.getByText("导出任务已创建", { exact: true })).toBeVisible();
  await expect(page.locator(".export-created-row")).toContainText("new-export-j");
  await expect(page.getByRole("heading", { name: /^导出目标/ })).toBeVisible();
  expect(job?.request_config).toMatchObject({ device_ids: [device.id] });
  await noPageOverflow(page);
});
