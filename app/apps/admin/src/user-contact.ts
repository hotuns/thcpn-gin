export function validateUserContact(field: "phone" | "email", value: string | undefined, other: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (!text && !(other ?? "").trim()) return "手机号或邮箱至少填写一项";
  if (!text) return undefined;
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "请输入有效的邮箱地址";
  if (field === "phone" && !/^\+?[0-9]{6,20}$/.test(text.replace(/[ \t-]/g, ""))) return "请输入有效的手机号";
  return undefined;
}
