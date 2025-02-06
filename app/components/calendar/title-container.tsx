import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { useViewportHeight } from "~/hooks/use-viewport-height";

type TitleContainerProps = {
  className?: string;
  calendarTitle?: string;
  calendarSubtitle?: string;
  calendarView: string;
};

export default function TitleContainer({
  className,
  calendarTitle,
  calendarSubtitle,
  calendarView,
}: TitleContainerProps) {
  const { title } = useLoaderData<{ title: string }>();
  const { isMd } = useViewportHeight();

  const titleToRender = useMemo(() => {
    if (calendarTitle) {
      return calendarTitle;
    }

    return title;
  }, [calendarTitle, title]);

  return (
    <div className={className}>
      <div className="text-left font-sans text-lg font-semibold leading-[20px] ">
        {titleToRender}
      </div>
      {!isMd || calendarView == "timeGridWeek" ? (
        <div className="text-gray-600">{calendarSubtitle}</div>
      ) : null}
    </div>
  );
}
