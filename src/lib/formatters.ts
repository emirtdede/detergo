function resolveEffectiveLocale(locale?: string | null): string {
  if (locale && typeof locale === "string" && locale.trim()) return locale;
  try {
    if (typeof window !== "undefined") {
      const stored =
        localStorage.getItem("dev_cleaner_language") ||
        localStorage.getItem("node_cleaner_language");
      if (stored) return stored;
    }
  } catch {}
  return "en";
}

/**
 * Format bytes into human-readable representation (MB, GB, TB) formatted according to the locale.
 */
export function formatBytes(bytes: number | null | undefined, locale?: string | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) {
    return "-";
  }
  if (bytes === 0) {
    return "0 B";
  }

  const effectiveLocale = resolveEffectiveLocale(locale);
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);

  if (safeIndex === 0) {
    return `${bytes} B`;
  }

  const value = bytes / Math.pow(k, safeIndex);
  try {
    const formattedValue = new Intl.NumberFormat(effectiveLocale, {
      minimumFractionDigits: value >= 10 ? 1 : 2,
      maximumFractionDigits: value >= 10 ? 1 : 2,
    }).format(value);
    return `${formattedValue} ${sizes[safeIndex]}`;
  } catch {
    const formattedValue = value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${formattedValue} ${sizes[safeIndex]}`;
  }
}

/**
 * Signed byte delta with a real minus sign (U+2212). The old duplicated
 * helpers in the caches/history views carried a mojibake literal instead.
 */
export function formatSignedBytes(bytes: number, locale?: string | null): string {
  if (bytes === 0) return formatBytes(0, locale);
  return `${bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(bytes), locale)}`;
}

/**
 * Format date string into relative localized string and exact localized date for tooltips.
 */
export function formatDate(
  isoString: string | null | undefined,
  locale?: string | null,
): {
  relative: string;
  exact: string;
} {
  if (!isoString) {
    return { relative: "-", exact: "-" };
  }

  const effectiveLocale = resolveEffectiveLocale(locale);
  const isTr = effectiveLocale.toLowerCase().startsWith("tr");

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return { relative: "-", exact: "-" };
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    let relative = "";
    try {
      const rtf = new Intl.RelativeTimeFormat(effectiveLocale, { numeric: "auto" });
      if (diffDays < 1) {
        if (diffHours < 1) {
          if (diffMin < 1) {
            relative = isTr ? "Az önce" : rtf.format(-Math.max(1, diffSec), "second");
          } else {
            relative = rtf.format(-diffMin, "minute");
          }
        } else {
          relative = rtf.format(-diffHours, "hour");
        }
      } else if (diffDays < 30) {
        relative = rtf.format(-diffDays, "day");
      } else if (diffMonths < 12) {
        relative = rtf.format(-diffMonths, "month");
      } else {
        relative = rtf.format(-diffYears, "year");
      }
    } catch {
      // Safe fallback when Intl.RelativeTimeFormat fails for effectiveLocale
      try {
        const fallbackRtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
        if (diffDays < 1) {
          if (diffHours < 1) {
            relative = isTr ? "Az önce" : fallbackRtf.format(-Math.max(1, diffMin), "minute");
          } else {
            relative = fallbackRtf.format(-diffHours, "hour");
          }
        } else if (diffDays < 30) {
          relative = fallbackRtf.format(-diffDays, "day");
        } else if (diffMonths < 12) {
          relative = fallbackRtf.format(-diffMonths, "month");
        } else {
          relative = fallbackRtf.format(-diffYears, "year");
        }
      } catch {
        relative = isTr ? "Az önce" : "-";
      }
    }

    const exact = new Intl.DateTimeFormat(effectiveLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

    return { relative, exact };
  } catch {
    return { relative: "-", exact: "-" };
  }
}

/**
 * Path helpers live in `@/lib/format/path` so views do not have to import
 * formatting utilities from a feature component. Re-exported here for the
 * existing call sites.
 */
export { maskPath, truncatePath } from "@/lib/format/path";
