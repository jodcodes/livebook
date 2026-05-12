"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

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

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectPreferredLocale);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
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
    [locale],
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
