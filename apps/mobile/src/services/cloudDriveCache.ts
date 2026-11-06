import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeCloudDriveSongs, normalizeCloudDriveSnapshot, type CloudDriveSnapshot } from "@lx/core";
export { normalizeCloudDriveSongs, type CloudDriveSnapshot } from "@lx/core";

/**
 * 云盘列表的落盘缓存（移动端）。
 *
 * 与桌面端 `services/cloudDriveCache` 同一条规则，只是落点换成 AsyncStorage：按 uid 一条
 * 记录、10 分钟保鲜期、退出登录就删。它解决的是「App 重开必然重新拉一遍」——内存里的
 * store 一关就没了，而云盘首页的等待感主要来自这一次请求。
 *
 * 三个必须守住的点：
 * 1. **按 uid 分区**：键里带 uid，读出来还要再校验一次，A 的列表不能出现在 B 的界面上。
 * 2. **过期不等于没用**：过期时调用方先显示旧列表再后台刷新（见 stores/cloudDriveStore）。
 * 3. **退出登录就删**：账号私有内容不该以缓存的形式长期留在设备上。
 */

const KEY_PREFIX = "auralflow.mobile.cloudDrive.v1:";
/** 保鲜期：10 分钟内直接信任缓存，不发起请求。 */
export const CLOUD_DRIVE_CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

/**
 * 读取某个账号的缓存。`fresh` 为 true 表示还在保鲜期内，调用方可以直接用、不必发请求。
 * 任何读取/解析失败都等同于「没有缓存」——它只是加速层，不能影响云盘能否打开。
 */
export async function loadCloudDriveSnapshot(
  uid: string,
): Promise<{ snapshot: CloudDriveSnapshot; fresh: boolean } | null> {
  if (!uid) return null;
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(cacheKey(uid));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const snapshot = normalizeCloudDriveSnapshot(parsed);
  if (!snapshot) return null;
  return { snapshot, fresh: Date.now() - snapshot.cachedAt < CLOUD_DRIVE_CACHE_TTL_MS };
}

export async function saveCloudDriveSnapshot(
  uid: string,
  snapshot: Omit<CloudDriveSnapshot, "cachedAt">,
): Promise<void> {
  if (!uid) return;
  const songs = normalizeCloudDriveSongs(snapshot.songs);
  // 空列表不值得落盘：省不下什么，还会把「当时确实为空」固化成缓存。
  if (songs.length === 0) return;
  try {
    await AsyncStorage.setItem(cacheKey(uid), JSON.stringify({ ...snapshot, songs, cachedAt: Date.now() }));
  } catch {
    // 写盘失败只是下次要重新拉，不能让它冒泡到 UI。
  }
}

/** 退出登录时清掉这个账号的缓存。 */
export async function clearCloudDriveSnapshot(uid: string): Promise<void> {
  if (!uid) return;
  try {
    await AsyncStorage.removeItem(cacheKey(uid));
  } catch {
    // 删不掉也只能算了：下次登录会覆盖同键。
  }
}
