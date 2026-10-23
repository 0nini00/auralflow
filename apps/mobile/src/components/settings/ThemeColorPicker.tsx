import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "react-native-linear-gradient";
import { ChevronDown, ChevronUp, Palette } from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import { hexToHsv, hsvToHex, type HsvColor } from "@/services/colorPickerModel";
import { parseAccentColorInput } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface ThemeColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

const HUE_COLORS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 主题色调色盘：HSV 色相条 + 饱和度/明度选区 + Hex 输入。
 *
 * 拖拽期间只更新本地 draft（预览圆点与 Hex），松手才写回主题 store，
 * 避免每帧 AsyncStorage 落盘；点预设色仍即时生效。
 */
export function ThemeColorPicker({ value, onChange }: ThemeColorPickerProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [expanded, setExpanded] = useState(false);
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const [svSize, setSvSize] = useState({ width: 0, height: 0 });
  const [hueWidth, setHueWidth] = useState(0);

  const hsvRef = useRef(hsv);
  const draftRef = useRef(value);

  // 外部（预设色/Hex/重置）变化时同步调色盘
  useEffect(() => {
    const next = hexToHsv(value);
    hsvRef.current = next;
    draftRef.current = value;
    setHsv(next);
    setDraft(value);
    setHexInput(value.toUpperCase());
  }, [value]);

  const applyHsv = useCallback((next: HsvColor) => {
    hsvRef.current = next;
    const color = hsvToHex(next.h, next.s, next.v);
    draftRef.current = color;
    setHsv(next);
    setDraft(color);
    setHexInput(color.toUpperCase());
  }, []);

  const commitDraft = useCallback(() => {
    if (draftRef.current.toLowerCase() !== value.toLowerCase()) {
      onChange(draftRef.current);
    }
  }, [onChange, value]);

  const handleSvTouch = (event: GestureResponderEvent) => {
    if (svSize.width <= 0 || svSize.height <= 0) return;
    const x = clamp(event.nativeEvent.locationX / svSize.width, 0, 1);
    const y = clamp(event.nativeEvent.locationY / svSize.height, 0, 1);
    applyHsv({ ...hsvRef.current, s: x, v: 1 - y });
  };

  const handleHueTouch = (event: GestureResponderEvent) => {
    if (hueWidth <= 0) return;
    const x = clamp(event.nativeEvent.locationX / hueWidth, 0, 1);
    applyHsv({ ...hsvRef.current, h: x * 360 });
  };

  const commitHex = useCallback(() => {
    const parsed = parseAccentColorInput(hexInput);
    if (parsed) onChange(parsed);
  }, [hexInput, onChange]);

  const handleHexChange = (text: string) => {
    setHexInput(text);
    const parsed = parseAccentColorInput(text);
    if (!parsed) return;
    applyHsv(hexToHsv(parsed));
  };

  const handleSvLayout = (event: LayoutChangeEvent) => {
    setSvSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const handleHueLayout = (event: LayoutChangeEvent) => {
    setHueWidth(event.nativeEvent.layout.width);
  };

  const hexValid = parseAccentColorInput(hexInput) !== null;

  return (
    <View style={styles.root}>
      <Touchable
        onPress={() => setExpanded((current) => !current)}
        activeScale={0.99}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "收起调色盘" : "打开调色盘"}
        style={[styles.entry, { backgroundColor: palette.surfaceMuted }]}
      >
        <View style={[styles.entryIcon, { backgroundColor: palette.surface }]}>
          <Palette size={18} color={palette.primaryInk} />
        </View>
        <View style={styles.entryCopy}>
          <Text style={[styles.entryTitle, { color: palette.text }]}>调色盘</Text>
          <Text style={[styles.entrySubtitle, { color: palette.textMuted }]} numberOfLines={1}>
            拖动色相与明度，或输入 Hex
          </Text>
        </View>
        <View style={[styles.entrySwatch, { backgroundColor: draft, borderColor: palette.border }]} />
        <Text style={[styles.entryHex, { color: palette.textMuted }]}>{draft.toUpperCase()}</Text>
        {expanded
          ? <ChevronUp size={18} color={palette.textSubtle} />
          : <ChevronDown size={18} color={palette.textSubtle} />}
      </Touchable>

      {expanded ? (
        <View style={[styles.panel, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <View
            style={[styles.svArea, { borderColor: palette.border }]}
            onLayout={handleSvLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleSvTouch}
            onResponderMove={handleSvTouch}
            onResponderRelease={commitDraft}
            onResponderTerminate={commitDraft}
            onResponderTerminationRequest={() => false}
            accessibilityLabel="饱和度与明度选择区"
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: hsvToHex(hsv.h, 1, 1) }]} />
            <LinearGradient
              colors={["#ffffff", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["rgba(0,0,0,0)", "#000000"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                styles.svThumb,
                {
                  left: 9 + hsv.s * Math.max(0, svSize.width - 18),
                  top: 9 + (1 - hsv.v) * Math.max(0, svSize.height - 18),
                  borderColor: hsv.v > 0.55 ? "#111111" : "#ffffff",
                },
              ]}
            />
          </View>

          <View
            style={styles.hueArea}
            onLayout={handleHueLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleHueTouch}
            onResponderMove={handleHueTouch}
            onResponderRelease={commitDraft}
            onResponderTerminate={commitDraft}
            onResponderTerminationRequest={() => false}
            accessibilityLabel="色相选择条"
          >
            <LinearGradient
              colors={[...HUE_COLORS]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.hueTrack}
            />
            <View
              style={[
                styles.hueThumb,
                { left: (hsv.h / 360) * hueWidth - 3 },
              ]}
            />
          </View>

          <View style={styles.previewRow}>
            <View style={[styles.previewSwatch, { backgroundColor: draft, borderColor: palette.border }]} />
            <View style={styles.previewCopy}>
              <Text style={[styles.previewLabel, { color: palette.text }]}>当前选择</Text>
              <Text style={[styles.previewHint, { color: palette.textMuted }]}>拖动松手生效 · Hex 回车生效</Text>
            </View>
            <TextInput
              style={[
                styles.hexInput,
                {
                  color: palette.text,
                  backgroundColor: palette.surface,
                  borderColor: hexValid ? palette.border : palette.danger,
                },
              ]}
              value={hexInput}
              onChangeText={handleHexChange}
              onSubmitEditing={commitHex}
              onEndEditing={commitHex}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              placeholder="#0D7A42"
              placeholderTextColor={palette.textSubtle}
              accessibilityLabel="自定义主题色 Hex 值"
            />
          </View>
          {!hexValid ? (
            <Text style={[styles.errorText, { color: palette.danger }]}>请输入 6 位 Hex 颜色</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.s,
  },
  entry: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    borderRadius: radius.md,
  },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  entryCopy: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  entrySubtitle: {
    marginTop: 2,
    fontSize: typography.micro,
  },
  entrySwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },
  entryHex: {
    fontSize: 10,
    fontFamily: "monospace",
    letterSpacing: 0.2,
  },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.s,
    gap: spacing.s,
  },
  svArea: {
    height: 150,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  svThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    backgroundColor: "transparent",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  hueArea: {
    height: 40,
    justifyContent: "center",
    position: "relative",
  },
  hueTrack: {
    height: 14,
    borderRadius: 7,
  },
  hueThumb: {
    position: "absolute",
    top: 8,
    width: 6,
    height: 24,
    borderRadius: 3,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.25)",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  previewSwatch: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
  },
  previewCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewLabel: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  previewHint: {
    marginTop: 2,
    fontSize: typography.micro,
  },
  hexInput: {
    width: 104,
    height: 40,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: 13,
    fontFamily: "monospace",
    textAlign: "center",
  },
  errorText: {
    fontSize: typography.micro,
    fontWeight: "500",
  },
});
