export { BackHandler, Platform, Keyboard, StyleSheet, View, Text, TouchableOpacity } from "react-native";
export { Screen, ScreenContainer, ScreenStack } from "react-native-screens";

export const history = new Proxy(
  {},
  {
    get() {},
  },
);
