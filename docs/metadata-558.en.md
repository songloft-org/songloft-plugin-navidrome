# #558 song metadata fix verification

[中文](metadata-558.md)

## Problem and implementation

Report: [songloft-org/songloft#558](https://github.com/songloft-org/songloft/issues/558#issuecomment-6729699499). The old plugin wrote no cover/lyric references and had no embedded-lyric endpoint. It did not modify audio files. Album names were already mapped and present in the real test files with the old plugin; not every reported symptom was reproduced.

Sync now stores credential-free internal media paths. Lyrics call [getLyricsBySongId](https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/) using original song IDs, supporting plain/synchronized lyrics and preferring valid synchronized tracks. Following [offset semantics](https://opensubsonic.netlify.app/docs/responses/structuredlyrics/), positive offsets move lyrics earlier and negative offsets later, preserving milliseconds. Covers use `coverArt` IDs and common bitmap types only. The added `fs` permission enables atomic writes inside the plugin directory and host `serveFile` responses, avoiding binary corruption and credential-bearing redirects. Parallel requests for a cover are coalesced.

Existing host upserts deduplicate by source and refresh albums/media references. Resyncing after upgrade backfills existing remote songs while preserving song and playlist identities. No host or SDK changes were needed; sync still disables audio probing.

## Target and results

- Date: 2026-11-09; Linux amd64, Node 22.17.1, Go 1.26.0, FFmpeg 5.1.9, SDK/Builder 2.18.0.
- Plugin: `songloft-org/songloft-plugin-navidrome@d4eb52b06eb1d548810dceee99ab4985909aced8` plus the uncommitted working tree; final diff identity `/tmp/songloft-558-metadata/verification-identity.json`.
- Host: `songloft-org/songloft@3c1c93a91d004e467855352a08b49af222057532`, built with `go build -tags dev,lite -o /tmp/songloft-558-metadata/server .`; isolated temporary SQLite, HTTP 58268, no daily data access.
- Real Navidrome 0.64.2 (`10114574`), pinned image `deluan/navidrome@sha256:38dc2727bfcfd5ede290f8ada114fc90368146f265ae4701ddddbcbe2a44ee52`; isolated data and HTTP 58269. FFmpeg generated two FLAC files with embedded images and plain-text/LRC lyrics. These are not the reporter's account or audio files.

All evidence below is under `/tmp/songloft-558-metadata/`:

| Check                                    | Result / log                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated old implementation              | Only new tests/harness copied into the baseline archive; eight failures on missing media references/routes; `baseline-final.log`                                                  |
| New metadata regressions                 | Eight pass: backfill, albums, lyric offsets/absence, credential edits/reload, ID encoding, error isolation, coalescing and failed atomic replacement preservation; `metadata.log` |
| `npm test`                               | One artifact, eight sync, eight metadata and nine release tests, 26 total pass; `tests.log` (Node's runner summarizes four files)                                                 |
| `npm run typecheck` / `npm run validate` | Pass; `typecheck.log` / `validate.log`                                                                                                                                            |
| format / check:format / diff --check     | Pass; `format.log` / `format-check.log`                                                                                                                                           |
| Old ZIP → new package → resync           | Real QuickJS/SQLite preserve song IDs; host `/songs/{id}/lyric` and `/songs/{id}/cover` return successfully; `integration-result.json`, `before-rows.json`                        |
| Final-package restart                    | Albums, plain/synchronized lyrics, images and identities pass; `restart-result.json`, `host/restart-final.log`                                                                    |
| Image integrity                          | Host output equals Navidrome `getCoverArt(size=600)` byte for byte, without Location; 189 bytes, SHA-256 `9c265bed01bcb0c467d7db2eaf68455758ca6a8d2b7f0fa0a6e0815cd12b060e`       |

The temporary script is `integration.py`; logs/scripts are not shipped. The separate pprof port was occupied, so pprof did not start; business HTTP verification was unaffected. The temporary host/container were stopped afterward; evidence remains.

## Boundaries and delivery

- Not run: the reporter's version/account/files, other Navidrome versions, native clients/speakers, browser rendering, long-running or large-library checks. Older servers without `getLyricsBySongId` return a lyric retrieval error. The reporter's missing album names remain to be investigated.
- Not run: full backend tests/vet, full frontend/documentation builds or remote CI. Only plugin code, tests and bilingual documentation changed; the host dev,lite build and real HTTP integration ran.
- No commits, pushes, releases or Issue replies. The version remains unchanged until automated release assigns one; a local ZIP is not an online update. The parent submodule remains dirty without a fabricated pointer.
- Suggested commit: `fix(navidrome): 补齐同步歌曲封面和内嵌歌词`, with `Ref songloft-org/songloft#558` in the body.
