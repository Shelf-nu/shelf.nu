import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { Navigation } from "react-router";

export function isFormProcessing(state: "idle" | "submitting" | "loading") {
  return state === "submitting" || state === "loading";
}

export function handleInputChange(
  event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  setState: Dispatch<
    SetStateAction<{
      [key: string]: any;
    }>
  >,
  field: string
) {
  setState((currentState) => ({
    ...currentState,
    [field]: event.target.value,
  }));
}

/**
 * Determines whether the current navigation is a search request.
 *
 * Accepts only the `location` slice of a navigation so it stays compatible
 * with the narrowed discriminated-union return type of `useNavigation()`
 * (React Router 7.16+), which omits fields like `matches`/`historyAction`
 * from the broader `Navigation` type in its idle state.
 *
 * @param navigation - The navigation object (or any object exposing `location`)
 * @returns `true` if the navigation target carries an `s` search param
 */
export function isSearching(navigation: Pick<Navigation, "location">) {
  const search = new URLSearchParams(navigation?.location?.search);
  return search?.has("s");
}
