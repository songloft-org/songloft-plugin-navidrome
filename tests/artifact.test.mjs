import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";

test("the installable archive resolves every local asset and defers UI bootstrap until DOM readiness", async () => {
  const zip = await JSZip.loadAsync(
    readFileSync("dist/navidrome.jsplugin.zip"),
  );
  const manifest = JSON.parse(await zip.file("plugin.json").async("string"));
  assert.equal(manifest.entryPath, "navidrome");
  assert.ok(zip.file(manifest.main));
  assert.match(manifest.entryHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.zipHash, /^[a-f0-9]{64}$/);
  const html = await zip.file("static/index.html").async("string");
  const scripts = [];
  for (const match of html.matchAll(/(?:href|src)="(static\/[^"#?]+)"/g)) {
    const file = zip.file(match[1]);
    assert.ok(file, "missing packaged asset: " + match[1]);
    if (match[1].endsWith(".js")) scripts.push(await file.async("string"));
  }
  assert.ok(scripts.length > 0);
  let ready;
  const context = vm.createContext({
    document: {
      readyState: "loading",
      addEventListener(name, callback) {
        assert.equal(name, "DOMContentLoaded");
        ready = callback;
      },
      getElementById() {
        throw Error("UI accessed DOM before it existed");
      },
    },
  });
  for (const script of scripts) vm.runInContext(script, context);
  assert.equal(typeof ready, "function");
});
