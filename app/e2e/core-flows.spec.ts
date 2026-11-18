import { test, expect, device, noPageOverflow } from "./fixtures";

const adminUrl = process.env.ADMIN_URL ?? "http://127.0.0.1:5176";

test("device filters survive returning from a detail tab and a workspace switch clears their scope", async ({ page, apiMock }, { project }) => {
  await page.goto("/devices");
  const search = page.getByRole("searchbox", { name: "搜索设备", exact: true });
  await search.fill(device.serial_no);
  await page.getByText(device.name, { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: device.name, exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.getByRole("tab", { name: "数据", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=data/);
  const back = project.name === "mobile"
    ? page.getByRole("button", { name: "返回设备", exact: true })
    : page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "设备", exact: true });
  await back.click();
  await expect(page).toHaveURL(/\/devices$/);
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

test("notifications return to their opener with its query and use overview on direct entry", async ({ page }, { project }) => {
  const mobile = project.name === "mobile";
  const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  const notification = page.getByRole("link", { name: mobile ? "查看通知" : "通知中心", exact: true });
  await page.goto("/data-compare?origin=preserve");
  await notification.click();
  await expect(page).toHaveURL(/\/notifications$/);
  await notification.click();
  const fromComparison = mobile
    ? page.getByRole("button", { name: "返回数据对比", exact: true })
    : breadcrumb.getByRole("link", { name: "数据对比", exact: true });
  await fromComparison.click();
  await expect(page).toHaveURL(/\/data-compare\?origin=preserve$/);

  await page.goto("/notifications");
  const toOverview = mobile
    ? page.getByRole("button", { name: "返回总览", exact: true })
    : breadcrumb.getByRole("link", { name: "总览", exact: true });
  await toOverview.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("dataset drafts use the same leave confirmation for top navigation and browser Back", async ({ page }, { project }) => {
  await page.goto("/datasets");
  await page.getByRole("button", { name: "创建数据集", exact: true }).click();
  const name = page.getByRole("textbox", { name: "名称", exact: true });
  await name.fill("未保存数据集");

  const back = project.name === "mobile"
    ? page.getByRole("button", { name: "返回数据集", exact: true })
    : page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "数据集", exact: true });
  const staying = page.waitForEvent("dialog");
  const click = back.click();
  const first = await staying;
  expect(first.message()).toContain("未保存的修改");
  await first.dismiss();
  await click;
  await expect(name).toHaveValue("未保存数据集");

  const leaving = page.waitForEvent("dialog");
  const pop = page.evaluate(() => window.history.back());
  const second = await leaving;
  expect(second.message()).toContain("未保存的修改");
  await second.accept();
  await pop;
  await expect(page).toHaveURL(/\/datasets$/);
});

test("switching workspaces from an editor confirms before leaving the draft", async ({ page }) => {
  await page.goto("/processing/new");
  const editor = page.getByRole("form", { name: "创建处理任务" });
  await editor.getByRole("button", { name: "下一步", exact: true }).click();
  await editor.getByRole("combobox", { name: "搜索目标设备" }).click();
  await page.getByRole("option").filter({ hasText: device.serial_no }).click();

  await page.getByRole("button", { name: /^切换(?:工作区|组织)/ }).click();
  const confirming = page.waitForEvent("dialog");
  const select = page.getByRole("option", { name: "空数据测试工作区" }).click();
  const prompt = await confirming;
  expect(prompt.message()).toContain("未保存的修改");
  await prompt.accept();
  await select;
  await expect(page).toHaveURL(/\/processing$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("thcpn.workspace.current"))).toBe("workspace-2");
});

test("processing creates only after the final review and sends the selected image input", async ({ page, apiMock }) => {
  await page.goto("/processing");
  await page.getByRole("button", { name: "创建处理任务", exact: true }).click();
  await expect(page).toHaveURL(/\/processing\/new$/);
  const editor = page.getByRole("form", { name: "创建处理任务" });
  const next = editor.getByRole("button", { name: "下一步", exact: true });
  const writes = () => apiMock.requests.filter(request => request.method === "POST");
  await expect(page.getByRole("heading", { name: "创建处理任务" })).toBeVisible();
  await next.click();
  await editor.getByRole("combobox", { name: "搜索目标设备" }).click();
  await page.getByRole("option").filter({ hasText: device.serial_no }).click();
  await editor.getByRole("combobox").filter({ hasText: "选择数据流" }).click();
  await page.getByRole("option", { name: "冠层图像", exact: true }).click();
  await noPageOverflow(page);
  await next.click();
  await next.click();
  const name = editor.getByRole("textbox", { name: "任务名称" });
  await name.fill("必要回归处理任务");
  await editor.getByRole("button", { name: "上一步", exact: true }).click();
  await next.click();
  await expect(name).toHaveValue("必要回归处理任务");
  const leaveConfirmation = page.waitForEvent("dialog");
  await Promise.all([
    leaveConfirmation.then((dialog) => dialog.dismiss()),
    editor.getByRole("button", { name: "取消", exact: true }).click(),
  ]);
  await expect(name).toHaveValue("必要回归处理任务");
  expect(writes()).toHaveLength(0);
  await noPageOverflow(page);
  await editor.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(page).toHaveURL(/\/processing\/task-created$/);
  await expect(page.getByRole("heading", { name: "必要回归处理任务", exact: true })).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(writes()[0]).toMatchObject({
    path: "/workspaces/workspace-1/processing-tasks",
    body: { name: "必要回归处理任务", target_id: device.id, inputs: [{ source_id: "stream-image" }] },
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/processing$/);
  await expect(page.getByText("必要回归处理任务", { exact: true })).toBeVisible();
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
