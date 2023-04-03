export const oneWeekFromNow = () => {
  const now = new Date();
  // const nextWeek =
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  // Get Unix timestamp of the next week date/time
  // return Math.floor(nextWeek.getTime() / 1000);
};

export const oneMinuteFromNow = () => {
  const now = new Date();
  // const nextWeek =
  return new Date(now.getTime() + 1 * 60 * 1000);
  // Get Unix timestamp of the next week date/time
  // return Math.floor(nextWeek.getTime() / 1000);
};
