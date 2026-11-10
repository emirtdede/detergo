import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Bot, Sparkles, Layers } from "lucide-react";
import { McpIdeKey, mcpConfigList } from "./docs-data";
import { useDocsT } from "./docs-i18n";

export interface McpIdeSelectorProps {
  activeIde: McpIdeKey;
  onSelect: (ide: McpIdeKey) => void;
}

export const McpIdeSelector: React.FC<McpIdeSelectorProps> = ({
  activeIde,
  onSelect,
}) => {
  const t = useDocsT();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentTool =
    mcpConfigList.find((item) => item.id === activeIde) || mcpConfigList[0];

  // Group tools into AI Tools tab tools and other popular environments
  const agentTools = mcpConfigList.filter((item) => item.category === "agents-tab");
  const otherTools = mcpConfigList.filter((item) => item.category === "other");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (id: McpIdeKey) => {
    onSelect(id);
    setIsOpen(false);
  };

  return (
    <div className="mcp-ide-selector-container" ref={containerRef}>
      <div className="mcp-ide-dropdown-wrapper">
        <button
          type="button"
          className={`mcp-ide-dropdown-trigger ${isOpen ? "open" : ""}`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={t("Change AI Tool")}
        >
          <div className="mcp-ide-trigger-left">
            <span className="mcp-ide-trigger-icon">
              <Bot size={16} />
            </span>
            <span className="mcp-ide-trigger-name">{currentTool.name}</span>
            <span className="mcp-ide-trigger-tag">{t(currentTool.tag)}</span>
          </div>
          <ChevronDown
            size={16}
            className={`mcp-ide-chevron ${isOpen ? "rotated" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="mcp-ide-dropdown-menu" role="listbox">
            {/* 1. AI Tools Tab */}
            <div className="mcp-ide-group-header">
              <Sparkles size={13} className="mcp-ide-group-icon" />
              <span>
                {t("Tools in AI Tools Tab")}
              </span>
            </div>
            {agentTools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`mcp-ide-menu-item ${
                  activeIde === tool.id ? "selected" : ""
                }`}
                onClick={() => handleSelect(tool.id)}
                role="option"
                aria-selected={activeIde === tool.id}
              >
                <div className="mcp-ide-item-left">
                  <span className="mcp-ide-item-name">{tool.name}</span>
                  <span className="mcp-ide-item-tag">{t(tool.tag)}</span>
                </div>
                {activeIde === tool.id && (
                  <Check size={14} className="mcp-ide-item-check" />
                )}
              </button>
            ))}

            {/* 2. Diğer Geliştirme Ortamları & Eklentiler */}
            <div className="mcp-ide-group-header">
              <Layers size={13} className="mcp-ide-group-icon" />
              <span>
                {t("Other Popular Environments & Extensions")}
              </span>
            </div>
            {otherTools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`mcp-ide-menu-item ${
                  activeIde === tool.id ? "selected" : ""
                }`}
                onClick={() => handleSelect(tool.id)}
                role="option"
                aria-selected={activeIde === tool.id}
              >
                <div className="mcp-ide-item-left">
                  <span className="mcp-ide-item-name">{tool.name}</span>
                  <span className="mcp-ide-item-tag">{t(tool.tag)}</span>
                </div>
                {activeIde === tool.id && (
                  <Check size={14} className="mcp-ide-item-check" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
