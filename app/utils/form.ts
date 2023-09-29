export function isFormProcessing(state: "idle" | "submitting" | "loading") {
  return state === "submitting" || state === "loading";
}

export function handleInputChange(
  event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  setState: React.Dispatch<
    React.SetStateAction<{
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
