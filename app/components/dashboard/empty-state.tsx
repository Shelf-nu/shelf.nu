export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center">
      <img
        src="/images/empty-state.svg"
        alt="Empty state"
        className="h-auto w-[45px]"
      />
      <div className="text-center font-semibold text-gray-900">{text}</div>
    </div>
  );
}
