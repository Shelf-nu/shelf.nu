import { useNavigation, type Fetcher } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";

/**
 * Used to know if a button should be disabled on navigation.
 * By default it works with navigation state
 * Optionally it can receive a fetcher to use as state
 */
export function useDisabled(fetcher?: Fetcher) {
  const navigation = useNavigation();
  const state = fetcher ? fetcher.state : navigation.state;
  return isFormProcessing(state);
}
