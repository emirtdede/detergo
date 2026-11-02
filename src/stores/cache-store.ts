import { create } from "zustand";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { CacheMeasureEvent, CacheProviderInfo } from "@/types";

interface CacheState {
  providers: CacheProviderInfo[];
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  measuring: boolean;
  measureDone: number;
  measureTotal: number;
  measureError: string | null;

  loadProviders: (force?: boolean) => Promise<void>;
  startMeasure: () => Promise<void>;
  cancelMeasure: () => Promise<void>;
  applyMeasureEvent: (event: CacheMeasureEvent) => void;
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * Measurement lives outside `CachesView` on purpose. The backend keeps walking
 * directories for the whole run, so the UI must keep receiving progress even
 * when the user visits another page and the view unmounts.
 */
export const useCacheStore = create<CacheState>((set, get) => ({
  providers: [],
  loading: false,
  loaded: false,
  loadError: null,
  measuring: false,
  measureDone: 0,
  measureTotal: 0,
  measureError: null,

  loadProviders: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, loadError: null });
    try {
      const providers = await scannerApi.getCacheProviders();
      set({ providers, loaded: true });
    } catch (err) {
      set({ loadError: describeError(err) });
    } finally {
      set({ loading: false });
    }
  },

  applyMeasureEvent: (event) => {
    switch (event.type) {
      case "started":
        set({ measureTotal: event.providerCount, measureDone: 0 });
        break;
      case "pathMeasured":
        set((state) => ({
          providers: state.providers.map((provider) => {
            if (provider.id !== event.providerId) return provider;
            const cachePaths = provider.cachePaths.map((path) =>
              path.path === event.path
                ? { ...path, exists: event.exists, bytes: event.bytes }
                : path
            );
            return { ...provider, cachePaths };
          }),
        }));
        break;
      case "providerFinished":
        set((state) => ({
          measureDone: state.measureDone + 1,
          providers: state.providers.map((provider) =>
            provider.id === event.providerId
              ? { ...provider, totalBytes: event.totalBytes, measured: true }
              : provider
          ),
        }));
        break;
      case "finished":
      case "cancelled":
        break;
    }
  },

  startMeasure: async () => {
    if (get().measuring) return;
    set({ measuring: true, measureDone: 0, measureTotal: 0, measureError: null });
    try {
      await scannerApi.measureCacheProviders((event) => get().applyMeasureEvent(event));
    } catch (err) {
      set({ measureError: describeError(err) });
    } finally {
      set({ measuring: false });
    }
  },

  cancelMeasure: async () => {
    try {
      await scannerApi.cancelCacheMeasurement();
    } catch (err) {
      set({ measureError: describeError(err) });
    }
  },
}));
