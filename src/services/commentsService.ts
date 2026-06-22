import type { MusicInfo } from "@lx/core";
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  likedCount: number;
  time: number;
  replies?: Comment[];
}

interface CommentResponse {
  comments: Comment[];
  total: number;
  hasMore: boolean;
  error?: string;
}

// 评论缓存
const commentsCache = new Map<string, CommentResponse>();

function getCacheKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

/**
 * 获取网易云音乐评论
 */
async function fetchNeteaseComments(songId: string, page: number = 1, limit: number = 50): Promise<CommentResponse> {
  try {
    const offset = (page - 1) * limit;
    const url = `https://music.163.com/api/v1/resource/comments/R_SO_4_${songId}?limit=${limit}&offset=${offset}`;

    const response = await tauriFetch(url, {
      method: 'GET',
      headers: {
        'Referer': 'https://music.163.com',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.comments) {
      return { comments: [], total: 0, hasMore: false };
    }

    const comments: Comment[] = data.comments.map((c: any) => ({
      id: String(c.commentId),
      userId: String(c.user.userId),
      userName: c.user.nickname,
      userAvatar: c.user.avatarUrl,
      content: c.content,
      likedCount: c.likedCount || 0,
      time: c.time,
      replies: c.beReplied?.map((r: any) => ({
        id: String(r.beRepliedCommentId),
        userId: String(r.user.userId),
        userName: r.user.nickname,
        userAvatar: r.user.avatarUrl,
        content: r.content,
        likedCount: 0,
        time: 0,
      })) || [],
    }));

    return {
      comments,
      total: data.total || 0,
      hasMore: data.more || false,
    };
  } catch (error) {
    console.error('Failed to fetch comments from Netease:', error);
    return { comments: [], total: 0, hasMore: false, error: '获取评论失败' };
  }
}

/**
 * 获取 QQ 音乐评论
 */
async function fetchQQMusicComments(songId: string, page: number = 1, limit: number = 50): Promise<CommentResponse> {
  try {
    const url = `https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=GB2312&notice=0&platform=yqq.json&needNewCode=0&cid=205360772&reqtype=2&biztype=1&topid=${songId}&cmd=8&needmusiccrit=0&pagenum=${page - 1}&pagesize=${limit}`;

    const response = await tauriFetch(url, {
      method: 'GET',
      headers: {
        'Referer': 'https://y.qq.com',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.comment || !data.comment.commentlist) {
      return { comments: [], total: 0, hasMore: false };
    }

    const comments: Comment[] = data.comment.commentlist.map((c: any) => ({
      id: String(c.rootcommentid),
      userId: String(c.uin),
      userName: c.nick,
      userAvatar: c.avatarurl,
      content: c.rootcommentcontent,
      likedCount: c.praisenum || 0,
      time: c.time * 1000,
      replies: [],
    }));

    return {
      comments,
      total: data.comment.commenttotal || 0,
      hasMore: (page * limit) < (data.comment.commenttotal || 0),
    };
  } catch (error) {
    console.error('Failed to fetch comments from QQ Music:', error);
    return { comments: [], total: 0, hasMore: false, error: '获取评论失败' };
  }
}

/**
 * 获取歌曲评论
 */
export async function getComments(music: MusicInfo, page: number = 1, limit: number = 50): Promise<CommentResponse> {
  if (!music.id) {
    return { comments: [], total: 0, hasMore: false, error: '歌曲信息不完整' };
  }

  // 本地音乐没有评论
  if (music.source === 'local') {
    return { comments: [], total: 0, hasMore: false, error: '本地音乐无评论' };
  }

  const cacheKey = `${getCacheKey(music)}_page${page}`;
  const cached = commentsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    let result: CommentResponse;

    switch (music.source) {
      case 'wy':
        result = await fetchNeteaseComments(music.id, page, limit);
        break;
      case 'tx':
        result = await fetchQQMusicComments(music.id, page, limit);
        break;
      default:
        result = { comments: [], total: 0, hasMore: false, error: '不支持的音源' };
    }

    commentsCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to get comments:', error);
    const errorResult = { comments: [], total: 0, hasMore: false, error: '获取评论失败' };
    commentsCache.set(cacheKey, errorResult);
    return errorResult;
  }
}
