import {
  validateAndCleanInputParams,
  ParamTypesClass,
  ParamsTypeRecord,
  ParamsOutputObj,
  parseUrl,
  $pathType,
  $paramsType,
  ParamsInputObj,
} from "typed-navigator";
import { PathObjResult } from "typed-navigator";
import { MultiTypeComponent, RouteDef, StackRouteDef, SwitchRouteDef } from "typed-navigator";
import { dequal } from "dequal/lite";
import useEvent from "use-event-callback";
import _ from "lodash";
import React, {
  createContext,
  ReactNode,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AbsNavStatePath,
  InnerNavigationState,
  RootNavigationState,
  StackNavigationState,
  SwitchNavigationState,
} from "typed-navigator";
import { createZustandStore, ZustandStore } from "./utils/createZustandStore.js";
import {
  BackHandler,
  history,
  Keyboard,
  Platform,
  Screen,
  ScreenContainer,
  ScreenStack,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "./primitives";
import type { TextProps, TouchableOpacityProps } from "react-native";
import { TypedNavigator } from "typed-navigator";
import { ExtractObjectPath } from "./utils/typescript-utils.js";

type RouterOpts = {
  rememberDevState?: boolean; //Defaults to true
  initialNavigationState?: RootNavigationState<any>;
};

export function createRouter<T extends RouteDef>(rootDefinition: T, opts?: RouterOpts): TypedReactNavigator<T> {
  const thisRouter = new TypedReactNavigator(rootDefinition, opts);

  return thisRouter as any;
}

class TypedReactNavigator<T extends RouteDef> extends TypedNavigator<T> {
  #getDefAtPath = _.memoize(
    (pathArr: string[]) => {
      let retDef: RouteDef;
      this.forEachRouteDefUsingPathArray(pathArr, (a) => {
        if (!a.thisDef) {
          throw new NotFoundError({
            msg: `Unable to find route definitition for the path ${pathArr.join("/")}`,
            path: pathArr,
          });
        } else {
          retDef = a.thisDef;
        }
      });
      return retDef!;
    },
    (a) => a.join(""),
  );

  #navigationStateStore: ZustandStore<RootNavigationState<any>>;

  #history = Platform.OS === "web" ? history.createBrowserHistory() : null;

  #unsubscribes: (() => void)[] | null = null;
  //This fn gets called during the root Navigator render
  #maybeSetupSubscriptions() {
    if (this.#unsubscribes !== null) {
      return;
    }
    this.#unsubscribes = [];

    if (Platform.OS === "android") {
      const fn = () => this.goBack();
      BackHandler.addEventListener("hardwareBackPress", fn);
      this.#unsubscribes.push(() => {
        BackHandler.removeEventListener("hardwareBackPress", fn);
      });
    }

    if (Platform.OS === "web" && this.#history) {
      this.#unsubscribes.push(
        this.#history.listen((e) => {
          if (this.#webIsGoingBack) {
            this.#webIsGoingBack = false;
            return;
          }

          const url = e.location.pathname + e.location.search;
          if (e.action === history.Action.Pop) {
            const { path, params } = parseUrl(url);
            this.#navigateToPath(path, params, { browserHistoryAction: "none" });
          }
        }),
      );
    }
  }

  //This gets called when the root navigator is unmounted
  #tearDownSubscriptions() {
    this.#unsubscribes?.forEach((fn) => fn());
    this.#unsubscribes = null;
  }

  constructor(rootDef: T, opts?: RouterOpts) {
    super(rootDef as any);

    if (opts?.rememberDevState) {
      //TODO: Load saved dev state
    }

    if (opts?.initialNavigationState) {
      //TODO: Validate opts?.initialNavigationState and clear it with warning if invalid
    }

    const initState = opts?.initialNavigationState || this.#generateInitialRootState(rootDef);

    this.#navigationStateStore = createZustandStore(initState);

    if (Platform.OS === "web") {
      const currUrl = this.getFocusedUrl();
      const browserUrl = (window.location.pathname + window.location.search).replace(/^\//, "");
      if (currUrl !== browserUrl) {
        const { path, params } = parseUrl(!browserUrl ? currUrl : browserUrl);
        this.#navigateToPath(path, params, { browserHistoryAction: "replace" });
      }
    }
  }

  #generateInitialRootState(rootDef: RouteDef): RootNavigationState<any> {
    if (!("routes" in rootDef) || !rootDef.routes) {
      throw new Error("The root of your route definition must be a switch or stack navigator!");
    }

    const initialRoute = rootDef.initialRoute || Object.keys(rootDef.routes)[0]!;
    const initialInnerState = this.#generateInitialInnerState(rootDef.routes[initialRoute]!, initialRoute);

    if (rootDef.type === "stack") {
      return {
        type: "root-stack",
        stack: [initialInnerState],
      };
    } else if (rootDef.type === "switch") {
      return {
        type: "root-switch",
        focusedSwitchIndex: 0,
        switches: [initialInnerState],
      };
    } else {
      ((a: never) => {})(rootDef);
      throw new Error("Unreachable");
    }
  }

  #generateInitialInnerState(
    def: RouteDef,
    path: string,
    allAccumulatedParams?: Record<string, any>,
  ): InnerNavigationState {
    const params = def.params ? _.pick(allAccumulatedParams, Object.keys(def.params)) : undefined;

    if (def.type === "leaf") {
      return omitUndefined({
        type: "leaf",
        path,
        params,
      });
    } else if ("routes" in def) {
      const initialRoute = def.initialRoute || Object.keys(def.routes)[0]!;
      const initialInnerState = this.#generateInitialInnerState(
        def.routes[initialRoute]!,
        initialRoute,
        allAccumulatedParams,
      );

      if (def.type == "stack") {
        return omitUndefined({
          type: "stack",
          path,
          params,
          stack: [initialInnerState],
        });
      } else if (def.type === "switch") {
        return omitUndefined({
          type: "switch",
          path,
          params,
          focusedSwitchIndex: 0,
          switches: [initialInnerState],
        });
      } else {
        ((a: never) => {})(def);
        throw new Error("Unreachable");
      }
    } else {
      ((a: never) => {})(def);
      throw new Error("Unreachable");
    }
  }

  #getComponentAtPath(
    path: string[],
    type: "leaf",
  ): {
    (): JSX.Element;
    loadComponent?: () => Promise<void>;
    hasLoaded?: () => boolean;
  } | null;
  #getComponentAtPath(path: string[], type: "wrapper"): ((a: { children: ReactNode }) => JSX.Element) | null;
  #getComponentAtPath(path: string[], type: "leaf" | "wrapper"): any {
    return this.#getComponentAtPathMemoized(path, type);
  }

  #getComponentAtPathMemoized = _.memoize(
    (path: string[], type: "leaf" | "wrapper"): any => {
      const childDef = this.#getDefAtPath(path);

      let Component: any;
      if (type === "leaf") {
        if ("Component" in childDef && childDef.Component) {
          Component = assertIsComponent(
            childDef.Component,
            "component was defined on a route but is not a react component!" + path.join("/"),
          );
        }
      } else if (type === "wrapper") {
        Component = childDef.Wrapper
          ? assertIsComponent(
              childDef.Wrapper,
              "Wrapper was defined on a route but is not a react component! " + path.join("/"),
            )
          : React.Fragment;
      }

      return Component;
    },
    (a, b) => a.join("") + b,
  );

  #getFocusedAbsoluteNavStatePath(rootState: RootNavigationState<any> = this.#navigationStateStore.get()) {
    let path: AbsNavStatePath = [];
    let currState: RootNavigationState<any> | InnerNavigationState = rootState;
    while (currState) {
      if ("switches" in currState) {
        const nextState = currState.switches[currState.focusedSwitchIndex]!;
        if (!nextState) {
          throw new Error("Unable to find focused switch!");
        }

        path.push("switches", currState.focusedSwitchIndex, nextState.path);
        currState = nextState as any;
      } else if ("stack" in currState) {
        const focusedIndex = currState.stack.length - 1;
        const nextState = currState.stack[focusedIndex];
        if (!nextState) {
          throw new Error("Unable to determine focused route! Empty stack!");
        }
        path.push("stack", focusedIndex, nextState.path);
        currState = nextState as any;
      } else if (currState.type === "leaf") {
        break;
      } else {
        ((a: never) => {})(currState);
        throw new Error("Unreachable");
      }
    }

    return path;
  }

  #useAbsoluteNavStatePathHasEverBeenFocused = (absoluteNavStatePath: (string | number)[]) => {
    const hasEverBeenFocused = useRef(absoluteNavStatePath.length ? false : true);
    return this.#navigationStateStore.useStore(() => {
      //A bit gross to do a side effect in a selector, but it's the best place for the side effect
      if (pathSatisfiesPathConstraint(absoluteNavStatePath, this.#getFocusedAbsoluteNavStatePath())) {
        hasEverBeenFocused.current = true;
      }
      return hasEverBeenFocused.current;
    });
  };

  public Redirect: <Path extends PathObjResult<any, any, any, any, any, any, any, any>>(p: {
    path: Path;
    params: ExtractObjectPath<ParamsInputObj<T>, Path[$pathType]>[$paramsType];
  }) => JSX.Element | null = (a) => {
    useLayoutEffect(() => {
      this.#navigateToPath(this.getPathArrFromPathObjResult(a.path), a.params, { browserHistoryAction: "replace" });
    }, []);

    return null;
  };

  public InlineLink: <Path extends PathObjResult<any, any, any, any, any, any, any, any>>(
    p: LinkComponentProps<Path, TextProps, ExtractObjectPath<ParamsInputObj<T>, Path[$pathType]>[$paramsType]>,
  ) => JSX.Element | null = (a) => {
    const {
      children,
      path,
      params,
      hrefLang,
      media,
      rel,
      target,
      referrerPolicy,
      onPress,
      accessibilityRole,
      ...rest
    } = a;

    const platformProps =
      Platform.OS === "web"
        ? {
            onClick: (e: React.MouseEvent) => {
              onPress?.();
              if (isHandledMouseEvent(e, target)) {
                e.preventDefault();
                this.navigate(path, params);
              }
            },
            href: "/" + this.generateUrl(path, params),
            hrefAttrs: { hrefLang, media, rel, target, referrerPolicy },
          }
        : {
            onPress: () => {
              onPress?.();
              this.navigate(path, params);
            },
          };

    return (
      <Text accessibilityRole={accessibilityRole ?? "link"} {...platformProps} {...rest}>
        {children}
      </Text>
    );
  };

  public BlockLink: <Path extends PathObjResult<any, any, any, any, any, any, any, any>>(
    p: LinkComponentProps<
      Path,
      TouchableOpacityProps,
      ExtractObjectPath<ParamsInputObj<T>, Path[$pathType]>[$paramsType]
    >,
  ) => JSX.Element | null = (a) => {
    const { children, path, params, hrefLang, media, referrerPolicy, rel, target, ...rest } = a;

    const { onPress, accessibilityRole, activeOpacity, ...restTouchableProps } = rest;

    const webLink: any =
      Platform.OS === "web" ? (
        <a
          //Expand the link to fill it's container. See: https://css-tricks.com/a-complete-guide-to-links-and-buttons/#aa-links-around-bigger-chunks-of-content
          style={{ position: "absolute", top: 0, right: 0, left: 0, bottom: 0 }}
          onClick={(e) => {
            onPress?.();

            if (isHandledMouseEvent(e, target)) {
              e.preventDefault();
              this.navigate(path, params);
            }
          }}
          href={"/" + this.generateUrl(path, params)}
          hrefLang={hrefLang}
          media={media}
          referrerPolicy={referrerPolicy}
          rel={rel}
          target={target}
        />
      ) : null;

    return (
      <TouchableOpacity
        activeOpacity={activeOpacity ?? 1}
        accessibilityRole={accessibilityRole ?? "link"}
        onPress={
          Platform.OS === "web"
            ? undefined
            : () => {
                onPress?.();
                this.navigate(path, params);
              }
        }
        {...restTouchableProps}
      >
        {webLink}
        {children}
      </TouchableOpacity>
    );
  };

  /**
   * The root navigator. Should be rendered at the root your app.
   */
  public Navigator: () => JSX.Element = () => {
    const navState = this.#navigationStateStore.useStore();
    const InnerNavigator = this.#InnerNavigator;
    this.#maybeSetupSubscriptions();
    useEffect(() => {
      return () => {
        this.#tearDownSubscriptions();
      };
    }, []);

    return React.cloneElement(<InnerNavigator state={navState} path={[]} absoluteNavStatePath={[]} />);
  };

  #AbsoluteNavStatePathContext = createContext<(string | number)[]>([]);
  #useAbsoluteNavStatePath = () => useContext(this.#AbsoluteNavStatePathContext);

  #InnerNavigator = (p: {
    state: InnerNavigationState | RootNavigationState<any>;
    path: string[];
    absoluteNavStatePath: (string | number)[];
  }) => {
    const hasEverBeenFocused = this.#useAbsoluteNavStatePathHasEverBeenFocused(p.absoluteNavStatePath);

    if (!hasEverBeenFocused) {
      return null;
    }

    if (p.state.infoForRenderingNotFoundError) {
      const { NotFound404 } = this.#getDefAtPath(p.path) as StackRouteDef | SwitchRouteDef;
      if (!NotFound404) {
        throw new Error(
          "Error in router internals. Should not set state property `infoForRenderingNotFoundError` unless a NotFound404 is also defined",
        );
      }

      const { origParams, origPath } = p.state.infoForRenderingNotFoundError;

      return <NotFound404 path={origPath.join("/")} params={origParams} />;
    }

    let inner: any;

    const InnerLeafNavigator = this.#InnerLeafNavigator;
    const InnerSwitchNavigator = this.#InnerSwitchNavigator;
    const InnerStackNavigator = this.#InnerStackNavigator;

    if (p.state.type === "leaf") {
      inner = <InnerLeafNavigator path={p.path} />;
    } else if (p.state.type === "switch" || p.state.type === "root-switch") {
      inner = (
        <InnerSwitchNavigator path={p.path} absoluteNavStatePath={p.absoluteNavStatePath} state={p.state as any} />
      );
    } else if (p.state.type === "stack" || p.state.type === "root-stack") {
      inner = (
        <InnerStackNavigator path={p.path} absoluteNavStatePath={p.absoluteNavStatePath} state={p.state as any} />
      );
    } else {
      ((a: never) => {})(p.state);
      throw new Error("Unreachable");
    }

    const Provider = this.#AbsoluteNavStatePathContext.Provider;

    return <Provider value={p.absoluteNavStatePath}>{inner}</Provider>;
  };

  #InnerLeafNavigator = React.memo((p: { path: string[] }) => {
    const Leaf = this.#getComponentAtPath(p.path, "leaf");

    const Wrapper = this.#getComponentAtPath(p.path, "wrapper") || React.Fragment;

    if (!Leaf) {
      throw new Error("No component defined on leaf route definition!");
    }

    return (
      <Wrapper>
        <View style={{ flex: 1 }}>
          <Leaf />
        </View>
      </Wrapper>
    );
  }, dequal);

  #InnerStackNavigator = React.memo(
    (p: { path: string[]; state: StackNavigationState<any, any, any>; absoluteNavStatePath: (string | number)[] }) => {
      const Wrapper = this.#getComponentAtPath(p.path, "wrapper") || React.Fragment;

      const parentDef = this.#getDefAtPath(p.path)! as StackRouteDef;

      const InnerNavigator = this.#InnerNavigator;

      return (
        <Wrapper>
          <ScreenStack style={{ flex: 1 }}>
            {p.state.stack.map((thisNavigationState, i) => {
              const thisRoutePath = p.path.concat(thisNavigationState.path);
              const thisRouteDef = this.#getDefAtPath(thisRoutePath)!;
              const allScreenProps = {
                ...(parentDef.unstable_rn_childScreenProps || {}),
                ...(thisRouteDef.unstable_rn_screenProps || {}),
              };

              const {
                screenOrientation,
                style,
                stackAnimation,
                onDismissed,
                stackPresentation,
                ...unstable_rn_screenProps
              } = allScreenProps;

              return (
                <Screen
                  key={i}
                  screenOrientation={screenOrientation}
                  stackAnimation={
                    stackAnimation ? stackAnimation : Platform.OS === "android" ? "fade" : "slide_from_left"
                  }
                  style={[{ ...StyleSheet.absoluteFillObject, backgroundColor: "white" }, style]}
                  stackPresentation={
                    stackPresentation
                      ? stackPresentation
                      : Platform.OS === "android"
                      ? "containedTransparentModal"
                      : "push"
                  }
                  hideKeyboardOnSwipe={true}
                  gestureEnabled={true}
                  onDismissed={(e) => {
                    this.#navigationStateStore.modifyImmutably((rootState) => {
                      const parentState = getStateAtAbsPath(rootState, p.absoluteNavStatePath);
                      if (!parentState || !("stack" in parentState)) {
                        throw new Error("Unable to clean up state on onDismissed transition!");
                      }

                      parentState.stack.splice(
                        parentState.stack.length - e.nativeEvent.dismissCount,
                        e.nativeEvent.dismissCount,
                      );
                    });
                    onDismissed?.(e);
                  }}
                  {...unstable_rn_screenProps}
                >
                  <View style={{ flex: 1 }}>
                    <InnerNavigator
                      state={thisNavigationState as any}
                      path={thisRoutePath}
                      absoluteNavStatePath={p.absoluteNavStatePath.concat("stack", i, thisNavigationState.path)}
                    />
                  </View>
                </Screen>
              );
            })}
          </ScreenStack>
        </Wrapper>
      );
    },
    dequal,
  );

  #InnerSwitchNavigator = React.memo(
    (p: { path: string[]; state: SwitchNavigationState<any, any, any>; absoluteNavStatePath: (string | number)[] }) => {
      const Wrapper = this.#getComponentAtPath(p.path, "wrapper") || React.Fragment;

      const focusedSwitchIndex = p.state.focusedSwitchIndex;
      const parentDef = this.#getDefAtPath(p.path)! as SwitchRouteDef;

      const InnerNavigator = this.#InnerNavigator;

      return (
        <Wrapper>
          <View style={{ flex: 1 }}>
            <ScreenContainer style={{ flex: 1 }}>
              {p.state.switches.map((thisNavigationState, i) => {
                let activityState: 0 | 1 | 2;
                let zIndex: number;

                activityState = i === focusedSwitchIndex ? 2 : 0;
                zIndex = i === focusedSwitchIndex ? 1 : -1;

                if (parentDef.keepChildrenMounted !== true && activityState === 0) {
                  return null;
                }

                const thisRoutePath = p.path.concat(thisNavigationState.path);
                const thisRouteDef = this.#getDefAtPath(thisRoutePath);

                const allScreenProps = {
                  ...(parentDef.unstable_rn_childScreenProps || {}),
                  ...(thisRouteDef.unstable_rn_screenProps || {}),
                };
                const {
                  screenOrientation,
                  activityState: ignoredActivityState,
                  style,
                  ...unstable_rn_screenProps
                } = allScreenProps;

                return (
                  <Screen
                    key={i}
                    screenOrientation={screenOrientation}
                    activityState={activityState}
                    style={[
                      {
                        ...StyleSheet.absoluteFillObject,
                        backgroundColor: "white",
                        zIndex,
                      },
                      style,
                    ]}
                    {...unstable_rn_screenProps}
                  >
                    <InnerNavigator
                      state={thisNavigationState as any}
                      path={thisRoutePath}
                      absoluteNavStatePath={p.absoluteNavStatePath.concat("switches", i, thisNavigationState.path)}
                    />
                  </Screen>
                );
              })}
            </ScreenContainer>
          </View>
        </Wrapper>
      );
    },
    dequal,
  );

  /**
   * Hook that returns params satisfying the `pathConstraint` found at the nearest parent navigator.
   * Throws an error if the component has no parent navigator satisfying the `pathConstraint`.
   * Optionally also supply a selector function as the second parameter to reduce re-renders
   *
   * @example
   * // ✅ Satisfies constraint
   * function BazPage(){
   *    const { bloopParam, bazParam } = useParams(PATHS.bloop.baz);
   * }
   *
   * @example
   * // ❌ FooPage does not satisfy constraint PATHS.bloop.baz
   * function FooPage(){
   *    const { bazParam } = useParams(PATHS.bloop.baz);
   * }
   *
   * @example
   * // Also note, it's okay to use less specific path selectors if you don't need all the params. This can potentially make a component easier to re-use within a component subtree.
   * function BazPage(){
   *    const { bloopParam } = useParams(PATHS.bloop);
   * }
   *
   * @example
   * //Use a selector to reduce re-renders
   * function BazPage(){
   *    const yesNo = useParams(PATHS.bloop.baz, a => a.bazParam > 5 ? 'yes' : 'no');
   * }
   */
  public useParams<Path extends PathObjResult<any, any, any, any, any, any, any, any>>(
    pathConstraint: Path,
  ): ExtractObjectPath<ParamsOutputObj<T>, Path[$pathType]>[$paramsType];
  public useParams<Path extends PathObjResult<any, any, any, any, any, any, any, any>, Ret>(
    pathConstraint: Path,
    selector: (params: ExtractObjectPath<ParamsOutputObj<T>, Path[$pathType]>[$paramsType]) => Ret,
  ): Ret;
  public useParams(pathConstraint: PathObjResult<any, any, any, any, any, any, any, any>, selector?: (a: any) => any) {
    const constraintPath = this.getPathArrFromPathObjResult(pathConstraint);
    const componentAbsPath = this.#useAbsoluteNavStatePath();
    const componentPath = absoluteNavStatePathToRegularPath(componentAbsPath);

    if (!pathSatisfiesPathConstraint(componentPath, constraintPath)) {
      throw new NotFoundError({
        msg: `Cannot find params at path ${constraintPath}! Current path is ${componentPath}`,
        path: componentPath,
      });
    }

    return this.#navigationStateStore.useStore(() => {
      const params = this.#getAccumulatedParamsAtAbsoluteNavStatePath(componentAbsPath);

      return selector ? selector(params) : params;
    });
  }

  #getAccumulatedParamsAtAbsoluteNavStatePath(navStatePath: AbsNavStatePath) {
    const rootState = this.#navigationStateStore.get();

    const accumulatedParams: Record<string, any> = {};
    navStatePath.forEach((__, i) => {
      if ((i + 1) % 3 === 0) {
        const thisStatePath = navStatePath.slice(0, i + 1);
        const thisRegularPath = absoluteNavStatePathToRegularPath(thisStatePath);
        const val: InnerNavigationState = getStateAtAbsPath(rootState, thisStatePath);

        if ("params" in val && val.params) {
          const theseParamTypes = this.#getDefAtPath(thisRegularPath).params;

          if (!theseParamTypes) {
            throw new NotFoundError({
              msg: "No param types found for route! " + thisRegularPath,
              path: absoluteNavStatePathToRegularPath(navStatePath),
              params: { ...accumulatedParams, ...val.params },
            });
          }

          const pr = validateAndCleanInputParams(val.params || {}, theseParamTypes);

          if (!pr.isValid) {
            throw new NotFoundError({
              msg: pr.errors.join("\n"),
              path: absoluteNavStatePathToRegularPath(navStatePath),
              params: { ...accumulatedParams, ...val.params },
            });
          }

          Object.assign(accumulatedParams, pr.params);
        }
      }
    });

    return accumulatedParams;
  }

  /**
   * The non hook equivalent to useParams. See {@link TypedReactNavigator#useParams}
   */
  public getFocusedParams<Path extends PathObjResult<any, any, any, any, any, any, any, any>>(
    pathConstraint: Path,
  ): ExtractObjectPath<ParamsOutputObj<T>, Path[$pathType]>[$paramsType] {
    const absPath = this.#getFocusedAbsoluteNavStatePath();

    const focusedPath = absoluteNavStatePathToRegularPath(absPath);
    const constraintPathStr = this.getPathArrFromPathObjResult(pathConstraint).join("/");

    const pathStr = focusedPath.join("/");
    if (pathStr !== constraintPathStr) {
      throw new Error(
        `Invalid path accessed! The currentpath ${pathStr} does not satisfy the required path ${constraintPathStr}`,
      );
    }

    return this.#getAccumulatedParamsAtAbsoluteNavStatePath(absPath) as any;
  }

  /**
   * Returns the current focused state of the nearest screen on which the hook is called
   */
  public useIsFocused = (absPath?: AbsNavStatePath) => {
    const thisAbsPath = this.#useAbsoluteNavStatePath();
    return this.#navigationStateStore.useStore(() => {
      return pathSatisfiesPathConstraint(absPath ?? thisAbsPath, this.#getFocusedAbsoluteNavStatePath());
    });
  };

  /**
   * An effect that runs whenever the focus state changes for the hook. Internally uses the proposed
   * `useEvent` hook so you don't need to worry about the effect function being stale.
   */
  public useFocusEffect: (effect: () => void | (() => void)) => void = (fn) => {
    const thisAbsPath = this.#useAbsoluteNavStatePath();

    const cleanupFn = useRef<void | (() => any)>();

    const doFocusEffect = useEvent(() => {
      const yes = pathSatisfiesPathConstraint(thisAbsPath, this.#getFocusedAbsoluteNavStatePath());
      if (yes) {
        cleanupFn.current = fn();
      } else {
        cleanupFn.current?.();
      }
    });

    useEffect(() => {
      doFocusEffect();
      return this.#navigationStateStore.subscribe(doFocusEffect);
    }, []);
  };

  /**
   * Returns the current url of the app.
   */
  public getFocusedUrl = () => {
    const absPath = this.#getFocusedAbsoluteNavStatePath();
    const path = absoluteNavStatePathToRegularPath(absPath);
    const params = this.#getAccumulatedParamsAtAbsoluteNavStatePath(absPath);

    return this.generateUrlFromPathArr(path, params);
  };

  /**
   * Subscribe to changes to the current url of the app
   */
  public subscribeToFocusedUrl: (subFn: (currPath: string) => any) => () => void = (fn) => {
    let currFocusedUrl: string;
    fn(this.getFocusedUrl());
    return this.#navigationStateStore.subscribe(() => {
      const newFocusedUrl = this.getFocusedUrl();
      if (newFocusedUrl !== currFocusedUrl) {
        currFocusedUrl = newFocusedUrl;
        fn(currFocusedUrl);
      }
    });
  };

  /**
   * Returns the current url of the app. Requires a selector to prevent unneccessary renders
   */
  public useFocusedUrl: <Ret>(selector: (currUrl: string) => Ret) => Ret = (selector) => {
    return this.#navigationStateStore.useStore(() => {
      const focusedUrl = this.getFocusedUrl();
      return selector ? selector(focusedUrl) : focusedUrl;
    }) as any;
  };

  //State variable that temporarily disables the history listener for the next tick. Appears to be the best way to handle this situation.
  #webIsGoingBack = false;

  /**
   * Equivalent to closing the keyboard if open and then pressing the Android back arrow.
   */
  public goBack = () => {
    Keyboard.dismiss();
    const { hasChanges } = this.#navigationStateStore.modifyImmutably((rootState) => {
      const focusedAbsPath = this.#getFocusedAbsoluteNavStatePath();

      const pathToGoBackIndex = _.findLastIndex(focusedAbsPath, (a) => typeof a === "number" && a !== 0);

      if (pathToGoBackIndex >= 0) {
        const statePath = focusedAbsPath.slice(0, pathToGoBackIndex - 1);
        const navigatorState:
          | StackNavigationState<any, any, any>
          | SwitchNavigationState<any, any, any>
          | RootNavigationState<any> = getStateAtAbsPath(rootState, statePath);

        if (navigatorState.type === "stack" || navigatorState.type === "root-stack") {
          navigatorState.stack.pop();
        } else {
          navigatorState.focusedSwitchIndex = 0;
        }
      }
    });

    if (hasChanges && this.#history && Platform.OS === "web") {
      if (this.#unsubscribes) {
        this.#webIsGoingBack = true;
      }
      this.#history.back();
    }

    return hasChanges;
  };

  #modifyStateForNavigateToPath(
    path: string[],
    params: Record<string, any>,
    opts: { isModifyingForNotFoundError: false | { origPath: string[]; origParams: any } },
  ) {
    return this.#navigationStateStore.modifyImmutably(
      (rootState) => {
        let currParentState = rootState as RootNavigationState<any> | InnerNavigationState;
        for (let i = 0; i < path.length; i++) {
          const thisDef = this.#getDefAtPath(path.slice(0, i + 1));
          const thisPath = path[i]!;
          const theseParams = thisDef.params ? _.pick(params, Object.keys(thisDef.params)) : undefined;

          if ("stack" in currParentState) {
            const existingPerfectMatchIndex = currParentState.stack.findIndex(
              (a) => a.path === thisPath && _.isEqual(a.params, theseParams),
            );

            if (existingPerfectMatchIndex !== -1) {
              currParentState.stack = currParentState.stack.slice(0, existingPerfectMatchIndex + 1);
            } else {
              currParentState.stack.push(this.#generateInitialInnerState(thisDef, thisPath, params));
            }

            currParentState = currParentState.stack[currParentState.stack.length - 1] as any;
          } else if ("switches" in currParentState) {
            const existingSwitchIndex = currParentState.switches.findIndex((a) => a.path === thisPath);
            if (existingSwitchIndex === -1) {
              currParentState.switches.push(this.#generateInitialInnerState(thisDef, thisPath, params));
            } else {
              currParentState.switches[existingSwitchIndex]!.params = theseParams;
            }

            currParentState.focusedSwitchIndex = currParentState.switches.findIndex((a) => a.path === thisPath);
            currParentState = currParentState.switches[currParentState.focusedSwitchIndex] as any;
          } else if (currParentState.type === "leaf") {
            throw new Error("Invalid leaf route!");
          } else {
            ((a: never) => {})(currParentState);
            throw new Error("Unreachable");
          }
        }

        if (opts.isModifyingForNotFoundError) {
          //Set infoForRenderingNotFoundError on the terminal state if there was a not found error
          currParentState.infoForRenderingNotFoundError = { ...opts.isModifyingForNotFoundError };
        } else {
          //After a successful navigate like this, ensure there's no lingering `infoForRenderingNotFoundError` properties anywhere in the state
          traverse(rootState, (obj) => {
            if (obj && typeof obj === "object" && "infoForRenderingNotFoundError" in obj) {
              delete obj["infoForRenderingNotFoundError"];
            }
          });
        }
      },
      { dryRun: true },
    );
  }

  #navigateToPath = (path: string[], params: Record<string, any>, opts?: NavigateToPathOpts) => {
    const { browserHistoryAction = "push" } = opts || {};

    let ret: { hasChanges: boolean; nextState: RootNavigationState<any> }, error: any;
    try {
      ret = this.#modifyStateForNavigateToPath(path, params, {
        isModifyingForNotFoundError: false,
      });
    } catch (e) {
      error = e;
    }

    if (error) {
      if (error instanceof NotFoundError) {
        const info: any[] = [];
        this.forEachRouteDefUsingPathArray(error.path, (a) => (a.thisDef ? info.push(a) : null));

        const NotFound404Info = info.reverse().find((a) => !!(a.thisDef as any).NotFound404);

        if (!NotFound404Info) {
          throw error;
        } else {
          ret = this.#modifyStateForNavigateToPath(
            NotFound404Info.thisPath,
            {},
            { isModifyingForNotFoundError: { origPath: path, origParams: params } },
          );
        }
      } else {
        throw error;
      }
    }

    const { hasChanges, nextState } = ret!;

    if (!hasChanges) {
      return;
    }

    const nextAbsPath = this.#getFocusedAbsoluteNavStatePath(nextState);
    const nextPath = absoluteNavStatePathToRegularPath(nextAbsPath);
    const Leaf = this.#getComponentAtPath(nextPath, "leaf");

    const doFinalize = () => {
      this.#navigationStateStore.set(nextState);
      if (!error && Platform.OS === "web" && this.#history && browserHistoryAction !== "none") {
        const url =
          "/" + this.generateUrlFromPathArr(nextPath, this.#getAccumulatedParamsAtAbsoluteNavStatePath(nextAbsPath));
        if (browserHistoryAction === "push") {
          this.#history.push(url);
        } else if (browserHistoryAction === "replace") {
          this.#history.replace(url);
        } else {
          ((a: never) => {})(browserHistoryAction);
          throw new Error("Unreachable");
        }
      }
    };

    //Some optimization on lazy components to defer state change until AFTER the lazy component has loaded. Reduces jank a bit.
    if (Leaf && Leaf.loadComponent && !Leaf.hasLoaded?.()) {
      Promise.race([Leaf.loadComponent(), new Promise((res) => setTimeout(res, 150))]).then(() => {
        doFinalize();
      }, console.error);
    } else if (Leaf && Leaf["_init"] && Leaf["_payload"] && Leaf["_payload"]?.["_status"] === -1) {
      try {
        Leaf["_init"](Leaf["_payload"]);
      } catch (compProm) {
        Promise.race([compProm, new Promise((res) => setTimeout(res, 150))]).then(() => {
          doFinalize();
        }, console.error);
      }
    } else {
      doFinalize();
    }
  };

  public navigate: <
    Path extends PathObjResult<any, any, any, any, any, any, any, any>,
    Params = ExtractObjectPath<ParamsInputObj<T>, Path[$pathType]>[$paramsType],
  >(
    p: Path,
    params: Params,
  ) => void = (pathObj, params) => {
    const path = this.getPathArrFromPathObjResult(pathObj);

    return this.#navigateToPath(path, params as any);
  };

  /**
   * Navigate to a string url. To try and enforce consistency, by default only accepts
   * inputs from the {@link Router#generateUrl} function.
   *
   * @example
   * import { UrlString } from 'react-typed-navigator';
   * // Typical
   * navigateToUrl(generateUrl(PATHS.baz, { bazParam: 1}))
   * // Cast string to UrlString
   * navigateToUrl("baz?bazParam=1" as UrlString)
   *
   */
  public navigateToUrl(url: string) {
    const v = this.validateUrl(url);
    if (!v.isValid) {
      throw new Error(v.errors.join("\n"));
    }

    const { path, params } = parseUrl(url);

    this.#navigateToPath(path, params);
  }
}

