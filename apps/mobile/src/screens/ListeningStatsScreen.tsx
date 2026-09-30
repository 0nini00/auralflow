import React, { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ChartColumnBig, ChevronLeft, TrendingUp } from "lucide-react-native";
import {
  aggregateListeningStats,
  type ListeningStatsArtist,
  type ListeningStatsDay,
  type ListeningStatsTrack,
} from "@lx/core";

import { IconButton } from "@/components/IconButton";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { SectionHeader } from "@/components/SectionHeader";
import { useHistoryStore } from "@/stores/historyStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

/**
 * 听歌统计。
 *
 * 聚合在 `@lx/core` 的 `aggregateListeningStats`（纯函数、被单测钉住），这里只做展示：
 * 数字卡片 + Top 歌曲 / Top 歌手 / 按天趋势，全部是纯 RN 视图条形，不引入图表库。
 *
 * 诚实边界：统计只覆盖**本地保存的播放历史**（上限 2000 条、滚动 31 天，
 * 见 `stores/historyStore.ts` 的 MAX_HISTORY_ITEMS / MAX_HISTORY_AGE_MS），
 * 所以页面上必须写明"不是全部时间"——不要删掉这句。
 */
export const HISTORY_SCOPE_NOTE = "统计基于本地历史（上限 2000 条、滚动 31 天），不代表全部时间的听歌数据。";

/** Top 榜单显示条数（core 返回完整排名，截断是展示决策） */
const TOP_LIST_SIZE = 10;
/** 按天趋势的窗口：只展示最近 30 天内有记录的日子 */
const TREND_DAY_LIMIT = 30;
/** 趋势柱高度（纯 RN 视图，用像素高而不是百分比，避免小数宽度告警） */
const TREND_BAR_MAX_HEIGHT = 88;

/** 毫秒 → 人话时长（小于 1 分钟也显示分钟，避免出现 0 秒这种无意义读数） */
function formatTotalDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 分钟";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

/** `2026-07-03` → `7月3日`（解析失败时原样返回，不猜） */
function formatDayLabel(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  const month = Number(parts[1]);
  const date = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(date)) return day;
  return `${month}月${date}日`;
}

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  wide?: boolean;
}

function StatCard({ label, value, hint, wide = false }: StatCardProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View
      accessibilityLabel={`${label} ${value}，${hint}`}
      style={[
        styles.statCard,
        wide && styles.statCardWide,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.statValue, { color: palette.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.statHint, { color: palette.textMuted }]}>{hint}</Text>
    </View>
  );
}

/** 榜单一行：名次 + 标题 + 数值 + 条形（条形长度 = 相对榜首的比例） */
function RankRow({
  rank,
  title,
  meta,
  ratio,
}: {
  rank: number;
  title: string;
  meta: string;
  ratio: number;
}) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  // flex 比例条：fill = ratio、剩余 = 1 - ratio（不用百分比字符串，避免小数宽度告警）
  const fill = Math.min(1, Math.max(0.04, ratio));

  return (
    <View accessibilityLabel={`第 ${rank} 名 ${title}，${meta}`} style={styles.rankRow}>
      <Text style={[styles.rankIndex, { color: palette.textSubtle }]}>{rank}</Text>
      <View style={styles.rankBody}>
        <View style={styles.rankHead}>
          <Text numberOfLines={1} style={[styles.rankTitle, { color: palette.text }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.rankMeta, { color: palette.textMuted }]}>
            {meta}
          </Text>
        </View>
        <View style={[styles.barTrack, { backgroundColor: palette.surfaceMuted }]}>
          <View style={[styles.barFill, { backgroundColor: palette.primary, flex: fill }]} />
          <View style={{ flex: 1 - fill }} />
        </View>
      </View>
    </View>
  );
}

function trackMeta(track: ListeningStatsTrack): string {
  const duration = track.totalMs > 0 ? ` · ${formatTotalDuration(track.totalMs)}` : "";
  return `${track.plays} 次${duration}`;
}

