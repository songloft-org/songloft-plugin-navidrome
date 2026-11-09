# #558 歌曲元数据修复验证

[English](metadata-558.en.md)

## 问题与实现

关联反馈：[songloft-org/songloft#558](https://github.com/songloft-org/songloft/issues/558#issuecomment-6729699499)。旧插件没有写入封面或歌词引用，也没有获取内嵌歌词的接口；不是歌曲文件被改写。专辑名原本已映射，真实样本在旧版也有专辑名，尚未复现报告人的全部现象。

同步现写入不含认证参数的插件内部媒体路径。歌词按原始歌曲 ID 调用 [getLyricsBySongId](https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/)，支持纯文本和同步歌词，优先有效同步轨；按 [offset 定义](https://opensubsonic.netlify.app/docs/responses/structuredlyrics/)将正值提前、负值延后，保留毫秒精度。封面按 `coverArt` ID 获取，限制为常见位图类型；新增 `fs` 权限，在插件目录原子写入并通过宿主 `serveFile` 返回，避免二进制损坏或带凭证重定向。同封面的并行请求合并。

既有宿主 upsert 按来源去重并刷新专辑和媒体引用，升级后再次同步即可补齐原有远程歌曲，保留歌曲及歌单身份。本次未修改宿主或 SDK，同步仍关闭音频探测。

## 对象与结果

- 时间：2026-11-09；Linux amd64，Node 22.17.1、Go 1.26.0、FFmpeg 5.1.9，SDK/Builder 2.18.0。
- 插件：`songloft-org/songloft-plugin-navidrome@d4eb52b06eb1d548810dceee99ab4985909aced8` + 未提交工作树；最终差异身份 `/tmp/songloft-558-metadata/verification-identity.json`。
- 宿主：`songloft-org/songloft@3c1c93a91d004e467855352a08b49af222057532`，执行 `go build -tags dev,lite -o /tmp/songloft-558-metadata/server .`；独立临时 SQLite，HTTP 58268，未使用日常数据。
- 真实 Navidrome 0.64.2 (`10114574`)，固定镜像 `deluan/navidrome@sha256:38dc2727bfcfd5ede290f8ada114fc90368146f265ae4701ddddbcbe2a44ee52`；隔离数据和 HTTP 58269。FFmpeg 合成两份 FLAC，内嵌图片及纯文本/LRC 歌词；不是报告人的账号或音频。

以下证据均在 `/tmp/songloft-558-metadata/`：

| 检查                                     | 结果 / 日志                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 隔离旧实现反向验证                       | 基线源码解包后仅复制新测试与 harness，8 项因缺少媒体引用/路由失败；`baseline-final.log`                                                                  |
| 新增元数据回归                           | 8 项通过：原记录补齐、专辑、歌词偏移及空歌词、凭证修改与重载、ID 编码、错误隔离、并行合并、原子替换失败保留；`metadata.log`                              |
| `npm test`                               | 产物 1、同步 8、元数据 8、发布 9，共 26 项通过；`tests.log`（Node 入口按 4 个文件汇总）                                                                  |
| `npm run typecheck` / `npm run validate` | 通过；`typecheck.log` / `validate.log`                                                                                                                   |
| format / check:format / diff --check     | 通过；`format.log` / `format-check.log`                                                                                                                  |
| 旧 ZIP → 新包 → 再同步                   | 真实 QuickJS/SQLite 保留原歌曲 ID，宿主 `/songs/{id}/lyric` 和 `/songs/{id}/cover` 成功返回；`integration-result.json`、`before-rows.json`               |
| 最终包重启复验                           | 专辑、纯文本/同步歌词、图片和身份通过；`restart-result.json`、`host/restart-final.log`                                                                   |
| 图片完整性                               | 宿主返回与 Navidrome `getCoverArt(size=600)` 字节相同，无 Location；189 字节，SHA-256 `9c265bed01bcb0c467d7db2eaf68455758ca6a8d2b7f0fa0a6e0815cd12b060e` |

临时脚本为 `integration.py`；日志和测试脚本不随发布包分发。独立 pprof 端口已被占用，因此 pprof 未启动，业务 HTTP 验证不受影响。测试后停止临时宿主和容器，保留证据目录。

## 边界与交付

- Not run：报告人的版本/账号/音频、其他 Navidrome 版本、原生客户端/音箱、浏览器显示、长期及大曲库性能。缺少 `getLyricsBySongId` 的旧服务会返回歌词获取错误；报告人的专辑丢失仍待核实。
- Not run：后端全量测试/vet、完整前端及文档站构建、远端 CI；仅插件代码、测试和双语文档变化，宿主执行了 dev,lite 构建与真实 HTTP 集成。
- 未提交、推送、发布或回复 Issue。版本保留原值，自动发布时生成新版本；本地 ZIP 不代表线上已有更新。父仓库子模块仍 dirty，未伪造指针。
- 建议提交：`fix(navidrome): 补齐同步歌曲封面和内嵌歌词`，正文 `Ref songloft-org/songloft#558`。
