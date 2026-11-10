# #562: Source tags and unique playlist names

2026-11-11, baseline `04d87b0d79c880d1e648d056375a680e97d78802`, uncommitted. Defaults use the remote name, then `-Navidrome`, then ` (2)` on conflict. Persist naming mode/request alongside identity mappings. Verified legacy defaults migrate; manual names and IDs survive. Explicit-name conflicts fail before changing membership. Source and optional connection tags bind both imported songs and playlists; missing host support stops before writes.

`npm run typecheck`, `npm test` (29 tests), `npm run validate`, `npm run check:format` pass. Added conflict/race, restart/manual-name, legacy migration, old-host rejection and shared-tag tests. Actual built-page Chrome accepts, submits and restores “Home NAS” against a fixture API without page errors. Evidence: `/tmp/songloft-562-implementation/nav-mobile.png/json`.

A new real Navidrome + QuickJS end-to-end run and native-device acceptance: Not run. No commit, push, release or Issue write. Central parent record: `docs/en/issue-562-verification.md`.
