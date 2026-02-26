import { useNavigation, type Fetcher } from "react-router";
import { isFormProcessing } from "~/utils/form";

/**
 * Used to know if a button should be disabled on navigation.
 * By default it works with navigation state
 * Optionally it can receive a fetcher to use as state
 */
export function useDisabled(fetcher?: Pick<Fetcher, "state">) {
  const navigation = useNavigation();
  const state = fetcher ? fetcher.state : navigation.state;
  return isFormProcessing(state);
}
