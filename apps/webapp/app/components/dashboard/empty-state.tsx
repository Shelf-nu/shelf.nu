import { Button } from "../shared/button";

export function DashboardEmptyState({
  text,
  subText,
  ctaTo,
  ctaText,
}: {
  text: string;
  subText?: string;
  ctaTo?: string;
  ctaText?: string;
}) {
  return (
    <div className="flex size-full min-h-[200px] flex-col items-center justify-center gap-2">
      <img
        src="/static/images/empty-state.svg"
        alt=""
        aria-hidden="true"
        className="h-auto w-[45px]"
      />
      <div className="text-center font-semibold text-gray-900">{text}</div>
      {subText && (
        <p className="max-w-[240px] text-center text-sm text-gray-600">
          {subText}
        </p>
      )}
      {ctaTo && ctaText && (
        <Button to={ctaTo} variant="link" className="mt-1 text-sm">
          {ctaText}
        </Button>
      )}
    </div>
  );
}
