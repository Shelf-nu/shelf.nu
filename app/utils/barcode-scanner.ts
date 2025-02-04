// app/utils/barcode-scanner.ts
import { prepareZXingModule, readBarcodes } from "zxing-wasm";

let isInitialized = false;

export async function initializeScanner() {
  if (!isInitialized) {
    await prepareZXingModule({
      overrides: {
        locateFile: (path: any, prefix: any) => {
          if (path.endsWith(".wasm")) {
            return `https://cdn.jsdelivr.net/npm/zxing-wasm@latest/dist/full/${path}`;
          }
          return prefix + path;
        },
      },
      fireImmediately: true,
    });
    isInitialized = true;
  }
  return { readBarcodes };
}
