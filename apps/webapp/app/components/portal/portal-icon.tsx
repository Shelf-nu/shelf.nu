type PortalIconProps = {
  name: string;
  className?: string;
  filled?: boolean;
};

export function PortalIcon({ name, className, filled }: PortalIconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`}
      style={filled ? { fontVariationSettings: '"FILL" 1' } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
