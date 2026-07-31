import { StyleSheet } from "react-native";
import { radius, touch, typography } from "@/theme/tokens";

export const styles = StyleSheet.create({

  coverPageContainer: {
    alignItems: "center",
    justifyContent: "center",
  },

  root: {

    flex: 1,

  },

  stage: {

    flex: 1,

    alignItems: "center",

    justifyContent: "center",

    paddingHorizontal: 20,

    gap: 20,

  },

  coverSection: {

    alignItems: "center",

    justifyContent: "center",

    gap: 8,

  },

  coverSectionTablet: {

    flexShrink: 0,

    paddingHorizontal: 12,

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

  coverHint: {

    fontSize: typography.caption,

    fontWeight: "600",

  },

  lyricSection: {

    flex: 1,

    width: "100%",

    minHeight: 220,

    justifyContent: "center",

  },

  lyricSectionTablet: {

    minWidth: 0,

    paddingLeft: 12,

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

    borderRadius: radius.xl,

    justifyContent: "center",

    alignItems: "center",

  },

  topInfo: {

    flex: 1,

    alignItems: "center",

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

  topRightButton: {

    minWidth: 40,

    height: 40,

    borderRadius: radius.xl,

    justifyContent: "center",

    alignItems: "center",

    paddingHorizontal: 6,

  },

  topRightButtonText: {

    fontSize: typography.meta,

    fontWeight: "700",

  },

  lyricList: {

    flex: 1,

  },

  centerToggle: {



    position: "absolute",



    top: 120,



    bottom: 200,



    left: 0,



    right: 0,



    zIndex: 5,



  },



  // 手机折叠态：承载 PosterMode 的可点按舞台，点一下展开/收起两行歌词

  phoneStage: {



    flex: 1,



    alignItems: "center",



    justifyContent: "center",



    paddingHorizontal: 20,



  },

  restoreControlsButton: {

    position: "absolute",

    right: 16,

    minHeight: 44,

    borderRadius: 22,

    borderWidth: 1,

    alignItems: "center",

    justifyContent: "center",

    paddingHorizontal: 16,

    zIndex: 12,

  },

  restoreControlsText: {

    fontSize: typography.meta,

    fontWeight: "700",

  },

  bottomBar: {

    position: "absolute",

    left: 0,

    right: 0,

    bottom: 0,

    paddingHorizontal: 20,

    paddingTop: 16,

    backgroundColor: "rgba(0,0,0,0.0)",

    zIndex: 10,

  },

  progressWrap: {

    marginBottom: 8,

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

    justifyContent: "space-between",

    marginVertical: 12,

  },

  modeControlButton: {

    width: 48,

    height: 48,

    borderRadius: 24,

    justifyContent: "center",

    alignItems: "center",

  },

  controlButton: {

    width: 52,

    height: 52,

    borderRadius: 26,

    justifyContent: "center",

    alignItems: "center",

  },

  playButton: {

    width: 64,

    height: 64,

    borderRadius: 32,

    justifyContent: "center",

    alignItems: "center",

  },

  auxRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    rowGap: 8,
    marginTop: 4,
  },
  auxButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
  },
  auxIconButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  auxButtonDisabled: {
    opacity: 0.6,
  },
  auxText: {
    fontSize: typography.meta,
    fontWeight: "600",
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
  queueModalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 24,
  },
  queueModalContent: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "78%",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 18,
  },
  queueModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  queueModalTitleWrap: {
    flex: 1,
  },
  queueModalTitle: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  queueModalMeta: {
    fontSize: typography.caption,
    marginTop: 4,
  },
  queueModalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  queueClearButton: {
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  queueClearButtonDisabled: {
    opacity: 0.5,
  },
  queueClearText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  queueCloseButton: {
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  queueCloseText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  queueList: {
    maxHeight: 420,
  },
  queueListContent: {
    gap: 8,
  },
  queueItem: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
  },
  queueItemIndex: {
    width: 28,
    fontSize: typography.meta,
    fontWeight: "700",
    textAlign: "center",
  },
  queueItemInfo: {
    flex: 1,
    gap: 4,
  },
  queueItemTitle: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  queueItemSubtitle: {
    fontSize: typography.caption,
  },
  queuePlayingText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  queueRemoveButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  queueRemoveText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  // 海报模式
  posterRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 200,
  },
  posterArtWrap: {
    borderRadius: radius.xl,
    overflow: "hidden",
    marginBottom: 24,
  },
  posterArt: {
    width: "100%",
    height: "100%",
    borderRadius: radius.xl,
  },
  posterArtPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  posterInfo: {
    alignItems: "center",
    marginBottom: 24,
  },
  posterSongName: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  posterArtist: {
    fontSize: typography.body,
    marginTop: 4,
  },
  posterLyricWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    minHeight: 60,
    justifyContent: "center",
  },
  posterLyric: {
    fontSize: typography.title,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 24,
  },
  posterTranslation: {
    fontSize: typography.meta,
    marginTop: 4,
    textAlign: "center",
  },
  posterKaraoke: {
    alignSelf: "stretch",
  },
  posterWaveArea: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 24,
    minHeight: touch.minTarget,
    justifyContent: "center",
  },
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
