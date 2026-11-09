# 开发经验

[English](LESSONS.en.md)

## UI-001：校验打包后的脚本加载时机

- 范围：Vanilla 静态页及 plugin-builder 2.18.0，首次开发工作树。
- 证据：2026-11-06，源码在 head 使用 `defer`，构建后的 HTML 将其合并为不带 `defer` 的脚本；初轮真实浏览器操作等待超时，远端测试服务器未收到请求。
- 规则：页面显式检查 `document.readyState`，在 DOMContentLoaded 后绑定元素；源码中的脚本属性不能替代产物验证。
- Done right：`tests/artifact.test.mjs` 对真实 ZIP 的脚本在 loading 文档中执行，若提前访问元素则失败；随后真实 Docker Chrome 完成配置、预览、同步、明暗主题和 390px 窄屏操作。证据见 `VERIFICATION.md`。
- Seen 1× (2026-11-06)。状态：本地实现与产物验证通过，未发布。

## MEDIA-001：同步引用须覆盖歌词、封面和旧记录补齐

- 范围：Navidrome 同步与宿主媒体消费；songloft-org/songloft#558，插件基线 `d4eb52b06eb1d548810dceee99ab4985909aced8`。
- 证据：2026-11-09 报告歌词和图片缺失；旧版仅传文本元数据，无媒体引用。隔离旧代码的新增 8 项回归均失败；真实 Navidrome 0.64.2 合成 FLAC 在旧插件导入后也无封面/歌词引用。专辑名原本正常，不把全部反馈归为同一已证实根因。
- 规则：Navidrome 扫描到内嵌标签不代表 Songloft 能自动读取；同步须保存无凭证引用、按原始 ID 取媒体，并验证旧包升级后的既有记录。SDK 的 Uint8Array 响应类型不能证明宿主字符串通道能返回二进制图片。
- Done right：旧 ZIP → 修复包 → 再同步 → 宿主重启，真实 QuickJS/SQLite/HTTP 保留歌曲 ID，返回专辑、纯文本/同步歌词及逐字节相同的封面；8 项回归转绿。封面使用插件内 `fs`、并发合并及原子替换；歌词保留毫秒及 offset 方向。证据与 Not run 见 [验证记录](docs/metadata-558.md)。
- Seen 1× (2026-11-09)。状态：修复 `9586eb0` 已推送，v2026.11.9.0 自动发布与线上字节码包实测通过；见 [发布验收](docs/release-20261109.md)。报告人环境与专辑缺失待核实，不增加独立事件次数。
