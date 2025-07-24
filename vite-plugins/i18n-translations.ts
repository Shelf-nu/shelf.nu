/* eslint-disable no-console */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import type { Plugin } from "vite";

interface I18nTranslationsOptions {
  sourceDir?: string;
  outputDir?: string;
}

export function i18nTranslations(
  options: I18nTranslationsOptions = {}
): Plugin {
  const sourceDir = options.sourceDir || "app/locales";
  const outputDir = options.outputDir || "public/locales";

  let root: string;

  const compileSingleFile = async (tsFilePath: string) => {
    const outputPath = resolve(root, outputDir);
    const relativePath = tsFilePath.replace(resolve(root, sourceDir), "");
    const pathParts = relativePath.split("/").filter(Boolean);

    if (pathParts.length !== 2) return; // Should be lang/file.ts

    const [lang, filename] = pathParts;
    const namespace = basename(filename, ".ts");
    const outputLangDir = join(outputPath, lang);
    const jsonFilePath = join(outputLangDir, `${namespace}.json`);

    // Ensure output directory exists
    await mkdir(outputLangDir, { recursive: true });

    try {
      // Use tsx to execute the TypeScript file and extract the default export
      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "npx",
          [
            "tsx",
            "--eval",
            `
          import translations from '${tsFilePath}';
          console.log(JSON.stringify(translations, null, 2));
        `,
          ],
          { stdio: ["ignore", "pipe", "pipe"] }
        );

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`tsx failed: ${stderr}`));
          }
        });
      });

      if (result) {
        const translations = JSON.parse(result);
        await writeFile(
          jsonFilePath,
          JSON.stringify(translations, null, 2),
          "utf-8"
        );
        console.log(
          `[i18n] Compiled ${lang}/${namespace}.ts → ${namespace}.json`
        );
      } else {
        console.warn(`[i18n] No output from ${tsFilePath}`);
      }
    } catch (error) {
      console.error(`[i18n] Failed to compile ${tsFilePath}:`, error);
    }
  };

  const compileAllTranslations = async () => {
    const sourcePath = resolve(root, sourceDir);

    if (!existsSync(sourcePath)) {
      console.warn(
        `[i18n-translations] Source directory ${sourcePath} does not exist`
      );
      return;
    }

    try {
      const languages = await readdir(sourcePath);

      for (const lang of languages) {
        const langDir = join(sourcePath, lang);

        try {
          const files = await readdir(langDir);

          for (const file of files) {
            if (file.endsWith(".ts")) {
              const tsFilePath = join(langDir, file);
              await compileSingleFile(tsFilePath);
            }
          }
        } catch (error) {
          console.warn(`[i18n] Could not read ${langDir}:`, error);
        }
      }
    } catch (error) {
      console.error(`[i18n] Failed to compile translations:`, error);
    }
  };

  let compiled = false;
  let compiling = new Set<string>();
  let debounceTimers = new Map<string, NodeJS.Timeout>();

  return {
    name: "i18n-translations",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      if (!compiled) {
        await compileAllTranslations();
        compiled = true;
      }
    },
    configureServer(server) {
      const watchPath = resolve(root, sourceDir);
      server.watcher.add(watchPath);

      server.watcher.on("change", (file) => {
        if (file.includes(sourceDir) && file.endsWith(".ts")) {
          // Prevent duplicate compilation of the same file
          if (compiling.has(file)) {
            return;
          }

          // Clear any existing timer for this file
          const existingTimer = debounceTimers.get(file);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          // Set a new debounced timer
          const timer = setTimeout(async () => {
            // Double-check if we're already compiling
            if (compiling.has(file)) {
              return;
            }

            compiling.add(file);
            console.log(`[i18n] Translation changed: ${basename(file)}`);

            try {
              await compileSingleFile(file);
              // Trigger full page reload since translations affect the entire app
              server.ws.send({ type: "full-reload" });
            } catch (error) {
              console.error(`[i18n] Error compiling ${file}:`, error);
            } finally {
              compiling.delete(file);
              debounceTimers.delete(file);
            }
          }, 150); // Increased debounce time

          debounceTimers.set(file, timer);
        }
      });
    },
  };
}
