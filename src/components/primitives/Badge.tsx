import React from "react";
import "./primitives.css";

export interface BadgeProps {
  type?: string;
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  type = "default",
  children,
  className = "",
}) => {
  return (
    <span className={`badge badge-${type} ${className}`}>
      {children}
    </span>
  );
};
