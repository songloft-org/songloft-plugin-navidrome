import test from "node:test";
import assert from "node:assert/strict";
import { harness, song } from "./harness.mjs";

const status = async (h, c) =>
  (await h.call("GET", "/api/state")).body.statuses[c.id];
const members = (h, index = 1) =>
  h.db.members
    .get(h.db.playlists[index].id)
    .map(
      (id) => JSON.parse(h.db.songs.find((s) => s.id === id).sourceData).songId,
    );

test("independent sync reuses identities, updates membership and exact remote order, protects unrelated playlists", async () => {
  const h = harness(),
    c = await h.save();
  h.db.playlists.push({ id: 999, name: "私人歌单", description: "unrelated" });
  h.db.members.set(999, []);
  assert.equal((await h.sync(c)).status, 202);
  assert.equal(h.db.songs.length, 2);
  assert.equal(h.db.playlists.length, 3);
  const target = h.db.playlists.find((p) =>
    p.description.endsWith("playlist%3Ap1]"),
  );
  const targetId = target.id;
  h.upstream.entries = [song("c"), song("a")];
  await h.sync(c);
  assert.equal(h.db.playlists.length, 3);
  assert.equal(target.id, targetId);
  assert.equal(h.db.songs.length, 3);
  const ids = h.db.members.get(targetId);
  assert.deepEqual(
    ids.map(
      (id) => JSON.parse(h.db.songs.find((s) => s.id === id).sourceData).songId,
    ),
    ["c", "a"],
  );
  assert.equal(h.db.playlists.find((p) => p.id === 999).name, "私人歌单");
  const s = await status(h, c);
  assert.equal(s.results[1].added, 1);
  assert.equal(s.results[1].removed, 1);
  assert.equal(s.failures, 0);
  assert.ok(s.lastSuccess);
});

test("failures, malformed snapshots and transactional write failures preserve last successful membership", async () => {
  const h = harness(),
    c = await h.save();
  await h.sync(c);
  const original = members(h),
    success = (await status(h, c)).lastSuccess;
  for (const flag of ["fail", "malformed", "apiError"]) {
    h.upstream[flag] = true;
    await h.sync(c);
    h.upstream[flag] = false;
    assert.deepEqual(members(h), original);
    assert.equal((await status(h, c)).lastSuccess, success);
    assert.ok((await status(h, c)).error);
    assert.doesNotMatch(
      JSON.stringify((await h.call("GET", "/api/state")).body),
      /secret-password|[?&]t=|host-plugin-token/,
    );
  }
  h.db.failWrite = true;
  h.upstream.entries = [song("c")];
  await h.sync(c);
  assert.deepEqual(members(h), original);
  h.db.failWrite = false;
  h.upstream.empty = true;
  await h.sync(c);
  assert.deepEqual(members(h), []);
  assert.equal((await status(h, c)).failures, 0);
});

test("restart recovers same playlists even after lost mapping, and keeps duplicate remote songs once", async () => {
  const h = harness(),
    c = await h.save();
  h.upstream.entries = [song("a"), song("a"), song("b")];
  await h.sync(c);
  assert.deepEqual(members(h), ["a", "b"]);
  const stored = JSON.parse(h.db.files.get("state.json"));
  stored.mappings = {};
  h.db.files.set("state.json", JSON.stringify(stored));
  const restarted = harness(h.db);
  await restarted.sync(c);
  assert.equal(h.db.playlists.length, 2);
  assert.equal(h.db.songs.length, 2);
});

