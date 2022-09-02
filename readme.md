# React Typed Navigator

This is a nested router solution meant as a replacement for react-navigation, with a focus on performance and type correctness.

First define your routes in a nested manner (typically in a `router.tsx` file or the like) to create your `Navigator` and navigation functions. Next, render your `Navigator` at the root of your app. Finally, use the navigation constants and functions exported from your route definition (e.g. the exports defined in `router.tsx`) to interact with the router, navigate, get params, etcetera.

The architecture lends itself to aggressive performance optimization since navigators do not need
to pass a navigation prop to their children (unlike most solutions). Because of this, we can enable two performance optimzations: (1) navigators are wrapped with `React.memo` to prevent
unnecessary re-renders and (2) We ["freeze"](https://www.npmjs.com/package/react-freeze) not-currently-visible routes to prevent their render functions from firing.

## Basic Example:

```tsx
import { Button, Text, View } from "react-native";
import { createRouter, createRouteDefinition, ParamTypes, lazy } from "typed-react-navigator";
const routeDef = createRouteDefinition({
  //Declare the type of root navigator. Options are "switch" or "stack"
  type: "switch",
  //Declare the routes that live under the root navigator
  routes: {
    //The login route. Is also the initial route since it comes first in the object
    login: {
      //Type "leaf" for the login route which means it does have any nested navigators. Note that most complex apps have nested navigators.
      type: "leaf",
      Component: () => {
        return (
          <View style={{ flex: 1 }}>
            <Text>Login Page</Text>
            <Button
              title="Login"
              onPress={() => {
                //On click, navigate to the main route with { someParam: 123 }
                navigate(PATHS.main, { someParam: 123 });
              }}
            />
          </View>
        );
      },
    },
    //The main route
    main: {
      //The main route is also a leaf route
      type: "leaf",
      params: {
        //Anytime the main route is navigated to there MUST be a someParam parameter defined that is a number
        someParam: ParamTypes.number(),
      },
      Component: () => {
        //Call the useParams method to get the param, and ensure you specify which router path you expect
        //this component to be rendered under. In this case the main route
        const { someParam } = useParams(PATHS.main);
        return (
          <View style={{ flex: 1 }}>
            <Text>Main</Text>
          </View>
        );
      },
    },
  },
});

//Export all the key functions and constants you will use throughout your app. These will be FULLY TYPED using the shape of your route definition
const { Navigator, PATHS, goBack, navigate, useParams } = createRouter(routeDef);

export function App() {
  //Render the navigator at the root of your app
  return <Navigator />;
}
```

## More Complex Example

```tsx
//router.tsx
import React from "react";
import { Button, Text, View } from "react-native";

import { createRouter, createRouteDefinition, ParamTypes } from "typed-react-navigator";
const routeDef = createRouteDefinition({
  type: "switch",
  routes: {
    login: {
      type: "leaf",
      //Note that
      Component: lazy(() => import("./Login")),
    },
    main: {
      type: "switch",
      //`keepChildrenMounted` makes previously rendered but currently inactive screens stay mounted. The default behavior is to unmount them.
      keepChildrenMounted: true,
      Wrapper: lazy(() => import("./MainLayout")),
      routes: {
        tab_1: {
          type: "stack",
          routes: {
            tab_1_stack_home: {
              type: "leaf",
              Component: lazy(() => import("./Tab1StackHome")),
            },
            tab_1_stack_screen: {
              type: "leaf",
              params: {
                //This parameter can be used by any subroute
                someParam: ParamTypes.number(),
              },
            },
          },
        },
        tab_2: {
          type: "leaf",
          Component: lazy(() => import("./Tab2")),
        },
      },
    },
  },
});

//NOTE EXPORTS BELOW! These are how params will be consumed and navigation will occur.
export const { Navigator, PATHS, goBack, navigate, useParams } = createRouter(routeDef);

//App.tsx
import { Navigator } from "./router.tsx";
export function App() {
  return <Navigator />;
}

//Login.tsx
import { PATHS, navigate } from "./router.tsx";

export default function Login() {
  return (
    <View style={{ flex: 1 }}>
      <Text>This is the Login Page</Text>
      <Button
        onPress={() => {
          navigate(PATHS.main.tab_1.tab_1_stack_home, {});
        }}
        title="Click to Login"
      />
    </View>
  );
}

//MainTabBar.tsx
import { View, Button, Text } from "react-native";
import { PATHS, navigate } from "../Router.js";
export default function MainTabBar() {
  return (
    <View style={{ height: 50, flex: 1 }}>
      <Button
        title="Tab 1"
        onPress={() => {
          navigate(PATHS.main.tab_1.tab_1_stack_home, {});
        }}
      />
      <Button
        title="Tab 2"
        onPress={() => {
          navigate(PATHS.main.tab_2, {});
        }}
      />
    </View>
  );
}

//Tab1StackHome.tsx
import { View, Button, Text } from "react-native";
import { PATHS, navigate } from "../Router.js";
export default function Tab1StackHome() {
  return (
    <View style={{ flex: 1 }}>
      <Text>Tab 1</Text>
      <Button
        onPress={() => {
          navigate(PATHS.main.tab_1.tab_1_stack_screen, { someParam: 123 });
        }}
        title="Push Stack Screen"
      />
    </View>
  );
}

//Tab1StackScreen.tsx
import { goBack, useParams } from "./router.tsx";
export default function Tab1StackScreen() {
  const { someParam } = useParams(PATHS.main.tab_1.tab_1_stack_screen);
  return (
    <View style={{ flex: 1 }}>
      <Text>Tab 1 Stack Screen ({someParam})</Text>
      <Button
        onPress={() => {
          goBack();
        }}
        title="Go Back"
      />
    </View>
  );
}

//Tab2.tsx
export default function Tab2() {
  return (
    <View style={{ flex: 1 }}>
      <Text>Tab 2</Text>
    </View>
  );
}
```
