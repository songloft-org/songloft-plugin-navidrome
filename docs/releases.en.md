# Automated releases

[中文](releases.md)

This plugin uses **Beijing-time `YYYY.M.D.N`** for plugins, for example `2026.11.6.0`. Month/day have no leading zeros. `N` starts at `0` each day and increases numerically (`.9` → `.10`); a new date starts at `.0`. Tags use `v2026.11.6.0`; versions in `plugin.json`, `package.json` and lockfiles omit `v`. This four-part date scheme is specific to plugins, does not apply to host versions and is not SemVer. Existing SemVer plugins may keep their version scheme.

Recommended CI behavior:

1. Publish each non-documentation business commit on `main` separately. Process batch pushes and commits arriving during builds in mainline order, not just the final commit. Changes limited to `.md` / `.mdx` or `docs/` do not release or consume a revision. Generated version commits do not recurse. Apply documentation filtering to both workflow triggers and the recovery queue, including manual dispatch.
2. Allocate the next numeric revision from existing tags. Never overwrite tags/Releases or reuse allocated revisions; gaps after failures are acceptable. Handle a new repository's root commit without existing tags. Existing plugins can start from their previous release source/tag; do not invent a baseline.
3. Build an isolated snapshot for each source commit. Complete applicable type checks, tests, frontend builds, packaging and built-manifest/hash validation before publishing. Tags point to that source plus release metadata, never newer main code carrying an older artifact.
4. Record `Source commit: <full SHA>` in Release notes and the same SHA in manifest `releaseSource`. Update main with versions, actual download URLs and toolchain-generated `entryHash` / `zipHash`; keep packaged/root manifests and lockfiles consistent. `zipHash` is not the archive's SHA-256.
5. Serialize releases per repository. Failed checks must not advance the queue; reruns resume unfinished source commits. If publishing succeeds but pushing main metadata fails, recover the existing Release by `Source commit` instead of publishing that source again. Provide manual dispatch for recovery.

When migrating a three-part date version, `2026.11.6` and `2026.11.6.0` compare equal, so start the first four-part release at `.1`. If an existing manifest uses a future date, retain that prefix until the real date catches up to avoid an apparent downgrade. Before changing formats, verify installation and update comparisons in the target host, registry list and GitHub discovery clients. Current four-part support does not imply support in historical clients.

Set a stable `updateUrl` in `plugin.json` and point `download_url` at the actual `{entryPath}.jsplugin.zip` release asset. For new host capabilities, set `minHostVersion` to the host version that actually contains them and check capabilities at runtime; the minimum-version field does not replace capability detection.

See the [Navidrome release script](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/scripts/release-plugin.mjs), [workflow](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/.github/workflows/release.yml) and [release regression tests](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/tests/release_pipeline.test.mjs). Adapt repository names, entry paths and checks; do not copy MIoT-specific frontend or data-generation steps. Release tests should use temporary local Git remotes and mocked Releases, covering bootstrap, day rollover, sequences, documentation skipping, batch pushes, recovery and tag/source correspondence. Never publish test packages to real repositories.
