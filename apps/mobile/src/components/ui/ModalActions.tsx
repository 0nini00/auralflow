import React from "react";
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { control } from "@/theme/tokens";
import { Button, type ButtonProps } from "./Button";

export interface ModalAction extends Pick<ButtonProps, "label" | "variant" | "disabled" | "loading" | "onPress" | "accessibilityLabel"> {}

export interface ModalActionsProps {
  secondary?: ModalAction;
  primary: ModalAction;
  style?: StyleProp<ViewStyle>;
}

export function ModalActions({ secondary, primary, style }: ModalActionsProps) {
  const { width } = useWindowDimensions();
  const stacked = width < 360;

  return (
    <View style={[styles.base, stacked && styles.stacked, style]}>
      {secondary ? <Button {...secondary} variant={secondary.variant ?? "secondary"} size="medium" style={stacked ? styles.stackedButton : styles.button} /> : null}
      <Button {...primary} variant={primary.variant ?? "primary"} size="medium" style={stacked ? styles.stackedButton : styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: control.modalActions.gap,
    paddingTop: control.modalActions.topPadding,
  },
  stacked: { flexDirection: "column" },
  button: { flex: 1 },
  stackedButton: { width: "100%" },
});
