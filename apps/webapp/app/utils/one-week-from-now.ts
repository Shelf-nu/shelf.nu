export const oneWeekFromNow = () => {
  const now = new Date();
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
};

export const oneDayFromNow = () => {
  const now = new Date();
  return new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
};

/** Returns a Date 72 hours from now. Used for signed URL expiration. */
export const threeDaysFromNow = () => {
  const now = new Date();
  return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
};

export const oneMinuteFromNow = () => {
  const now = new Date();
  return new Date(now.getTime() + 1 * 60 * 1000);
};
