// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api, formatApiError } from "./index";
import { publicErrorMessages } from "./error-messages";
afterEach(() => {document.documentElement.lang = "zh-CN";vi.unstubAllGlobals();});
it("preserves locked account context across HTTP parsing and localization", async () => {
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:"RATE_LIMITED",message:"account is temporarily locked",request_id:"req-lock",details:{reason:"ACCOUNT_LOCKED",retry_after_seconds:61,locked_until:"2026-10-25T10:00:00Z"}}}),{status:429})));
 try {await api.auth.login({identifier:"user",password:"wrong"});throw new Error("expected rejection");}
 catch(error){expect(formatApiError(error)).toMatchObject({message:expect.stringContaining("账号暂时锁定，请在约 2 分钟后重试"),requestId:"req-lock",status:429});}
});
it("distinguishes login failure, verification failure, session expiry and throttling",()=>{
 expect(formatApiError(new ApiError("invalid administrator credentials",401,undefined,undefined,"UNAUTHORIZED")).message).toContain("账号或密码不正确");
 expect(formatApiError(new ApiError("sms code is invalid or expired",401,undefined,undefined,"UNAUTHORIZED")).message).toContain("短信验证码");
 expect(formatApiError(new ApiError("expired",401,undefined,undefined,"UNAUTHORIZED")).message).toContain("登录状态已失效");
 expect(formatApiError(new ApiError("public device request limit exceeded",429,undefined,undefined,"RATE_LIMITED")).message).toContain("操作过于频繁");
});
it("does not mask business conflicts as stale data",()=>{
 expect(formatApiError(new ApiError("workspace must keep at least one active owner",409,undefined,undefined,"CONFLICT")).message).toContain("至少一位");
 expect(formatApiError(new ApiError("该手机号已注册，请直接登录",409,undefined,undefined,"CONFLICT")).message).toBe("该手机号已注册，请直接登录");
});
it.each(["DATA_SOURCE_ERROR","INTERNAL","SERVICE_UNAVAILABLE"])("hides diagnostics for %s",code=>{
 expect(formatApiError(new ApiError("postgres://secret@db SQL failed",502,undefined,undefined,code)).message).not.toContain("secret");
});
it("localizes network failures and lockout for English users",()=>{
 document.documentElement.lang="en-US";
 expect(formatApiError(new TypeError("Failed to fetch")).message).toContain("Check your network");
 expect(formatApiError(new ApiError("account is temporarily locked",429,undefined,{error:{details:{reason:"ACCOUNT_LOCKED",retry_after_seconds:61}}},"RATE_LIMITED")).message).toContain("2 minute");
});
it("contains nonempty reviewed messages",()=>{
 for(const [key,value] of Object.entries(publicErrorMessages)){expect(key.trim()).not.toBe("");expect(value.trim()).not.toBe("");}
});
