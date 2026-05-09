import type { ReactNode } from "react";

type Tone =
  | "neutral"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error";

const toneClass: Record<Tone, string> = {
  neutral:
    "bg-[var(--portal-surface-container)] text-[var(--portal-on-surface)]",
  primary:
    "bg-[color-mix(in_srgb,var(--portal-primary)_12%,transparent)] text-[var(--portal-primary)]",
  secondary:
    "bg-[color-mix(in_srgb,var(--portal-secondary)_12%,transparent)] text-[var(--portal-secondary)]",
  success:
    "bg-[color-mix(in_srgb,var(--portal-success)_12%,transparent)] text-[var(--portal-success)]",
  warning:
    "bg-[color-mix(in_srgb,var(--portal-warning)_15%,transparent)] text-[var(--portal-warning)]",
  error:
    "bg-[var(--portal-error-container)] text-[var(--portal-on-error-container)]",
};

export function PortalChip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        toneClass[tone]
      } ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
