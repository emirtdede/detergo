import React, { useMemo, useState } from "react";

import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText, localizeCategory, resolveUiLocale } from "@/lib/ui-text";
import type { CatalogRule } from "@/types";

/**
 * Ecosystem metadata.
 *
 * `label` is deliberately not translated: these are product and language names
 * (Rust, .NET, Unreal Engine) that are spelled the same in every locale. The
 * `color` values exist so the panel keeps the same visual language as the rest
 * of the app without inventing a colour per ecosystem.
 */
const ECOSYSTEMS: Record<string, { label: string; color: string }> = {
  javascript: { label: "JavaScript / TypeScript", color: "var(--accent)" },
  python: { label: "Python", color: "var(--success)" },
  rust: { label: "Rust", color: "var(--eco-rust)" },
  dotnet: { label: ".NET", color: "var(--eco-purple, #a78bfa)" },
  java: { label: "Java / Kotlin", color: "var(--eco-orange, #fb923c)" },
  go: { label: "Go", color: "var(--eco-cyan, #22d3ee)" },
  php: { label: "PHP", color: "var(--eco-indigo, #818cf8)" },
  dart: { label: "Dart / Flutter", color: "var(--eco-sky, #38bdf8)" },
  cpp: { label: "C / C++", color: "var(--eco-slate, #94a3b8)" },
  unity: { label: "Unity", color: "var(--eco-agent)" },
  unreal: { label: "Unreal Engine", color: "var(--eco-build)" },
  elixir: { label: "Elixir", color: "var(--eco-magenta, #e879f9)" },
  swift: { label: "Swift / iOS", color: "var(--eco-amber, #f59e0b)" },
  godot: { label: "Godot", color: "var(--eco-cache)" },
  ruby: { label: "Ruby", color: "var(--danger)" },
  zig: { label: "Zig", color: "var(--warning)" },
  devops: { label: "DevOps / IaC", color: "var(--eco-build)" },
  haskell: { label: "Haskell", color: "var(--eco-agent)" },
};

const FALLBACK_COLOR = "var(--text-muted)";

export function ecosystemMeta(ecosystem: string): { label: string; color: string } {
  return (
    ECOSYSTEMS[ecosystem] ?? {
      // An unknown ecosystem still renders: showing the raw id is better than
      // hiding a rule the scanner will happily match.
      label: ecosystem,
      color: FALLBACK_COLOR,
    }
  );
}

/** Rules ordered by the catalog's own ecosystem then rule id, for stable lists. */
export function groupRules(rules: readonly CatalogRule[]): Map<string, CatalogRule[]> {
  const groups = new Map<string, CatalogRule[]>();
  for (const rule of [...rules].sort((a, b) => a.id.localeCompare(b.id))) {
    const list = groups.get(rule.ecosystem);
    if (list) list.push(rule);
    else groups.set(rule.ecosystem, [rule]);
  }
  return groups;
}

interface CatalogExplorerProps {
  rules: readonly CatalogRule[];
  /** Ecosystem selected from the summary card grid, if any. */
  selected: string | null;
  onSelect: (ecosystem: string | null) => void;
}

/**
 * "What the rules actually do" panel.
 *
 * The summary cards above only carry a count per ecosystem; a user cannot tell
 * from `24` what will be deleted. This panel lists every rule of the selected
 * ecosystem with the folder names it matches, its category, its safety class
 * and - when the catalog knows it - the command that regenerates the output.
 *
 * All of it comes from the live catalog (`getCatalog`), so the panel can never
 * drift from the rules the scanner actually applies.
 */
export const CatalogExplorer: React.FC<CatalogExplorerProps> = ({ rules, selected, onSelect }) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const locale = resolveUiLocale(language);
  const groups = useMemo(() => groupRules(rules), [rules]);
  const [openRule, setOpenRule] = useState<string | null>(null);

  const ecosystems = useMemo(
    () =>
      [...groups.keys()].sort((a, b) =>
        ecosystemMeta(a).label.localeCompare(ecosystemMeta(b).label),
      ),
    [groups],
  );

  const active = selected && groups.has(selected) ? selected : null;
  const activeRules = active ? (groups.get(active) ?? []) : [];

  return (
    <section className="about-catalog-explorer" aria-labelledby="catalog-explorer-title">
      <header className="about-catalog-explorer-head">
        <div>
          <h2 className="about-panel-title" id="catalog-explorer-title">
            {ui.catalog.details}
          </h2>
          <p className="about-catalog-explorer-hint">{ui.catalog.hint}</p>
        </div>
        <span className="about-catalog-count">
          {rules.length.toLocaleString(locale)} {ui.settings.rules}
        </span>
      </header>

      <div className="about-eco-chips" role="group" aria-label={ui.catalog.details}>
        {ecosystems.map((ecosystem) => {
          const meta = ecosystemMeta(ecosystem);
          const count = groups.get(ecosystem)?.length ?? 0;
          const isActive = ecosystem === active;
          return (
            <button
              key={ecosystem}
              type="button"
              aria-pressed={isActive}
              className={`about-eco-chip${isActive ? " is-active" : ""}`}
              onClick={() => {
                onSelect(isActive ? null : ecosystem);
                setOpenRule(null);
              }}
            >
              <span className="about-rule-dot" style={{ backgroundColor: meta.color }} />
              <span className="about-eco-chip-label">{meta.label}</span>
              <span className="about-eco-chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      {!active && <p className="about-catalog-empty">{ui.catalog.hint}</p>}

      {active && (
        <ul className="about-rule-list">
          {activeRules.map((rule) => {
            const expanded = openRule === rule.id;
            const regen = rule.regenerate?.trim();
            return (
              <li key={rule.id} className={`about-rule-item${expanded ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="about-rule-item-head"
                  aria-expanded={expanded}
                  onClick={() => setOpenRule(expanded ? null : rule.id)}
                >
                  <span
                    className="about-rule-dot"
                    style={{ backgroundColor: ecosystemMeta(rule.ecosystem).color }}
                  />
                  <span className="about-rule-item-name">{rule.names.join(", ")}</span>
                  <span className="about-rule-item-cat">
                    {localizeCategory(rule.category, locale)}
                  </span>
                  <span className={`about-rule-safety about-rule-safety--${rule.safety}`}>
                    {ui.safety[rule.safety]}
                  </span>
                </button>

                {expanded && (
                  <div className="about-rule-item-body">
                    <div className="about-rule-field">
                      <span className="about-rule-field-label">{ui.catalog.matches}</span>
                      <code className="about-rule-field-value">{rule.names.join(", ")}</code>
                    </div>
                    <div className="about-rule-field">
                      <span className="about-rule-field-label">{ui.table.safety}</span>
                      <span className="about-rule-field-value">{ui.safety[rule.safety]}</span>
                    </div>
                    {regen && (
                      <div className="about-rule-field">
                        <span className="about-rule-field-label">{ui.catalog.regenerate}</span>
                        <code className="about-rule-field-value">{regen}</code>
                      </div>
                    )}
                    {rule.note && rule.note.trim() && (
                      <div className="about-rule-field">
                        <span className="about-rule-field-label">{ui.catalog.note}</span>
                        <span className="about-rule-field-value">{rule.note}</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rules.length === 0 && <p className="about-catalog-empty">{ui.catalog.empty}</p>}
    </section>
  );
};
