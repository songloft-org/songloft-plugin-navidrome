# Navidrome 插件开发约定

- 本插件独立管理 Navidrome 连接，不依赖其他插件。修改前读取 `LESSONS.md`（存在时）。
- 运行在 QuickJS；前端只使用宿主注入的主题、组件和公开客户端 SDK，不复制字体、主题或桥接声明。
- 同步以来源 ID 为准；必须完整拉取并校验后才原子替换歌单成员，错误响应不能视为空列表。
- 不保存带认证的播放 URL；凭证只保存在服务端，不在日志、前端响应、歌曲或歌单中泄露。
- 格式化 `npm run format`。相关检查：typecheck、test、build、validate、check:format；UI 修改执行真实浏览器验证。
- 文档中英同步。提交、推送、发布、GitHub 写入按当前用户授权执行，直接 main，无 Co-Authored-By。
- 独立仓库 `songloft-org/songloft-plugin-navidrome`，父仓库通过子模块引用；遵循 [自动发布](docs/releases.md)，非文档 main 提交逐笔出包，版本使用北京时间 `YYYY.M.D.N`。改发布流程时运行 `npm run test:release`。