function artistMeta(artist: ListeningStatsArtist): string {
  const duration = artist.totalMs > 0 ? ` · ${formatTotalDuration(artist.totalMs)}` : "";
  return `${artist.plays} 次${duration}`;
}

export function ListeningStatsScreen({ onBack }: { onBack?: () => void }) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );
  const entries = useHistoryStore((state) => state.entries);
  const statsEntries = useHistoryStore((state) => state.statsEntries);
  const loadHistory = useHistoryStore((state) => state.loadHistory);
  // 统计入参用 store 的派生数组而不是裸 entries：合成占位时间的条目已被按「时间未知」处理
  // （不带 playedAt），只进总数/总时长/榜单，不进按天趋势——否则趋势图会拿假时间撒谎。
  const stats = useMemo(() => aggregateListeningStats(statsEntries), [statsEntries]);

  // 与 CacheSettings 同口径：进页面主动拉一次本地历史，启动期加载失败时这里还能救回来
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const topTracks = stats.topTracks.slice(0, TOP_LIST_SIZE);
  const topArtists = stats.topArtists.slice(0, TOP_LIST_SIZE);
  const trendDays: ListeningStatsDay[] = stats.byDay.slice(-TREND_DAY_LIMIT);
  const maxDayPlays = trendDays.reduce((max, day) => Math.max(max, day.plays), 0);
  const busiestDay = trendDays.reduce<ListeningStatsDay | null>(
    (best, day) => (best === null || day.plays > best.plays ? day : best),
    null,
  );
  const maxTrackPlays = topTracks.reduce((max, track) => Math.max(max, track.plays), 0);
  const maxArtistPlays = topArtists.reduce((max, artist) => Math.max(max, artist.plays), 0);
  const hasPlays = stats.totalPlays > 0;

  return (
    <ScreenScaffold>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        {onBack ? (
          <IconButton
            render={({ size, color }) => <ChevronLeft size={size} color={color} />}
            onPress={onBack}
            accessibilityLabel="返回"
          />
        ) : null}
        <Text style={[styles.headerTitle, { color: palette.text }]}>听歌统计</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="summary" style={[styles.scopeNote, { color: palette.textMuted }]}>
          {HISTORY_SCOPE_NOTE}
          {`当前本地历史 ${entries.length} 条。`}
        </Text>

        {!hasPlays ? (
          <EmptyState
            icon={ChartColumnBig}
            title="还没有听歌记录"
            description="播放过的歌曲会记进本地历史，统计随之生成；历史为空时这里不会显示任何数字。"
          />
        ) : (
          <>
            <View style={styles.statGrid}>
              <StatCard label="总时长" value={formatTotalDuration(stats.totalMs)} hint="按歌曲时长累加" />
              <StatCard label="播放次数" value={`${stats.totalPlays}`} hint="历史条目数（一条 = 一次）" />
              <StatCard
                wide
                label="时长未知的次数"
                value={`${stats.playsWithoutDuration}`}
                hint={
                  stats.playsWithoutDuration > 0
                    ? "这些记录没有歌曲时长信息，未计入总时长"
                    : "全部记录都带歌曲时长"
                }
              />
            </View>

            <View style={styles.section}>
              <SectionHeader title="Top 歌曲" description={`按播放次数排序，最多列出前 ${TOP_LIST_SIZE} 首`} />
              {topTracks.length > 0 ? (
                <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  {topTracks.map((track, index) => (
                    <RankRow
                      key={track.key}
                      rank={index + 1}
                      title={track.song.name || "未知歌曲"}
                      meta={trackMeta(track)}
                      ratio={maxTrackPlays > 0 ? track.plays / maxTrackPlays : 0}
                    />
                  ))}
                </View>
              ) : (
                <Text style={[styles.sectionEmpty, { color: palette.textMuted }]}>
                  历史条目缺少歌曲标识，无法排出歌曲榜
                </Text>
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Top 歌手" description={`按播放次数排序，最多列出前 ${TOP_LIST_SIZE} 位`} />
              {topArtists.length > 0 ? (
                <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  {topArtists.map((artist, index) => (
                    <RankRow
                      key={artist.name}
                      rank={index + 1}
                      title={artist.name}
                      meta={artistMeta(artist)}
                      ratio={maxArtistPlays > 0 ? artist.plays / maxArtistPlays : 0}
                    />
                  ))}
                </View>
              ) : (
                <Text style={[styles.sectionEmpty, { color: palette.textMuted }]}>
                  历史条目缺少歌手信息，无法排出歌手榜
                </Text>
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader
                title="按天趋势"
                description={`最近 ${TREND_DAY_LIMIT} 天内有记录的日子（按本地日历日切分）`}
              />
              {trendDays.length > 0 && busiestDay ? (
                <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View
                    accessibilityLabel={`按天趋势，${trendDays.length} 天有记录，单日最多 ${maxDayPlays} 次`}
                    style={styles.trendChart}
                  >
                    {trendDays.map((day) => (
                      <View
                        key={day.day}
                        accessibilityLabel={`${formatDayLabel(day.day)} 播放 ${day.plays} 次`}
                        style={styles.trendColumn}
                      >
                        <View
                          style={[
                            styles.trendBar,
                            {
                              backgroundColor: palette.primary,
                              height: Math.max(
                                2,
                                Math.round((maxDayPlays > 0 ? day.plays / maxDayPlays : 0) * TREND_BAR_MAX_HEIGHT),
                              ),
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.trendAxisLabel, { color: palette.textMuted }]}>
                      {formatDayLabel(trendDays[0].day)}
                    </Text>
                    <Text style={[styles.trendAxisLabel, { color: palette.textMuted }]}>
                      {formatDayLabel(trendDays[trendDays.length - 1].day)}
                    </Text>
                  </View>
                  <View style={styles.trendSummary}>
                    <TrendingUp size={14} color={palette.textMuted} />
                    <Text style={[styles.trendSummaryText, { color: palette.textMuted }]}>
                      有记录 {trendDays.length} 天 · 单日最多 {maxDayPlays} 次（{formatDayLabel(busiestDay.day)}）
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.sectionEmpty, { color: palette.textMuted }]}>
                  历史条目没有可用的播放时间，无法生成按天趋势
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  content: {
    gap: spacing.l,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.m,
    paddingBottom: spacing.xl,
  },
  scopeNote: {
    fontSize: typography.meta,
    lineHeight: 19,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    gap: spacing.xxs,
  },
  statCardWide: {
    flexBasis: "100%",
  },
  statValue: {
    fontSize: typography.display,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  statHint: {
    fontSize: typography.caption,
    lineHeight: 17,
  },
  section: {
    gap: spacing.xs,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.s,
    gap: spacing.s,
  },
  sectionEmpty: {
    fontSize: typography.meta,
    lineHeight: 19,
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    minHeight: spacing.xl,
  },
  rankIndex: {
    width: 20,
    fontSize: typography.meta,
    fontWeight: "700",
    textAlign: "center",
  },
  rankBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  rankHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  rankTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.body,
    fontWeight: "600",
  },
  rankMeta: {
    fontSize: typography.caption,
  },
  barTrack: {
    flexDirection: "row",
    height: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  barFill: {
    borderRadius: radius.pill,
  },
  trendChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    minHeight: TREND_BAR_MAX_HEIGHT,
  },
  trendColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: "flex-end",
  },
  trendBar: {
    width: "100%",
    borderRadius: 3,
  },
  trendAxis: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trendAxisLabel: {
    fontSize: typography.caption,
  },
  trendSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  trendSummaryText: {
    flexShrink: 1,
    fontSize: typography.caption,
    lineHeight: 18,
  },
});
