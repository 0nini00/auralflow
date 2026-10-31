/**
 * 网易云会员直连优先开关（移动端）。
 *
 * 与桌面端 `desktop/src/services/playback/officialPriority.ts` 同语义：账号层在
 * 登录态变化时写入，播放解析层只读。会员会话里把官方直连（weapi + Cookie）提到
 * 主源位置——网关对 VIP 曲目只能给降档/试听，会员自己的账号权限才是最高音质来源。
 *
 * 独立成无依赖模块：`playerService` 会被单测用最小模块图加载，不能因为一个布尔值
 * 把 React store 与账号服务整条依赖链拖进来。
 */
let vipOfficialFirst = false;

/** 由账号 store 在登录 / 退出 / 会员状态变化时调用。 */
export function setVipOfficialFirst(enabled: boolean): void {
  vipOfficialFirst = enabled;
}

/** 只有确认是会员会话才为 true（未知 / 未登录一律 false）。 */
export function isVipOfficialFirst(): boolean {
  return vipOfficialFirst;
}
