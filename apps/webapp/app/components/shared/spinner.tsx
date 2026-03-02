import { tw } from "~/utils/tw";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={tw("relative size-5", className)}>
      <div className="spinner" />
    </div>
  );
}
