import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light" | "system";

export type ColorPalette = "navy" | "forest" | "ocean" | "sunrise" | "slate" | "teal";

export const COLOR_PALETTES: Array<{
  id: ColorPalette;
  label: string;
  description: string;
  swatch: string;
}> = [
  { id: "navy", label: "Navy", description: "EnerTech blue", swatch: "oklch(0.32 0.14 264)" },
  { id: "forest", label: "Forest", description: "EnerTech green", swatch: "oklch(0.56 0.152 158)" },
  { id: "ocean", label: "Ocean", description: "Trust blue", swatch: "oklch(0.55 0.14 245)" },
  { id: "sunrise", label: "Sunrise", description: "Energy amber", swatch: "oklch(0.68 0.15 70)" },
  { id: "slate", label: "Slate", description: "Neutral steel", swatch: "oklch(0.48 0.04 250)" },
  { id: "teal", label: "Teal", description: "Cool cyan", swatch: "oklch(0.58 0.12 195)" },
];

const THEME_KEY = "enertech-theme";
const PALETTE_KEY = "enertech-palette";

type ThemeContextValue = {
  theme: Theme;
  resolved: "dark" | "light";
  palette: ColorPalette;
  setTheme: (t: Theme) => void;
  setPalette: (p: ColorPalette) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolved: "dark",
  palette: "navy",
  setTheme: () => {},
  setPalette: () => {},
});

function isPalette(value: string | null): value is ColorPalette {
  return COLOR_PALETTES.some((p) => p.id === value);
}

function applyThemeMode(theme: Theme): "dark" | "light" {
  const dark =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  return dark ? "dark" : "light";
}

function applyPalette(palette: ColorPalette) {
  document.documentElement.dataset.palette = palette;
}

/** Runs before hydration so the first paint already has the right theme + palette. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"dark";var d=t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:t==="dark";var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";var p=localStorage.getItem("${PALETTE_KEY}")||"navy";var ok=["navy","forest","ocean","sunrise","slate","teal"];if(p==="forest"&&!localStorage.getItem("${PALETTE_KEY}-picked"))p="navy";if(ok.indexOf(p)<0)p="navy";e.setAttribute("data-palette",p);}catch(err){document.documentElement.classList.add("dark");document.documentElement.setAttribute("data-palette","navy");}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");
  const [palette, setPaletteState] = useState<ColorPalette>("navy");

  useEffect(() => {
    const storedTheme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
    const storedPaletteRaw = localStorage.getItem(PALETTE_KEY);
    const picked = localStorage.getItem(`${PALETTE_KEY}-picked`);
    const storedPalette = isPalette(storedPaletteRaw)
      ? storedPaletteRaw === "forest" && !picked
        ? "navy"
        : storedPaletteRaw
      : "navy";
    setThemeState(storedTheme);
    setPaletteState(storedPalette);
    setResolved(applyThemeMode(storedTheme));
    applyPalette(storedPalette);
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyThemeMode("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
    setResolved(applyThemeMode(t));
  }, []);

  const setPalette = useCallback((p: ColorPalette) => {
    localStorage.setItem(PALETTE_KEY, p);
    localStorage.setItem(`${PALETTE_KEY}-picked`, "1");
    setPaletteState(p);
    applyPalette(p);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, palette, setTheme, setPalette }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
