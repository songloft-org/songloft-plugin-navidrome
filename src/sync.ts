import type { State, Connection, Selection, Status, SyncResult } from "./model";
import { saveState } from "./model";
import { snapshot } from "./client";
import { mediaUrl } from "./media";
import {
  allocateName,
  isNameConflict,
  managedPlaylist,
  marker,
  plannedName,
} from "./naming";

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
// Reuse SDK method types while published SDK 2.18 lacks playlist tag methods.
type SharedTags = typeof songloft.tags & {
  getPlaylistTags: typeof songloft.tags.getSongTags;
  bindPlaylists: typeof songloft.tags.bindSongs;
  unbindPlaylists: typeof songloft.tags.unbindSongs;
};
export function hasSharedTags(): boolean {
  return (
    typeof songloft.tags?.list === "function" &&
    typeof (songloft.tags as SharedTags)?.bindPlaylists === "function"
  );
}
async function sourceTags(c: Connection): Promise<number[]> {
  const ids: number[] = [];
  for (const name of new Set([
    "Navidrome",
    ...(c.tagName ? [c.tagName] : []),
  ])) {
    const lookup = async () => {
      let offset = 0;
      while (true) {
        const page = await songloft.tags.list({
          keyword: name,
          limit: 200,
          offset,
        });
        const match = page.find(
          (t) => t.name.toLowerCase() === name.toLowerCase(),
        );
        if (match || page.length < 200) return match;
        offset += page.length;
      }
    };
    let tag = await lookup();
    if (!tag) {
      try {
        tag = await songloft.tags.create({ name });
      } catch (error) {
        if (!/UNIQUE constraint failed: song_tags\.name/i.test(String(error)))
          throw error;
        tag = await lookup();
        if (!tag) throw error;
      }
    }
    if (!tag || !Number.isSafeInteger(tag.id) || tag.id <= 0)
      throw new Error("来源标签创建失败");
    ids.push(tag.id);
  }
  return ids;
}
export async function syncSelection(
  state: State,
  c: Connection,
  selection: Selection,
): Promise<SyncResult> {
  if (!hasAtomicPlaylists())
    throw new Error("宿主缺少原子歌单同步接口，请升级到包含 #558 支持的版本");
  if (!hasSharedTags())
    throw new Error("宿主缺少歌单自定义标签接口，请升级到包含 #562 支持的版本");
  const remote = await snapshot(c, selection.key);
  const mapKey = c.id + "/" + selection.key;
  const description = marker(c, selection);
  const playlists = await songloft.playlists.list();
  let playlist = managedPlaylist(state, c, selection, playlists);
  let name = plannedName(state, c, selection, remote.name, playlists);
  const occupied = new Set(
    playlists.filter((p) => p.id !== playlist?.id).map((p) => p.name),
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (!playlist)
        playlist = await songloft.playlists.create({
          name,
          type: "normal",
          description,
        });
      else if (playlist.name !== name)
        await songloft.playlists.update(playlist.id, { name });
      if (!playlist) throw new Error("创建歌单失败");
      break;
    } catch (error) {
      if (selection.targetName || !isNameConflict(error)) throw error;
      occupied.add(name);
      name = allocateName(remote.name, occupied, false);
      if (attempt === 99) throw error;
    }
  }
  if (!playlist) throw new Error("创建歌单失败");
  state.mappings[mapKey] = playlist.id;
  state.naming ??= {};
  state.naming[mapKey] = {
    requested: selection.targetName || remote.name,
    explicit: !!selection.targetName,
    allocated: name,
  };
  await saveState(state);
  const tagIDs = await sourceTags(c);
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
  const previous = await songloft.playlists.getSongs(playlist.id);
  const before = new Set(previous.map((s) => s.id)),
    after = new Set(ids);
  await (songloft.playlists as AtomicPlaylists).replaceSongs(playlist.id, ids);
  for (const tagID of tagIDs) {
    await (songloft.tags as SharedTags).bindPlaylists(tagID, [playlist.id]);
    for (let offset = 0; offset < ids.length; offset += 100)
      await songloft.tags.bindSongs(tagID, ids.slice(offset, offset + 100));
  }
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
