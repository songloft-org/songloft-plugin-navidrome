# Development lessons

[中文](LESSONS.md)

## UI-001: Verify script timing in the packaged page

- Scope: Vanilla static pages and plugin-builder 2.18.0, initial development worktree.
- Evidence: On 2026-11-06 the source head script used `defer`, but built HTML merged it into a script without `defer`. The initial real-browser operation timed out and the remote fixture received no requests.
- Rule: Check `document.readyState` explicitly and bind elements after DOMContentLoaded. Source script attributes do not replace artifact verification.
- Done right: `tests/artifact.test.mjs` runs the actual ZIP's script against a loading document and fails on early element access. Docker Chrome then completed setup, preview, sync, light/dark theme and 390px interactions. See `VERIFICATION.en.md` for evidence.
- Seen 1× (2026-11-06). Status: Local implementation and artifact verification passed; unpublished.