type LazyComponent<T extends MultiTypeComponent> = T & {
  loadComponent?: () => Promise<void>;
  isLoaded: () => boolean;
};

/**
 * A `lazy` alternative that should be more stable than `React.lazy` in terms of some optimizations on routing to prevent some dropped frames
 */
export function lazy<T extends MultiTypeComponent<any>>(component: () => Promise<{ default: T }>): LazyComponent<T> {
  let Component: any;
  let prom: any;

  const loadComponent = () => {
    if (!prom) {
      prom = component().then((b) => {
        Component = b.default;
        const compName = Component.name || Component.displayName;
        //@ts-ignore
        Inner.displayName = compName ? "Lazy" + compName : "LazyComponent";
      });
    }

    return prom;
  };

  function Inner(props: any) {
    if (!Component) {
      loadComponent();
      throw prom;
    }

    return <Component {...props} />;
  }

  (Inner as any).loadComponent = loadComponent;
  (Inner as any).hasLoaded = () => {
    return !!Component;
  };

  return Inner as any;
}

function assertIsComponent<T>(val: T, errMsg: string) {
  if (process.env["NODE_ENV"] === "development") {
    //Doesn't need to be too rigorous of checks. Just here to help people debug dumb mistakes.
    const isFunction = typeof val === "function";
    const isLikelyLazyComponent = val && typeof val === "object" && val["$$typeof"];
    const isLikelyLazyBareImport = val && val instanceof Promise;
    if (!val || (!isFunction && !isLikelyLazyComponent && !isLikelyLazyBareImport)) {
      throw new Error(errMsg);
    }
  }

  return val;
}

