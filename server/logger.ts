export const customLogger = (message: string, ...rest: string[]) => {
  // eslint-disable-next-line no-console
  console.log(message, ...rest);
};
