import { dequal } from "dequal/lite";
import { useRef } from "react";

//Returns an object whose reference only changes when the underlying data actually changes
export function useObjectMemo<T>(value: T) {
  const ref = useRef(value);
  if (!dequal(ref.current, value)) {
    ref.current = value;
  }

  return ref.current;
}
