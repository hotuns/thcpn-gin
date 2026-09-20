import { describe, expect, it } from "vitest";
import { alertRecipientFromMember } from "./alerts-page";

describe("alertRecipientFromMember", () => {
  it("uses the nested user identity and submits the user id", () => {
    expect(alertRecipientFromMember({ id: "membership-id", status: "active", user: { id: "user-id", name: "林业管理员", email: "admin@example.com", phone: "13800000000" } })).toEqual({ id: "user-id", label: "林业管理员", detail: "admin@example.com" });
  });

  it("falls back to email or phone and excludes inactive members", () => {
    expect(alertRecipientFromMember({ status: "active", user: { id: "email-user", email: "member@example.com" } })).toEqual({ id: "email-user", label: "member@example.com", detail: "" });
    expect(alertRecipientFromMember({ status: "active", user: { id: "phone-user", name: "13800000000", phone: "13800000000" } })).toEqual({ id: "phone-user", label: "13800000000", detail: "" });
    expect(alertRecipientFromMember({ status: "disabled", user: { id: "disabled-user", name: "Disabled" } })).toBeNull();
  });
});
