/**
 * react-native 的测试替身（仅用于 vitest / node 环境）。
 *
 * 真实的 react-native 源码带有 Flow 的 `import typeof` 语法，vite 的 SSR transform 走
 * rollup 解析器无法处理，会导致整个测试 suite 加载崩溃（Expected 'from', got 'typeOf'）。
 * 由于移动端单元测试只验证 store / service 的逻辑，不做组件渲染，这里提供一组够用的占位实现：
 * - Platform / NativeModules / Appearance 等运行时会被逻辑读取，给出可用默认值；
 * - UI 组件只需存在，返回 null 即可（node 环境不渲染）。
 *
 * 通过 vitest.config.mts 的 resolve.alias 把 `react-native` 精确指向本文件。
 */

type AnyProps = Record<string, unknown>;

function stubComponent(name: string) {
  const component = () => null;
  Object.defineProperty(component, "name", { value: name });
  return component;
}

export const Platform = {
  OS: "android" as const,
  select: <T>(specifics: { android?: T; ios?: T; native?: T; default?: T }): T | undefined =>
    specifics.android ?? specifics.native ?? specifics.default,
};

export const NativeModules: Record<string, AnyProps> = {};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  absoluteFillObject: {},
  absoluteFill: {},
};

export const Appearance = {
  getColorScheme: () => "dark" as const,
  addChangeListener: () => ({ remove() {} }),
};

export const Alert = {
  alert: () => {},
};

export const Linking = {
  openURL: () => Promise.resolve(),
  canOpenURL: () => Promise.resolve(true),
  getInitialURL: () => Promise.resolve(null as string | null),
  addEventListener: () => ({ remove() {} }),
};

class AnimatedValue {
  constructor(private value: number) {}
  setValue(next: number) {
    this.value = next;
  }
  interpolate() {
    return this;
  }
}

const noopAnimation = () => ({ start: (cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true }), stop() {} });

export const Animated = {
  View: stubComponent("Animated.View"),
  Text: stubComponent("Animated.Text"),
  Image: stubComponent("Animated.Image"),
  ScrollView: stubComponent("Animated.ScrollView"),
  Value: AnimatedValue,
  timing: noopAnimation,
  loop: noopAnimation,
  parallel: noopAnimation,
  sequence: noopAnimation,
  createAnimatedComponent: <T>(component: T): T => component,
};

export const Easing = new Proxy({}, { get: () => () => 0 });

export const ActivityIndicator = stubComponent("ActivityIndicator");
export const FlatList = stubComponent("FlatList");
export const Image = stubComponent("Image");
export const ImageBackground = stubComponent("ImageBackground");
export const Modal = stubComponent("Modal");
export const Pressable = stubComponent("Pressable");
export const ScrollView = stubComponent("ScrollView");
export const Text = stubComponent("Text");
export const TextInput = stubComponent("TextInput");
export const View = stubComponent("View");

export default {
  Platform,
  NativeModules,
  StyleSheet,
  Appearance,
  Alert,
  Linking,
  Animated,
  Easing,
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
};
