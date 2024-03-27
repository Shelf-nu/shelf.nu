import { twMerge } from "tailwind-merge";

export function tw(...args: Parameters<typeof twMerge>) {
  return twMerge(...args);
}
