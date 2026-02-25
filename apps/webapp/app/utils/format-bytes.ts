export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";

  /** Converts on base 10
   * In binary - change k to 1024
   */
  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
