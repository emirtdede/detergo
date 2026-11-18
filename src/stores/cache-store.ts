import { create } from "zustand";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { toAppError } from "@/lib/errors/app-error";
import { AppErrorDto, CacheMeasureEvent, CacheProviderInfo } from "@/types";

interface CacheState {
  providers: CacheProviderInfo[];
  loading: boolean;
  loaded: boolean;
  loadError: AppErrorDto | null;
  measuring: boolean;
  measureDone: number;
  measureTotal: number;
  measureError: AppErrorDto | null;

  loadProviders: (force?: boolean) => Promise<void>;
  startMeasure: (providerIds?: string[]) => Promise<void>;
  cancelMeasure: () => Promise<void>;
  applyMeasureEvent: (event: CacheMeasureEvent) => void;
}

/**
 * Monotonic id of the measurement the UI currently wants.
 *
 * `startMeasure` and `cancelMeasure` both cross the IPC bridge. A cancel only
 * awaits its command, it cannot stop the start promise that is already in
 * flight: without this guard the *old* run's `finally` (or a late `finished`
 * event from its channel) flipped `measuring` to false while the new run was
 * still walking the disk. The header then offered "Scan" during a live
 * measurement and let the user start a second scan over it.
 *
 * Kept at module scope on purpose: it describes backend sessions, not render
 * state, and must survive a component unmount.
 */
let measureRunId = 0;

/** In-flight provider metadata load, shared by every concurrent caller. */
let providerLoad: Promise<void> | null = null;

/** Exported for tests: a real run id must not leak between cases. */
export function resetCacheMeasureRunForTests(): void {
  measureRunId = 0;
  providerLoad = null;
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
    // A concurrent caller must wait for the in-flight load instead of returning
    // immediately: `startMeasure` relies on this await to guarantee that the
    // rows exist before the first `pathMeasured` event can arrive.
    if (providerLoad) return providerLoad;
    if (get().loaded && !force) return;
    providerLoad = (async () => {
      set({ loading: true, loadError: null });
      try {
        const fresh = await scannerApi.getCacheProviders();
        // Metadata refreshes must not erase measurements: the provider list is
        // fetched without walking directories, so every fresh provider reports
        // `measured: false, totalBytes: 0`. Replacing the list wholesale made a
        // single official action wipe every size on the page.
        const previous = get().providers;
        const merged = fresh.map((incoming) => {
          const old = previous.find((provider) => provider.id === incoming.id);
          if (!old?.measured) return incoming;
          const oldPaths = new Map(old.cachePaths.map((path) => [path.path, path]));
          const cachePaths = incoming.cachePaths.map((path) => {
            const oldPath = oldPaths.get(path.path);
            // A path that disappeared must not keep its old size (L1).
            if (!oldPath || !path.exists) return path;
            if (oldPath.bytes === null || oldPath.bytes === undefined) return path;
            return {
              ...path,
              bytes: oldPath.bytes,
              unmeasuredReason: oldPath.unmeasuredReason ?? path.unmeasuredReason,
            };
          });
          // Re-derive the provider total from the surviving paths; copying the
          // old total kept bytes for folders that no longer exist.
          const totalBytes = cachePaths.reduce((sum, path) => sum + (path.bytes ?? 0), 0);
          return {
            ...incoming,
            measured: true,
            totalBytes,
            cachePaths,
          };
        });
        set({ providers: merged, loaded: true });
      } catch (err) {
        // A failed provider load also blocks measurement: the progress card must
        // explain why nothing was measured instead of sitting silent at 0/0.
        set({ loadError: toAppError(err), measureError: toAppError(err) });
      } finally {
        set({ loading: false });
      }
    })();
    try {
      await providerLoad;
    } finally {
      providerLoad = null;
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
                ? {
                    ...path,
                    exists: event.exists,
                    bytes: event.bytes,
                    unmeasuredReason: event.unmeasuredReason ?? null,
                  }
                : path,
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
              : provider,
          ),
        }));
        break;
      case "finished":
        set({ measuring: false, measureError: null });
        break;
      case "cancelled":
        // A cancelled run must not leave a half-filled progress counter behind:
        // the next run starts from zero and the UI would otherwise show e.g.
        // "3/8" forever.
        set({ measuring: false, measureDone: 0, measureTotal: 0 });
        break;
    }
  },

  startMeasure: async (providerIds?: string[]) => {
    // The provider rows must exist before events stream in: `pathMeasured` and
    // `providerFinished` update existing rows, so an empty list silently drops
    // every measured size and the page still reads "not measured" afterwards.
    // Guaranteeing the load here means every caller (header menu, Caches page,
    // combined scan) gets the same behaviour instead of each one remembering.
    await get().loadProviders();
    if (get().providers.length === 0) {
      // Nothing to measure: a measurement without rows cannot record anything,
      // and starting one would report 0/N forever.
      return;
    }

    const runId = ++measureRunId;
    // Starting a second run used to return silently, leaving the caller to
    // believe its request was honoured. Cancel the running measurement first
    // so the new request actually runs (L1).
    if (get().measuring) {
      await get().cancelMeasure();
    }
    // The cancel above may have been superseded by another start while it was
    // awaiting; that newer run owns the state now.
    if (runId !== measureRunId) return;

    const scoped = providerIds && providerIds.length > 0 ? new Set(providerIds) : null;
    set((state) => ({
      measuring: true,
      measureDone: 0,
      measureTotal: 0,
      measureError: null,
      // Sizes from the previous run are stale as soon as a new measurement
      // begins; keeping them made the totals look complete while it ran. A
      // scoped run (after an official action) only invalidates its providers.
      providers: state.providers.map((provider) =>
        scoped && !scoped.has(provider.id)
          ? provider
          : { ...provider, measured: false, totalBytes: 0 },
      ),
    }));
    try {
      await scannerApi.measureCacheProviders(
        (event) => {
          // Late events from a superseded run must not touch this session.
          if (runId === measureRunId) get().applyMeasureEvent(event);
        },
        scoped ? [...scoped] : undefined,
      );
    } catch (err) {
      if (runId === measureRunId) set({ measureError: toAppError(err) });
    } finally {
      // Only the current run may clear the flag: the previous run's `finally`
      // used to turn off `measuring` for a measurement that was still running.
      if (runId === measureRunId) set({ measuring: false });
    }
  },

  cancelMeasure: async () => {
    const runId = measureRunId;
    try {
      await scannerApi.cancelCacheMeasurement();
    } catch (err) {
      // A failed cancel belongs to the run that asked for it, not to whatever
      // started while the command was in flight.
      if (runId === measureRunId) set({ measureError: toAppError(err) });
    }
  },
}));
