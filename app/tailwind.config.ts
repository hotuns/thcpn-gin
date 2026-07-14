import type { Config } from "tailwindcss";

export default {
  content: ["./apps/**/*.{ts,tsx}", "./packages/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: []
} satisfies Config;
