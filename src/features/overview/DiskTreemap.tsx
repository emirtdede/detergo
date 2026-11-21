import React, { useEffect, useMemo, useRef, useState } from "react";
import { CleanupItem } from "@/types";
import { formatBytes } from "@/lib/formatters";
import { itemBucket } from "@/lib/classify";
import { maskPath } from "@/lib/format/path";

export interface TreemapEntry {
  id: string;
  label: string;
  subtitle: string;
  fullPath: string;
  bytes: number;
  bucket: string;
  searchTerm: string;
  targetView: "projects" | "agents";
}

export interface TreemapRect extends TreemapEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  percent: number;
}

const BUCKET_COLORS: Record<string, string> = {
  node: "var(--accent)",
  rust: "var(--eco-rust)",
  python: "var(--success)",
  agent: "var(--eco-agent)",
  cache: "var(--eco-cache)",
  other: "var(--text-muted)",
};

function worstAspectRatio(row: number[], shortSide: number): number {
  if (row.length === 0 || shortSide <= 0) return Infinity;
  let sum = 0;
  let maxVal = 0;
  let minVal = Infinity;
  for (const v of row) {
    sum += v;
    if (v > maxVal) maxVal = v;
    if (v < minVal) minVal = v;
  }
  if (sum <= 0 || minVal <= 0) return Infinity;
  const s2 = sum * sum;
  const w2 = shortSide * shortSide;
  return Math.max((w2 * maxVal) / s2, s2 / (w2 * minVal));
}

/**
 * Pure squarified treemap layout (Bruls, Huizing, van Wijk) computed in the
 * container's real aspect ratio (`canvasWidth x canvasHeight`) and then
 * normalized into percentage coordinates (`0..100`) so tiles stay well-proportioned
 * across widescreen and compact windows alike.
 */
export function squarify(
  entries: TreemapEntry[],
  totalBytes: number,
  canvasWidth = 800,
  canvasHeight = 260,
): TreemapRect[] {
  if (entries.length === 0 || totalBytes <= 0) return [];
  const safeW = Math.max(1, canvasWidth);
  const safeH = Math.max(1, canvasHeight);
  const totalArea = safeW * safeH;
  const items = entries
    .filter((e) => e.bytes > 0)
    .map((entry) => ({
      entry,
      area: (entry.bytes / totalBytes) * totalArea,
    }));

  const rects: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = safeW;
  let h = safeH;
  let idx = 0;

  while (idx < items.length && w > 0.01 && h > 0.01) {
    const horizontal = w >= h;
    const shortSide = horizontal ? h : w;
    const row: typeof items = [items[idx]];
    let rowAreas = [items[idx].area];
    idx += 1;

    while (idx < items.length) {
      const candidate = items[idx];
      const nextAreas = [...rowAreas, candidate.area];
      if (worstAspectRatio(nextAreas, shortSide) <= worstAspectRatio(rowAreas, shortSide)) {
        row.push(candidate);
        rowAreas = nextAreas;
        idx += 1;
      } else {
        break;
      }
    }

    const rowAreaSum = rowAreas.reduce((acc, a) => acc + a, 0);
    if (horizontal) {
      const stripW = rowAreaSum / h;
      let cy = y;
      for (const item of row) {
        const tileH = stripW > 0 ? item.area / stripW : 0;
        rects.push({
          ...item.entry,
          x: (x / safeW) * 100,
          y: (cy / safeH) * 100,
          w: (stripW / safeW) * 100,
          h: (tileH / safeH) * 100,
          percent: (item.entry.bytes / totalBytes) * 100,
        });
        cy += tileH;
      }
      x += stripW;
      w = Math.max(0, w - stripW);
    } else {
      const stripH = rowAreaSum / w;
      let cx = x;
      for (const item of row) {
        const tileW = stripH > 0 ? item.area / stripH : 0;
        rects.push({
          ...item.entry,
          x: (cx / safeW) * 100,
          y: (y / safeH) * 100,
          w: (tileW / safeW) * 100,
          h: (stripH / safeH) * 100,
          percent: (item.entry.bytes / totalBytes) * 100,
        });
        cx += tileW;
      }
      y += stripH;
      h = Math.max(0, h - stripH);
    }
  }

  return rects;
}

