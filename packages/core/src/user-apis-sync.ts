export interface UserApisSyncFile<T = Record<string, unknown>> {
  version?: string;
  lastModified?: number;
  data?: T[] | { list?: T[]; scripts?: Record<string, string> };
}

export interface UserApiSyncSource {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author?: unknown;
  homepage?: unknown;
  version?: unknown;
  allowShowUpdateAlert?: unknown;
  script?: unknown;
}

const INVALID_FILE_MESSAGE = "云端音源文件已损坏或不是有效的 JSON";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildUserApisSyncFile(
  sources: readonly UserApiSyncSource[],
  lastModified = Date.now(),
): UserApisSyncFile<UserApiSyncSource> {
  return {
    version: "2",
    lastModified,
    data: sources
      .filter((source) => typeof source.script === "string" && source.script.trim().length > 0)
      .map((source) => ({
        id: source.id,
        name: source.name,
        description: source.description,
        author: source.author ?? "",
        homepage: source.homepage ?? "",
        version: source.version ?? "",
        allowShowUpdateAlert: source.allowShowUpdateAlert,
        script: source.script,
      })),
  };
}

export async function parseUserApisSyncFile<R>(
  text: string,
  convert: (api: UserApiSyncSource, scripts: Record<string, string>, index: number) => Promise<R | null>,
): Promise<Awaited<R>[]> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(INVALID_FILE_MESSAGE);
  }
  if (!isRecord(payload)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }
  const data = payload.data;
  if (data != null && !Array.isArray(data) && !isRecord(data)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }
  const apis = Array.isArray(data) ? data : data?.list ?? [];
  const scripts = Array.isArray(data) ? {} : data?.scripts ?? {};
  if (!Array.isArray(apis) || !apis.every(isRecord) || !isRecord(scripts)
    || !Object.values(scripts).every((script) => typeof script === "string")) {
    throw new Error(INVALID_FILE_MESSAGE);
  }
  const sources = await Promise.all(apis.map((api, index) => convert(api, scripts as Record<string, string>, index)));
  return sources.filter((source): source is Awaited<R> => source != null);
}
