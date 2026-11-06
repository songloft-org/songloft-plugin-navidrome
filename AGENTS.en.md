# Navidrome plugin development

- Own Navidrome connections independently; do not depend on other plugins. Read `LESSONS.md` first when present.
- Backend runs in QuickJS. Frontend reuses host-injected themes, components and the public client SDK; do not copy fonts, themes or bridge declarations.
- Source IDs define identity. Fetch and validate complete snapshots before atomic membership replacement; never interpret errors as empty lists.
- Do not persist authenticated stream URLs. Credentials remain server-side and must not leak through logs, frontend responses, song or playlist records.
- Format with `npm run format`. Relevant checks: typecheck, test, build, validate, check:format. UI changes require actual browser verification.
- Keep Chinese/English documentation synchronized. Commit, push, release and GitHub writes require applicable session authorization. Use main directly and no Co-Authored-By.
- Independent repository `songloft-org/songloft-plugin-navidrome`, referenced as a parent submodule. Follow [automated releases](docs/releases.en.md): each non-documentation main commit releases separately with Beijing-time `YYYY.M.D.N`. Run `npm run test:release` when changing the pipeline.
