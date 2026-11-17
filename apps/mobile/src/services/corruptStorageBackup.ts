import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/services/logger";

const CORRUPT_BACKUP_SUFFIX = ".corrupt-backup";

/**
 * 配置读出来是坏的（键存在，但解析不了或形状不对）时的处置：落盘日志，并把原始字符串
 * 原样存到 `<key>.corrupt-backup`。调用方在这之后才允许退回默认值。
 *
 * 只给「抛错就没有出路」的配置用：主题在启动的阻塞加载里，抛错应用就停在启动失败页；
 * WebDAV 配置唯一的修复方式是用户在设置里重填，而重填必然覆盖原键。
 * 用户数据（收藏、播放历史、下载记录、首选版本）不走这里——它们读坏了直接抛错并拒绝写盘，
 * 做法见 favoritesStore。
 *
 * 退回默认值后的下一次保存会覆盖原键，所以备份写不进去时错误必须继续往外抛：
 * 没有备份就不允许继续。
 */
export async function backupCorruptStorageValue(storageKey: string, raw: string, error: unknown): Promise<void> {
  const backupKey = `${storageKey}${CORRUPT_BACKUP_SUFFIX}`;
  logger.error(`[存储] ${storageKey} 的内容已损坏，原始值备份到 ${backupKey}，本次按默认值继续`, error);
  await AsyncStorage.setItem(backupKey, raw);
}
