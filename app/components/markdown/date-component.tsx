import { DateS } from "~/components/shared/date";

/**
 * DateComponent for Markdoc
 *
 * This component is used by Markdoc to render date tags with proper
 * localization and timezone support using Shelf's DateS component.
 *
 * Usage in markdown content:
 * {% date value="2023-12-25T10:30:00.000Z" /%}
 * {% date value="2023-12-25T10:30:00.000Z" includeTime=false /%}
 */

interface DateComponentProps {
  value: string;
  includeTime?: boolean;
}

export function DateComponent({
  value,
  includeTime = true,
}: DateComponentProps) {
  return <DateS date={value} includeTime={includeTime} />;
}
