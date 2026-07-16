import React, { type PropsWithChildren } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { layout, spacing } from "@/theme/tokens";

export function ScreenScaffold({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export interface ScreenScrollViewProps extends ScrollViewProps {
  innerRef?: React.Ref<ScrollView>;
}

export function ScreenScrollView({
  contentContainerStyle,
  innerRef,
  ...props
}: ScreenScrollViewProps) {
  return (
    <ScrollView
      {...props}
      ref={innerRef}
      style={[styles.scroll, props.style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  scroll: {
    flex: 1,
    minWidth: 0,
  },
  content: {
    flexGrow: 1,
    minWidth: 0,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.l,
  },
});
