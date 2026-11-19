import React from "react";
import { Check, Copy, Terminal } from "lucide-react";

export interface DocsCommandItem {
  id: string;
  label?: string;
  command: string;
}

interface DocsCommandListProps {
  title: string;
  items: readonly DocsCommandItem[];
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  copyLabel: string;
  copiedLabel: string;
  highlight: (code: string) => React.ReactNode;
}

/**
 * Renders a group of terminal commands where every individual command has its
 * own dedicated one-click copy button right beside it.
 */
export const DocsCommandList: React.FC<DocsCommandListProps> = ({
  title,
  items,
  copiedKey,
  onCopy,
  copyLabel,
  copiedLabel,
  highlight,
}) => (
  <div className="docs-code-card">
    <div className="docs-code-header">
      <span className="docs-code-header-left">
        <Terminal size={13} />
        {title}
      </span>
    </div>
    <div className="docs-cmd-list">
      {items.map((item) => {
        const copied = copiedKey === item.id;
        return (
          <div key={item.id} className="docs-cmd-row">
            <div className="docs-cmd-row-body">
              {item.label && <span className="docs-cmd-row-label"># {item.label}</span>}
              <code className="docs-cmd-row-code">{highlight(item.command)}</code>
            </div>
            <button
              type="button"
              className={`docs-copy-action docs-cmd-copy-btn ${copied ? "is-copied" : ""}`}
              onClick={() => onCopy(item.command, item.id)}
              aria-label={`${copyLabel}: ${item.command}`}
              title={copied ? copiedLabel : copyLabel}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? copiedLabel : copyLabel}</span>
            </button>
          </div>
        );
      })}
    </div>
  </div>
);
