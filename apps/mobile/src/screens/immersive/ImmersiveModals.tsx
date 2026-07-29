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
  View,
} from "react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { SoundEffectPanel } from "@/components/SoundEffectPanel";
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
  rateModalVisible: boolean;
  rateModel: any;
  setCustomMinutes: (...args: any[]) => void;
  setCustomSongCount: (...args: any[]) => void;
  setQueueModalVisible: (...args: any[]) => void;
  setRateModalVisible: (...args: any[]) => void;
  setSleepModalVisible: (...args: any[]) => void;
  setSoundEffectModalVisible: (...args: any[]) => void;
  setVolumeModalVisible: (...args: any[]) => void;
  sleepModalVisible: boolean;
  sleepTimerActive: boolean;
  sleepTimerControl: any;
  sleepTimerMinutes: string | number;
  sleepTimerSongActive: boolean;
  sleepTimerSongCount: string | number;
  soundEffectModalVisible: boolean;
  volumeModalVisible: boolean;
  volumeModel: any;
}

export function ImmersiveModals({
  customMinutes, customSongCount, handleCancelSleepTimer, handleClearQueue, handlePlayQueueItem, handleRemoveQueueItem, handleSetPlaybackRate, handleSetVolume, handleStartCustomSleepTimer, handleStartCustomSongSleepTimer, handleStartSleepTimer, handleStartSongSleepTimer, handleToggleMute, management, palette, queueModalVisible, queueModel, rateModalVisible, rateModel, setCustomMinutes, setCustomSongCount, setQueueModalVisible, setRateModalVisible, setSleepModalVisible, setSoundEffectModalVisible, setVolumeModalVisible, sleepModalVisible, sleepTimerActive, sleepTimerControl, sleepTimerMinutes, sleepTimerSongActive, sleepTimerSongCount, soundEffectModalVisible, volumeModalVisible, volumeModel
}: ImmersiveModalsProps) {
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
              option.active && { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
            onPress={() => void handleSetPlaybackRate(option.value)}
          >
            <Text style={[styles.rateOptionText, { color: option.active ? palette.primaryText : palette.text }]}>
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
              option.active && { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
            onPress={() => void handleSetVolume(option.value)}
          >
            <Text style={[styles.volumeOptionText, { color: option.active ? palette.primaryText : palette.text }]}>
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

{/* 音效弹窗 */}

<Modal

  visible={soundEffectModalVisible}

  transparent

  animationType="slide"

  onRequestClose={() => setSoundEffectModalVisible(false)}

>

  <View style={styles.volumeModalOverlay}>

    <View style={[styles.volumeModalContent, styles.soundEffectModalContent]}>

      <Text style={[styles.volumeModalTitle, { color: palette.text }]}>音效</Text>

      <ScrollView

        style={styles.soundEffectScroll}

        contentContainerStyle={styles.soundEffectScrollContent}

        showsVerticalScrollIndicator={false}

      >

        <SoundEffectPanel />

      </ScrollView>

      <Pressable

        style={[styles.volumeCloseButton, { backgroundColor: palette.surface }]}

        onPress={() => setSoundEffectModalVisible(false)}

      >

        <Text style={[styles.volumeCloseText, { color: palette.textMuted }]}>关闭</Text>

      </Pressable>

    </View>

  </View>

</Modal>



{/* 睡眠定时器弹窗（与播放页能力对齐） */}

<Modal

  visible={sleepModalVisible}

  transparent

  animationType="fade"

  onRequestClose={() => setSleepModalVisible(false)}

>

  <KeyboardAvoidingView

    style={styles.volumeModalOverlay}

    behavior={Platform.OS === "ios" ? "padding" : "height"}

  >

    <View style={[styles.volumeModalContent, { borderColor: palette.border }]}>

      <Text style={[styles.volumeModalTitle, { color: palette.text }]}>睡眠定时器</Text>

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

            { backgroundColor: customSongCount ? palette.primary : palette.surface },

          ]}

          onPress={handleStartCustomSongSleepTimer}

          disabled={!customSongCount}

        >

          <Text

            style={[

              styles.sleepCustomStartText,

              { color: customSongCount ? palette.primaryText : palette.textMuted },

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

            { backgroundColor: customMinutes ? palette.primary : palette.surface },

          ]}

          onPress={handleStartCustomSleepTimer}

          disabled={!customMinutes}

        >

          <Text

            style={[

              styles.sleepCustomStartText,

              { color: customMinutes ? palette.primaryText : palette.textMuted },

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

    </View>

  </KeyboardAvoidingView>

</Modal>



<Modal

  visible={queueModalVisible}

  transparent
  animationType="fade"
  onRequestClose={() => setQueueModalVisible(false)}
>
  <View style={styles.queueModalOverlay}>
    <View style={[styles.queueModalContent, { backgroundColor: palette.background, borderColor: palette.border }]}> 
      <View style={styles.queueModalHeader}>
        <View style={styles.queueModalTitleWrap}>
          <Text style={[styles.queueModalTitle, { color: palette.text }]}>{queueModel.title}</Text>
          <Text style={[styles.queueModalMeta, { color: palette.textMuted }]}>{queueModel.summary}</Text>
        </View>
        <View style={styles.queueModalActions}>
          <Pressable
            style={[
              styles.queueClearButton,
              { backgroundColor: palette.surface },
              !queueModel.management.canClearQueue && styles.queueClearButtonDisabled,
            ]}
            onPress={() => void handleClearQueue()}
            disabled={!queueModel.management.canClearQueue}
          >
            <Text style={[styles.queueClearText, { color: palette.danger }]}>{queueModel.management.clearLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.queueCloseButton, { backgroundColor: palette.surface }]}
            onPress={() => setQueueModalVisible(false)}
          >
            <Text style={[styles.queueCloseText, { color: palette.textMuted }]}>{queueModel.closeLabel}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView style={styles.queueList} contentContainerStyle={styles.queueListContent}>
        {queueModel.items.map((item: any) => {
          const management = queueModel.management.items[item.index];
          return (
            <Pressable
              key={item.key}
              style={[
                styles.queueItem,
                { backgroundColor: palette.surface, borderColor: palette.border },
                item.isCurrent && { borderColor: palette.primary },
              ]}
              onPress={() => void handlePlayQueueItem(item.index)}
            >
              <Text style={[styles.queueItemIndex, { color: item.isCurrent ? palette.primary : palette.textMuted }]}>
                {item.index + 1}
              </Text>
              <View style={styles.queueItemInfo}>
                <Text style={[styles.queueItemTitle, { color: item.isCurrent ? palette.primary : palette.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.queueItemSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              </View>
              {(() => {
                const row = management?.items?.[item.index];
                if (row?.statusLabel) {
                  return (
                    <Text style={[styles.queuePlayingText, { color: palette.primary }]}>{row.statusLabel}</Text>
                  );
                }
                if (row?.canRemove && row.removeLabel) {
                  return (
                    <Pressable
                      style={[styles.queueRemoveButton, { backgroundColor: palette.background }]}
                      onPress={(event) => {
                        event.stopPropagation();
                        handleRemoveQueueItem(item.index);
                      }}
                    >
                      <Text style={[styles.queueRemoveText, { color: palette.danger }]}>{row.removeLabel}</Text>
                    </Pressable>
                  );
                }
                return null;
              })()}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  </View>
</Modal>
    </>
  );
}
