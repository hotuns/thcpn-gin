import { test, expect, device, noPageOverflow } from "./fixtures";

const adminUrl = process.env.ADMIN_URL ?? "http://127.0.0.1:5176";

test("device filters survive detail navigation and a workspace switch clears their scope", async ({ page, apiMock }) => {
  await page.goto("/devices");
  const search = page.getByRole("searchbox", { name: "搜索设备", exact: true });
  await search.fill(device.serial_no);
  await page.getByText(device.name, { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: device.name, exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.goBack();
  await expect(search).toHaveValue(device.serial_no);

  const workspace = page.getByRole("button", { name: /^切换(?:工作区|组织)/ });
  // Desktop uses the sidebar picker; mobile uses the header Sheet.
  await workspace.click();
  await page.getByRole("option", { name: "空数据测试工作区" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByText("没有匹配的设备", { exact: true })).toBeVisible();
  await expect.poll(() => apiMock.requests.some(request => request.path.includes("/devices?workspace_id=workspace-2"))).toBe(true);
  await noPageOverflow(page);
});

test("processing creates only after the final review and sends the selected image input", async ({ page, apiMock }) => {
  await page.goto("/processing");
  await page.getByRole("button", { name: "创建处理任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建处理任务" });
  const writes = () => apiMock.requests.filter(request => request.method === "POST");
  await dialog.getByRole("button", { name: "下一步", exact: true }).click();
  await dialog.getByRole("combobox", { name: "搜索目标设备" }).click();
  await page.getByRole("option").filter({ hasText: device.serial_no }).click();
  await dialog.getByRole("combobox").filter({ hasText: "选择数据流" }).click();
  await page.getByRole("option", { name: "冠层图像", exact: true }).click();
  await dialog.getByRole("button", { name: "下一步", exact: true }).click();
  await dialog.getByRole("button", { name: "下一步", exact: true }).click();
  expect(writes()).toHaveLength(0);
  await dialog.getByRole("textbox", { name: "任务名称" }).fill("必要回归处理任务");
  await noPageOverflow(page);
  await dialog.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes()).toHaveLength(1);
  expect(writes()[0]).toMatchObject({
    path: "/workspaces/workspace-1/processing-tasks",
    body: { name: "必要回归处理任务", target_id: device.id, inputs: [{ source_id: "stream-image" }] },
  });
});

test("admin validation prevents writes and a rejected save preserves the form with a visible error", async ({ page, apiMock }) => {
  await page.goto(`${adminUrl}/admin/devices`);
  await page.getByRole("button", { name: "创建设备", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建设备", exact: true });
  const save = dialog.locator("button.ant-btn-primary");
  await save.click();
  await expect(dialog.locator(".ant-form-item-explain-error").first()).toBeVisible();
  expect(apiMock.requests.filter(request => request.method === "POST")).toHaveLength(0);

  await dialog.getByRole("combobox", { name: /设备类型/ }).click();
  await page.locator(".ant-select-dropdown").getByText("视频站", { exact: true }).click();
  const name = dialog.getByRole("textbox", { name: /视频站名称/ });
  const serial = dialog.getByRole("textbox", { name: /萤石设备序列号/ });
  await name.fill("测试视频站");
  await serial.fill("TEST-CAMERA-001");
  await expect(save).not.toHaveClass(/ant-btn-loading/);
  await save.click();

  await expect(dialog.getByRole("alert")).toContainText("e2e-admin-save");
  await expect(name).toHaveValue("测试视频站");
  await expect(serial).toHaveValue("TEST-CAMERA-001");
  expect(apiMock.requests.filter(request => request.method === "POST")).toMatchObject([
    { path: "/admin/cameras", body: { name: "测试视频站", device_serial: "TEST-CAMERA-001" } },
  ]);
  await noPageOverflow(page);
  await dialog.getByRole("button", { name: /取\s*消/ }).click();
  await expect(dialog).toBeHidden();
});
