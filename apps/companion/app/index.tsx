import { useState, useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { getStartPage, getStartPageRoute } from "@/lib/start-page";

export default function Index() {
  const { session } = useAuth();
  const [startRoute, setStartRoute] = useState<string | null>(null);

  useEffect(() => {
    getStartPage().then((page) => setStartRoute(getStartPageRoute(page)));
  }, []);

  // Wait for start page preference to resolve (splash covers this)
  if (!startRoute) return null;

  if (session) {
    return <Redirect href={startRoute as any} />;
  }

  return <Redirect href="/(auth)/login" />;
}
