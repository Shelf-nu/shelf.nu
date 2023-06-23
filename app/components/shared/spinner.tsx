import { tw } from "~/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={tw("relative h-5 w-5", className)}>
      <div className="spinner" />
    </div>
  );
}
