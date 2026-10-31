/**
 * 会员直连优先开关。
 *
 * 背景：`wyProvider` 的官方取链（weapi + Cookie）是带账号权限的最可靠通道，但它此前
 * 只排在全链路失败后的兜底位置——会员点一首歌，仍要先走第三方网关与自定义音源，
 * 网关拿不到无损时用户就听到降档结果。
 *
 * 账号层在登录态变化时写入本开关，解析层只读：会员会话里把「官方直连」提到主源位置，
 * 失败再照常唤醒网关 / 自定义源（`raceQualityTierLazy` 本来就带兜底语义）。
 *
 * 为什么不直接 import Zustand store：解析层是纯服务，测试与预取路径都会直接调用它，
 * 引 store 会把 React 状态带进服务层并制造 store ↔ service 环。这个模块没有依赖，
 * 测试可以显式注入。
 */
let vipOfficialFirst = false;

/** 由账号 store 在登录 / 退出 / 会员状态变化时调用。 */
export function setVipOfficialFirst(enabled: boolean): void {
  vipOfficialFirst = enabled;
}

/** 解析层读取：只有确认是会员会话才为 true（未知 / 未登录一律 false）。 */
export function isVipOfficialFirst(): boolean {
  return vipOfficialFirst;
}
