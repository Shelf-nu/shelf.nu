export function isFormProcessing(state: "idle" | "submitting" | "loading") {
  return state === "submitting" || state === "loading";
}
