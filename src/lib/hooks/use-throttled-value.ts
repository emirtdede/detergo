import { useEffect, useRef, useState } from "react";

/**
 * Throttles a fast-changing value to a human-visible cadence.
 *
 * Byte aggregates derived from every row are expensive (the overview walks the
 * whole result set six times). Measurement events arrive at up to 20 Hz and
 * each one changes the row map identity, so without throttling a 50k-row scan
 * spent most of the main thread recomputing aggregates the eye cannot follow.
 * Counters that must look live can keep using the raw value; only the heavy
 * derivations consume the throttled one.
 */

/**
 * Shared cadence for every aggregate derived from the same scan.
 *
 * The table and the overview used to pick their own values (400 ms vs 250 ms),
 * so during a scan the two totals could disagree by up to one interval and look
 * like lost data. One constant keeps them in step and leaves a single knob.
 */
export const SCAN_AGGREGATE_THROTTLE_MS = 300;

export function useThrottledValue<T>(value: T, ms = 250): T {
  const [throttled, setThrottled] = useState(value);
  const lastApplied = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastApplied.current;
    // On mount `throttled` already equals `value`; re-setting the same
    // reference would schedule a render (and the expensive derivations behind
    // it) for no visible change.
    if (Object.is(throttled, value)) {
      lastApplied.current = now;
      return;
    }
    if (elapsed >= ms) {
      lastApplied.current = now;
      setThrottled(value);
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      lastApplied.current = Date.now();
      setThrottled(value);
    }, ms - elapsed);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [value, ms, throttled]);

  return throttled;
}
