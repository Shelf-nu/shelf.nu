import { useMemo } from "react";
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
  const { isMd } = useViewportHeight();

  const titleToRender = useMemo(() => {
    if (calendarTitle) {
      return calendarTitle;
    }

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString("default", {
      month: "long",
    });
    const currentYear = currentDate.getFullYear();
    return `${currentMonth} ${currentYear}`;
  }, [calendarTitle]);

  return (
    <div className={className}>
      <div className="text-left font-sans text-lg font-semibold leading-[20px] ">
        {titleToRender}
      </div>
      {!isMd || calendarView.endsWith("Week") ? (
        <div className="text-gray-600">{calendarSubtitle}</div>
      ) : null}
    </div>
  );
}
