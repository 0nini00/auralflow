/**
 * WebDAV 同步的「拒绝」错误类型。
 *
 * 同步在无法确认操作安全时会拒绝执行。调用方必须按类型区分，不要匹配错误文案里
 * 是否含「较旧」「强制下载」：文案会变，而且「无法判定云端更新时间」的拒绝同样会
 * 提示强制下载——两者一旦混淆，最保守的拒绝反而会触发覆盖式上传，删掉只存在于
 * 云端的实体。
 */

/**
 * 同步被拒绝，但用户可以用「强制下载」显式覆盖。
 *
 * 设置页据此决定是否弹出强制确认（`error instanceof CloudSyncRefusalError`）。
 * 注意 `force` 能跳过的是「守卫拦截」，不是所有拒绝——例如「云端音源解析出 0 项」
 * 是普通 Error，不派生本类，因为它本来就不受 `force` 影响。
 */
export class CloudSyncRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSyncRefusalError";
    // 用 new.target 而非写死类名：子类构造时 this 的 [[Prototype]] 必须留在子类上，
    // 否则 instanceof CloudDataStaleError 会失效。
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 云端数据可证明比本地旧（本地为权威）。
 *
 * 这是唯一可以安全「跳过下载、直接上传本地结果收敛」的拒绝，
 * 自动同步据此判断（`error instanceof CloudDataStaleError`）。
 */
export class CloudDataStaleError extends CloudSyncRefusalError {
  constructor(message: string) {
    super(message);
    this.name = "CloudDataStaleError";
  }
}
