import { useMemo } from "react";
import { useDateFormatter } from "~/hooks/use-date-formatter";
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
  const { formatDate } = useDateFormatter();

  const titleToRender = useMemo(() => {
    if (calendarTitle) {
      return calendarTitle;
    }

    const currentDate = new Date();
    return formatDate(currentDate, {
      month: "long",
      year: "numeric",
      localeOnly: true,
    });
  }, [calendarTitle, formatDate]);

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
