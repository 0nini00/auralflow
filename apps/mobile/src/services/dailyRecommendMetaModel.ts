export interface DailyRecommendMeta {
  title: string;
  subtitle: string;
}

const DAILY_RECOMMEND_UPDATE_TIME = "每日 6:00 更新";
const DAILY_RECOMMEND_EMPTY_DATE = "今日";

function formatLocalDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) return DAILY_RECOMMEND_EMPTY_DATE;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDailyRecommendMeta(date = new Date()): DailyRecommendMeta {
  const dateText = formatLocalDate(date);

  return {
    title: "每日歌曲推荐",
    subtitle: `根据你的口味，${DAILY_RECOMMEND_UPDATE_TIME} · ${dateText}`,
  };
}
