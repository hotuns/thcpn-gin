// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./breadcrumb";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("breadcrumb", () => {
  let host: HTMLDivElement;
  beforeEach(() => { host=document.createElement("div");document.body.append(host); });
  afterEach(() => host.remove());

  it("renders ancestor levels as links and the current page as text", async () => {
    const root=createRoot(host);
    await act(async()=>root.render(<MemoryRouter><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink to="/dashboard">原位生态云</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbLink to="/workspaces">工作区</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbPage>设备</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></MemoryRouter>));
    expect([...host.querySelectorAll("a")].map(item=>item.getAttribute("href"))).toEqual(["/dashboard","/workspaces"]);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("设备");
    await act(async()=>root.unmount());
  });
});
