# #558 local verification

[中文](VERIFICATION.md)

## Identity and environment

- Date: 2026-11-06; Linux amd64, Go 1.26.0, Node 22.17.1, TypeScript and plugin-builder/SDK 2.18.0.
- Parent baseline: `3049574c76431ddefc20dbe9c1adba8bef3212ef` plus this uncommitted worktree.
- Toolchain baseline: `ee0eb8fb473208b3397ec7f16fb71ae4c64c2f9c` plus SDK type changes (dirty; gitlink unchanged).
- Independent plugin: new uncommitted `plugins/src/songloft-plugin-navidrome/` directory. No remote repository or submodule created.
- `/tmp/songloft-558-run/verification-identity.json` records baselines, diffs and plugin file SHA-256 hashes.
- Host: `go build -tags dev,lite -o /tmp/songloft-558 .`, isolated SQLite `/tmp/songloft-558-run/test.db`, port 58258; no daily-use database. Music directory `/home/hanxi/.cache/songloft-558/music`.
- Navidrome fixture: controlled compatible API on port 58259 with synthetic songs and WAV, not a real account. Browser: existing Docker browserless Chrome at 1280px and 390px.

## Results

| Check                                        | Result and evidence                                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CGO_ENABLED=0 go test -tags dev,lite ./...` | Passed; `go-test.log`                                                                                                                                                                                            |
| Same-tag `go vet ./...`                      | Passed; `go-vet.log`                                                                                                                                                                                             |
| Focused race tests                           | Atomic replacement, permissions and bridge input validation passed; `race.log`                                                                                                                                   |
| Real in-memory SQLite regression             | Add/remove/order, invalid/duplicate IDs, rollback, explicit empty clear, built-in protection, missing-array rejection and read-only permission enforcement                                                       |
| Plugin `npm run typecheck`                   | Passed; `plugin-typecheck.log`                                                                                                                                                                                   |
| Plugin `npm test`                            | Nine passed, including built ZIP resource and DOM initialization checks; `plugin-test.log`                                                                                                                       |
| Plugin build / validate / check:format       | Passed; `plugin-validate.log`, `plugin-format-check.log`                                                                                                                                                         |
| SDK build / typecheck                        | Passed; `sdk-build.log`, `sdk-typecheck.log`. The pnpm entry rejected local version 11 versus the repository's 9.15 requirement; package npm scripts completed verification                                      |
| Real QuickJS / SQLite / HTTP                 | Installed bytecode ZIP; starred/playlist reads, membership/order, valid-empty clear, failure preservation, source-ID reuse, keep-alive and password non-disclosure; `http-result.json`                           |
| Audio boundary                               | Fixture recorded no stream requests during sync. Explicit playback resolution then fetched 88,244 bytes of WAV; `http-result.json`                                                                               |
| Real browser                                 | Connection test/save, selection, preview, automatic/manual sync, removal warning and Escape dismissal passed; no page errors or horizontal overflow at 390px; `browser-result.json`, `browser-final-result.json` |
| Theme                                        | Host shared light/dark styles. A simulated host theme message changed button color to `rgb(239, 184, 200)`; `final-light.png`, `final-dark.png`, `final-mobile.png`                                              |
| Backend restart                              | Persisted connections, mappings and source songs reused; `restart-result.json`                                                                                                                                   |

Full local evidence is in `/tmp/songloft-558-run/` and is not published with the source. Initial source-manifest validation failed because build hashes were absent; validation now targets `dist/_build`. Initial browser checks exposed head script timing; a packaged-artifact regression now covers it. The initial permission test mutated the plugin object instead of the permission list copied at construction; the corrected test was followed by a full passing rerun.

No previous implementation exists for this new feature, so reverse Bug validation is not applicable. Rollback was tested by injecting a failure after real repository writes and checking preserved membership.

## Not run and delivery boundaries

- Not run: real Navidrome services/accounts, native Flutter/Lynx WebViews, physical devices or Xiaomi speakers, long-running scheduling and large multi-connection libraries. Fixtures and browser checks do not replace these acceptance checks.
- Not run: full embedded-client build, documentation-site build and remote CI. Changes cover server plugin bridges, SDK types, an independent static plugin and documentation.
- No commit, push, release or Issue comment. Before release, set the minimum host version to the actual release containing the atomic API, create the independent repository and fill update URLs. Temporary local compatibility types remain until the SDK's new types are published.