interface DiskTreemapProps {
  items: CleanupItem[];
  ownBytes: Map<string, { estimatedReclaimBytes: number }>;
  language?: string | null;
  maskPaths: boolean;
  title: string;
  subtitle: string;
  otherLabel?: string;
  onInspect: (view: "projects" | "agents", query: string) => void;
}

export const DiskTreemap: React.FC<DiskTreemapProps> = ({
  items,
  ownBytes,
  language,
  maskPaths,
  title,
  subtitle,
  otherLabel = "Other",
  onInspect,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 260 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasSize((prev) =>
          Math.abs(prev.width - rect.width) > 4 || Math.abs(prev.height - rect.height) > 4
            ? { width: rect.width, height: rect.height }
            : prev,
        );
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(() => {
    const cleanable: TreemapEntry[] = [];
    let grandTotal = 0;
    for (const item of items) {
      if (!item.selectable || item.protected || item.safetyClass === "keep") continue;
      const bytes = ownBytes.get(item.id)?.estimatedReclaimBytes ?? 0;
      if (bytes <= 0) continue;
      grandTotal += bytes;
      const bucket = itemBucket(item);
      cleanable.push({
        id: item.id,
        label: item.projectName ? `${item.projectName} / ${item.displayName}` : item.displayName,
        subtitle: item.displayName,
        fullPath: maskPaths ? maskPath(item.displayPath) : item.displayPath,
        bytes,
        bucket,
        searchTerm: item.projectName || item.displayName,
        targetView: bucket === "agent" ? "agents" : "projects",
      });
    }
    cleanable.sort((a, b) => b.bytes - a.bytes);
    const MAX_INDIVIDUAL = 15;
    let visible = cleanable;
    if (cleanable.length > MAX_INDIVIDUAL + 1) {
      const top = cleanable.slice(0, MAX_INDIVIDUAL);
      const rest = cleanable.slice(MAX_INDIVIDUAL);
      const restBytes = rest.reduce((sum, entry) => sum + entry.bytes, 0);
      if (restBytes > 0) {
        const dominantView =
          rest.filter((e) => e.targetView === "agents").length > rest.length / 2
            ? "agents"
            : "projects";
        top.push({
          id: "__treemap_other__",
          label: `+${rest.length} ${otherLabel}`,
          subtitle: otherLabel,
          fullPath: `${rest.length} ${otherLabel}`,
          bytes: restBytes,
          bucket: "other",
          searchTerm: "",
          targetView: dominantView,
        });
      }
      visible = top;
    }
    return squarify(visible, grandTotal, canvasSize.width, canvasSize.height);
  }, [items, ownBytes, maskPaths, otherLabel, canvasSize.width, canvasSize.height]);

  if (tiles.length === 0) return null;

  return (
    <section className="overview-treemap-panel" aria-label={title}>
      <div className="overview-panel-header">
        <div className="overview-panel-title-group">
          <h2 className="overview-panel-title">{title}</h2>
          <span className="overview-panel-desc">{subtitle}</span>
        </div>
      </div>

      <div className="overview-treemap-canvas" ref={canvasRef} role="group" aria-label={title}>
        {tiles.map((tile) => {
          const color = BUCKET_COLORS[tile.bucket] ?? BUCKET_COLORS.other;
          const showLabel = tile.w >= 10 && tile.h >= 16;
          const showMeta = tile.w >= 14 && tile.h >= 28;
          const sizeLabel = formatBytes(tile.bytes, language);
          return (
            <button
              key={tile.id}
              type="button"
              className="overview-treemap-tile"
              style={
                {
                  left: `${tile.x}%`,
                  top: `${tile.y}%`,
                  width: `${tile.w}%`,
                  height: `${tile.h}%`,
                  "--tile-color": color,
                } as React.CSSProperties
              }
              title={`${tile.label} - ${sizeLabel} (${tile.percent.toFixed(1)}%)\n${tile.fullPath}`}
              aria-label={`${tile.label}: ${sizeLabel} (${tile.percent.toFixed(1)}%)`}
              onClick={() => onInspect(tile.targetView, tile.searchTerm)}
            >
              {showLabel && <span className="overview-treemap-name">{tile.label}</span>}
              {showMeta && (
                <span className="overview-treemap-size">
                  {sizeLabel} · {tile.percent.toFixed(1)}%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};
