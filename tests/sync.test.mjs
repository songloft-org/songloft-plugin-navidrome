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

test("shared source tags and stable unique favorite names survive restart and manual rename", async () => {
  const h = harness();
  h.db.playlists.push({ id: 900, name: "收藏", description: "built-in" });
  h.db.members.set(900, []);
  const c = await h.save({
    tagName: "家中 NAS",
    selections: [{ key: "starred", name: "收藏", targetName: "" }],
  });
  await h.sync(c);
  const target = h.db.playlists.find((p) => p.id !== 900);
  assert.equal(target.name, "收藏-Navidrome");
  const source = h.db.tags.find((t) => t.name === "Navidrome");
  const connection = h.db.tags.find((t) => t.name === "家中 NAS");
  assert.deepEqual(
    [...h.db.playlistTags.get(target.id)],
    [source.id, connection.id],
  );
  for (const id of h.db.members.get(target.id))
    assert.deepEqual([...h.db.songTags.get(id)], [source.id, connection.id]);
  const second = await h.save({ name: "另一个连接", selections: c.selections });
  await h.sync(second);
  assert.equal(h.db.playlists.at(-1).name, "收藏-Navidrome (2)");
  h.db.playlists.splice(
    h.db.playlists.findIndex((p) => p.id === 900),
    1,
  );
  const restarted = harness(h.db);
  await restarted.sync(c);
  assert.equal(target.name, "收藏-Navidrome");
  target.name = "我的手动名称";
  await restarted.sync(c);
  assert.equal(target.name, "我的手动名称");
  assert.equal(h.db.tags.length, 2);
});

test("only owned legacy defaults migrate; explicit name conflicts preserve playlist membership", async () => {
  const h = harness();
  let c = await h.save({
    selections: [{ key: "starred", name: "收藏", targetName: "" }],
  });
  await h.sync(c);
  const target = h.db.playlists[0];
  const state = JSON.parse(h.db.files.get("state.json"));
  delete state.naming;
  target.name = c.name + " · 收藏";
  h.db.files.set("state.json", JSON.stringify(state));
  const restarted = harness(h.db);
  await restarted.sync(c);
  assert.equal(target.name, "收藏");
  h.db.playlists.push({ id: 999, name: "指定名称", description: "user" });
  c = await restarted.save({
    ...c,
    password: "",
    selections: [{ key: "starred", name: "收藏", targetName: "指定名称" }],
  });
  const before = [...h.db.members.get(target.id)];
  restarted.upstream.starred = [song("new")];
  await restarted.sync(c);
  assert.deepEqual(h.db.members.get(target.id), before);
  assert.equal(target.name, "收藏");
  assert.match((await status(restarted, c)).results[0].error, /同名|存在|占用/);
});

test("automatic naming retries only a confirmed concurrent name conflict and rejects old tag hosts before writes", async () => {
  const h = harness();
  const c = await h.save({
    selections: [{ key: "starred", name: "收藏", targetName: "" }],
  });
  h.db.raceName = "收藏";
  await h.sync(c);
  assert.equal(h.db.playlists.at(-1).name, "收藏-Navidrome");
  const failing = harness();
  const other = await failing.save({ selections: c.selections });
  failing.db.failNameCreate = true;
  await failing.sync(other);
  assert.equal(failing.db.playlists.length, 0);
  assert.equal(failing.db.songs.length, 0);
  delete h.songloft.tags.bindPlaylists;
  assert.equal((await h.sync(c)).status, 409);
});

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
