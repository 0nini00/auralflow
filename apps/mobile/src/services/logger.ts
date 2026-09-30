import RNFS from "react-native-fs";

/**
 * 运行日志落盘（移动端）。
 *
 * 目标：用户报「播放断了 / 同步失败 / 下载失败」时能拿到证据（此前只有 console.*，重启即丢）。
 *
 * 落盘位置：`<DocumentDirectoryPath>/logs/app-<YYYY-MM-DD>.log`（应用私有目录，不需要存储权限，
 * 用户可用 adb / 文件管理器在应用私有目录下取到）。
 *
 * 规则：
 * - 单文件上限 1 MiB：写之前发现会超限就截断，只保留最近约 256 KiB，并**从整行边界切开**（不留半行）；
 * - 启动时清理 7 天前的日志（按文件名里的日期判断，不依赖设备时钟精度之外的元数据）；
 * - `debug/info/warn/error` 四个级别都同时写 console 与文件；
 * - **落盘失败一律静默**：日志是取证手段，绝不能反过来把功能搞崩，也不允许递归报错
 *   （所以这里的 catch 里不再调用 console.* / logger.*）；
 * - 写盘串行化：并发调用排队执行，避免两次 append 交错写坏文件。
 *
 * 接全局兜底：`ErrorUtils.setGlobalHandler`（保留并调用此前已安装的处理器链）+ Hermes 未处理 Promise 拒绝跟踪。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogStorageInfo {
  /** 日志目录绝对路径 */
  directory: string;
  /** 目录里的日志文件数 */
  fileCount: number;
  /** 目录里日志文件总字节数 */
  totalBytes: number;
}

const LOG_DIR = `${RNFS.DocumentDirectoryPath}/logs`;
/** 单文件上限 1 MiB（规格：超限截断） */
const LOG_FILE_MAX_BYTES = 1024 * 1024;
/** 截断后保留的尾部大小 */
const LOG_FILE_KEEP_BYTES = 256 * 1024;
/** 保留最近 7 个日历日（含今天） */
const LOG_RETENTION_DAYS = 7;
/** 单行上限：一次超长错误（含堆栈）不能把刚截断的文件立刻顶爆 */
const LOG_LINE_MAX_CHARS = 4000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 只识别本模块自己写出的日志文件，避免误删目录里的其他文件 */
const LOG_FILE_PATTERN = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;

