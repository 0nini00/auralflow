import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 持久化 JSON 损坏自愈：把坏串备份到 `${key}.corrupt` 后移除原键。
 * 用于 likedSongs/localPlaylists 等无版本字段的结构——写入中断或磁盘损坏
 * 会让解析持续失败、数据表现为"永久消失"；备份至少保留人工恢复的可能。
 */
export async function healCorruptStorage(key: string, raw: string | null): Promise<boolean> {
  if (!raw) return false;
  try {
    await AsyncStorage.setItem(`${key}.corrupt`, raw);
    await AsyncStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`[storage] ${key} 损坏数据备份失败`, error);
    return false;
  }
}
