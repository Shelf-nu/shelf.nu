// https://overreacted.io/making-setinterval-declarative-with-react-hooks/

import { useEffect, useRef } from "react";

/**
 * useInterval
 * @param callback
 * @param delay - in seconds
 */
export function useInterval(callback: () => void, delay?: number) {
  const savedCallback = useRef<() => void>();

  // Remember the latest callback.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval.
  useEffect(() => {
    function tick() {
      savedCallback.current?.();
    }
    if (delay) {
      const id = setInterval(tick, delay * 1_000);
      return () => clearInterval(id);
    }
  }, [delay]);
}
