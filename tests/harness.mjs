import { build } from "esbuild";
import vm from "node:vm";
import { createHash } from "node:crypto";
const bundle = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "neutral",
  target: "es2020",
});
export const song = (id, extra = {}) => ({
  id,
  title: "歌曲 " + id,
  duration: 180,
  artist: "艺术家",
  ...extra,
});
export function harness(shared) {
  const db = shared || {
    files: new Map(),
    songs: [],
    playlists: [],
    members: new Map(),
    settings: { plugins: ["other"] },
  };
  let id =
    Math.max(
      0,
      ...db.songs.map((s) => s.id),
      ...db.playlists.map((p) => p.id),
    ) + 1;
  db.tags ||= [];
  db.songTags ||= new Map();
  db.playlistTags ||= new Map();
  const upstream = {
    starred: [song("a", { starred: "2026-11-01" })],
    playlists: [{ id: "p1", name: "夜间音乐", songCount: 2 }],
    entries: [song("a"), song("b")],
    fail: false,
    malformed: false,
    empty: false,
    apiError: false,
    lyrics: [],
    cover: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x80]),
    coverType: "image/png",
    coverStatus: 200,
  };
  const requests = [],
    timers = [];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const songloft = {
    fs: {
      async rename(from, to) {
        if (db.failFileRename) throw Error("injected file rename failure");
        db.files.set(to, db.files.get(from));
        db.files.delete(from);
      },
      async unlink(path) {
        db.files.delete(path);
      },
      async writeFile(path, data, options) {
        if (options?.encoding !== "base64")
          throw Error("cover must preserve binary");
        db.files.set(path, Buffer.from(data, "base64"));
      },
    },
    storage: {
      async get(key) {
        return db.files.get(key) || null;
      },
      async set(key, value) {
        db.files.set(key, JSON.stringify(value));
      },
    },
    plugin: {
      async getHostUrl() {
        return "http://localhost:58199";
      },
      async getToken() {
        return "host-plugin-token";
      },
    },
    log: { info() {}, error() {}, warn() {} },
    songs: {
      async create(inputs, options) {
        if (options?.probeMetadata !== false)
          throw Error("sync must disable audio probing");
        return inputs.map((input) => {
          let record = db.songs.find((s) => s.dedupKey === input.dedupKey);
          if (!record) {
            record = { ...input, id: id++ };
            db.songs.push(record);
          } else Object.assign(record, input);
          return copy(record);
        });
      },
    },
    tags: {
      async list({ keyword = "" } = {}) {
        return copy(db.tags.filter((t) => t.name.includes(keyword)));
      },
      async create({ name }) {
        if (db.tags.some((t) => t.name.toLowerCase() === name.toLowerCase()))
          throw Error("UNIQUE constraint failed: song_tags.name");
        const tag = { id: Math.max(0, ...db.tags.map((t) => t.id)) + 1, name };
        db.tags.push(tag);
        return copy(tag);
      },
      async getSongTags(id) {
        return copy(db.tags.filter((t) => db.songTags.get(id)?.has(t.id)));
      },
      async getPlaylistTags(id) {
        return copy(db.tags.filter((t) => db.playlistTags.get(id)?.has(t.id)));
      },
      async bindSongs(tagID, ids) {
        if (!db.tags.some((t) => t.id === tagID)) throw Error("tag not found");
        for (const id of ids) {
          const set = db.songTags.get(id) || new Set();
          set.add(tagID);
          db.songTags.set(id, set);
        }
        return { bound: ids.length };
      },
      async bindPlaylists(tagID, ids) {
        if (!db.tags.some((t) => t.id === tagID)) throw Error("tag not found");
        for (const id of ids) {
          const set = db.playlistTags.get(id) || new Set();
          set.add(tagID);
          db.playlistTags.set(id, set);
        }
        return { bound: ids.length };
      },
    },
    playlists: {
      async list() {
        return copy(db.playlists);
      },
      async getById(id) {
        return copy(db.playlists.find((p) => p.id === id) || null);
      },
      async create(input) {
        if (db.raceName === input.name) {
          db.playlists.push({
            id: id++,
            name: input.name,
            description: "concurrent",
          });
          db.raceName = undefined;
        }
        if (db.playlists.some((p) => p.name === input.name))
          throw Error("playlist with the same name already exists");
        if (db.failNameCreate) throw Error("injected network failure");
        const p = { ...input, id: id++ };
        db.playlists.push(p);
        db.members.set(p.id, []);
        return copy(p);
      },
      async getSongs(id) {
        return (db.members.get(id) || []).map((id) =>
          copy(db.songs.find((s) => s.id === id)),
        );
      },
      async update(id, fields) {
        if (db.playlists.some((p) => p.id !== id && p.name === fields.name))
          throw Error("playlist with the same name already exists");
        const p = db.playlists.find((p) => p.id === id);
        Object.assign(p, fields);
        return copy(p);
      },
      async replaceSongs(id, ids) {
        if (db.failWrite) throw Error("injected write failure");
        db.members.set(id, [...ids]);
      },
    },
  };
  const context = vm.createContext({
    songloft,
    console,
    btoa,
    Date,
    Math,
    Map,
    Set,
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
    __go_crypto_md5(input) {
      return createHash("md5").update(input).digest("hex");
    },
    async fetch(url, options = {}) {
      requests.push({ url, options });
      const parsed = new URL(url);
      const ok = (body) => ({
        ok: true,
        status: 200,
        json: async () => copy(body),
      });
      if (parsed.hostname === "localhost") {
        if (options.method === "PUT") db.settings = JSON.parse(options.body);
        return ok(db.settings);
      }
      if (upstream.fail) throw Error("network failed: " + url);
      if (upstream.block) await upstream.block;
      if (upstream.apiError)
        return ok({
          "subsonic-response": {
            status: "failed",
            error: { code: 40, message: url },
          },
        });
      const name = parsed.pathname.split("/").pop();
      if (name === "getCoverArt")
        return {
          ok: upstream.coverStatus === 200,
          status: upstream.coverStatus,
          headers: new Headers({ "Content-Type": upstream.coverType }),
          arrayBuffer: async () => upstream.cover.buffer,
        };
      let body = { status: "ok" };
      if (name === "getLyricsBySongId")
        body.lyricsList = { structuredLyrics: upstream.lyrics };
      if (name === "getPlaylists")
        body.playlists = { playlist: upstream.playlists };
      if (name === "getStarred2" && !upstream.malformed)
        body.starred2 = { song: upstream.empty ? [] : upstream.starred };
      if (name === "getPlaylist" && !upstream.malformed)
        body.playlist = {
          id: parsed.searchParams.get("id"),
          name: upstream.playlists[0].name,
          songCount: upstream.empty ? 0 : upstream.entries.length,
          entry: upstream.empty ? [] : upstream.entries,
        };
      return ok({ "subsonic-response": body });
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  async function raw(method, path, body) {
    const [pathname, query = ""] = path.split("?");
    return context.onHTTPRequest({
      method,
      path: pathname,
      body: body === undefined ? "" : JSON.stringify(body),
      query,
      headers: {},
    });
  }
  async function call(method, path, body) {
    const response = await raw(method, path, body);
    return {
      status: response.statusCode || 200,
      body: JSON.parse(response.body),
    };
  }
  async function settle() {
    for (let i = 0; i < 200; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!(await call("GET", "/api/state")).body.busy) return;
    }
    throw Error("background sync did not settle");
  }
  async function save(overrides = {}) {
    const res = await call("POST", "/api/connections", {
      name: "家里的音乐",
      url: "https://music.example.test/navidrome",
      username: "listener",
      password: "secret-password",
      automatic: false,
      intervalMinutes: 30,
      selections: [
        { key: "starred", name: "收藏", targetName: "" },
        { key: "playlist:p1", name: "夜间音乐", targetName: "" },
      ],
      ...overrides,
    });
    if (res.status !== 200) throw Error(JSON.stringify(res));
    return res.body;
  }
  async function sync(c) {
    const res = await call("POST", "/api/connections/" + c.id + "/sync", {});
    await settle();
    return res;
  }
  return {
    db,
    upstream,
    songloft,
    requests,
    timers,
    context,
    call,
    raw,
    settle,
    save,
    sync,
  };
}
