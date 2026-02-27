import { AsyncLocalStorage } from "node:async_hooks";

const tabIdStorage = new AsyncLocalStorage<string | undefined>();

export function runWithTabId<T>(tabId: string | undefined, fn: () => T): T {
  return tabIdStorage.run(tabId, fn);
}

export function getTabId(): string | undefined {
  return tabIdStorage.getStore();
}
