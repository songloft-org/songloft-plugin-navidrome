import type { HTTPResponse } from "@songloft/plugin-sdk";
import type { Connection } from "./model";
import { UserError } from "./model";
import { buildUrl, request } from "./client";

export function mediaUrl(
  c: Connection,
  kind: "cover" | "lyric",
  id: string,
): string {
  return (
    "/api/v1/jsplugin/navidrome/media/" +
    encodeURIComponent(c.id) +
    "/" +
    kind +
    "?id=" +
    encodeURIComponent(id)
  );
}

function lrc(track: any): string {
  if (!track || !Array.isArray(track.line) || typeof track.synced !== "boolean")
    return "";
  if (track.line.some((line: any) => !line || typeof line.value !== "string"))
    return "";
  if (!track.line.some((line: any) => line.value.trim())) return "";
  if (!track.synced)
    return track.line.map((line: any) => line.value).join("\n");
  if (
    track.line.some(
      (line: any) => !Number.isSafeInteger(line.start) || line.start < 0,
    )
  )
    return "";
  const offset = Number.isSafeInteger(track.offset) ? track.offset : 0;
  return track.line
    .map((line: any) => {
      // OpenSubsonic/LRC offsets: positive means earlier. Bake it into timestamps
      // because clients need not support the LRC offset tag.
      const ms = Math.max(0, line.start - offset);
      const minutes = String(Math.floor(ms / 60000)).padStart(2, "0");
      const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
      const fraction = String(ms % 1000).padStart(3, "0");
      return `[${minutes}:${seconds}.${fraction}]${line.value}`;
    })
    .join("\n");
}

export async function lyrics(c: Connection, songId: string): Promise<string> {
  const body = await request(c, "getLyricsBySongId", { id: songId });
  const tracks = body.lyricsList?.structuredLyrics;
  if ((tracks !== undefined && !Array.isArray(tracks)) || !body.lyricsList)
    throw new UserError("Navidrome 歌词响应无效", 502);
  const candidates = (tracks || []).map((track: any) => ({
    synced: track?.synced,
    text: lrc(track),
  }));
  return (
    candidates.find((t: any) => t.synced && t.text)?.text ||
    candidates.find((t: any) => t.text)?.text ||
    ""
  );
}

// Coalesce parallel requests for the same cover to avoid concurrent file writes.
const pending = new Map<string, Promise<HTTPResponse>>();
export async function cover(
  c: Connection,
  coverId: string,
): Promise<HTTPResponse> {
  const key = c.id + ":" + coverId;
  const active = pending.get(key);
  if (active) return active;
  const task = fetchCover(c, coverId);
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
async function fetchCover(
  c: Connection,
  coverId: string,
): Promise<HTTPResponse> {
  const response = await fetch(
    buildUrl(c, "getCoverArt", { id: coverId, size: "600" }),
    {
      headers: { "X-Fetch-Timeout-Ms": "20000", "X-Fetch-No-Redirect": "1" },
    },
  );
  if (response.status === 404) throw new UserError("远端封面不存在", 404);
  if (!response.ok) throw new UserError("Navidrome 封面获取失败", 502);
  const type = (response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  if (!extension[type]) throw new UserError("Navidrome 封面格式无效", 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new UserError("Navidrome 封面大小无效", 502);
  // The host HTTP bridge carries string bodies. serveFile preserves binary bytes
  // and never sends upstream credentials or redirect headers to the client.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const filePath =
    "cover-" + __go_crypto_md5(c.id + ":" + coverId) + "." + extension[type];
  const temporary = filePath + ".tmp";
  try {
    await songloft.fs.writeFile(temporary, btoa(binary), {
      encoding: "base64",
    });
    await songloft.fs.rename(temporary, filePath);
  } catch (error) {
    await songloft.fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
    serveFile: { filePath },
  };
}
