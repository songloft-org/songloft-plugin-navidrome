import type { State, Connection, Selection, Status, SyncResult } from "./model";
import { saveState } from "./model";
import { snapshot } from "./client";
import { mediaUrl } from "./media";

// Compatibility with the published 2.18 SDK until replaceSongs is released.
// The method is implemented by this change's host; no fallback to destructive multi-step writes.
type AtomicPlaylists = typeof songloft.playlists & {
  replaceSongs(id: number, songIds: number[]): Promise<void>;
};
export function hasAtomicPlaylists(): boolean {
  return (
    typeof (songloft.playlists as AtomicPlaylists).replaceSongs === "function"
  );
}
function marker(c: Connection, selection: Selection): string {
  return "[navidrome:" + c.id + ":" + encodeURIComponent(selection.key) + "]";
}
export async function syncSelection(
  state: State,
  c: Connection,
  selection: Selection,
): Promise<SyncResult> {
  if (!hasAtomicPlaylists())
    throw new Error("宿主缺少原子歌单同步接口，请升级到包含 #558 支持的版本");
  const remote = await snapshot(c, selection.key);
  const mapKey = c.id + "/" + selection.key;
  const description = marker(c, selection);
  const playlists = await songloft.playlists.list();
  let playlist = playlists.find((p) => p.id === state.mappings[mapKey]) || null;
  // Validate ownership on every run, and recover a create that succeeded before mapping was persisted.
  if (playlist && playlist.description !== description)
    throw new Error("目标歌单的同步标记已变更，已停止更新");
  if (!playlist) {
    const found = playlists.filter((p) => p.description === description);
    if (found.length > 1)
      throw new Error("发现重复的同步歌单，请保留一份后重试");
    playlist = found[0] || null;
  }
  // Read and validate the complete remote snapshot before touching host membership.
  const ids: number[] = [];
  for (let offset = 0; offset < remote.songs.length; offset += 100) {
    const batch = remote.songs.slice(offset, offset + 100);
    const create = songloft.songs.create as (
      inputs: Parameters<typeof songloft.songs.create>[0],
      options: { probeMetadata: boolean },
    ) => ReturnType<typeof songloft.songs.create>;
    const records = await create(
      batch.map((s) => ({
        url: "",
        title: s.title,
        artist: s.artist || "",
        album: s.album || "",
        coverUrl: s.coverArt ? mediaUrl(c, "cover", s.coverArt) : "",
        lyricRemoteUrl: mediaUrl(c, "lyric", s.id),
        duration: s.duration,
        sourceData: JSON.stringify({ connectionId: c.id, songId: s.id }),
        dedupKey: "navidrome:" + c.id + ":" + s.id,
      })),
      { probeMetadata: false },
    );
    if (
      records.length !== batch.length ||
      records.some((r) => !r || !Number.isSafeInteger(r.id) || r.id <= 0)
    )
      throw new Error("歌曲写入结果不完整，已保留原歌单");
    ids.push(...records.map((r) => r.id));
  }
  if (!playlist) {
    playlist = await songloft.playlists.create({
      name: selection.targetName || c.name + " · " + remote.name,
      type: "normal",
      description,
    });
    if (!playlist) throw new Error("创建歌单失败");
  }
  state.mappings[mapKey] = playlist.id;
  await saveState(state);
  const previous = await songloft.playlists.getSongs(playlist.id);
  const before = new Set(previous.map((s) => s.id)),
    after = new Set(ids);
  await (songloft.playlists as AtomicPlaylists).replaceSongs(playlist.id, ids);
  const name = selection.targetName || c.name + " · " + remote.name;
  if (playlist.name !== name)
    await songloft.playlists.update(playlist.id, { name });
  selection.name = remote.name;
  return {
    key: selection.key,
    name,
    playlistId: playlist.id,
    count: ids.length,
    added: ids.filter((id) => !before.has(id)).length,
    removed: previous.filter((s) => !after.has(s.id)).length,
    lastSuccess: new Date().toISOString(),
  };
}
export async function syncConnection(
  state: State,
  c: Connection,
): Promise<void> {
  const previous = state.statuses[c.id];
  const status: Status = {
    ...previous,
    lastAttempt: new Date().toISOString(),
    error: undefined,
    failures: previous?.failures || 0,
    nextRun: 0,
    results: previous?.results || [],
  };
  state.statuses[c.id] = status;
  await saveState(state);
  const results: SyncResult[] = [];
  for (const selection of c.selections) {
    try {
      results.push(await syncSelection(state, c, selection));
    } catch (e) {
      const old = status.results.find((r) => r.key === selection.key);
      results.push({
        key: selection.key,
        name: selection.targetName || selection.name,
        count: old?.count || 0,
        playlistId: old?.playlistId,
        lastSuccess: old?.lastSuccess,
        added: 0,
        removed: 0,
        error: safeError(e),
      });
    }
  }
  status.results = results;
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    status.failures++;
    status.error = failed.length + " 个歌单同步失败，请查看详情";
  } else {
    status.failures = 0;
    status.lastSuccess = new Date().toISOString();
  }
  const delayMinutes = status.failures
    ? Math.max(
        c.intervalMinutes,
        Math.min(360, 5 * 2 ** Math.min(status.failures, 6)),
      )
    : c.intervalMinutes;
  status.nextRun = Date.now() + delayMinutes * 60000;
  await saveState(state);
}
export function safeError(error: unknown): string {
  // Host errors can include URLs. Never send those (or their credentials) to the UI/log.
  const message = error instanceof Error ? error.message : "";
  if (/https?:\/\/|[?&](t|p|s|u)=|password|token/i.test(message))
    return "同步失败，请检查连接配置或宿主日志";
  return message.slice(0, 240) || "同步失败，请稍后重试";
}
