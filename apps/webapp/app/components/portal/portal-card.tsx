import type { ReactNode } from "react";

export function PortalCard({
  children,
  className,
  as: Tag = "div",
  accent,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "section";
  accent?: "primary" | "secondary" | "tertiary";
}) {
  const accentClass = accent
    ? `border-l-4 ${
        accent === "primary"
          ? "border-l-[var(--portal-primary)]"
          : accent === "secondary"
          ? "border-l-[var(--portal-secondary)]"
          : "border-l-[var(--portal-tertiary)]"
      }`
    : "";

  return (
    <Tag
      className={`rounded-2xl border border-[var(--portal-outline-variant)] bg-[var(--portal-surface-container-lowest)] p-5 ${accentClass} ${
        className ?? ""
      }`}
    >
      {children}
    </Tag>
  );
}
