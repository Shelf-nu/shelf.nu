import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed";

const variantClass: Record<Variant, string> = {
  primary:
    "bg-[var(--portal-primary)] text-[var(--portal-on-primary)] hover:brightness-105",
  secondary:
    "bg-[var(--portal-surface-container-lowest)] text-[var(--portal-on-surface)] border border-[var(--portal-outline-variant)] hover:bg-[var(--portal-surface-container-low)]",
  ghost:
    "bg-transparent text-[var(--portal-primary)] hover:underline underline-offset-4",
};

const sizeClass: Record<Size, string> = {
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3.5 text-base",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

export function PortalButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={rest.type ?? "button"}
      className={`${base} ${variantClass[variant]} ${sizeClass[size]} ${
        className ?? ""
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PortalLinkButton({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
  reloadDocument,
}: CommonProps & { to: string; reloadDocument?: boolean }) {
  return (
    <Link
      to={to}
      reloadDocument={reloadDocument}
      className={`${base} ${variantClass[variant]} ${sizeClass[size]} ${
        className ?? ""
      }`}
    >
      {children}
    </Link>
  );
}
