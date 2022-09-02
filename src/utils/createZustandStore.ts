import immer, { Patch, enablePatches } from "immer";
enablePatches();
import _ from "lodash";
import zustand, { State, Subscribe, UseBoundStore, StoreApi } from "zustand";

type ModifyImmutablyReturn<T> = {
  hasChanges: boolean;
  nextState: T;
};

type ModifyImmutablyOpts = {
  dryRun?: boolean; //Does not actually modify the state
};

//Don't love the Zustand top level API. This tightens it up a bit IMO
export type ZustandStore<T extends object> = {
  set: (newState: T) => void;
  get: () => T;
  subscribe: T extends State ? Subscribe<T> : never;
  useStore(): T;
  useStore<U>(selector: (s: T) => U): U;
  modifyImmutably(modifyFn: (currState: T) => void, o?: ModifyImmutablyOpts): ModifyImmutablyReturn<T>;
  modifyImmutably(
    modifyFn: (currState: T) => Promise<void>,
    o?: ModifyImmutablyOpts,
  ): Promise<ModifyImmutablyReturn<T>>;
};

export function createZustandStore<StoreState extends object>(initState: StoreState): ZustandStore<StoreState> {
  const useStore = zustand(() => initState as any);

  const store: ZustandStore<StoreState> = {
    useStore: useStore as any,
    get: () => useStore.getState(),
    set: (a) => useStore.setState(a, true),
    subscribe: ((a: any) => useStore.subscribe(a)) as any,
    modifyImmutably: (modifyFn, opts?: ModifyImmutablyOpts) => {
      const patches: Patch[] = [];
      const nextStateRaw = immer(
        useStore.getState(),
        (d) => {
          //Ensure that the store is never replaced accidentally when the user returns a value. Only mutations will change the store.
          const ret = modifyFn(d);
          if (ret instanceof Promise) {
            return ret.then(() => {});
          } else {
            return;
          }
        },
        (ptc) => {
          patches.push(...ptc);
        },
      );

      const nextState: Promise<StoreState> | StoreState = nextStateRaw as any;

      //Prevent re-renders by only setting the state if the value actually changed.
      if (nextState instanceof Promise) {
        return nextState.then((newVal) => {
          if (patches.length && opts?.dryRun !== true) {
            useStore.setState(newVal, true);
          }

          return { hasChanges: !!patches.length, nextState: newVal };
        }) as any;
      } else {
        if (patches.length && opts?.dryRun !== true) {
          useStore.setState(nextState, true);
        }
        return { hasChanges: !!patches.length, nextState: nextState };
      }
    },
  };

  return store;
}
