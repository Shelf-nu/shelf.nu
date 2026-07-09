import { Redirect } from "expo-router";

/**
 * Route-level safety net: any path the router cannot match (e.g. an
 * OS-delivered link shape `app/+native-intent.ts` didn't anticipate)
 * redirects to the start screen instead of stranding the user on a dead
 * screen behind the splash — the failure mode of the 1.1.0 build-25
 * cold-start deep-link hang.
 */
export default function NotFoundScreen() {
  return <Redirect href="/" />;
}
