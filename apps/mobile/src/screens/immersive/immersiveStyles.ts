import { StyleSheet } from "react-native";
import { radius, touch, typography } from "@/theme/tokens";

export const styles = StyleSheet.create({

  coverPageContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // 对齐 lx Pic：底部留白给迷你歌词，封面视觉重心略微上移
    paddingBottom: 24,
  },

  root: {

    flex: 1,

  },

  coverFrame: {

    borderRadius: radius.sm,

    overflow: "hidden",

    // 轻微投影，贴近桌面 cover shadow

    elevation: 10,

    shadowColor: "#000000",

    shadowOpacity: 0.35,

    shadowRadius: 24,

    shadowOffset: { width: 0, height: 12 },

  },

  coverImage: {

    width: "100%",

    height: "100%",

  },

  coverPlaceholder: {

    justifyContent: "center",

    alignItems: "center",

  },

  topBar: {

    position: "absolute",

    top: 0,

    left: 0,

    right: 0,

    flexDirection: "row",

    alignItems: "center",

    paddingHorizontal: 16,

    paddingBottom: 12,

    zIndex: 10,

  },

  closeButton: {

    width: touch.minTarget,

    height: touch.minTarget,

    justifyContent: "center",

    alignItems: "center",

  },

  topInfo: {

    flex: 1,

    alignItems: "flex-start",

    paddingHorizontal: 8,

  },

  songName: {

    fontSize: typography.title,

    fontWeight: "700",

  },

  artistName: {

    fontSize: typography.caption,

    marginTop: 2,

  },

  topRightIconButton: {

    width: 40,

    height: 40,

    justifyContent: "center",

    alignItems: "center",

  },

  pagerView: {
    flex: 1,
  },
  pagerPage: {
    flex: 1,
  },
  pagerLyricList: {
    flex: 1,
  },

  // 对齐 lx 竖屏 Player：底部播放区（文档流三段式：PlayInfo / ControlBtn / MoreBtn）
  playerArea: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  playInfoWrap: {
    marginBottom: 4,
  },

  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },

  timeText: {
    fontSize: typography.caption,
  },

  mainControls: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingVertical: 14,
  },

  modeControlButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },

  controlButton: {
    width: 56,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },

  playButton: {
    width: 64,
    height: 64,
    justifyContent: "center",
    alignItems: "center",
  },

  moreBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    gap: 8,
    marginTop: 2,
  },
  rateModalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 24,
  },
  rateModalContent: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 18,
  },
  rateModalTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 14,
  },
  rateOptionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  rateOption: {
    minWidth: 74,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  rateOptionText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  rateModalCloseButton: {
    minHeight: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rateModalCloseText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  volumeModalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 24,
  },
  volumeModalContent: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 18,
  },
  volumeModalTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  volumeModalMeta: {
    fontSize: typography.meta,
    textAlign: "center",
    marginBottom: 14,
  },
  volumeOptionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  volumeOption: {
    minWidth: 74,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  volumeOptionText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  volumeMuteButton: {
    minHeight: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  volumeMuteText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  volumeCloseButton: {
    minHeight: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  volumeCloseText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  // 海报模式已随桌面端风格移除（对齐 lx 竖屏播放器）
  soundEffectModalContent: {

    maxHeight: "80%",

    paddingBottom: 12,

  },

  soundEffectScroll: {

    maxHeight: 480,

  },

  soundEffectScrollContent: {

    paddingBottom: 24,

  },

  sleepSectionTitle: {

    fontSize: typography.caption,

    fontWeight: "600",

    marginTop: 8,

    marginBottom: 8,

  },

  sleepOptionGrid: {

    flexDirection: "row",

    flexWrap: "wrap",

    gap: 8,

    marginBottom: 8,

  },

  sleepOption: {

    minWidth: "30%",

    flexGrow: 1,

    paddingVertical: 12,

    paddingHorizontal: 10,

    borderRadius: radius.md,

    alignItems: "center",

  },

  sleepOptionText: {

    fontSize: typography.body,

    fontWeight: "600",

  },

  sleepCustomRow: {

    flexDirection: "row",

    alignItems: "center",

    gap: 8,

    marginBottom: 12,

  },

  sleepCustomInput: {

    flex: 1,

    borderWidth: 1,

    borderRadius: radius.md,

    paddingHorizontal: 12,

    paddingVertical: 10,

    fontSize: typography.body,

  },

  sleepCustomStart: {

    paddingVertical: 10,

    paddingHorizontal: 14,

    borderRadius: radius.md,

  },

  sleepCustomStartText: {

    fontSize: typography.body,

    fontWeight: "700",

  },



});
