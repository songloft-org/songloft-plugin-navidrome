import type { Playlist } from "@songloft/plugin-sdk";
import type { Connection, Selection, State } from "./model";
import { UserError } from "./model";

export function marker(c: Connection, selection: Selection): string {
  return "[navidrome:" + c.id + ":" + encodeURIComponent(selection.key) + "]";
}

export function managedPlaylist(
  state: State,
  c: Connection,
  selection: Selection,
  playlists: Playlist[],
): Playlist | undefined {
  const description = marker(c, selection);
  const mapped = playlists.find(
    (p) => p.id === state.mappings[c.id + "/" + selection.key],
  );
  if (mapped && mapped.description !== description)
    throw new UserError("目标歌单的同步标记已变更，已停止更新", 409);
  if (mapped) return mapped;
  const matches = playlists.filter((p) => p.description === description);
  if (matches.length > 1)
    throw new UserError("发现重复的同步歌单，请保留一份后重试", 409);
  return matches[0];
}

export function allocateName(
  base: string,
  occupied: Set<string>,
  explicit: boolean,
): string {
  if (!occupied.has(base)) return base;
  if (explicit)
    throw new UserError(
      "目标歌单名称已存在：" + base + "，请修改目标名称",
      409,
    );
  const sourceName = base + "-Navidrome";
  if (!occupied.has(sourceName)) return sourceName;
  for (let i = 2; i <= 100; i++) {
    const candidate = sourceName + " (" + i + ")";
    if (!occupied.has(candidate)) return candidate;
  }
  throw new UserError("无法分配唯一歌单名称，请设置目标名称", 409);
}

export function plannedName(
  state: State,
  c: Connection,
  selection: Selection,
  remoteName: string,
  playlists: Playlist[],
): string {
  const playlist = managedPlaylist(state, c, selection, playlists);
  const requested = selection.targetName || remoteName;
  const explicit = !!selection.targetName;
  const previous = state.naming?.[c.id + "/" + selection.key];
  if (
    playlist &&
    previous?.requested === requested &&
    previous.explicit === explicit
  )
    return playlist.name;
  // Only migrate the verified old default. Preserve manually named playlists.
  if (
    playlist &&
    !previous &&
    !explicit &&
    playlist.name !== c.name + " · " + selection.name &&
    playlist.name !== c.name + " · " + remoteName
  )
    return playlist.name;
  const occupied = new Set(
    playlists.filter((p) => p.id !== playlist?.id).map((p) => p.name),
  );
  return allocateName(requested, occupied, explicit);
}

export function isNameConflict(error: unknown): boolean {
  return /playlist with the same name already exists|UNIQUE constraint failed: playlists\.name/i.test(
    String(error),
  );
}
