import { isHttpMediaUrl } from "@/utils/mediaUrl";

export type CommentVoice = {
  url: string;
  /** 网易云 contentResource.duration 的单位为秒。 */
  duration: number;
};

type CommentContent = {
  content: string;
  voice?: CommentVoice;
  voiceError?: string;
};

export interface SongComment extends CommentContent {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl?: string;
  likedCount: number;
  createdAt: number;
  beReplied?: Array<CommentContent & { nickname: string }>;
}

export interface SongCommentResult {
  total: number;
  comments: SongComment[];
  /**
   * 热门评论（响应里的 `hotComments`，含作者置顶的 `topComments`）。
   *
   * 与 `comments` 同一次请求返回，不参与 offset 分页：接口只给一页热门（实测 15 条），
   * 所以「热门」标签页没有上拉加载。置顶评论同时出现在热门里时按 id 去重。
   */
  hotComments: SongComment[];
}

const VOICE_RESOURCE_TYPE = 1014;
const VOICE_PLACEHOLDER = "[发布了语音，请前往最新移动端版本查看]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, missing = ""): string {
  if (value == null) return missing;
  if (typeof value !== "string") throw new Error("评论响应格式无效：文本字段不是字符串");
  return value;
}

function readUser(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new Error("评论响应格式无效：用户字段不是对象");
  return value;
}

function removeVoicePlaceholder(content: string): string {
  if (!content.endsWith(VOICE_PLACEHOLDER)) return content;
  // 只去掉接口追加的占位及其一处换行，不 trim 用户正文。
  return content.slice(0, -VOICE_PLACEHOLDER.length).replace(/\r?\n$/, "");
}

function mapContent(item: Record<string, unknown>): CommentContent {
  const content = readText(item.content);
  const resource = item.contentResource;
  if (!isRecord(resource) || resource.resourceType !== VOICE_RESOURCE_TYPE) return { content };

  const text = removeVoicePlaceholder(content);
  if (!isHttpMediaUrl(resource.url)) {
    return { content: text, voiceError: "语音不可用：播放地址缺失或无效" };
  }
  if (typeof resource.duration !== "number" || !Number.isFinite(resource.duration) || resource.duration <= 0) {
    return { content: text, voiceError: "语音不可用：时长缺失或无效" };
  }
  return { content: text, voice: { url: resource.url, duration: resource.duration } };
}

function mapReplies(value: unknown): SongComment["beReplied"] {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("评论响应格式无效：回复列表不是数组");
  return value
    .filter((reply): reply is Record<string, unknown> => isRecord(reply) && Boolean(reply.user))
    .map((reply) => ({
      nickname: readText(readUser(reply.user)?.nickname),
      ...mapContent(reply),
    }));
}

function mapComment(item: unknown): SongComment {
  if (!isRecord(item)) throw new Error("评论响应格式无效：评论不是对象");
  const user = readUser(item.user);
  return {
    id: String(item.commentId ?? item.id),
    ...mapContent(item),
    userId: String(user?.userId ?? ""),
    nickname: readText(user?.nickname, "未知用户"),
    avatarUrl: readText(user?.avatarUrl),
    likedCount: Number(item.likedCount ?? 0),
    createdAt: Number(item.time ?? 0),
    beReplied: mapReplies(item.beReplied),
  };
}

/**
 * 热门 / 置顶评论列表。
 *
 * 与 `comments` 的严格校验不同，这里缺失或结构异常一律按空列表处理：
 * 热门只是体验增强，不能因为它把整个评论面板判成失败（正文列表才是主体）。
 */
function mapOptionalCommentList(value: unknown): SongComment[] {
  if (!Array.isArray(value)) return [];
  const comments: SongComment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    try {
      comments.push(mapComment(item));
    } catch {
      // 单条脏数据只丢这一条：热门列表是增强信息，不能因此让整个面板失败。
    }
  }
  return comments;
}

/** 置顶在前、热门在后，按评论 id 去重（同一条置顶也会出现在 hotComments 里）。 */
function mergeHotComments(top: SongComment[], hot: SongComment[]): SongComment[] {
  const seen = new Set<string>();
  const merged: SongComment[] = [];
  for (const comment of [...top, ...hot]) {
    if (seen.has(comment.id)) continue;
    seen.add(comment.id);
    merged.push(comment);
  }
  return merged;
}

export function parseNeteaseCommentResult(data: unknown): SongCommentResult {
  if (!isRecord(data) || typeof data.code !== "number" || !Number.isFinite(data.code)) {
    throw new Error("评论响应格式无效：缺少有效 code");
  }
  if (data.code !== 200) throw new Error(`评论请求失败（code: ${data.code}）`);
  if (!Array.isArray(data.comments)) throw new Error("评论响应格式无效：缺少评论数组");
  if (typeof data.total !== "number" || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error("评论响应格式无效：评论总数无效");
  }
  return {
    total: data.total,
    comments: data.comments.map(mapComment),
    hotComments: mergeHotComments(
      mapOptionalCommentList(data.topComments),
      mapOptionalCommentList(data.hotComments),
    ),
  };
}
