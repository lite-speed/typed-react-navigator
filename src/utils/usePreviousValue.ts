import { useEffect, useRef } from "react";

export function usePreviousValue<T>(value: T): T | null {
  const ref = useRef<any>(null);

  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

export function usePreviousValueRef<T>(value: T): { current: T | null } {
  const ref = useRef<any>(null);

  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
