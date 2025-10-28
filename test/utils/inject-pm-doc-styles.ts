import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let injected = false;

export function ensurePmDocStyles() {
  if (injected) return;
  const style = document.createElement("style");
  style.setAttribute("data-testid", "pm-doc-styles");
  const basePath = dirname(fileURLToPath(import.meta.url));
  const cssPath = resolve(basePath, "../../app/styles/pm-doc.css");
  style.textContent = readFileSync(cssPath, "utf8");
  document.head.append(style);
  injected = true;
}
