import type { UpdateInfo } from "@/services/updateService";

export function getUpdateCheckStatus(info: UpdateInfo): string {
  return info.hasUpdate ? `发现新版本 ${info.latestVersion}` : "已是最新版本";
}
