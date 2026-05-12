"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  LOCALE_STORAGE_KEY,
  type Locale,
  detectPreferredLocale,
  formatDate,
  formatDateTime,
  formatEnumLabel,
  formatTime,
  translate,
} from "@/lib/locale";

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  formatDate: (value: Date | string | number) => string;
  formatDateTime: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatTime: (value: Date | string | number) => string;
  formatEnumLabel: (value: string) => string;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);
const LOCALE_CHANGE_EVENT = "livebook-locale-change";

function subscribeToLocaleChanges(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(LOCALE_CHANGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(LOCALE_CHANGE_EVENT, handler);
  };
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(
    subscribeToLocaleChanges,
    detectPreferredLocale,
    () => "en",
  );

  const setLocale = useCallback((nextLocale: Locale) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    document.documentElement.lang = nextLocale;
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextType>(
    () => ({
      locale,
      setLocale,
      t: (key) => translate(locale, key),
      formatDate: (value) => formatDate(locale, value),
      formatDateTime: (value, options) => formatDateTime(locale, value, options),
      formatTime: (value) => formatTime(locale, value),
      formatEnumLabel: (value) => formatEnumLabel(locale, value),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