function absoluteNavStatePathToRegularPath(absNavStatePath: (string | number)[]) {
  //Absolute nav state paths are always in pairs of 3. E.g. "switches" -> 0 -> "someRouteName"
  return _.filter(absNavStatePath, (a, i) => (i + 1) % 3 === 0) as string[];
}

function getStateAtAbsPath(state: RootNavigationState<any>, path: (string | number)[]) {
  if (!path.length) {
    return state;
  } else {
    return _.get(
      state,
      path.filter((a, i) => (i + 1) % 3 !== 0),
    );
  }
}

function pathSatisfiesPathConstraint(path: (string | number)[], pathConstraint: (string | number)[]) {
  return _.isEqual(path, pathConstraint.slice(0, path.length));
}

class NotFoundError extends Error {
  path: string[];
  params?: ParamsTypeRecord;

  constructor(a: { msg: string; path: string[]; params?: ParamsTypeRecord }) {
    super(a.msg);
    this.path = a.path;
    this.params = a.params;
  }
}

function omitUndefined<T extends Record<string, any>>(obj: T): T {
  return _.omitBy(obj, _.isUndefined) as any;
}

function traverse(jsonObj: any, fn: (val: any) => any) {
  fn(jsonObj);

  if (jsonObj !== null && typeof jsonObj == "object") {
    Object.entries(jsonObj).forEach(([key, value]) => {
      traverse(value, fn);
    });
  }
}

type NavigateToPathOpts = { browserHistoryAction?: "push" | "none" | "replace" };

function isHandledMouseEvent(e: React.MouseEvent, target: string | undefined) {
  return (
    !e.defaultPrevented &&
    e.button === 0 && //Ignore non-left clicks
    (!target || target === "_self") && //Ignore if target is set
    !(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey)
  ); //Ignore if click modifiers
}

type LinkProps = {
  hrefLang?: string | undefined;
  media?: string | undefined;
  rel?: string | undefined;
  target?: React.HTMLAttributeAnchorTarget | undefined;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy | undefined;
};

type LinkComponentProps<Path, ComponentProps, Params> = {
  children: ReactNode;
  path: Path;
  params: Params;
} & Omit<ComponentProps, "onPress"> & { onPress?: () => void } & LinkProps;
