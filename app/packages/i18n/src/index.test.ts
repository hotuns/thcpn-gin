// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { detectLocale, detectTheme, normalizeLocale, localeStorageKey, themeStorageKey } from "./index";
import { resources } from "./resources";
import { translateLegacyText } from "./legacy";

const flatten = (value: unknown, prefix = ""): string[] => {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
};

describe("i18n resources", () => {
  it("keeps Chinese and English resource keys in sync", () => {
    expect(flatten(resources["en-US"]).sort()).toEqual(flatten(resources["zh-CN"]).sort());
  });

  it("normalizes browser locales", () => {
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("fr-FR")).toBe("en-US");
  });

  it("prefers a valid stored locale and ignores invalid values", () => {
    localStorage.setItem(localeStorageKey, "zh-CN");
    expect(detectLocale()).toBe("zh-CN");
    localStorage.setItem(localeStorageKey, "invalid");
    expect(detectLocale()).toBe(normalizeLocale(navigator.languages?.[0] ?? navigator.language));
  });

  it("defaults to light theme and preserves a valid stored preference", () => {
    localStorage.removeItem(themeStorageKey);
    expect(detectTheme()).toBe("light");
    localStorage.setItem(themeStorageKey, "dark");
    expect(detectTheme()).toBe("dark");
  });

  it("translates registered legacy UI text without changing domain names", () => {
    expect(translateLegacyText("设备详情")).toBe("Device details");
    expect(translateLegacyText("北京森林站")).toBe("北京森林站");
  });
});
