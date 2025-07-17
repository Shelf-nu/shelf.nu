import { useEffect, useState } from "react";
import { Button } from "~/components/shared/button";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Check current theme on mount
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);

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
