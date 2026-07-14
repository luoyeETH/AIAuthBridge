import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "session-converter-theme";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "系统",
  light: "浅色",
  dark: "深色",
};

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) {
      return stored;
    }
  } catch {
    // ignore private-mode / blocked storage
  }
  return "system";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

export function applyTheme(mode: ThemeMode, resolved: ResolvedTheme = resolveTheme(mode)) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0a0a0a" : "#ffffff");
  }
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredThemeMode()));

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    const nextResolved = resolveTheme(next);
    setResolved(nextResolved);
    applyTheme(next, nextResolved);
  }, []);

  useEffect(() => {
    applyTheme(mode, resolved);
  }, [mode, resolved]);

  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const nextResolved = getSystemTheme();
      setResolved(nextResolved);
      applyTheme("system", nextResolved);
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  return { mode, resolved, setMode };
}
