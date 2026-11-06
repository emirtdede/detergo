import React, { useMemo, useState, useEffect } from "react";
import {
  ShieldCheck,
  FolderTree,
  HardDrive,
  TrendingDown,
  TrendingUp,
  ArrowUpRight,
  Code2,
  Bot,
  Zap,
  Sparkles,
  History,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useScanStore } from "@/stores/scan-store";
import { useUIText } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { formatBytes, formatSignedBytes, truncatePath } from "@/lib/formatters";
import { maskPath } from "@/features/items/ItemTable";
import { SafetyBadge } from "@/features/items/SafetyBadge";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAppStore } from "@/stores/app-store";
import { useCacheStore } from "@/stores/cache-store";
import { scannerApi } from "@/lib/tauri/scanner-api";
import "../items/items.css";
import "./overview.css";

export const OverviewView: React.FC = () => {
  const ui = useUIText();
  const { isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const progress = useScanStore((s) => s.progress);
  const previousSummary = useScanStore((s) => s.previousSummary);
  const previousCleanableBytes = useScanStore((s) => s.previousCleanableBytes);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const setView = useAppStore((s) => s.setView);
  const cacheProviders = useCacheStore((s) => s.providers);
  const loadCacheProviders = useCacheStore((s) => s.loadProviders);
  const showToast = useUiStore((s) => s.showToast);
  const restored = useScanStore((s) => s.restored);

  const handleReset = () => {
    useScanStore.getState().resetScan();
    useSelectionStore.getState().clearSelection();
    showToast(ui.overview.resetToast, "info");
  };

  const handleRestoreLastScan = async () => {
    try {
      const snapshot = await scannerApi.getLastScan();
      if (snapshot && snapshot.summary) {
        useScanStore.getState().restoreScan(snapshot);
        showToast(ui.overview.restoreSuccessToast, "success");
      } else {
        showToast(ui.overview.noLastScanToast, "error");
      }
    } catch (err) {
      showToast(`Geri yükleme başarısız: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

    const [lifetimeReclaimed, setLifetimeReclaimed] = useState<number>(0);
  const [lifetimeRuns, setLifetimeRuns] = useState<number>(0);

  useEffect(() => {
    
    scannerApi
      .getCleanupHistory(100)
      .then((records) => {
        const total = records.reduce((acc, r) => acc + (r.reclaimBytes || 0), 0);
        setLifetimeReclaimed(total);
        setLifetimeRuns(records.length);
      })
      .catch(() => {});

    void loadCacheProviders();
  }, [loadCacheProviders]);

  const items = useMemo(
    () => itemIds.map((id) => itemsById[id]).filter(Boolean),
    [itemIds, itemsById]
  );

  const totals = useMemo(() => {
    let cleanable = 0;
    let safeReclaim = 0;
    let regenerateReclaim = 0;
    let reviewReclaim = 0;
    let protectedBytes = 0;
    const projects = new Set<string>();

    for (const item of items) {
      const bytes = item.estimatedReclaimBytes ?? 0;
      const blocked = item.protected || item.safetyClass === "keep" || !item.selectable;
      if (blocked) {
        protectedBytes += bytes;
      } else {
        cleanable += bytes;
        if (item.safetyClass === "safe") safeReclaim += bytes;
        else if (item.safetyClass === "regenerate") regenerateReclaim += bytes;
        else reviewReclaim += bytes;
      }
      if (item.projectId) projects.add(item.projectId);
    }
    return {
      cleanable,
      safeReclaim,
      regenerateReclaim,
      reviewReclaim,
      protectedBytes,
      projects: projects.size,
    };
  }, [items]);

  const distributionSegments = useMemo(() => {
    if (totals.cleanable <= 0) return [];
    const ecoMap: Record<string, { label: string; bytes: number; color: string }> = {
      node: { label: "Web / Node.js", bytes: 0, color: "var(--accent)" },
      rust: { label: "Rust / Cargo", bytes: 0, color: "#F97316" },
      python: { label: "Python / venv", bytes: 0, color: "var(--success)" },
      agent: { label: "AI Ajanları", bytes: 0, color: "#8B5CF6" },
      cache: { label: "Önbellekler", bytes: 0, color: "#EC4899" },
      other: { label: "Diğer Çıktılar", bytes: 0, color: "var(--text-muted)" },
    };

    for (const item of items) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const bytes = item.estimatedReclaimBytes ?? 0;
      const eco = (item.ecosystem || "").toLowerCase();
      const name = (item.displayName || "").toLowerCase();
      const cat = (item.category || "").toLowerCase();

      if (eco.includes("node") || eco.includes("npm") || name.includes("node_modules")) {
        ecoMap.node.bytes += bytes;
      } else if (eco.includes("rust") || eco.includes("cargo") || name.includes("target")) {
        ecoMap.rust.bytes += bytes;
      } else if (eco.includes("python") || eco.includes("pip") || name.includes("venv")) {
        ecoMap.python.bytes += bytes;
      } else if (cat.includes("agent") || name.includes("claude") || name.includes("cursor")) {
        ecoMap.agent.bytes += bytes;
      } else if (cat.includes("cache") || eco.includes("cache")) {
        ecoMap.cache.bytes += bytes;
      } else {
        ecoMap.other.bytes += bytes;
      }
    }

    return Object.entries(ecoMap)
      .filter(([_, v]) => v.bytes > 0)
      .map(([k, v]) => ({
        id: k,
        label: v.label,
        bytes: v.bytes,
        color: v.color,
        percent: (v.bytes / totals.cleanable) * 100,
      }));
  }, [items, totals.cleanable]);

  const topItems = useMemo(
    () =>
      [...items]
        .filter((item) => item.selectable && !item.protected)
        .sort((a, b) => (b.estimatedReclaimBytes ?? 0) - (a.estimatedReclaimBytes ?? 0))
        .slice(0, 5),
    [items]
  );

  const cleanableDelta = totals.cleanable - previousCleanableBytes;
  const hasComparison = previousCleanableBytes > 0 || previousSummary !== null;

  // Counts for 3 category cards
  const projectItemsCount = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.ecosystem || "").toLowerCase().includes("node") ||
          (i.ecosystem || "").toLowerCase().includes("rust") ||
          i.displayName.includes("node_modules") ||
          i.displayName.includes("target")
      ).length,
    [items]
  );

  const agentItemsCount = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.category || "").toLowerCase().includes("agent") ||
          (i.displayName || "").toLowerCase().includes("claude") ||
          (i.displayName || "").toLowerCase().includes("cursor") ||
          (i.displayName || "").toLowerCase().includes("codex")
      ).length,
    [items]
  );

  const totalCachesBytes = useMemo(
    () => cacheProviders.reduce((acc, p) => acc + (p.totalBytes || 0), 0),
    [cacheProviders]
  );

  return (
    <div className="overview-page">
      {/* 1. TOP HEADER & TELEMETRY */}
      <header className="overview-header">
        <div className="overview-header-copy">
          <h1 className="overview-title">Genel Bakış</h1>
          <p className="overview-subtitle">
            Geliştirici depolama alanı, yapay zeka ajanları ve sistem derleme artıklarının merkezi analizi.
          </p>
        </div>

        <div className="overview-header-telemetry">
          <div className="overview-status-pill">
            <span
              className={`overview-status-pulse ${isScanning ? "is-scanning" : ""}`}
              aria-hidden="true"
            />
            <span>
              {isScanning
                ? `${ui.common.scanning} (${progress?.entriesFound ?? 0} hedef)`
                : items.length > 0
                ? "Analiz Hazır"
                : "Sistem Hazır"}
            </span>
          </div>

          <div className="overview-header-actions" role="toolbar" aria-label={ui.overview.title}>
            <button
              type="button"
              className="overview-header-btn"
              onClick={handleReset}
              disabled={isScanning || (items.length === 0 && !restored)}
              title={ui.overview.resetUi}
              aria-label={ui.overview.resetUi}
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="overview-header-btn"
              onClick={handleRestoreLastScan}
              disabled={isScanning}
              title={ui.overview.restoreLastScan}
              aria-label={ui.overview.restoreLastScan}
            >
              <History size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. 4-COLUMN BENTO KPI ROW */}
      <section className="overview-kpi-grid" aria-label="Temel Sistem Göstergeleri">
        {/* KPI 1: Temizlenebilir Alan */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Temizlenebilir Alan</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <HardDrive size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(totals.cleanable) : "—"}
            </span>
            <div className="nc-kpi-card-sub">
              {hasComparison && items.length > 0 ? (
                <span
                  className={`nc-kpi-delta-pill ${cleanableDelta > 0 ? "is-up" : "is-down"}`}
                >
                  {cleanableDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {formatSignedBytes(cleanableDelta)}
                </span>
              ) : (
                <span>Taranan çalışma alanında</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI 2: Güvenli Reclaim */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">%100 Güvenli Reclaim</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(totals.safeReclaim) : "—"}
            </span>
            <div className="nc-kpi-card-sub">
              <span>Geri Dönüşüm Kutusuna taşınır</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Taranan Hedefler & Projeler */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Taranan Hedefler</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <FolderTree size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? `${items.length} Öğe` : "0 Öğe"}
            </span>
            <div className="nc-kpi-card-sub">
              <span>{totals.projects > 0 ? `${totals.projects} Aktif Projede` : "Klasör seçimi bekleniyor"}</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Geçmiş Kazanım (Lifetime Reclaimed) */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Toplam Tasarruf</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <Sparkles size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {lifetimeReclaimed > 0 ? formatBytes(lifetimeReclaimed) : "0 B"}
            </span>
            <div className="nc-kpi-card-sub">
              <span>{lifetimeRuns > 0 ? `${lifetimeRuns} temizlikte kazanıldı` : "İlk temizliğinize hazır"}</span>
            </div>
          </div>
        </div>
      </section>

            {/* 3. FULL-WIDTH STORAGE DISTRIBUTION & INTERACTIVE ACTION CENTER */}
      <section className="overview-dist-panel" aria-label="Depolama Dağılımı ve Eylem Merkezi">
        <div className="overview-panel-header">
          <div className="overview-panel-title-group">
            <h2 className="overview-panel-title">Depolama Dağılımı ve Eylem Merkezi</h2>
            <span className="overview-panel-desc">
              {items.length > 0
                ? "Ekosistemlere göre disk tüketimi analizi ve doğrudan eylem başlatıcı"
                : "Çalışma alanınızı tarayarak disk yükünü haritalandırın ve tek tıkla temizlik başlatın"}
            </span>
          </div>
          {items.length > 0 && (
            <span className="overview-hub-badge">
              {formatBytes(totals.cleanable)} toplam
            </span>
          )}
        </div>

        {/* Interactive Distribution Bar */}
        {items.length > 0 && distributionSegments.length > 0 ? (
          <div className="overview-dist-bar-wrapper">
            <div
              className="overview-dist-bar"
              role="progressbar"
              aria-valuenow={100}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {distributionSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="overview-dist-segment"
                  style={{
                    width: `${Math.max(2, seg.percent)}%`,
                    backgroundColor: seg.color,
                  }}
                  title={`${seg.label}: ${formatBytes(seg.bytes)} (${seg.percent.toFixed(1)}%)`}
                />
              ))}
            </div>

            {/* Interactive Grid of Ecosystems */}
            <div className="overview-eco-cards-grid">
              {distributionSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="overview-eco-card"
                  style={{ "--eco-color": seg.color } as React.CSSProperties}
                  title={`${seg.label}: ${formatBytes(seg.bytes)}`}
                >
                  <div className="overview-eco-card-top">
                    <span
                      className="overview-eco-card-dot"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="overview-eco-card-name">{seg.label}</span>
                    <span className="overview-eco-card-pct">{seg.percent.toFixed(1)}%</span>
                  </div>
                  <div className="overview-eco-card-bottom">
                    <span className="overview-eco-card-size">{formatBytes(seg.bytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overview-zero-state">
            <div className="overview-zero-icon">
              <HardDrive size={26} />
            </div>
            <h3 className="overview-zero-heading">Çalışma Alanınızı Analiz Edin</h3>
            <p className="overview-zero-desc">
              node_modules, target, venv ve geçici derleme kalıntılarını tespit etmek için taranacak dizini seçin.
            </p>
          </div>
        )}
      </section>

      {/* 4. DUAL BALANCED COLUMNS: Top 5 Targets + 4 Hubs (Same Height) */}
      <section className="overview-secondary-grid" aria-label="Ayrıntılı Hedefler ve Kategoriler">
        {/* Left: Top 5 Space Consumers */}
        <div className="overview-panel overview-panel--equal">
          <div className="overview-panel-header">
            <div className="overview-panel-title-group">
              <h2 className="overview-panel-title">En Çok Yer Kaplayan 5 Hedef</h2>
              <span className="overview-panel-desc">
                Diskte en yüksek geri kazanım potansiyeli sunan dizinler
              </span>
            </div>
            {topItems.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowUpRight size={13} />}
                onClick={() => setView("projects")}
              >
                Tümünü Gör
              </Button>
            )}
          </div>

          <div className="overview-top-items-list">
            {topItems.length > 0 ? (
              topItems.map((item, index) => (
                <div key={item.id} className="overview-top-item-row">
                  <span className="overview-top-item-rank">{index + 1}</span>
                  <div className="overview-top-item-info">
                    <div className="overview-top-item-header">
                      <span className="overview-top-item-name">{item.displayName}</span>
                      <SafetyBadge safety={item.safetyClass} />
                    </div>
                    <span className="overview-top-item-path" title={item.displayPath}>
                      {truncatePath(maskPaths ? maskPath(item.displayPath) : item.displayPath, 50)}
                    </span>
                  </div>
                  <span className="overview-top-item-size">
                    {formatBytes(item.estimatedReclaimBytes ?? 0)}
                  </span>
                </div>
              ))
            ) : (
              <div className="overview-zero-state" style={{ padding: "20px" }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  Tarama tamamlandığında en büyük depolama yükleri burada listelenecektir.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right: 4 Category Hub Cards - Exactly matches height of Left Panel */}
        <div className="overview-hubs-column overview-hubs-column--equal" aria-label="Temizlik Kategorileri">
          {/* Hub 1: Projeler */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("projects")}
            onKeyDown={(e) => e.key === "Enter" && setView("projects")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--projects">
                <Code2 size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">Proje Bağımlılıkları</h3>
                <span className="overview-hub-desc">
                  node_modules, target, .next, dist ve venv çıktıları
                </span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {items.length > 0 ? `${projectItemsCount} Öğe` : "Projeler"}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 2: AI Kodlama Ajanları */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("agents")}
            onKeyDown={(e) => e.key === "Enter" && setView("agents")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--ai">
                <Bot size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">AI Kodlama Ajanları</h3>
                <span className="overview-hub-desc">
                  Claude Code, Cursor, Codex ve Antigravity oturum/logları
                </span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {items.length > 0 ? `${agentItemsCount} Ajan Hedefi` : "Ajanlar"}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 3: Araç Önbellekleri */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("caches")}
            onKeyDown={(e) => e.key === "Enter" && setView("caches")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--caches">
                <Zap size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">Paket & Araç Önbellekleri</h3>
                <span className="overview-hub-desc">
                  npm, Cargo, Pip ve Yarn global indirme depoları
                </span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {totalCachesBytes > 0 ? formatBytes(totalCachesBytes) : `${cacheProviders.length} Araç`}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 4: Temizlik & İşlem Geçmişi */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("history")}
            onKeyDown={(e) => e.key === "Enter" && setView("history")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--history">
                <History size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">Temizlik & İşlem Geçmişi</h3>
                <span className="overview-hub-desc">
                  {lifetimeReclaimed > 0
                    ? `${formatBytes(lifetimeReclaimed)} geri kazanım denetim günlüğü`
                    : "Gerçekleşen temizlik kayıtları ve denetim günlüğü"}
                </span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {lifetimeRuns > 0 ? `${lifetimeRuns} İşlem` : "Geçmiş"}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
