"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "autobureau.theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Inlined in <head> before paint so the correct theme is applied on the first frame.
 * Without this the user sees a light flash before a dark preference resolves — a
 * small thing that reads as sloppiness in a product asking for trust.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=p==="light"||p==="dark"?p:(m?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

/**
 * Both inputs to the theme are *external stores*, not React state: the OS colour
 * preference and the persisted choice in localStorage. Reading them in an effect and
 * calling setState works, but costs a second render on every mount and trips the
 * cascading-render rule. `useSyncExternalStore` is the API built for exactly this —
 * it reads the store during render, subscribes for changes, and takes an explicit
 * server snapshot so hydration can never mismatch.
 */

const storageListeners = new Set<() => void>();

/**
 * Last choice made in this tab. It exists so the toggle still works when storage is
 * unavailable (private browsing, blocked cookies) — the preference simply doesn't
 * outlive the session, which is far better than a control that appears to do nothing.
 * Cleared on a cross-tab `storage` event so another tab's change wins.
 */
let sessionPreference: ThemePreference | null = null;

function subscribePreference(onChange: () => void): () => void {
  // `storage` only fires in *other* tabs, so same-tab writes notify through the set.
  storageListeners.add(onChange);
  const onStorage = () => {
    sessionPreference = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    storageListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readPreference(): ThemePreference {
  if (sessionPreference !== null) return sessionPreference;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Server and first hydration render: no storage, no media query — assume system. */
const preferenceServerSnapshot = (): ThemePreference => "system";

function subscribeSystemDark(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const readSystemDark = (): boolean =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;
const systemDarkServerSnapshot = (): boolean => false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    preferenceServerSnapshot,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    readSystemDark,
    systemDarkServerSnapshot,
  );

  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    sessionPreference = next;
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    // The store is the source of truth; notifying re-reads it for every subscriber.
    for (const listener of storageListeners) listener();
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
