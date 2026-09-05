import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import type { ThemePalette } from "@/stores/themeStore";
import type { MusicInfo } from "@lx/core";
import { QueueModal } from "@/components/QueueModal";
import { styles } from "./immersiveStyles";

export interface ImmersiveModalsProps {
  customMinutes: string | number;
  customSongCount: string | number;
  handleCancelSleepTimer: (...args: any[]) => void;
  handleClearQueue: (...args: any[]) => void;
  handlePlayQueueItem: (...args: any[]) => void;
  handleRemoveQueueItem: (...args: any[]) => void;
  handleSetPlaybackRate: (...args: any[]) => void;
  handleSetVolume: (...args: any[]) => void;
  handleStartCustomSleepTimer: (...args: any[]) => void;
  handleStartCustomSongSleepTimer: (...args: any[]) => void;
  handleStartSleepTimer: (...args: any[]) => void;
  handleStartSongSleepTimer: (...args: any[]) => void;
  handleToggleMute: (...args: any[]) => void;
  management: any;
  palette: ThemePalette;
  queueModalVisible: boolean;
  queueModel: any;
  queue: MusicInfo[];
  rateModalVisible: boolean;
  rateModel: any;
  setCustomMinutes: (...args: any[]) => void;
  setCustomSongCount: (...args: any[]) => void;
  setQueueModalVisible: (...args: any[]) => void;
  setRateModalVisible: (...args: any[]) => void;
  setSleepModalVisible: (...args: any[]) => void;
  setVolumeModalVisible: (...args: any[]) => void;
  sleepModalVisible: boolean;
  sleepTimerActive: boolean;
  sleepTimerControl: any;
  sleepTimerMinutes: string | number;
  sleepTimerSongActive: boolean;
  sleepTimerSongCount: string | number;
  volumeModalVisible: boolean;
  volumeModel: any;
  /** 队列菜单内发起路由跳转前回调（播放页场景传 onClose，先关闭覆盖导航栈的 Modal） */
  onQueueNavigate?: () => void;
}