test("starred sort is deterministic, names track remote unless overridden, deleting connection preserves songs and playlists", async () => {
  const h = harness();
  h.upstream.starred = [
    song("b"),
    song("a"),
    song("c", { starred: "2026-11-06" }),
  ];
  let c = await h.save();
  await h.sync(c);
  assert.deepEqual(members(h, 0), ["c", "a", "b"]);
  h.upstream.playlists[0].name = "新名字";
  await h.sync(c);
  assert.match(h.db.playlists[1].name, /新名字$/);
  c = await h.save({
    ...c,
    password: "",
    selections: [
      { key: "playlist:p1", name: "新名字", targetName: "自定义名称" },
    ],
  });
  await h.sync(c);
  assert.equal(h.db.playlists[1].name, "自定义名称");
  await h.call("DELETE", "/api/connections/" + c.id);
  assert.equal(h.db.playlists.length, 2);
  assert.equal(h.db.songs.length, 3);
  assert.equal((await h.call("GET", "/api/state")).body.connections.length, 0);
});

test("automatic sync adds only itself to keep-alive, resumes on init, and serializes mutation", async () => {
  const h = harness(),
    c = await h.save({ automatic: true });
  assert.deepEqual(h.db.settings.plugins, ["other", "navidrome"]);
  await h.context.onInit();
  assert.equal(h.timers.length, 1);
  await h.timers.shift().fn();
  await h.settle();
  assert.equal(h.db.playlists.length, 2);
  const future = (await status(h, c)).nextRun;
  assert.ok(future > Date.now());
  let unblock;
  h.upstream.block = new Promise((resolve) => {
    unblock = resolve;
  });
  assert.equal(
    (await h.call("POST", "/api/connections/" + c.id + "/sync", {})).status,
    202,
  );
  assert.equal(
    (await h.call("POST", "/api/connections/" + c.id + "/sync", {})).status,
    409,
  );
  assert.equal(
    (await h.call("DELETE", "/api/connections/" + c.id)).status,
    409,
  );
  unblock();
  await h.settle();
  await h.context.onDeinit();
});

test("playback resolves directly by source IDs and stores no signed stream URLs; passwords stay private", async () => {
  const h = harness(),
    c = await h.save();
  await h.sync(c);
  assert.equal(c.password, undefined);
  assert.equal(c.hasPassword, true);
  assert.ok(
    h.db.songs.every((s) => s.url === "" && !s.sourceData.includes("secret")),
  );
  const response = await h.call("POST", "/api/music/url", {
    source_data: { connectionId: c.id, songId: "a" },
  });
  const url = new URL(response.body.url);
  assert.equal(url.pathname, "/navidrome/rest/stream");
  assert.equal(url.searchParams.get("id"), "a");
  assert.ok(url.searchParams.get("t"));
  assert.equal(url.searchParams.has("p"), false);
  assert.ok(h.requests.every((r) => !r.url.includes("/stream?"))); // sync never requests audio
  const edit = await h.call("POST", "/api/connections", {
    ...c,
    url: "https://other.test",
    password: "",
    selections: [],
  });
  assert.equal(edit.status, 400);
});

test("ownership changes stop sync; obsolete hosts fail before writing; partial successes are independent", async () => {
  const h = harness(),
    c = await h.save();
  await h.sync(c);
  h.db.playlists[1].description = "now owned by user";
  h.upstream.starred = [song("z")];
  await h.sync(c);
  assert.deepEqual(members(h, 0), ["z"]);
  assert.deepEqual(members(h), ["a", "b"]);
  assert.ok((await status(h, c)).results[1].error);
  delete h.songloft.playlists.replaceSongs;
  assert.equal(
    (await h.call("POST", "/api/connections/" + c.id + "/sync", {})).status,
    409,
  );
});

test("preview has no song or playlist side effects and validates incomplete remote entries", async () => {
  const h = harness(),
    c = await h.save();
  const result = await h.call("POST", "/api/connections/" + c.id + "/preview", {
    selections: c.selections,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.previews[1].count, 2);
  assert.equal(h.db.songs.length, 0);
  assert.equal(h.db.playlists.length, 0);
  h.upstream.entries = [{ id: "broken", title: "缺少时长" }];
  await h.sync(c);
  assert.equal(h.db.playlists.length, 1);
  assert.ok((await status(h, c)).results[1].error);
});
