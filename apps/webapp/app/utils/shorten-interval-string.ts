export function shortenIntervalString(str: string): string {
  // Using a regular expression to replace 'year' with 'yr' and 'month' with 'mo'
  return str.replace(/\b(year|month)\b/g, (match: string) => {
    if (match === "year") return "yr";
    else if (match === "month") return "mo";
    else return str;
  });
}
