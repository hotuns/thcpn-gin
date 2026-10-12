import { describe, expect, it } from "vitest";
import { alertRecipientFromMember, validateAlertCondition } from "./alerts-page";

describe("alert condition validation", () => {
  const valid = { type: "telemetry_threshold", mode: "above", lower: "", upper: "0", durationMinutes: "5", offlineMinutes: "30" };
  it("accepts zero and negative thresholds without treating blanks as zero", () => {
    expect(validateAlertCondition(valid)).toBe("");
    expect(validateAlertCondition({ ...valid, upper: "-10" })).toBe("");
    expect(validateAlertCondition({ ...valid, upper: "" })).not.toBe("");
    expect(validateAlertCondition({ ...valid, upper: "Infinity" })).not.toBe("");
  });
  it("requires ordered bounds for outside rules", () => {
    expect(validateAlertCondition({ ...valid, mode: "outside", lower: "-2", upper: "3" })).toBe("");
    expect(validateAlertCondition({ ...valid, mode: "outside", lower: "3", upper: "3" })).not.toBe("");
  });
  it("checks duration and offline limits independently", () => {
    expect(validateAlertCondition({ ...valid, durationMinutes: "0" })).toBe("");
    expect(validateAlertCondition({ ...valid, durationMinutes: "43201" })).not.toBe("");
    expect(validateAlertCondition({ ...valid, type: "device_offline", upper: "", offlineMinutes: "1" })).toBe("");
    expect(validateAlertCondition({ ...valid, type: "device_offline", offlineMinutes: "0" })).not.toBe("");
    expect(validateAlertCondition({ ...valid, type: "device_offline", offlineMinutes: "1.5" })).not.toBe("");
  });
});

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
