import { useCallback, useMemo, useState } from "react";

type UseooleanStateProps = {
  isTruthy?: boolean;
};

export const useBooleanState = (props: UseooleanStateProps) => {
  const [isTruthy, setIsTruthy] = useState<boolean>(props.isTruthy || false);

  const onFalsy = useCallback(() => {
    setIsTruthy(false);
  }, []);

  const onTruthy = useCallback(() => {
    setIsTruthy(true);
  }, []);

  const onToggle = useCallback(() => {
    if (isTruthy) {
      onFalsy();
    } else {
      onTruthy();
    }
  }, [isTruthy, onTruthy, onFalsy]);

  return useMemo(
    () => ({
      isTruthy,
      onFalsy,
      onToggle,
      onTruthy,
    }),
    [isTruthy, onFalsy, onTruthy, onToggle]
  );
};
