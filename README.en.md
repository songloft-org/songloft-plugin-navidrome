# Navidrome Sync

An independent Songloft plugin that continuously mirrors Navidrome starred songs and selected playlists into regular Songloft playlists. It owns connections, authentication, playback resolution and background jobs. Neither the Subsonic nor MIoT plugin is required. It uses Navidrome's Subsonic-compatible API.

[中文](README.md)

## Setup and use

1. Upload `dist/navidrome.jsplugin.zip` to Songloft and open the plugin page.
2. Enter a connection name, Navidrome base URL, username and password. Reverse-proxy subpaths work; do not append `/rest`. Test and save the connection.
3. Select starred songs and playlists. Optional target names override the remote playlist name. Conflicts allocate “name-Navidrome”, then “name-Navidrome (2)”. Explicit conflicting names report an error. Preview, then save and sync.
4. Enable automatic sync if desired: 5–10080 minutes, default 30. Enabling preserves other keep-alive entries and adds `navidrome` to the host's keep-alive list. Disabling does not remove that entry, which may serve other connections.
5. Play the regular playlists from Songloft. Speakers can reuse them; dedicated voice commands are outside this plugin's scope.

The page directly uses host-injected `theme.css`, `components.css` and the `SongloftPlugin` client API. Typography, colors, buttons, inputs, switches, cards and light/dark themes follow the host. Desktop uses two columns; mobile uses one. Host styles are not copied.

## Host compatibility

**Requires a build containing the host changes for songloft-org/songloft#558 and songloft-org/songloft#562.** The existing 2.13.9 release lacks `playlists.replaceSongs` and `songs.create(..., {probeMetadata: false})`. The plugin checks atomic sync and shared playlist-tag methods. Older hosts can configure and test connections but cannot sync; there is no destructive multi-step fallback.

The manifest specifies `2.13.10`, the next planned stable host version containing these APIs; this work does not publish a stable host release. This field is compatibility information, not a replacement for runtime checks. Development hosts containing the APIs can be used.

## Automated releases

Following MIoT, non-documentation main commits release in order using Beijing-time `YYYY.M.D.N`, starting at `.0` daily. Markdown/docs-only commits do not release or consume a revision. Failed checks retain queue position; reruns recover. Releases record the source SHA, and the root manifest receives real download URLs and package hashes. A repository without tags can bootstrap from its root commit. See [release rules](docs/releases.en.md).

## Shared source tags and names

Each sync resolves the shared `Navidrome` tag and an optional connection tag (for example, “Home NAS”), then binds them to the target playlists and imported songs. Existing custom tags and system labels survive. Tag browsing separates playlists and songs. The host must expose `tags.bindPlaylists`; older hosts stop before writing.

Names stay globally unique. Once allocated, a name stays stable across restarts and when a shorter candidate becomes available. Manual host renames survive while naming configuration is unchanged. Only a verified owned legacy default “connection · remote name” migrates, preserving IDs and source markers. Preview uses the same allocator. Concurrent automatic-name conflicts retry; other errors stop the sync.

[Local #562 verification](docs/issue-562.en.md).

## Sync behavior

- One-way: Navidrome controls managed membership and order. Local membership edits are overwritten on the next sync.
- Starred songs sort by starred time descending, then song ID ascending. Playlists retain remote order. Songloft requires unique members, so only the first occurrence of a repeated remote song is retained.
- Stable connection IDs and remote song/playlist IDs identify records; names are not identities. Songs are reused across playlists within a connection and isolated across connections. Changing servers or accounts requires a new connection.
- Complete remote snapshots are fetched and validated before changing target membership. Remote failures, malformed responses and incomplete song metadata preserve membership. A valid empty response clears it. Membership and order are replaced in one transaction and rolled back on failure.
- Each playlist succeeds or fails independently. The page shows last attempt, last fully successful sync, per-playlist last success, added/removed counts and errors.
- Repeated syncs and restarts reuse playlists. A source marker in the description recovers a successful creation whose mapping was not saved. Deleted target playlists are recreated on the next sync; edited source markers stop updates to protect repurposed playlists.
- Pausing, deselecting, removing connections and deleted remote playlists preserve local playlists and global song records. Removing a connection prevents its remote songs from resolving; the page explains this before removal.
- Sync jobs and configuration writes are serialized; conflicts return 409. Due jobs are checked every 30 seconds and resume after a randomized 3–10 second startup delay. Retries back off up to six hours or the user's longer configured interval.
- Sync imports titles, artists, album names and cover/lyric references, explicitly disabling automatic host audio probing. It never fetches audio files. Playback resolves original song IDs without searching other platforms.
- Covers are fetched server-side using Navidrome's `coverArt` ID. Lyrics use the original song ID through `getLyricsBySongId`, supporting embedded plain text and synchronized lyrics, preferring valid synchronized tracks and applying millisecond offsets. Navidrome must provide this lyric API; there is no title-based substitute search. Missing album names or covers are not guessed.
- After updating the plugin, run “Sync now” once to backfill references and refresh album names on existing remote records. No playlist deletion or reimport is needed; song and playlist IDs remain stable. Covers and lyrics are fetched on demand; retrieval failures do not change synced membership.
- Credentials stay in server-side plugin storage; passwords are not returned to the page. Songs contain source IDs and credential-free internal media paths. The `fs` permission stores covers in the plugin's own data directory; the host returns original image bytes without redirecting clients to authenticated URLs. Repeated requests reuse the cover file and replace it atomically. Uninstallation follows the host's storage lifecycle. Do not publish the plugin data directory.

Initial limits: 20 connections and 200 sync targets per connection. Navidrome must provide valid audio durations; missing duration or video entries fail the affected playlist while preserving existing members.

## Development and verification

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate
npm run check:format
```

Generated with `npx create-songloft-plugin@latest`, Vanilla + static. Validation checks the built manifest. The archive includes QuickJS bytecode. Until the public SDK includes the new types, `sync.ts` provides temporary compatibility types for these two APIs; host implementations and official SDK types are maintained in the parent repository/toolchain.

Behavior tests use controlled Navidrome responses and host interfaces. Real QuickJS/SQLite/browser coverage and screenshots are documented in [Verification](VERIFICATION.en.md). Actual Navidrome accounts, native devices and speakers require separate acceptance checks.

The embedded lyric, album and cover fix was verified with an isolated real Navidrome 0.64.2 instance and synthetic FLAC files, including an old-plugin upgrade, backfilling existing records and host restart. See [metadata verification](docs/metadata-558.en.md). The reporter's server version, private library and native clients still require acceptance testing.

Related request: [songloft-org/songloft#558](https://github.com/songloft-org/songloft/issues/558).
