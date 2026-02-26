import { useTheme } from "./use-theme";

/**
 * Custom hook to get the placeholder image URL based on the current theme.
 * Returns a dark or light themed placeholder image URL.
 */
export function usePlaceholderImage() {
  const theme = useTheme();
  return theme === "dark"
    ? "/static/images/asset-placeholder-dark.jpeg"
    : "/static/images/asset-placeholder.jpg";
}
