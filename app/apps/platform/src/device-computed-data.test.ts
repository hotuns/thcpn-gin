import { describe, expect, it } from "vitest";
import { formulaTokenDeletionRange } from "./device-computed-data";

describe("formulaTokenDeletionRange", () => {
  const formula = "stream.temperature + meta.offset";

  it("deletes the complete variable with Backspace from inside or after it", () => {
    expect(formulaTokenDeletionRange(formula, 8, 8, "backward")).toEqual([0, 18]);
    expect(formulaTokenDeletionRange(formula, 18, 18, "backward")).toEqual([0, 18]);
  });

  it("deletes the complete variable with Delete from its start or inside it", () => {
    expect(formulaTokenDeletionRange(formula, 21, 21, "forward")).toEqual([21, 32]);
    expect(formulaTokenDeletionRange(formula, 26, 26, "forward")).toEqual([21, 32]);
  });

  it("keeps normal character deletion for operators and whitespace", () => {
    expect(formulaTokenDeletionRange(formula, 20, 20, "backward")).toBeNull();
    expect(formulaTokenDeletionRange(formula, 19, 19, "forward")).toBeNull();
  });

  it("expands a partial selection to every overlapping variable", () => {
    expect(formulaTokenDeletionRange(formula, 7, 25, "backward")).toEqual([0, 32]);
  });
});
