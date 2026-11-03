import { test, expect, device, noPageOverflow } from "./fixtures";

for (const english of [false, true]) {
  test(`overview counts, trend interaction, and workspace isolation (${english ? "English dark" : "Chinese light"})`, async ({ page, apiMock }, testInfo) => {
    if (english) await page.addInitScript(() => {
      localStorage.setItem("thcpn.locale", "en-US");
      localStorage.setItem("thcpn.theme", "dark");
    });
    await page.goto("/dashboard");
    await expect(page.getByTestId("overview-records")).toHaveText("125,430");
    await expect(page.getByTestId("overview-images")).toHaveText(english ? "Unknown" : "未知");
    await expect(page.getByTestId("overview-today")).toHaveText("120");
    await expect(page.locator(".observation-overview")).not.toContainText(/部分设备的数据尚未计入|部分统计|统计不完整|Partial statistics|not complete totals|incomplete statistics|Refreshes every|每 \d+ 秒刷新/);
    await expect(page.locator(".overview-coverage, .overview-table-status")).toHaveCount(0);
    if (testInfo.project.name === "desktop") {
      const metrics = await page.locator(".overview-metric").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
      expect(Math.max(...metrics) - Math.min(...metrics)).toBeLessThan(1);
      const statistics = await page.locator(".overview-statistics").boundingBox();
      const trend = await page.locator(".overview-trend").boundingBox();
      const attention = await page.locator(".overview-attention").boundingBox();
      expect(statistics!.height).toBeLessThan(360);
      expect(trend!.y).toBeLessThan(600);
      expect(attention!.y).toBe(trend!.y);
    }
    await expect(page.getByRole("link", { name: device.name, exact: true })).toHaveAttribute("href", "/devices/device-1");
    await noPageOverflow(page);
    await page.getByRole("button", { name: english ? "Last 30 days" : "近 30 天", exact: true }).click();
    await expect(page.locator(".overview-bar-target")).toHaveCount(30);
    await expect(page.getByTestId("overview-records")).toHaveText("125,430");
    await expect.poll(() => apiMock.requests.some(request => request.path.endsWith("/dashboard?days=30"))).toBe(true);
    await page.locator(".overview-bar-target").nth(2).focus();
    await expect(page.locator(".overview-chart-readout")).toContainText("126");
    await page.locator(".overview-bar-target").nth(3).click();
    await expect(page.locator(".overview-chart-readout")).toContainText("129");
    await expect(page.locator(".overview-chart-readout")).not.toContainText(/部分统计|完整|Partial|Complete/);
    await expect(page.locator(".overview-bar-target").nth(3)).not.toHaveAccessibleName(/部分统计|完整|Partial|Complete/);
    const mark = await page.locator(".overview-bar").first().evaluate(el => ({ color: getComputedStyle(el).backgroundColor, width: el.getBoundingClientRect().width }));
    expect(mark.color).toBe(english ? "rgb(57, 135, 229)" : "rgb(42, 120, 214)");
    expect(mark.width).toBeLessThanOrEqual(24);
    await noPageOverflow(page);
    await page.locator(".overview-trend").click({ position: { x: 10, y: 10 } });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath("overview-trend.png"), fullPage: true });
    await page.getByRole("button", { name: english ? "Images" : "图片", exact: true }).click();
    await expect(page.locator(".overview-bar")).toHaveCount(0);
    await page.getByRole("button", { name: english ? "Data table" : "数据表", exact: true }).click();
    await expect(page.locator(".overview-trend-table tbody tr")).toHaveCount(30);
    await expect(page.locator(".overview-trend-table tbody tr").nth(0).locator("td").nth(0)).toHaveText(english ? "Unknown" : "未知");
    await expect(page.locator(".overview-trend-table tbody tr").nth(1).locator("td").nth(0)).toHaveText("0");
    await expect(page.locator(".overview-trend-table tbody tr").nth(2).locator("td").nth(0)).toHaveText("126");
    await expect(page.locator(".overview-trend-table")).not.toContainText(/部分统计|完整|Partial|Complete/);
    await noPageOverflow(page);
    await page.getByRole("button", { name: english ? /^Switch (workspace|organization)/i : /^切换(?:工作区|组织)/ }).click();
    await page.getByRole("option", { name: "空数据测试工作区" }).click();
    await expect(page.getByTestId("overview-records")).toHaveText("0");
    await expect(page.getByTestId("overview-images")).toHaveText("0");
    await expect(page.getByRole("link", { name: device.name, exact: true })).toHaveCount(0);
    await noPageOverflow(page);
  });
}

test("overview failure preserves unknown counts and retry restores data", async ({ page, apiMock }) => {
  apiMock.mode = "error";
  await page.goto("/dashboard");
  await expect(page.getByRole("alert").filter({ hasText: "e2e-dashboard" })).toBeVisible();
  await expect(page.getByTestId("overview-records")).toHaveText("未知");
  apiMock.mode = "data";
  await page.getByRole("button", { name: "重试", exact: true }).first().click();
  await expect(page.getByTestId("overview-records")).toHaveText("125,430");
});
