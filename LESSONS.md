# 开发经验

[English](LESSONS.en.md)

## UI-001：校验打包后的脚本加载时机

- 范围：Vanilla 静态页及 plugin-builder 2.18.0，首次开发工作树。
- 证据：2026-11-06，源码在 head 使用 `defer`，构建后的 HTML 将其合并为不带 `defer` 的脚本；初轮真实浏览器操作等待超时，远端测试服务器未收到请求。
- 规则：页面显式检查 `document.readyState`，在 DOMContentLoaded 后绑定元素；源码中的脚本属性不能替代产物验证。
- Done right：`tests/artifact.test.mjs` 对真实 ZIP 的脚本在 loading 文档中执行，若提前访问元素则失败；随后真实 Docker Chrome 完成配置、预览、同步、明暗主题和 390px 窄屏操作。证据见 `VERIFICATION.md`。
- Seen 1× (2026-11-06)。状态：本地实现与产物验证通过，未发布。
