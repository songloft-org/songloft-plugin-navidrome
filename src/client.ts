import type { Connection } from "./model";

export interface RemoteSong {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  starred?: string;
  coverArt?: string;
}
interface RemotePlaylist {
  id: string;
  name: string;
  songCount: number;
}
type Payload = Record<string, any>;

export function buildUrl(
  c: Connection,
  endpoint: string,
  params: Record<string, string> = {},
): string {
  const salt = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const token = __go_crypto_md5(c.password + salt);
  const query = {
    u: c.username,
    t: token,
    s: salt,
    v: "1.16.1",
    c: "songloft-navidrome",
    f: "json",
    ...params,
  };
  return (
    c.url +
    "/rest/" +
    endpoint +
    "?" +
    Object.entries(query)
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&")
  );
}
export async function request(
  c: Connection,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<Payload> {
  let response;
  try {
    response = await fetch(buildUrl(c, endpoint, params), {
      headers: { "X-Fetch-Timeout-Ms": "20000", "X-Fetch-No-Redirect": "1" },
    });
  } catch {
    throw new Error("无法连接 Navidrome，请检查服务器地址和网络");
  }
  if (!response.ok) throw new Error("Navidrome HTTP " + response.status);
  let body;
  try {
    body = (await response.json())["subsonic-response"];
  } catch {
    throw new Error("Navidrome 返回了无效 JSON");
  }
  if (!body || body.status !== "ok") {
    const code = Number(body?.error?.code);
    if (code === 40 || code === 41)
      throw new Error("Navidrome 认证失败，请检查账号或密码");
    if (code === 70) throw new Error("远端资源已删除或不可访问");
    // Do not echo upstream errors: they may contain credentials or URLs.
    throw new Error(
      "Navidrome API 失败" +
        (Number.isFinite(code) ? "（" + code + "）" : "，响应状态无效"),
    );
  }
  return body;
}
function requireContainer(body: Payload, name: string): Payload {
  const value = body[name];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("远端响应不完整，已保留原歌单");
  return value;
}
function array(value: unknown): any[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("远端列表格式无效，已保留原歌单");
  return value;
}
function songs(value: unknown): RemoteSong[] {
  const entries = array(value);
  const seen = new Set<string>();
  const result: RemoteSong[] = [];
  for (const s of entries) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      typeof s.title !== "string" ||
      s.isVideo === true ||
      !Number.isFinite(s.duration) ||
      s.duration <= 0
    ) {
      throw new Error("歌曲信息缺失或包含非音频内容，已保留原歌单");
    }
    // Songloft playlists are sets: retain the first occurrence in remote order.
    if (!seen.has(s.id)) {
      result.push(s);
      seen.add(s.id);
    }
  }
  return result;
}
export async function catalog(c: Connection): Promise<RemotePlaylist[]> {
  const body = await request(c, "getPlaylists");
  return array(requireContainer(body, "playlists").playlist).map((p) => {
    if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string")
      throw new Error("歌单列表响应不完整");
    return { id: p.id, name: p.name, songCount: Number(p.songCount) || 0 };
  });
}
export async function snapshot(
  c: Connection,
  key: string,
): Promise<{ name: string; songs: RemoteSong[] }> {
  if (key === "starred") {
    const body = await request(c, "getStarred2");
    const list = songs(requireContainer(body, "starred2").song);
    list.sort((a, b) => {
      const ta = Date.parse(a.starred || "") || 0,
        tb = Date.parse(b.starred || "") || 0;
      return tb - ta || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return { name: "收藏", songs: list };
  }
  const id = key.slice("playlist:".length);
  const body = await request(c, "getPlaylist", { id });
  const p = requireContainer(body, "playlist");
  if (
    p.id !== id ||
    typeof p.name !== "string" ||
    !Number.isInteger(p.songCount) ||
    p.songCount < 0 ||
    array(p.entry).length !== p.songCount
  ) {
    throw new Error("远端歌单响应不完整，已保留原歌单");
  }
  return { name: p.name, songs: songs(p.entry) };
}
