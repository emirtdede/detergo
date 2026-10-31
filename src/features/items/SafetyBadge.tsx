import React from "react";
import { useUIText } from "@/lib/ui-text";
import { SafetyClass } from "@/types";
import "./items.css";

export const SafetyBadge: React.FC<{ safety: SafetyClass }> = ({ safety }) => {
  const ui = useUIText();
  const label =
    safety === "safe"
      ? ui.safety.safe
      : safety === "regenerate"
        ? ui.safety.regenerate
        : safety === "review"
          ? ui.safety.review
          : ui.safety.keep;
  return <span className={`safety-badge ${safety}`}>{label}</span>;
};
