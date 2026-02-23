/** Delays using a promise
 * @param ms Milisecods of delay
 * @return Promise
 */
export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
