import {
  BackHandler as RNWBackHandler,
  Platform as RNWPlatform,
  Keyboard as RNWKeyboard,
  StyleSheet as RNWStyleSheet,
  View as RNWView,
  Text as RNWText,
  TouchableOpacity as RNWTouchableOpacity,
  //@ts-ignore
} from "react-native-web";

import type {
  BackHandler as RNBackHandler,
  Keyboard as RNKeyboard,
  Platform as RNPlatform,
  StyleSheet as RNStyleSheet,
  View as RNView,
  TouchableOpacity as RNTouchableOpacity,
  Text as RNText,
} from "react-native";

import type {
  Screen as RNScreen,
  ScreenContainer as RNScreenContainer,
  ScreenStack as RNScreenStack,
} from "react-native-screens";

import * as historyRaw from "history";

export const BackHandler: typeof RNBackHandler = RNWBackHandler;
export const Platform: typeof RNPlatform = RNWPlatform;
export const Keyboard: typeof RNKeyboard = RNWKeyboard;
export const StyleSheet: typeof RNStyleSheet = RNWStyleSheet;
export const View: typeof RNView = RNWView;
export const Text: typeof RNText = RNWText;
export const TouchableOpacity: typeof RNTouchableOpacity = RNWTouchableOpacity;
export const Screen: typeof RNScreen = RNWView;
export const ScreenContainer: typeof RNScreenContainer = RNWView;
export const ScreenStack: typeof RNScreenStack = RNWView;
export const history = historyRaw;
