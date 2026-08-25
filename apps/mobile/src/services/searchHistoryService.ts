import AsyncStorage from "@react-native-async-storage/async-storage";
import { updateSearchHistory } from "./searchHistoryModel";

const SEARCH_HISTORY_KEY = "auralflow.mobile.search.history";
const MAX_HISTORY_COUNT = 10;

/**
 * 获取搜索历史
 */
export async function getSearchHistory(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = data ? JSON.parse(data) : [];
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("搜索历史数据格式错误");
    }
    return parsed;
  } catch (error) {
    throw error instanceof Error ? error : new Error("读取搜索历史失败");
  }
}

/**
 * 添加搜索历史
 */
export async function addSearchHistory(keyword: string): Promise<void> {
  if (!keyword || keyword.trim().length === 0) {
    return;
  }

  try {
    const trimmed = keyword.trim();
    const history = await getSearchHistory();
    // 写前再次去重：读到的旧值可能已含同词（跨屏竞态/重复触发），避免重复入列
    const updated = updateSearchHistory(
      history.some((item) => item === trimmed) ? history : [...history, trimmed],
      trimmed,
      MAX_HISTORY_COUNT,
    );

    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("[搜索历史] 保存搜索历史失败", error);
  }
}

/**
 * 删除单条搜索历史
 */
export async function removeSearchHistory(keyword: string): Promise<void> {
  try {
    const history = await getSearchHistory();
    const target = keyword.trim().normalize("NFC");
    const updated = history.filter((item) => item !== target);
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("[搜索历史] 删除搜索历史失败", error);
  }
}

/**
 * 清空搜索历史
 */
export async function clearSearchHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch (error) {
    console.error("[搜索历史] 清空搜索历史失败", error);
  }
}
