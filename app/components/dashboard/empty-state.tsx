export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex size-full min-h-[200px] flex-col items-center justify-center">
      <img
        src="/static/images/empty-state.svg"
        alt="Empty state"
        className="h-auto w-[45px]"
      />
      <div className="text-center font-semibold text-color-900">{text}</div>
    </div>
  );
}