function toLocalDateText(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 当天日志文件路径（跨天写新文件，不再轮转旧文件） */
function logFilePathFor(now: number): string {
  return `${LOG_DIR}/app-${toLocalDateText(new Date(now))}.log`;
}

/** 日志目录绝对路径（设置页展示用） */
export function getLogDirectoryPath(): string {
  return LOG_DIR;
}

/** 文件名里的日期 → 该本地日 00:00 的毫秒时间戳；不是本模块的日志文件返回 null */
function parseLogFileDayStart(name: string): number | null {
  const match = LOG_FILE_PATTERN.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = new Date(year, month - 1, day).getTime();
  return Number.isFinite(start) ? start : null;
}

/** UTF-8 字节数（RN 没有 Buffer，这里自己数，用于 1 MiB 上限判断） */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对：一个字符占 4 字节
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** 把任意详情值转成可读文本：Error 保留 message + stack，其余走 JSON.stringify（失败则 String） */
function describeDetail(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ? `${value.name}: ${value.message}\n${value.stack}` : `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // 循环引用等情况：JSON.stringify 会抛，退化为 String
    return String(value);
  }
}

function formatLine(level: LogLevel, message: string, details: unknown[]): string {
  const head = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const detailText = details.map(describeDetail).filter((text) => text.length > 0).join(" ");
  const body = detailText ? `${head} ${detailText}` : head;
  const trimmed = body.length > LOG_LINE_MAX_CHARS ? `${body.slice(0, LOG_LINE_MAX_CHARS)}…（已截断）` : body;
  return `${trimmed}\n`;
}

// debug 走 console.log：RN 的 console.debug 在各引擎上支持度不一致，日志级别本身由行内 [DEBUG] 标记
const consoleWriters: Record<LogLevel, (text: string, details: unknown[]) => void> = {
  debug: (text, details) => console.log(text, ...details),
  info: (text, details) => console.info(text, ...details),
  warn: (text, details) => console.warn(text, ...details),
  error: (text, details) => console.error(text, ...details),
};

/** 写盘串行链：任何一步失败都不会中断后续写入 */
let writeChain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(task).catch(() => undefined);
  return writeChain;
}

async function ensureLogDirectory(): Promise<void> {
  if (await RNFS.exists(LOG_DIR)) return;
  await RNFS.mkdir(LOG_DIR);
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await RNFS.stat(filePath);
    return Number.isFinite(info.size) ? info.size : 0;
  } catch {
    // 文件不存在或不可读：按 0 处理，交给 appendFile 自己失败（失败也会被静默吞掉）
    return 0;
  }
}

/** 超过 1 MiB 就截断：读回尾部、从行边界切开后整体重写（保留最新记录） */
async function truncateIfOversized(filePath: string, incomingBytes: number): Promise<void> {
  const size = await fileSize(filePath);
  if (size + incomingBytes <= LOG_FILE_MAX_BYTES) return;
  const readLength = Math.min(LOG_FILE_KEEP_BYTES, size);
  const tail = await RNFS.read(filePath, readLength, size - readLength, "utf8");
  const firstBreak = tail.indexOf("\n");
  // 首个换行之前是可能被切坏的半行：丢掉，保证文件每行完整
  const kept = firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
  const marker = `${new Date().toISOString()} [INFO] 日志超过 1 MiB 上限，已截断，仅保留最近约 256 KiB\n`;
  await RNFS.writeFile(filePath, `${marker}${kept}`, "utf8");
}

async function appendLine(line: string): Promise<void> {
  const filePath = logFilePathFor(Date.now());
  await ensureLogDirectory();
  await truncateIfOversized(filePath, utf8ByteLength(line));
  await RNFS.appendFile(filePath, line, "utf8");
}

function write(level: LogLevel, message: string, details: unknown[]): void {
  consoleWriters[level](message, details);
  const line = formatLine(level, message, details);
  void enqueue(() => appendLine(line));
}

/** 统一日志入口：同时写 console 与当天日志文件；落盘失败静默 */
export const logger = {
  debug: (message: string, ...details: unknown[]): void => write("debug", message, details),
  info: (message: string, ...details: unknown[]): void => write("info", message, details),
  warn: (message: string, ...details: unknown[]): void => write("warn", message, details),
  error: (message: string, ...details: unknown[]): void => write("error", message, details),
};

/** `RNFS.readDir` 返回项里本模块用到的字段（react-native-fs 的类型未导出，这里只声明所需子集） */
interface LogDirEntry {
  name: string;
  path: string;
  size: number;
}

async function listLogFiles(): Promise<LogDirEntry[]> {
  if (!(await RNFS.exists(LOG_DIR))) return [];
  const entries = await RNFS.readDir(LOG_DIR);
  return entries.filter((entry) => LOG_FILE_PATTERN.test(entry.name));
}

/** 删除 7 天前的日志文件（保留最近 7 个日历日，含今天） */
async function pruneExpiredLogs(): Promise<void> {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const cutoff = todayStart - (LOG_RETENTION_DAYS - 1) * MS_PER_DAY;
  for (const entry of await listLogFiles()) {
    const dayStart = parseLogFileDayStart(entry.name);
    if (dayStart === null || dayStart >= cutoff) continue;
    await RNFS.unlink(entry.path).catch(() => undefined);
  }
}

/**
 * 启动时调用：建目录、清理过期日志、写一条启动记录，并安装全局兜底。
 * 不返回 Promise：内部全部串行在写盘链上，失败也不向上抛。
 */
export function initLogger(): void {
  void enqueue(async () => {
    await ensureLogDirectory();
    await pruneExpiredLogs();
    await appendLine(formatLine("info", `应用启动，日志目录 ${LOG_DIR}`, []));
  });
  installGlobalLogHandlers();
}

/** 日志目录概况（设置页展示路径与体积） */
export async function getLogStorageInfo(): Promise<LogStorageInfo> {
  const entries = await listLogFiles();
  return {
    directory: LOG_DIR,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0), 0),
  };
}

/** 清空全部日志文件，返回删除的文件数。清理动作本身会在新文件里留一条记录。 */
export function clearLogs(): Promise<number> {
  let deleted = 0;
  return enqueue(async () => {
    await ensureLogDirectory();
    const entries = await listLogFiles();
    for (const entry of entries) {
      await RNFS.unlink(entry.path).catch(() => undefined);
    }
    deleted = entries.length;
    await appendLine(formatLine("info", `设置页清理运行日志：删除 ${deleted} 个文件`, []));
  }).then(() => deleted);
}

/** 全局未捕获异常 / 未处理拒绝的处理器签名 */
type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
}

interface HermesInternalLike {
  enablePromiseRejectionTracker?: (options: {
    /** true = 连「后来又被处理」的拒绝也回调；这里只要真正没人管的，所以置 false */
    allRejections?: boolean;
    onUnhandled?: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
  }) => void;
}

let globalErrorHandlerInstalled = false;

/**
 * 接 `ErrorUtils.setGlobalHandler`：保留原有处理器链（globalErrorCapture 的崩溃取证、
 * RN 默认 handler），先落盘再交回去，避免顶掉既有崩溃行为。
 */
function installGlobalErrorHandler(): void {
  if (globalErrorHandlerInstalled) return;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const setGlobalHandler = errorUtils?.setGlobalHandler;
  if (!errorUtils || typeof setGlobalHandler !== "function") return;
  globalErrorHandlerInstalled = true;
  const previous = errorUtils.getGlobalHandler?.();
  setGlobalHandler((error, isFatal) => {
    logger.error(`未捕获的 JS 异常（isFatal=${isFatal !== false}）`, error);
    if (previous) previous(error, isFatal);
  });
}

/**
 * 未处理的 Promise 拒绝：RN 只在 Hermes 上提供这个全局钩子
 * （`HermesInternal.enablePromiseRejectionTracker`）。非 Hermes 引擎没有等价能力，
 * 这里不伪造一个不会触发的监听器。
 */
function installUnhandledRejectionHandler(): void {
  const hermes = (globalThis as { HermesInternal?: HermesInternalLike }).HermesInternal;
  const enableTracker = hermes?.enablePromiseRejectionTracker;
  if (!hermes || typeof enableTracker !== "function") return;
  enableTracker.call(hermes, {
    allRejections: false,
    onUnhandled: (_id, error) => {
      logger.error("未处理的 Promise 拒绝", error);
    },
  });
}

function installGlobalLogHandlers(): void {
  installGlobalErrorHandler();
  installUnhandledRejectionHandler();
}
