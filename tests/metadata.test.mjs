import test from "node:test";
import assert from "node:assert/strict";
import { harness, song } from "./harness.mjs";

const route = (url) => url.replace("/api/v1/jsplugin/navidrome", "");
const media = (c, kind, id) =>
  `/media/${encodeURIComponent(c.id)}/${kind}?id=${encodeURIComponent(id)}`;

test("resync backfills album, cover and lyric references on existing song IDs without fetching audio or media", async () => {
  const h = harness(),
    c = await h.save();
  await h.sync(c);
  const ids = h.db.songs.map((s) => s.id);
  // Simulate records imported before metadata support.
  for (const s of h.db.songs) {
    s.album = "";
    delete s.coverUrl;
    delete s.lyricRemoteUrl;
  }
  h.upstream.starred = [song("a", { album: "专辑甲", coverArt: "al-123" })];
  h.upstream.entries = [
    song("a", { album: "专辑甲", coverArt: "al-123" }),
    song("b", { album: "专辑乙" }),
  ];
  await h.sync(c);
  assert.deepEqual(
    h.db.songs.map((s) => s.id),
    ids,
  );
  assert.equal(h.db.songs[0].album, "专辑甲");
  assert.equal(h.db.songs[1].album, "专辑乙");
  assert.equal(
    route(h.db.songs[0].coverUrl || ""),
    media(c, "cover", "al-123"),
  );
  assert.equal(h.db.songs[1].coverUrl, "");
  for (const [i, id] of ["a", "b"].entries()) {
    assert.equal(
      route(h.db.songs[i].lyricRemoteUrl || ""),
      media(c, "lyric", id),
    );
  }
  assert.ok(
    h.requests.every(
      (r) => !/\/(stream|getLyricsBySongId|getCoverArt)\?/.test(r.url),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(h.db.songs),
    /secret-password|[?&](t|s|u)=/,
  );
});

test("lyrics use exact song ID and prefer synced lyrics, applying millisecond offset once", async () => {
  const h = harness(),
    c = await h.save();
  h.upstream.lyrics = [
    { synced: false, line: [{ value: "同名歌曲不应搜索" }] },
    {
      synced: true,
      offset: 100,
      line: [
        { start: 0, value: "第一行" },
        { start: 61234, value: "第二行" },
      ],
    },
  ];
  const r = await h.call("GET", media(c, "lyric", "exact-id"));
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0); // Host LyricFetcher requires this envelope.
  assert.equal(r.body.data.lyric, "[00:00.000]第一行\n[01:01.134]第二行");
  const url = new URL(h.requests.at(-1).url);
  assert.equal(url.searchParams.get("id"), "exact-id");
  assert.equal(url.pathname, "/navidrome/rest/getLyricsBySongId");
  assert.equal(url.searchParams.has("artist"), false);
});

test("plain embedded lyrics, negative offsets and no-lyrics responses are supported", async () => {
  const h = harness(),
    c = await h.save();
  const path = media(c, "lyric", "a");
  h.upstream.lyrics = [
    { synced: false, line: [{ value: "中文歌词" }, { value: "第二行" }] },
  ];
  assert.equal(
    (await h.call("GET", path)).body.data?.lyric,
    "中文歌词\n第二行",
  );
  h.upstream.lyrics = [
    { synced: true, offset: -250, line: [{ start: 1000, value: "歌词" }] },
  ];
  assert.equal((await h.call("GET", path)).body.data?.lyric, "[00:01.250]歌词");
  h.upstream.lyrics = [];
  assert.equal((await h.call("GET", path)).body.data?.lyric, "");
});

test("cover proxy returns exact binary bytes and no authenticated redirects; credentials resolve after restart/edit", async () => {
  const h = harness(),
    c = await h.save();
  const edited = await h.save({ ...c, password: "new-password" });
  const restarted = harness(h.db);
  const r = await restarted.raw("GET", media(edited, "cover", "al-123"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "image/png");
  assert.equal(r.headers.Location, undefined);
  assert.deepEqual(
    Array.from(h.db.files.get(r.serveFile.filePath)),
    Array.from(h.upstream.cover),
  );
  const url = new URL(restarted.requests.at(-1).url);
  const { createHash } = await import("node:crypto");
  assert.equal(
    url.searchParams.get("t"),
    createHash("md5")
      .update("new-password" + url.searchParams.get("s"))
      .digest("hex"),
  );
  assert.equal(url.searchParams.get("id"), "al-123");
});

test("metadata errors stay private, reject non-image responses, and never damage sync membership", async () => {
  const h = harness(),
    c = await h.save();
  await h.sync(c);
  const before = JSON.stringify([...h.db.members]);
  h.upstream.coverType = "application/json";
  assert.equal((await h.call("GET", media(c, "cover", "a"))).status, 502);
  h.upstream.coverType = "image/png";
  h.upstream.coverStatus = 404;
  assert.equal((await h.call("GET", media(c, "cover", "a"))).status, 404);
  h.upstream.apiError = true;
  const failed = await h.call("GET", media(c, "lyric", "a"));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(
    JSON.stringify(failed),
    /secret-password|https?:|[?&](t|s|u)=/,
  );
  assert.equal(JSON.stringify([...h.db.members]), before);
  const calls = h.requests.length;
  assert.equal(
    (await h.call("GET", media({ id: "removed" }, "cover", "a"))).status,
    404,
  );
  assert.equal(h.requests.length, calls);
});

test("opaque media IDs are decoded once and remain isolated query parameters", async () => {
  const h = harness(),
    c = await h.save();
  const id = "al-%2F &?中文";
  const r = await h.raw("GET", media(c, "cover", id));
  assert.equal(r.statusCode, 200);
  assert.equal(new URL(h.requests.at(-1).url).searchParams.get("id"), id);
});

test("parallel cover requests coalesce and failed file replacement preserves previous bytes", async () => {
  const h = harness(),
    c = await h.save();
  const path = media(c, "cover", "a");
  const first = await h.raw("GET", path);
  const original = h.db.files.get(first.serveFile.filePath);
  h.upstream.cover = new Uint8Array([1, 2, 3]);
  h.db.failFileRename = true;
  assert.equal((await h.call("GET", path)).status, 502);
  assert.deepEqual(h.db.files.get(first.serveFile.filePath), original);
  assert.ok([...h.db.files.keys()].every((key) => !key.endsWith(".tmp")));
  h.db.failFileRename = false;
  let unblock;
  h.upstream.block = new Promise((resolve) => {
    unblock = resolve;
  });
  const before = h.requests.length;
  const responses = [h.raw("GET", path), h.raw("GET", path)];
  await new Promise((resolve) => setImmediate(resolve));
  unblock();
  const [a, b] = await Promise.all(responses);
  assert.equal(a.serveFile.filePath, b.serveFile.filePath);
  assert.equal(h.requests.length, before + 1);
  assert.deepEqual(Array.from(h.db.files.get(a.serveFile.filePath)), [1, 2, 3]);
});

test("invalid or empty lyric tracks do not hide a usable track", async () => {
  const h = harness(),
    c = await h.save();
  h.upstream.lyrics = [
    null,
    { synced: true, line: [{ start: -1, value: "invalid" }] },
    { synced: true, line: [{ start: 0, value: "" }] },
    { synced: false, line: [{ value: "可用内嵌歌词" }] },
  ];
  assert.equal(
    (await h.call("GET", media(c, "lyric", "a"))).body.data?.lyric,
    "可用内嵌歌词",
  );
});
