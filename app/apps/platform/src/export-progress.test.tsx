// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,it,expect,vi} from "vitest";
import {ExportProgress} from "./exports-page";
import type {ExportJob} from "@thcpn/api";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
vi.mock("@thcpn/i18n",()=>({useLocale:()=>({t:(key:string,value:{count:number,size:string})=>`${key}: ${value.count} / ${value.size}`})}));
describe("export progress",()=>{
 it("distinguishes packing and uploading and never claims bytes are uploaded",async()=>{
  const host=document.createElement("div"),root=createRoot(host);
  try {
   const job={progress:{stage:"packing",packed_images:123,packed_bytes:2*1048576}} as ExportJob;
   await act(async()=>root.render(<ExportProgress job={job}/>));
   expect(host.textContent).toBe("exportEditor.packingProgress: 123 / 2.0 MB");
   await act(async()=>root.render(<ExportProgress job={{...job,progress:{...job.progress,stage:"uploading"}}}/>));
   expect(host.textContent).toBe("exportEditor.uploadingProgress: 123 / 2.0 MB");
   await act(async()=>root.render(<ExportProgress job={{...job,progress:{}}}/>));expect(host.textContent).toBe("");
  }finally{await act(async()=>root.unmount())}
 });
});
