/**
 * 网易云登录态失效标记错误（与移动端 `services/wyAuthError.ts` 同构）。
 *
 * 服务端明确拒绝（code=301/401/403、缺少 MUSIC_U、匿名会话）时抛出，
 * 与网络失败、业务错误区分开：`wyAccountStore` 据此清掉已失效的 Cookie。
 * 判定必须靠这个类型而不是错误文案——文案改动或巧合的关键词都会让判定静默出错。
 */
export class WyAuthExpiredError extends Error {
  constructor(message = "网易云登录已过期，请重新登录") {
    super(message);
    this.name = "WyAuthExpiredError";
  }
}
