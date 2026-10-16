/**
 * 歌词选择孤儿表的持久化：AsyncStorage 一个键，外加一份进程内索引。
 *
 * 为什么单独一个键而不是塞进曲库记录：孤儿表按「内容指纹」索引，服务的对象是还没出现的记录；
 * 塞进曲库会让每次扫描都重写它，也会把「认回线索」和「曲库真相」混成一份数据。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  mergeLyricsChoiceOrphans,
  parseLyricsChoiceOrphans,
  type LocalLyricsChoiceOrphan,
} from "./localLyricsChoiceOrphanModel";

/** 跟随既有的 `auralflow.mobile.*` 命名；值是一条条按指纹索引的选择，不是完整记录。 */
export const LOCAL_LYRICS_CHOICE_ORPHANS_KEY = "auralflow.mobile.localLyricsChoiceOrphans";

/** 进程内索引：null 表示本会话还没读过盘。 */
let cached: LocalLyricsChoiceOrphan[] | null = null;

/**
 * 读改写串行化：登记与认领都是「读表 → 改 → 落盘」，并发执行会让后写覆盖先写。
 * 队列只用于自愈，调用方仍然收到原始结果（失败不被吞掉）。
 */
let tail: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 磁盘一个会话只读一次。
 *
 * 认领会在解析本地曲时被问到（每次播放都会经过），若每次都读一遍 AsyncStorage，等于给播放路径
 * 加一次存储往返；而本键只由本模块写入，内存索引与磁盘不会分叉。
 */
async function loadOrphans(): Promise<LocalLyricsChoiceOrphan[]> {
  if (cached) return cached;
  cached = parseLyricsChoiceOrphans(await AsyncStorage.getItem(LOCAL_LYRICS_CHOICE_ORPHANS_KEY));
  return cached;
}

async function persist(orphans: LocalLyricsChoiceOrphan[]): Promise<void> {
  if (orphans.length) await AsyncStorage.setItem(LOCAL_LYRICS_CHOICE_ORPHANS_KEY, JSON.stringify(orphans));
  else await AsyncStorage.removeItem(LOCAL_LYRICS_CHOICE_ORPHANS_KEY);
  // 只有落盘成功后才更新索引：失败时下次仍读到与磁盘一致的旧值。
  cached = orphans;
}

/**
 * 登记消失记录上的歌词选择。
 *
 * 空数组是绝大多数扫描的答案（没有带选择的记录消失），此时连磁盘都不读 —— 重新扫描是常态操作，
 * 不能让孤儿表给它加 I/O。
 */
export async function rememberLyricsChoiceOrphans(
  incoming: readonly LocalLyricsChoiceOrphan[],
): Promise<void> {
  if (!incoming.length) return;
  await serialize(async () => {
    await persist(mergeLyricsChoiceOrphans(await loadOrphans(), incoming));
  });
}

/**
 * 认领：指纹命中即取走并从表中删除（同一份内容只会认回一次，下次直接命中记录的字段）。
 * 没有命中返回 null。清空后删除存储键，不留「[]」这种垃圾。
 */
export async function claimLyricsChoiceOrphan(fingerprint: string): Promise<LocalLyricsChoiceOrphan | null> {
  const key = fingerprint.trim();
  if (!key) return null;
  return serialize(async () => {
    const orphans = await loadOrphans();
    const claimed = orphans.find((orphan) => orphan.fingerprint === key);
    if (!claimed) return null;
    await persist(orphans.filter((orphan) => orphan !== claimed));
    return claimed;
  });
}
