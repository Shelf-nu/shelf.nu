import { useEffect, useState } from "react";

/**
 * This base hook is used to logout the user after a certain delay
 * @param delay - delay before logout in ms. Default is 3000
 * @returns {Promise} - when the timeout has finished
 */

export function useTimeout(delay = 3000) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    let timerId = setTimeout(() => {
      setDone(true);
    }, delay);

    return () => {
      clearTimeout(timerId);
    };
  }, [delay]);

  const waitUntilDone = async () => {
    await new Promise<void>(async (resolve) => {
      if (done) {
        resolve();
      } else {
        const checkDone = async () => {
          if (done) {
            clearInterval(checkDoneInterval);
            resolve();
          }
        };

        const checkDoneInterval = setInterval(checkDone, 10);
      }
    });
  };

  return waitUntilDone;
}