/** 自定义定时输入是否为有效的正数（"0"/非数字/空串均无效，禁用开始按钮） */
function isPositiveNumericInput(value: string | number): boolean {
  if (value === "" || value == null) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function ImmersiveModals({
  customMinutes, customSongCount, handleCancelSleepTimer, handleClearQueue, handlePlayQueueItem, handleRemoveQueueItem, handleSetPlaybackRate, handleSetVolume, handleStartCustomSleepTimer, handleStartCustomSongSleepTimer, handleStartSleepTimer, handleStartSongSleepTimer, handleToggleMute, management, palette, queueModalVisible, queueModel, rateModalVisible, rateModel, setCustomMinutes, setCustomSongCount, setQueueModalVisible, setRateModalVisible, setSleepModalVisible, setVolumeModalVisible, sleepModalVisible, sleepTimerActive, sleepTimerControl, sleepTimerMinutes, sleepTimerSongActive, sleepTimerSongCount, volumeModalVisible, volumeModel, queue, onQueueNavigate
}: ImmersiveModalsProps) {
  const customSongCountValid = isPositiveNumericInput(customSongCount);
  const customMinutesValid = isPositiveNumericInput(customMinutes);
  return (
    <>
<Modal
  visible={rateModalVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setRateModalVisible(false)}
>
  <View style={styles.rateModalOverlay}>
    <View style={[styles.rateModalContent, { backgroundColor: palette.background, borderColor: palette.border }]}> 
      <Text style={[styles.rateModalTitle, { color: palette.text }]}>{rateModel.title}</Text>
      <View style={styles.rateOptionGrid}>
        {rateModel.options.map((option: any) => (
          <Pressable
            key={option.value}
            style={[
              styles.rateOption,
              { backgroundColor: palette.surface, borderColor: palette.border },
              option.active && { borderColor: palette.primary },
            ]}
            onPress={() => void handleSetPlaybackRate(option.value)}
          >
            <Text style={[styles.rateOptionText, { color: option.active ? palette.primary : palette.text }]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        style={[styles.rateModalCloseButton, { backgroundColor: palette.surface }]}
        onPress={() => setRateModalVisible(false)}
      >
        <Text style={[styles.rateModalCloseText, { color: palette.textMuted }]}>{rateModel.closeLabel}</Text>
      </Pressable>
    </View>
  </View>
</Modal>

<Modal
  visible={volumeModalVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setVolumeModalVisible(false)}
>
  <View style={styles.volumeModalOverlay}>
    <View style={[styles.volumeModalContent, { backgroundColor: palette.background, borderColor: palette.border }]}> 
      <Text style={[styles.volumeModalTitle, { color: palette.text }]}>{volumeModel.title}</Text>
      <Text style={[styles.volumeModalMeta, { color: palette.textMuted }]}>{volumeModel.meta}</Text>
      <View style={styles.volumeOptionGrid}>
        {volumeModel.options.map((option: any) => (
          <Pressable
            key={option.value}
            style={[
              styles.volumeOption,
              { backgroundColor: palette.surface, borderColor: palette.border },
              option.active && { borderColor: palette.primary },
            ]}
            onPress={() => void handleSetVolume(option.value)}
          >
            <Text style={[styles.volumeOptionText, { color: option.active ? palette.primary : palette.text }]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        style={[
          styles.volumeMuteButton,
          { backgroundColor: volumeModel.muted ? palette.primary : palette.surface },
        ]}
        onPress={() => void handleToggleMute()}
      >
        <Text
          style={[
            styles.volumeMuteText,
            { color: volumeModel.muted ? palette.primaryText : palette.text },
          ]}
        >
          {volumeModel.muteLabel}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.volumeCloseButton, { backgroundColor: palette.surface }]}
        onPress={() => setVolumeModalVisible(false)}
      >
        <Text style={[styles.volumeCloseText, { color: palette.textMuted }]}>{volumeModel.closeLabel}</Text>
      </Pressable>
    </View>
  </View>
</Modal>

{/* 睡眠定时弹窗（与播放页能力对齐） */}

<Modal

  visible={sleepModalVisible}

  transparent

  animationType="fade"

  onRequestClose={() => setSleepModalVisible(false)}

>

  <TouchableWithoutFeedback accessibilityRole="button" accessibilityLabel="关闭睡眠定时" onPress={() => setSleepModalVisible(false)}>

  <KeyboardAvoidingView

    style={styles.volumeModalOverlay}

    behavior={Platform.OS === "ios" ? "padding" : "height"}

  >

    <Pressable onPress={() => undefined} style={[styles.volumeModalContent, { backgroundColor: palette.background, borderColor: palette.border }]}>

      <Text style={[styles.volumeModalTitle, { color: palette.text }]}>睡眠定时</Text>

      {sleepTimerActive && sleepTimerMinutes != null ? (

        <Text style={[styles.volumeModalMeta, { color: palette.textMuted }]}>

          当前剩余 {sleepTimerMinutes} 分钟

        </Text>

      ) : sleepTimerSongActive ? (

        <Text style={[styles.volumeModalMeta, { color: palette.textMuted }]}>

          当前剩余 {sleepTimerSongCount} 首

        </Text>

      ) : (

        <Text style={[styles.volumeModalMeta, { color: palette.textMuted }]}>未开启</Text>

      )}



      <Text style={[styles.sleepSectionTitle, { color: palette.textMuted }]}>按时间停止</Text>

      <View style={styles.sleepOptionGrid}>

        {sleepTimerControl.minutePresets.map((minutes: any) => {

          const active = sleepTimerActive && sleepTimerMinutes === minutes;

          return (

            <Pressable

              key={minutes}

              onPress={() => handleStartSleepTimer(minutes)}

              style={[

                styles.sleepOption,

                { backgroundColor: active ? palette.primary : palette.surface },

              ]}

            >

              <Text

                style={[

                  styles.sleepOptionText,

                  { color: active ? palette.primaryText : palette.text },

                ]}

              >

                {minutes} 分钟

              </Text>

            </Pressable>

          );

        })}

      </View>



      <Text style={[styles.sleepSectionTitle, { color: palette.textMuted }]}>听完歌曲后停止</Text>

      <View style={styles.sleepOptionGrid}>

        {sleepTimerControl.songCountPresets.map((songCount: any) => {

          const active = sleepTimerSongActive && sleepTimerSongCount === songCount;

          return (

            <Pressable

              key={songCount}

              onPress={() => handleStartSongSleepTimer(songCount)}

              style={[

                styles.sleepOption,

                { backgroundColor: active ? palette.primary : palette.surface },

              ]}

            >

              <Text

                style={[

                  styles.sleepOptionText,

                  { color: active ? palette.primaryText : palette.text },

                ]}

              >

                {songCount} 首

              </Text>

            </Pressable>

          );

        })}

      </View>



      <View style={styles.sleepCustomRow}>

        <TextInput

          style={[

            styles.sleepCustomInput,

            {

              borderColor: palette.border,

              color: palette.text,

              backgroundColor: palette.surface,

            },

          ]}

          placeholder="自定义歌曲数"

          placeholderTextColor={palette.textMuted}

          keyboardType="numeric"

          value={String(customSongCount ?? "")}

          onChangeText={setCustomSongCount}

        />

        <Pressable

          style={[

            styles.sleepCustomStart,

            { backgroundColor: customSongCountValid ? palette.primary : palette.surface },

          ]}

          onPress={handleStartCustomSongSleepTimer}

          disabled={!customSongCountValid}

        >

          <Text

            style={[

              styles.sleepCustomStartText,

              { color: customSongCountValid ? palette.primaryText : palette.textMuted },

            ]}

          >

            开始

          </Text>

        </Pressable>

      </View>



      <Text style={[styles.sleepSectionTitle, { color: palette.textMuted }]}>自定义时间</Text>

      <View style={styles.sleepCustomRow}>

        <TextInput

          style={[

            styles.sleepCustomInput,

            {

              borderColor: palette.border,

              color: palette.text,

              backgroundColor: palette.surface,

            },

          ]}

          placeholder="自定义分钟数"

          placeholderTextColor={palette.textMuted}

          keyboardType="numeric"

          value={String(customMinutes ?? "")}

          onChangeText={setCustomMinutes}

        />

        <Pressable

          style={[

            styles.sleepCustomStart,

            { backgroundColor: customMinutesValid ? palette.primary : palette.surface },

          ]}

          onPress={handleStartCustomSleepTimer}

          disabled={!customMinutesValid}

        >

          <Text

            style={[

              styles.sleepCustomStartText,

              { color: customMinutesValid ? palette.primaryText : palette.textMuted },

            ]}

          >

            开始

          </Text>

        </Pressable>

      </View>



      <Pressable

        style={[

          styles.volumeCloseButton,

          {

            backgroundColor: palette.dangerSurface ?? palette.surface,

            marginBottom: 8,

            opacity: sleepTimerActive || sleepTimerSongActive ? 1 : 0.5,

          },

        ]}

        onPress={handleCancelSleepTimer}

        disabled={!sleepTimerActive && !sleepTimerSongActive}

      >

        <Text style={[styles.volumeCloseText, { color: palette.danger ?? palette.text }]}>

          关闭定时器

        </Text>

      </Pressable>



      <Pressable

        style={[styles.volumeCloseButton, { backgroundColor: palette.surface }]}

        onPress={() => setSleepModalVisible(false)}

      >

        <Text style={[styles.volumeCloseText, { color: palette.textMuted }]}>返回</Text>

      </Pressable>

    </Pressable>

  </KeyboardAvoidingView>

  </TouchableWithoutFeedback>

</Modal>



<QueueModal
  visible={queueModalVisible}
  queueModel={queueModel}
  queue={queue}
  palette={palette}
  onClose={() => setQueueModalVisible(false)}
  onPlayItem={(index) => void handlePlayQueueItem(index)}
  onRemoveItem={handleRemoveQueueItem}
  onClear={() => void handleClearQueue()}
  onRequestNavigate={onQueueNavigate}
  // 播放页内走应用内底部弹层（非 Modal）：队列与子弹窗不再构成嵌套 Modal，
  // 根除 Android 嵌套 Modal 白屏问题（此前需收起主面板规避）
  presentation="sheet"
/>
    </>
  );
}
