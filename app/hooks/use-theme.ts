import { useEffect, useState } from "react";

/**
 * Client-side theme hook that reacts to theme changes
 * Unlike useHints(), this updates immediately when theme changes
 */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Get initial theme from localStorage or system preference
    const getTheme = () => {
      if (typeof window === "undefined") return "light";
      
      const stored = localStorage.getItem("theme") as "light" | "dark" | null;
      if (stored) return stored;
      
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    // Set initial theme
    setTheme(getTheme());

    // Listen for theme changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "theme" && e.newValue) {
        setTheme(e.newValue as "light" | "dark");
      }
    };

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // Only update if no theme is stored (following system preference)
      if (!localStorage.getItem("theme")) {
        setTheme(e.matches ? "dark" : "light");
      }
    };

    // Listen for DOM class changes (for immediate updates)
    const handleClassChange = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "dark" : "light");
    };

    // Set up listeners
    window.addEventListener("storage", handleStorageChange);
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    
    // MutationObserver to watch for class changes on html element
    const observer = new MutationObserver(handleClassChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Cleanup
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
      observer.disconnect();
    };
  }, []);

  return theme;
}