/* Host-injected public client SDK handles authentication, base paths, and theme changes. */
function start() {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = window.SongloftPlugin;
  const prefix = "";
  let state = {
    connections: [],
    statuses: {},
    busy: null,
    atomicSupported: true,
  };
  let selected = null;
  let catalog = [];
  let draftSelections = [];
  let working = false;
  let catalogVersion = 0;
  let editing = false;
  function message(text, error = false) {
    $("message").textContent = text;
    $("message").classList.toggle("error", error);
    $("message").hidden = !text;
  }
  const get = (path) => api.apiGet(prefix + path);
  const post = (path, data) => api.apiPost(prefix + path, data);
  const current = () => state.connections.find((c) => c.id === selected);
  function text(tag, value, className) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  function icon(name) {
    const el = text("span", name, "material-symbols-outlined");
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  function date(value) {
    return value ? new Date(value).toLocaleString() : "尚无记录";
  }
  async function act(fn) {
    if (working) return;
    working = true;
    setControls();
    try {
      await fn();
    } catch (e) {
      message(e.message || "请求失败，请稍后重试", true);
    } finally {
      working = false;
      setControls();
    }
  }
  function setControls() {
    const hasConnection = !!current(),
      blocked = working || !!state.busy;
    $("connection-form")
      .querySelectorAll("button")
      .forEach((b) => {
        b.disabled = blocked;
      });
    $("new-connection").disabled = blocked;
    $("reload-catalog").disabled = blocked || !hasConnection;
    $("schedule-fields").disabled = blocked || !hasConnection;
    $("scope-list")
      .querySelectorAll("input")
      .forEach((i) => {
        i.disabled = blocked;
      });
    $("sync-now").disabled =
      blocked ||
      !hasConnection ||
      !current().selections.length ||
      !state.atomicSupported;
    $("save-scope").disabled = blocked || !state.atomicSupported;
  }
  function renderTabs() {
    $("connections").replaceChildren();
    state.connections.forEach((c) => {
      const button = text(
        "button",
        c.name,
        "chip" + (selected === c.id ? " selected" : ""),
      );
      button.type = "button";
      button.setAttribute("aria-pressed", String(selected === c.id));
      button.disabled = working;
      button.onclick = () => {
        void act(async () => {
          if (editing && !window.confirm("放弃尚未保存的修改？")) return;
          await choose(c.id);
        });
      };
      $("connections").append(button);
    });
  }
  function readSelections() {
    return [...$("scope-list").querySelectorAll(".scope-item")]
      .filter((row) => row.querySelector("input[type=checkbox]").checked)
      .map((row) => ({
        key: row.dataset.key,
        name: row.dataset.name,
        targetName: row.querySelector("input[type=text]").value.trim(),
      }));
  }
  function renderScope() {
    const root = $("scope-list");
    root.replaceChildren();
    if (!current()) {
      root.append(
        text("div", "先保存一个服务器连接，再选择收藏和歌单。", "empty-state"),
      );
      return;
    }
    const entries = [
      { key: "starred", name: "收藏歌曲", count: null },
      ...catalog.map((p) => ({
        key: "playlist:" + p.id,
        name: p.name,
        count: p.songCount,
      })),
    ];
    // Keep selected remote playlists visible when a refresh no longer returns them.
    draftSelections.forEach((s) => {
      if (!entries.some((p) => p.key === s.key))
        entries.push({
          key: s.key,
          name: s.name + "（远端未返回）",
          count: null,
        });
    });
    entries.forEach((item, index) => {
      const chosen = draftSelections.find((s) => s.key === item.key);
      const row = document.createElement("div");
      row.className = "scope-item";
      row.dataset.key = item.key;
      row.dataset.name = item.key === "starred" ? "收藏" : item.name;
      const label = document.createElement("label");
      label.className = "scope-check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!chosen;
      check.id = "scope-" + index;
      label.append(check, text("span", item.name));
      if (item.count !== null)
        label.append(text("span", item.count + " 首", "count"));
      const field = document.createElement("div");
      field.className = "text-field";
      field.hidden = !check.checked;
      const input = document.createElement("input");
      input.type = "text";
      input.id = "target-" + index;
      input.placeholder = " ";
      input.maxLength = 200;
      input.value = chosen?.targetName || "";
      const fieldLabel = text("label", "目标名称（留空跟随远端）");
      fieldLabel.htmlFor = input.id;
      field.append(input, fieldLabel);
      row.append(label, field);
      root.append(row);
      check.onchange = () => {
        field.hidden = !check.checked;
        editing = true;
        $("preview").hidden = true;
      };
      input.oninput = () => {
        editing = true;
        $("preview").hidden = true;
      };
    });
  }
  function renderStatus() {
    const status = state.statuses[selected];
    $("status-title").textContent =
      state.busy === selected
        ? "正在同步…"
        : status?.error
          ? "部分同步失败"
          : status?.lastSuccess
            ? "同步完成"
            : "等待首次同步";
    const lines = [];
    if (status) {
      lines.push(
        "最近尝试：" + date(status.lastAttempt),
        "最近全部成功：" + date(status.lastSuccess),
      );
      if (current()?.automatic && status.nextRun)
        lines.push("下次同步：" + date(status.nextRun));
      if (status.error) lines.push(status.error);
    } else lines.push("保存同步范围后，即可开始同步。");
    $("sync-status").textContent = lines.join("\n");
    if (
      !state.busy &&
      status?.lastAttempt &&
      ["设置已保存，正在后台同步。", "已开始同步。"].includes(
        $("message").textContent,
      )
    ) {
      message(
        status.error ? "同步完成，部分歌单失败，请查看详情。" : "同步已完成。",
        !!status.error,
      );
    }
    $("sync-results").replaceChildren();
    (status?.results || []).forEach((result) => {
      const row = document.createElement("div");
      row.className = "result-row";
      const title = text(
        "div",
        "",
        "result-title" + (result.error ? " failed" : ""),
      );
      title.append(
        icon(result.error ? "error_outline" : "check_circle"),
        text("span", result.name),
      );
      row.append(
        title,
        text(
          "p",
          result.error ||
            result.count +
              " 首 · 新增 " +
              result.added +
              " · 移除 " +
              result.removed,
          "help",
        ),
      );
      if (result.lastSuccess)
        row.append(text("p", "最近成功：" + date(result.lastSuccess), "help"));
      $("sync-results").append(row);
    });
    $("compatibility").hidden = state.atomicSupported;
    setControls();
  }
  async function refresh() {
    state = await get("/api/state");
    renderTabs();
    renderStatus();
  }
  async function choose(id) {
    selected = id;
    catalog = [];
    editing = false;
    catalogVersion++;
    const c = current();
    draftSelections = structuredCloneSafe(c?.selections || []);
    $("connection-name").value = c?.name || "";
    $("server-url").value = c?.url || "";
    $("server-url").readOnly = !!c;
    $("username").value = c?.username || "";
    $("username").readOnly = !!c;
    $("password").value = "";
    $("password").required = !c;
    $("password-help").textContent = c
      ? "密码已保存，留空保持原密码。"
      : "认证信息仅保存在服务器端。";
    $("identity-help").textContent = c
      ? "更换服务器或账号请添加新连接，避免混用歌曲 ID。"
      : "例如 https://music.example.com，支持子路径。";
    $("automatic").checked = c?.automatic || false;
    $("interval").value = c?.intervalMinutes || 30;
    $("delete-connection").hidden = !c;
    $("preview").hidden = true;
    renderTabs();
    renderScope();
    renderStatus();
    if (c) await loadCatalog();
  }
  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }
  async function loadCatalog() {
    const id = selected,
      version = ++catalogVersion;
    try {
      const data = await get(
        "/api/connections/" + encodeURIComponent(id) + "/catalog",
      );
      if (id !== selected || version !== catalogVersion) return;
      draftSelections = readSelections();
      catalog = data.playlists;
      renderScope();
    } catch (e) {
      message("读取歌单失败：" + e.message + "。已保留现有选择。", true);
    }
  }
  function connectionInput() {
    const c = current();
    return {
      id: c?.id,
      name: $("connection-name").value.trim(),
      url: $("server-url").value.trim(),
      username: $("username").value.trim(),
      password: $("password").value,
      automatic: c?.automatic || false,
      intervalMinutes: c?.intervalMinutes || 30,
      selections: c?.selections || [],
    };
  }
  $("connection-form").onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      const saved = await post("/api/connections", connectionInput());
      await refresh();
      await choose(saved.id);
      message("连接已保存。选择收藏或歌单后即可同步。");
    });
  };
  $("test-connection").onclick = () => {
    if (!$("connection-form").reportValidity()) return;
    void act(async () => {
      const data = await post("/api/test", connectionInput());
      message("连接成功，发现 " + data.playlists.length + " 个歌单。");
    });
  };
  $("new-connection").onclick = () => {
    void act(async () => {
      if (editing && !window.confirm("放弃尚未保存的修改？")) return;
      await choose(null);
      message("");
      $("connection-name").focus();
    });
  };
  $("reload-catalog").onclick = () => {
    void act(loadCatalog);
  };
  $("preview-button").onclick = () => {
    void act(async () => {
      const data = await post(
        "/api/connections/" + encodeURIComponent(selected) + "/preview",
        { selections: readSelections() },
      );
      $("preview").textContent = data.previews.length
        ? data.previews.map((p) => p.name + " · " + p.count + " 首").join("\n")
        : "未选择同步内容；保存后将停止同步，保留现有歌单。";
      $("preview").hidden = false;
    });
  };
  $("scope-form").onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      const c = current(),
        selections = readSelections();
      await post("/api/connections", {
        ...c,
        automatic: $("automatic").checked,
        intervalMinutes: Number($("interval").value),
        selections,
      });
      editing = false;
      draftSelections = selections;
      await refresh();
      if (selections.length) {
        await post(
          "/api/connections/" + encodeURIComponent(selected) + "/sync",
          {},
        );
        message("设置已保存，正在后台同步。");
        await refresh();
      } else message("设置已保存，原有歌单已保留。");
    });
  };
  $("sync-now").onclick = () => {
    void act(async () => {
      await post(
        "/api/connections/" + encodeURIComponent(selected) + "/sync",
        {},
      );
      await refresh();
      message("已开始同步。");
    });
  };
  function closeDialog() {
    $("remove-dialog").classList.remove("open");
    $("delete-connection").focus();
  }
  $("delete-connection").onclick = () => {
    $("remove-dialog").classList.add("open");
    $("cancel-remove").focus();
  };
  $("cancel-remove").onclick = closeDialog;
  $("confirm-remove").onclick = () => {
    void act(async () => {
      await api.apiDelete(
        prefix + "/api/connections/" + encodeURIComponent(selected),
      );
      closeDialog();
      await refresh();
      await choose(state.connections[0]?.id || null);
      message("连接已移除，原有歌单和歌曲已保留。");
    });
  };
  document.addEventListener("keydown", (e) => {
    if (!$("remove-dialog").classList.contains("open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
    }
    if (e.key === "Tab") {
      const first = $("cancel-remove"),
        last = $("confirm-remove");
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  $("connection-form").addEventListener("input", () => {
    editing = true;
  });
  $("schedule-fields").addEventListener("input", () => {
    editing = true;
  });
  window.addEventListener("beforeunload", (e) => {
    if (editing) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  async function poll() {
    if (!document.hidden && !working) {
      try {
        await refresh();
      } catch {
        /* Preserve the current editor and last known status. */
      }
    }
    setTimeout(poll, 3000);
  }
  void act(async () => {
    if (!api)
      throw new Error("主程序公共资源未加载，请从 Songloft 打开插件页面");
    await refresh();
    await choose(state.connections[0]?.id || null);
    setTimeout(poll, 3000);
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
