import React, { useMemo } from "react";
import { FolderTree, ShieldCheck, Boxes } from "lucide-react";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { ItemTable, maskPath } from "./ItemTable";
import { formatBytes, truncatePath } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import "./items.css";

export const ProjectsView: React.FC = () => {
  const ui = useUIText();
  const { isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const rootPath = useScanStore((s) => s.currentRootPath);
  const scope = useScanStore((s) => s.scope);
  const status = useScanStore((s) => s.status);
  const error = useScanStore((s) => s.error);
  const progress = useScanStore((s) => s.progress);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const items = useMemo(
    () =>
      itemIds
        .map((id) => itemsById[id])
        .filter((item) => item && item.provider === "project" && item.status !== "deleted"),
    [itemIds, itemsById]
  );

  const projectTotals = useMemo(() => {
    let cleanable = 0;
    let safe = 0;
    const projects = new Set<string>();
    for (const item of items) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const b = item.estimatedReclaimBytes ?? 0;
      cleanable += b;
      if (item.safetyClass === "safe") safe += b;
      if (item.projectId) projects.add(item.projectId);
    }
    return { cleanable, safe, projectCount: projects.size };
  }, [items]);

  const emptyTitle = isScanning
    ? ui.common.scanning
    : status === "failed"
      ? ui.errors.title
      : status === "idle"
        ? "Henüz Proje Taraması Yapılmadı"
        : "Temizlenebilir Proje Artığı Bulunamadı";
  const emptyDescription = isScanning
    ? `${progress?.entriesFound ?? 0} / ${progress?.entriesMeasured ?? 0}`
    : status === "failed"
      ? error?.message ?? "Tarama sırasında bir hata oluştu."
      : status === "idle"
        ? "Proje bağımlılıklarını ve derleme kalıntılarını listelemek için bir klasör seçip tarayın."
        : "Seçilen dizin temiz durumda. Temizlenebilecek node_modules, target veya derleme çıktısı bulunamadı.";

  const subtitle =
    scope === "allDrives"
      ? ui.common.allDrives
      : rootPath
        ? truncatePath(maskPaths ? maskPath(rootPath) : rootPath, 90)
        : ui.overview.scanFirst;

  return (
    <div className="items-view">
      <PageHeader
        title={ui.nav.projects}
        description={subtitle}
      />

      {/* Shared Bento KPI Strip for Projects */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Proje Artıkları</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <FolderTree size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(projectTotals.cleanable) : "—"}
            </span>
            <span className="nc-kpi-card-sub">{items.length} temizlenebilir hedef</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Güvenli Geri Kazanım</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(projectTotals.safe) : "—"}
            </span>
            <span className="nc-kpi-card-sub">Geri Dönüşüm Kutusuna taşınır</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Tespit Edilen Projeler</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <Boxes size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{projectTotals.projectCount} Proje</span>
            <span className="nc-kpi-card-sub">Node, Rust, Python, Go projeleri</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          live={isScanning}
          icon={<FolderTree size={22} />}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ItemTable items={items} />
      )}
    </div>
  );
};
