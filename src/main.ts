import {
  createRouter,
  createMusicUrlHandler,
  jsonResponse,
  parseQuery,
} from "@songloft/plugin-sdk";
import type { HTTPRequest, HTTPResponse } from "@songloft/plugin-sdk";
import {
  loadState,
  saveState,
  publicConnection,
  validateConnection,
  UserError,
} from "./model";
import type { Connection, State } from "./model";
import { request, catalog, buildUrl, snapshot } from "./client";
import {
  syncConnection,
  safeError,
  hasAtomicPlaylists,
  hasSharedTags,
} from "./sync";
import { marker, plannedName } from "./naming";
import { cover, lyrics } from "./media";

const router = createRouter();
let state: State;
let busy: string | null = null;
let stopped = true;
let timer: ReturnType<typeof setTimeout> | undefined;
async function current(): Promise<State> {
  if (!state) state = await loadState();
  return state;
}
function body(req: HTTPRequest): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(req.body || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw 0;
    return parsed;
  } catch {
    throw new UserError("请求 JSON 无效");
  }
}
async function connection(id: string): Promise<Connection> {
  const c = (await current()).connections.find((c) => c.id === id);
  if (!c) throw new UserError("连接不存在", 404);
  return c;
}
async function exclusive<T>(
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  if (busy) throw new UserError("正在同步或保存，请稍后重试", 409);
  busy = label;
  try {
    return await action();
  } finally {
    busy = null;
  }
}
async function hostRequest(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<any> {
  const base = await songloft.plugin.getHostUrl(),
    token = await songloft.plugin.getToken();
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-Fetch-Timeout-Ms": "10000",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok)
    throw new UserError(
      "无法设置插件常驻，请到主程序的插件常驻设置中启用 Navidrome",
      503,
    );
  return response.json();
}
async function keepAlive(): Promise<void> {
  const cfg = await hostRequest("/settings/plugin-keep-alive");
  if (
    !cfg ||
    !Array.isArray(cfg.plugins) ||
    cfg.plugins.some((s: unknown) => typeof s !== "string")
  )
    throw new UserError("宿主常驻设置响应无效", 503);
  if (!cfg.plugins.includes("navidrome"))
    await hostRequest("/settings/plugin-keep-alive", "PUT", {
      plugins: [...cfg.plugins, "navidrome"],
    });
}
router.get("/api/state", async () => {
  const s = await current();
  return jsonResponse({
    connections: s.connections.map(publicConnection),
    statuses: s.statuses,
    busy,
    atomicSupported: hasAtomicPlaylists() && hasSharedTags(),
  });
});
router.post("/api/connections", async (req) =>
  exclusive("save", async () => {
    const s = await current(),
      input = body(req);
    const old = input.id ? await connection(String(input.id)) : undefined;
    const c = validateConnection(input, old);
    if (!old && s.connections.length >= 20)
      throw new UserError("最多支持 20 个连接");
    await request(c, "ping");
    if (c.automatic) {
      if (!hasAtomicPlaylists() || !hasSharedTags())
        throw new UserError(
          "宿主缺少原子同步或歌单标签接口，请升级到包含 #562 支持的版本",
          409,
        );
      await keepAlive();
    }
    const next = {
      ...s,
      connections: old
        ? s.connections.map((item) => (item.id === c.id ? c : item))
        : [...s.connections, c],
      statuses: { ...s.statuses },
    };
    if (old && !old.automatic && c.automatic)
      next.statuses[c.id] = {
        ...s.statuses[c.id],
        failures: 0,
        nextRun: Date.now(),
        results: s.statuses[c.id]?.results || [],
      };
    await saveState(next);
    state = next;
    return jsonResponse(publicConnection(c));
  }),
);
router.post("/api/test", async (req) => {
  const input = body(req),
    old = input.id ? await connection(String(input.id)) : undefined;
  const c = validateConnection(
    { ...input, automatic: false, selections: [], intervalMinutes: 30 },
    old,
  );
  await request(c, "ping");
  return jsonResponse({ ok: true, playlists: await catalog(c) });
});
router.get("/api/connections/:id/catalog", async (_req, p) =>
  jsonResponse({ playlists: await catalog(await connection(p.id)) }),
);
router.post("/api/connections/:id/preview", async (req, p) => {
  const c = await connection(p.id),
    input = body(req);
  if (!Array.isArray(input.selections) || input.selections.length > 200)
    throw new UserError("同步范围无效");
  const valid = validateConnection(
    { ...c, selections: input.selections, automatic: false },
    c,
  );
  const previews = [];
  const s = await current();
  const playlists = await songloft.playlists.list();
  for (const selection of valid.selections) {
    const remote = await snapshot(c, selection.key);
    const name = plannedName(s, valid, selection, remote.name, playlists);
    previews.push({
      key: selection.key,
      name,
      count: remote.songs.length,
    });
    // Reserve the preview candidate so two selections cannot promise the same name.
    const description = marker(valid, selection);
    const existing = playlists.find((p) => p.description === description);
    if (existing) existing.name = name;
    else
      playlists.push({
        id: -previews.length,
        name,
        description,
      } as (typeof playlists)[number]);
  }
  return jsonResponse({ previews });
});
router.delete("/api/connections/:id", async (_req, p) =>
  exclusive("delete", async () => {
    const s = await current();
    await connection(p.id);
    const next = {
      ...s,
      connections: s.connections.filter((c) => c.id !== p.id),
    };
    await saveState(next);
    state = next;
    return jsonResponse({ retainedPlaylists: true });
  }),
);
async function runSync(c: Connection): Promise<void> {
  await exclusive(c.id, async () => syncConnection(await current(), c));
}
router.post("/api/connections/:id/sync", async (_req, p) => {
  const c = await connection(p.id);
  if (!c.selections.length) throw new UserError("请先保存同步范围");
  if (!hasAtomicPlaylists() || !hasSharedTags())
    throw new UserError(
      "宿主缺少原子同步或歌单标签接口，请升级到包含 #562 支持的版本",
      409,
    );
  if (busy) throw new UserError("正在同步或保存，请稍后重试", 409);
  // Begin now to reserve the lock; the host event pump completes the background promise.
  void runSync(c).catch((e) => songloft.log.error(safeError(e)));
  return jsonResponse({ started: true }, 202);
});
function mediaId(req: HTTPRequest): string {
  const id = parseQuery(req.query).id;
  if (!id) throw new UserError("媒体来源 ID 无效");
  return id;
}
router.get("/media/:connectionId/cover", async (req, p) =>
  cover(await connection(p.connectionId), mediaId(req)),
);
router.get("/media/:connectionId/lyric", async (req, p) =>
  // LyricFetcher consumes the existing plugin lyric envelope.
  jsonResponse({
    code: 0,
    data: {
      lyric: await lyrics(await connection(p.connectionId), mediaId(req)),
    },
  }),
);
router.post(
  "/api/music/url",
  createMusicUrlHandler({
    resolveUrl: async (data) => {
      if (
        typeof data.connectionId !== "string" ||
        typeof data.songId !== "string" ||
        !data.songId
      )
        throw new UserError("歌曲来源无效");
      return buildUrl(await connection(data.connectionId), "stream", {
        id: data.songId,
      });
    },
  }),
);
function schedule(delay: number): void {
  if (!stopped)
    timer = setTimeout(() => {
      void tick();
    }, delay);
}
async function tick(): Promise<void> {
  try {
    if (!busy && !stopped) {
      const s = await current();
      const c = s.connections.find(
        (c) =>
          c.automatic &&
          c.selections.length &&
          (s.statuses[c.id]?.nextRun || 0) <= Date.now(),
      );
      if (c) await runSync(c);
    }
  } catch (e) {
    songloft.log.error(safeError(e));
  } finally {
    schedule(30000);
  }
}
globalThis.onInit = async () => {
  await current();
  stopped = false;
  schedule(3000 + Math.floor(Math.random() * 7000));
};
globalThis.onDeinit = async () => {
  stopped = true;
  if (timer !== undefined) clearTimeout(timer);
};
globalThis.onHTTPRequest = async (req: HTTPRequest): Promise<HTTPResponse> => {
  try {
    return await router.handle(req);
  } catch (e) {
    return jsonResponse(
      { error: e instanceof UserError ? e.message : safeError(e) },
      e instanceof UserError ? e.status : 502,
    );
  }
};
