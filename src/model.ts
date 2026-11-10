export interface Selection {
  key: string;
  name: string;
  targetName: string;
}
export interface Connection {
  id: string;
  name: string;
  tagName?: string;
  url: string;
  username: string;
  password: string;
  automatic: boolean;
  intervalMinutes: number;
  selections: Selection[];
}
export interface SyncResult {
  key: string;
  name: string;
  playlistId?: number;
  count: number;
  added: number;
  removed: number;
  error?: string;
  lastSuccess?: string;
}
export interface Status {
  lastAttempt?: string;
  lastSuccess?: string;
  error?: string;
  failures: number;
  nextRun: number;
  results: SyncResult[];
}
export interface State {
  connections: Connection[];
  statuses: Record<string, Status>;
  mappings: Record<string, number>;
  naming?: Record<
    string,
    { requested: string; explicit: boolean; allocated: string }
  >;
}
export const emptyState = (): State => ({
  connections: [],
  statuses: {},
  mappings: {},
});
export async function loadState(): Promise<State> {
  const raw = await songloft.storage.get("state.json");
  if (raw === null || raw === "") return emptyState();
  const state = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !state ||
    !Array.isArray(state.connections) ||
    !state.statuses ||
    !state.mappings
  ) {
    throw new Error("配置文件无效，请恢复备份；未执行同步");
  }
  return state as State;
}
export async function saveState(state: State): Promise<void> {
  await songloft.storage.set("state.json", state);
}
export function publicConnection(c: Connection) {
  const { password, ...rest } = c;
  return { ...rest, hasPassword: !!password };
}
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function validateConnection(
  input: Record<string, unknown>,
  old?: Connection,
): Connection {
  const name = String(input.name || "").trim();
  const tagName = String(input.tagName ?? old?.tagName ?? "").trim();
  if (Array.from(tagName).length > 50 || tagName.includes(","))
    throw new UserError("连接标签最多 50 个字符，不能包含逗号");
  const url = String(input.url || "")
    .trim()
    .replace(/\/+$/, "");
  const username = String(input.username || "").trim();
  // Restrict URL to a server base, including an optional reverse-proxy path.
  if (!/^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/.test(url))
    throw new UserError(
      "请输入完整的 HTTP/HTTPS 服务器地址，不含账号、查询参数或片段",
    );
  if (!name || name.length > 80 || !username || username.length > 200)
    throw new UserError("请填写连接名称和用户名");
  if (old && (old.url !== url || old.username !== username))
    throw new UserError("服务器或账号变更请新建连接，避免混用歌曲 ID");
  const password =
    input.password === "" || input.password === undefined
      ? old?.password || ""
      : String(input.password);
  if (!password) throw new UserError("请输入密码");
  const intervalMinutes = Number(input.intervalMinutes);
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 5 ||
    intervalMinutes > 10080
  )
    throw new UserError("同步间隔应为 5～10080 分钟");
  if (!Array.isArray(input.selections) || input.selections.length > 200)
    throw new UserError("请选择同步范围（最多 200 个）");
  const seen = new Set<string>();
  const selections = input.selections.map((s: Selection) => {
    if (
      !s ||
      typeof s.key !== "string" ||
      (s.key !== "starred" && !s.key.startsWith("playlist:")) ||
      s.key.length > 300 ||
      seen.has(s.key)
    )
      throw new UserError("同步范围无效或重复");
    seen.add(s.key);
    return {
      key: s.key,
      name: String(s.name || "").slice(0, 200),
      targetName: String(s.targetName || "")
        .trim()
        .slice(0, 200),
    };
  });
  if (typeof input.automatic !== "boolean")
    throw new UserError("自动同步设置无效");
  if (input.automatic && !selections.length)
    throw new UserError("自动同步至少选择一个收藏或歌单");
  const id =
    old?.id ||
    "nd-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 12);
  return {
    id,
    name,
    tagName,
    url,
    username,
    password,
    intervalMinutes,
    automatic: input.automatic,
    selections,
  };
}
