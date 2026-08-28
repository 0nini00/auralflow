/**
 * 网易云登录态失效标记错误。
 * 服务端明确拒绝（code=301/401/403 或匿名会话）时抛出，
 * 与网络失败区分：UI 据此提示重新登录，checkLoginStatus 据此清理登录态。
 */
export class WyAuthExpiredError extends Error {
  constructor(message = "网易云登录已过期，请重新登录") {
    super(message);
    this.name = "WyAuthExpiredError";
  }
}
