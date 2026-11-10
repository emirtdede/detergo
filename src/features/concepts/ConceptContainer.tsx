import React, { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { ConceptAView } from "./ConceptAView";
import { ConceptBView } from "./ConceptBView";
import { ConceptScreen, ConceptVariant } from "./concept-types";
import { useUIText } from "@/lib/ui-text";

export const ConceptContainer: React.FC = () => {
  const ui = useUIText();
  const [concept, setConcept] = useState<ConceptVariant>("A");
  const [screen, setScreen] = useState<ConceptScreen>("overview");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("concept") as ConceptVariant | null;
    const s = params.get("screen") as ConceptScreen | null;
    const t = params.get("theme") as "dark" | "light" | null;

    if (c === "A" || c === "B") setConcept(c);
    if (s) setScreen(s);
    if (t === "dark" || t === "light") setTheme(t);
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* Concept Switcher floating bar for preview/debug */}
      <div
        id="concept-switcher-bar"
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          background: "rgba(0, 0, 0, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          borderRadius: 8,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 9999,
          fontSize: 12,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setConcept("A")}
            style={{
              background: concept === "A" ? "#3b82f6" : "#222",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Concept A (Precision)
          </button>
          <button
            onClick={() => setConcept("B")}
            style={{
              background: concept === "B" ? "#38bdf8" : "#222",
              color: concept === "B" ? "#000" : "#fff",
              border: "none",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Concept B (Native)
          </button>
        </div>

        <select
          value={screen}
          onChange={(e) => setScreen(e.target.value as ConceptScreen)}
          style={{
            background: "#222",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "3px 6px",
            fontSize: 11,
          }}
        >
          <option value="overview">{ui.nav.overview}</option>
          <option value="projects">{ui.nav.projects}</option>
          <option value="agents">{ui.nav.agents}</option>
          <option value="caches">{ui.nav.caches}</option>
          <option value="history">{ui.nav.history}</option>
          <option value="settings">{ui.nav.settings}</option>
          <option value="cleanup-modal">{ui.plan.title}</option>
          <option value="permanent-modal">{ui.plan.confirmPermanent}</option>
        </select>

        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          style={{
            background: "#333",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
          <span>{theme === "dark" ? ui.settings.themeLight : ui.settings.themeDark}</span>
        </button>
      </div>

      {concept === "A" ? (
        <ConceptAView screen={screen} theme={theme} onNavigate={setScreen} />
      ) : (
        <ConceptBView screen={screen} theme={theme} onNavigate={setScreen} />
      )}
    </div>
  );
};
