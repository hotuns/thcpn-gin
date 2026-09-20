// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { detectLocale, detectTheme, normalizeLocale, localeStorageKey, shouldObserveLegacyDom, themeStorageKey } from "./index";
import { resources } from "./resources";
import { legacyEnglish, translateLegacyText } from "./legacy";

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

  it("only observes DOM mutations while legacy English translation is active", () => {
    expect(shouldObserveLegacyDom("zh-CN")).toBe(false);
    expect(shouldObserveLegacyDom("zh-Hans-CN")).toBe(false);
    expect(shouldObserveLegacyDom("en-US")).toBe(true);
  });

  it("registers every static Chinese business string in the platform catalog", () => {
    const sourceRoot = resolve(process.cwd(), "apps/platform/src");
    const missing = new Set<string>();
    for (const file of readdirSync(sourceRoot).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))) {
      const filename = resolve(sourceRoot, file);
      const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text.trim() : "";
        if (text && /\p{Script=Han}/u.test(text) && !legacyEnglish[text]) missing.add(text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("keeps native form controls inside shadcn primitives", () => {
    const sourceRoot = resolve(process.cwd(), "apps/platform/src");
    const violations: string[] = [];
    for (const file of readdirSync(sourceRoot).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx") && name !== "platform-ui.tsx")) {
      const contents = readFileSync(resolve(sourceRoot, file), "utf8");
      contents.split("\n").forEach((line, index) => {
        const match = line.match(/<(input|select|textarea)(?:\s|>)/);
        if (match) violations.push(`${file}:${index + 1} <${match[1]}>`);
      });
    }
    expect(violations).toEqual([]);
  });
});
