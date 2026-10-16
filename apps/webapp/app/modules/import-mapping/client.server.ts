/**
 * Import mapping: the Anthropic client.
 *
 * Lazily created once per process and reused. When `ANTHROPIC_API_KEY` is not
 * set the client stays `null` and the importer uses the rule-based proposal
 * only, so unsetting the key is the kill switch.
 *
 * The key is read here and nowhere else. It is never sent to the browser
 * (`getBrowserEnv` does not list it), never logged and never put in error
 * `additionalData`.
 *
 * @see {@link file://./model.server.ts} the only caller
 */
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "~/utils/env";

/** Abandon a mapping request after this long and use the rules instead. */
export const IMPORT_MAPPING_TIMEOUT_MS = 20_000;

let client: Anthropic | null = null;
let initialised = false;

/** Reads the key at call time so tests and deploys can change it. */
function readApiKey(): string | undefined {
  return getEnv("ANTHROPIC_API_KEY", { isRequired: false }) || undefined;
}

/**
 * Whether the model may be asked for a mapping in this process.
 *
 * @returns `true` when `ANTHROPIC_API_KEY` is set
 */
export function isImportMappingModelEnabled(): boolean {
  return Boolean(readApiKey());
}

/**
 * Returns the shared Anthropic client, or `null` when no key is configured.
 *
 * Retries are off: a failed or slow call falls back to the free rule-based
 * proposal, so retrying would only add cost and wait.
 *
 * @returns The client, or `null` when the model is disabled
 */
export function getImportMappingClient(): Anthropic | null {
  if (initialised) return client;
  initialised = true;

  const apiKey = readApiKey();
  client = apiKey
    ? new Anthropic({
        apiKey,
        timeout: IMPORT_MAPPING_TIMEOUT_MS,
        maxRetries: 0,
      })
    : null;
  return client;
}
