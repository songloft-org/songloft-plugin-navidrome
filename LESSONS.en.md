# Development lessons

[中文](LESSONS.md)

## UI-001: Verify script timing in the packaged page

- Scope: Vanilla static pages and plugin-builder 2.18.0, initial development worktree.
- Evidence: On 2026-11-06 the source head script used `defer`, but built HTML merged it into a script without `defer`. The initial real-browser operation timed out and the remote fixture received no requests.
- Rule: Check `document.readyState` explicitly and bind elements after DOMContentLoaded. Source script attributes do not replace artifact verification.
- Done right: `tests/artifact.test.mjs` runs the actual ZIP's script against a loading document and fails on early element access. Docker Chrome then completed setup, preview, sync, light/dark theme and 390px interactions. See `VERIFICATION.en.md` for evidence.
- Seen 1× (2026-11-06). Status: Local implementation and artifact verification passed; unpublished.

## MEDIA-001: Sync references must cover lyrics, images and existing-record backfill

- Scope: Navidrome sync and host media consumption; songloft-org/songloft#558, plugin baseline `d4eb52b06eb1d548810dceee99ab4985909aced8`.
- Evidence: missing lyrics/images reported on 2026-11-09. The old plugin sent text metadata without media references. All eight new regressions fail against isolated old code; synthetic FLAC files in real Navidrome 0.64.2 also lack cover/lyric references after old-plugin import. Albums were already correct; not every reported symptom has the same proven cause.
- Rule: tags scanned by Navidrome are not automatically readable by Songloft. Sync needs credential-free references, original IDs for media retrieval and verification of existing records after old-package upgrade. The SDK's Uint8Array response type does not establish binary-image support in the host string channel.
- Done right: old ZIP → fixed package → resync → host restart preserve song IDs and return albums, plain/synchronized lyrics and byte-identical covers through real QuickJS/SQLite/HTTP; eight regressions turn green. Covers use plugin-local `fs`, coalescing and atomic replacement; lyrics retain milliseconds and offset direction. Evidence and Not run items are in [verification](docs/metadata-558.en.md).
- Seen 1× (2026-11-09). Status: local fix and verification, no commit/push/release. The reporter's environment and missing album names remain unverified.
