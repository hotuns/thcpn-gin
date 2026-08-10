import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export type ColorTheme =
  | "pine"
  | "ocean"
  | "clay"
  | "aurora"
  | "iris"
  | "obsidian";

const colorThemeStorageKey = "thcpn.platform.color-theme";
const colorThemes: ColorTheme[] = [
  "pine",
  "ocean",
  "clay",
  "aurora",
  "iris",
  "obsidian",
];

const readColorTheme = (): ColorTheme => {
  const stored = window.localStorage.getItem(colorThemeStorageKey);
  return colorThemes.includes(stored as ColorTheme)
    ? (stored as ColorTheme)
    : "pine";
};

const ColorThemeContext = createContext<{
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}>({ colorTheme: "pine", setColorTheme: () => undefined });

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(readColorTheme);
  const setColorTheme = (next: ColorTheme) => {
    window.localStorage.setItem(colorThemeStorageKey, next);
    setColorThemeState(next);
  };

  useLayoutEffect(() => {
    document.documentElement.dataset.colorTheme = colorTheme;
    return () => {
      delete document.documentElement.dataset.colorTheme;
    };
  }, [colorTheme]);

  return (
    <ColorThemeContext.Provider value={{ colorTheme, setColorTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme() {
  return useContext(ColorThemeContext);
}
