import { useEffect, useState } from "react";
import { Button } from "~/components/shared/button";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Check current theme on mount from localStorage or system preference
    const storedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const currentTheme = storedTheme || systemTheme;
    setTheme(currentTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);

    // Store preference in localStorage
    localStorage.setItem("theme", newTheme);
    
    // Update the client hint cookie
    document.cookie = `CH-theme=${encodeURIComponent(newTheme)};path=/`;
    
    // Apply theme class immediately
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Only show in development
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={toggleTheme}
      // className="fixed top-4 right-4 z-50 shadow-lg"
    >
      {theme === "light" ? "🌙" : "☀️"} {theme === "light" ? "Dark" : "Light"}
    </Button>
  );
}
