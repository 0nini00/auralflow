import AsyncStorage from "@react-native-async-storage/async-storage";

const SEARCH_HISTORY_KEY = "auralflow.mobile.search.history";
const MAX_HISTORY_COUNT = 10;

/**
 * 获取搜索历史
 */
export async function getSearchHistory(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Get search history error:", error);
    return [];
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
    const history = await getSearchHistory();
    
    // 移除重复项
    const filtered = history.filter((item) => item !== keyword);
    
    // 添加到最前面
    const updated = [keyword, ...filtered].slice(0, MAX_HISTORY_COUNT);
    
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Add search history error:", error);
  }
}

/**
 * 删除单条搜索历史
 */
export async function removeSearchHistory(keyword: string): Promise<void> {
  try {
    const history = await getSearchHistory();
    const updated = history.filter((item) => item !== keyword);
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Remove search history error:", error);
  }
}

/**
 * 清空搜索历史
 */
export async function clearSearchHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch (error) {
    console.error("Clear search history error:", error);
  }
}
