import { useCacheStore } from "@/stores/cache-store";
import { useScanStore } from "@/stores/scan-store";

/**
 * Single definition of "the app is busy scanning".
 *
 * The store status alone is not enough: a combined run keeps measuring package
 * caches after the walk reported `completed`, and the caches page can measure on
 * its own. Keeping a second, shorter copy of this predicate in `App.tsx` made
 * Ctrl+Enter silently dead in exactly that window (stop did nothing because the
 * status looked finished, and start was rejected by the controller guard).
 */
export function isScanActiveNow(): boolean {
  const { status, combinedActive } = useScanStore.getState();
  return (
    status === "scanning" ||
    status === "measuring" ||
    status === "cancelling" ||
    combinedActive ||
    useCacheStore.getState().measuring
  );
}

/** Reactive variant for components that must re-render on the same definition. */
export function useScanActive(): boolean {
  const status = useScanStore((s) => s.status);
  const combinedActive = useScanStore((s) => s.combinedActive);
  const cacheMeasuring = useCacheStore((s) => s.measuring);
  return (
    status === "scanning" ||
    status === "measuring" ||
    status === "cancelling" ||
    combinedActive ||
    cacheMeasuring
  );
}
