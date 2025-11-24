type RelativeTimeUnit =
  | "years"
  | "months"
  | "weeks"
  | "days"
  | "hours"
  | "minutes"
  | "seconds";
export function timeAgo(input: Date | string) {
  const date = new Date(input);
  const formatter = new Intl.RelativeTimeFormat("en");

  const ranges: Record<RelativeTimeUnit, number> = {
    years: 3600 * 24 * 365,
    months: 3600 * 24 * 30,
    weeks: 3600 * 24 * 7,
    days: 3600 * 24,
    hours: 3600,
    minutes: 60,
    seconds: 1,
  };
  const secondsElapsed = (date.getTime() - Date.now()) / 1000;
  for (const key of Object.keys(ranges) as RelativeTimeUnit[]) {
    if (ranges[key] < Math.abs(secondsElapsed)) {
      const delta = secondsElapsed / ranges[key];
      return formatter.format(Math.round(delta), key);
    }
  }
  return "Just now";
}
