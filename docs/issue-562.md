# #562：来源标签与歌单唯一名称

2026-11-11，基线 `04d87b0d79c880d1e648d056375a680e97d78802`，未提交工作树。默认使用远端原名；冲突追加 `-Navidrome`，再冲突追加 ` (2)`。在原身份映射旁保存命名模式与请求原名；仅迁移已确认归属的旧默认名，保留手动名称和 ID。显式名称冲突在修改成员前返回。来源及可选连接标签同时绑定导入歌曲与歌单，旧宿主缺少能力时在写入前停止。

`npm run typecheck`、`npm test`（29 项）、`npm run validate`、`npm run check:format` 通过。新增冲突/并发占用、重启与手动名称、旧名迁移、旧宿主拒绝和共享标签测试。真实构建页面 Chrome 对 fixture API 完成“家中 NAS”输入、提交与回填，无页面异常。证据：`/tmp/songloft-562-implementation/nav-mobile.png/json`。

新一轮真实 Navidrome + QuickJS 全链路和原生设备：Not run。未提交、推送、发布或写 Issue。完整记录统一在父仓库 `docs/issue-562-verification.md`。
