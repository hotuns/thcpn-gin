// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,it,expect,vi} from "vitest";
import {ExportRowActions} from "./exports-page";
import type {ExportJob} from "@thcpn/api";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
vi.mock("@thcpn/i18n",()=>({useLocale:()=>({t:(key:string)=>key})}));
describe("export row controls",()=>{
 it("uses matching buttons for details and unavailable downloads",async()=>{
  const host=document.createElement("div"),root=createRoot(host),toggle=vi.fn(),download=vi.fn();
  const job={id:"test",status:"expired",expires_at:"2020-01-01T00:00:00Z"} as ExportJob;
  try{
   await act(async()=>root.render(<ExportRowActions job={job} expanded downloading={false} retrying={false} onToggle={toggle} onDownload={download} onRetry={vi.fn()}/>));
   const buttons=host.querySelectorAll("button");expect(buttons).toHaveLength(2);
   expect(buttons[0].className).toBe(buttons[1].className);
   expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
   expect(buttons[0].getAttribute("aria-controls")).toBe("export-detail-test");
   expect(buttons[1].disabled).toBe(true);
   await act(async()=>{buttons[0].click();buttons[1].click()});expect(toggle).toHaveBeenCalledOnce();expect(download).not.toHaveBeenCalled();
   await act(async()=>root.render(<ExportRowActions job={{...job,status:"success",expires_at:"2099-01-01T00:00:00Z"}} expanded={false} downloading={false} retrying={false} onToggle={toggle} onDownload={download} onRetry={vi.fn()}/>));
   expect(host.querySelectorAll("button")[1].disabled).toBe(false);
   await act(async()=>host.querySelectorAll("button")[1].click());expect(download).toHaveBeenCalledOnce();
  }finally{await act(async()=>root.unmount())}
 });
});
