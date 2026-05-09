import type { InputHTMLAttributes } from "react";
import { PortalIcon } from "./portal-icon";

type PortalInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: string;
  iconRight?: string;
};

export function PortalInput({
  label,
  hint,
  error,
  iconLeft,
  iconRight,
  id,
  className,
  ...rest
}: PortalInputProps) {
  const fieldId = id ?? rest.name;
  return (
    <label htmlFor={fieldId} className="block w-full">
      {label && (
        <span className="portal-label mb-1 block text-[var(--portal-on-surface-variant)]">
          {label}
        </span>
      )}
      <span className="relative block">
        {iconLeft && (
          <PortalIcon
            name={iconLeft}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--portal-outline)]"
          />
        )}
        <input
          id={fieldId}
          className={`w-full ${iconLeft ? "pl-11" : ""} ${
            iconRight ? "pr-11" : ""
          } ${className ?? ""}`}
          {...rest}
        />
        {iconRight && (
          <PortalIcon
            name={iconRight}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--portal-outline)]"
          />
        )}
      </span>
      {error ? (
        <span className="mt-1 block text-sm text-[var(--portal-error)]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-sm text-[var(--portal-on-surface-variant)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
