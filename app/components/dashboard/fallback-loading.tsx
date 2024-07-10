import { tw } from "~/utils/tw";
export default function FallbackLoading({ className }: { className?: string }) {
  return (
    <div className={tw("animate-pulse", className)}>
      <div className=" h-full rounded-md bg-gray-200"></div>
    </div>
  );
}
