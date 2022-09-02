import { useRef, useEffect } from "react";

export function useIsMountedRef() {
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  return isMountedRef;
}
