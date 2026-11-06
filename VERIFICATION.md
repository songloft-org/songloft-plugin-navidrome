# #558 本地验证

> 本页保留首次本地开发时的验证状态；正式发布及商店验收见 [首次发布记录](docs/release-20261106.md)。

[English](VERIFICATION.en.md)

## 对象与环境

- 时间：2026-11-06，Linux amd64，Go 1.26.0、Node 22.17.1、TypeScript、plugin-builder/SDK 2.18.0。
- 主仓库基线：`3049574c76431ddefc20dbe9c1adba8bef3212ef` + 本批未提交工作树。
- toolchain 基线：`ee0eb8fb473208b3397ec7f16fb71ae4c64c2f9c` + SDK 类型改动（dirty，未更新 gitlink）。
- 独立插件：`plugins/src/songloft-plugin-navidrome/` 新建未提交目录，未创建远端仓库或子模块。
- 身份记录：`/tmp/songloft-558-run/verification-identity.json` 保存各仓库基线、diff 和插件文件 SHA-256。
- 后端：`go build -tags dev,lite -o /tmp/songloft-558 .`，独立 SQLite `/tmp/songloft-558-run/test.db`、端口 58258，未使用日常数据库。音乐目录 `/home/hanxi/.cache/songloft-558/music`。
- Navidrome 替身：本地 58259 端口受控兼容 API，合成歌曲及 WAV；不是真实 Navidrome 账号。浏览器：已有 Docker browserless Chrome，1280px 与 390px。

## 结果

| 检查                                         | 结果与证据                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CGO_ENABLED=0 go test -tags dev,lite ./...` | 通过，`go-test.log`                                                                                                                                               |
| 同标签 `go vet ./...`                        | 通过，`go-vet.log`                                                                                                                                                |
| 定向 race                                    | 普通歌单原子替换、权限和桥接输入验证通过，`race.log`                                                                                                              |
| 真实内存 SQLite 回归                         | 新增/移除/顺序、无效和重复 ID、事务回滚、空数组清空、内置歌单保护、缺失数组拒绝、读权限不能写                                                                     |
| 插件 `npm run typecheck`                     | 通过，`plugin-typecheck.log`                                                                                                                                      |
| 插件 `npm test`                              | 9 项通过，包含构建后真实 ZIP 的资源和 DOM 初始化检查，`plugin-test.log`                                                                                           |
| 插件 build / validate / check:format         | 通过，`plugin-validate.log`、`plugin-format-check.log`                                                                                                            |
| SDK build / typecheck                        | 通过，`sdk-build.log`、`sdk-typecheck.log`；pnpm 入口因本机 11 与仓库 9.15 版本检查失败，改用包内 npm 脚本完成验证                                                |
| 真实 QuickJS / SQLite / HTTP                 | 安装字节码 ZIP 后读取收藏与歌单、增删及顺序、合法空歌单清空、连接失败保留、复用来源 ID、常驻设置、密码不回显；`http-result.json`                                  |
| 音频请求边界                                 | 替身记录证明同步期间没有 stream 请求；明确请求播放解析后才成功读取 88,244 字节 WAV，`http-result.json`                                                            |
| 真实浏览器                                   | 测试连接、保存连接、范围勾选、预览、自动同步、立即同步、移除提示及 Esc 关闭通过；无页面异常，390px 无横向溢出；`browser-result.json`、`browser-final-result.json` |
| 主题                                         | 宿主共享样式亮暗切换；模拟主程序主题消息将按钮主色实际改为 `rgb(239, 184, 200)`；`final-light.png`、`final-dark.png`、`final-mobile.png`                          |
| 后端重启                                     | 持久连接、映射和源歌曲复用，结果见 `restart-result.json`                                                                                                          |

完整证据保存在本机 `/tmp/songloft-558-run/`，不随代码发布。首次校验源码清单因缺少构建哈希失败，已将 validate 改为校验 `dist/_build`；首次浏览器测试暴露 head 脚本时机，已增加产物回归。桥接权限测试初稿修改了插件对象而非构造时复制的权限列表，修正测试后全量重跑通过。

新增功能无对应旧实现，反向 Bug 验证不适用；事务回滚使用真实仓储写入完成后注入失败，确认原成员保留。

## 未运行与交付边界

- Not run：真实 Navidrome 服务/账号、原生 Flutter/Lynx WebView、真机及小爱音箱、长时间自动同步和多连接大曲库性能。兼容替身和浏览器验证不替代这些验收。
- Not run：完整嵌入版客户端构建、文档站构建和远端 CI；本次只修改服务端插件桥接、SDK 类型、独立静态插件和文档。
- 未提交、推送、发布或评论 Issue。首次发布需把最低宿主版本指向实际包含原子接口的版本，并建立独立仓库、填写更新地址；SDK 新类型未发布前使用局部兼容类型。
