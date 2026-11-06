# 自动发布

[English](releases.en.md)

本插件采用 **北京时间 `YYYY.M.D.N`**：如 `2026.11.6.0`。月份和日期不补零，`N` 是当日从 `0` 开始的递增序号；同日 `.9` 后是 `.10`，换日从 `.0` 开始。Git tag 使用 `v2026.11.6.0`，`plugin.json`、`package.json` 和锁文件中的版本不带 `v`。这是插件专用的四段日期版本规则，不用于主程序版本，也不称为 SemVer；已有 SemVer 插件可以保留原有版本体系。

推荐的 CI 行为：

1. `main` 的每个非文档业务提交单独出包；批量推送或构建期间收到新提交，按主线顺序逐个处理，不只发布最后一笔。仅修改 `.md` / `.mdx` 或 `docs/` 的提交不出包、不占序号；自动生成的版本提交不递归触发。工作流触发过滤与补发队列均须应用文档规则，手动续跑也不补发纯文档提交。
2. 从已有 tag 的数值最大序号分配新版本，不覆盖既有 tag 或 Release、不复用已分配序号；失败留下序号间隔可以接受。首次发布须处理无 tag 的根提交；已有插件可用上次发布的源码或 tag 作为起点，不虚构基线。
3. 对每笔源码建立隔离构建快照，完成适用的类型检查、测试、前端构建、打包和产物清单/哈希校验，再发包。tag 指向该源码加版本元数据的快照，不能把旧产物挂到较新的 main 提交上。
4. Release 说明使用 `Source commit: <完整 SHA>`，清单的 `releaseSource` 保存相同 SHA；主线同步版本、实际下载地址、工具链生成的 `entryHash` / `zipHash`，并保持包清单、根清单和锁文件一致。`zipHash` 不是 ZIP 文件本身的 SHA-256。
5. 同一仓库的发布任务串行，检查失败不推进队列；重跑从未完成的源码续发。若 Release 成功但主线元数据推送失败，按 `Source commit` 接回已有 Release，不重复发布同一源码。保留手动触发入口用于恢复。

从三段日期版本迁移时，同一天的 `2026.11.6` 与 `2026.11.6.0` 数值相等，首个四段版本应从 `.1` 开始；若旧清单使用未来日期，真实日期追上之前沿用旧日期前缀，避免被判断为降级。首次使用新格式前应核对目标宿主及客户端的安装、源列表和 GitHub 发现升级比较；当前代码支持四段版本不代表历史客户端也支持。

在 `plugin.json` 配置稳定的 `updateUrl`，`download_url` 指向实际发布的 `{entryPath}.jsplugin.zip`。新增宿主能力时，`minHostVersion` 填写真正包含该能力的宿主版本，并在运行时检测能力；最低版本字段不能代替能力检查。

可参考 [Navidrome 发布脚本](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/scripts/release-plugin.mjs)、[工作流](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/.github/workflows/release.yml)和[发布回归](https://github.com/songloft-org/songloft-plugin-navidrome/blob/main/tests/release_pipeline.test.mjs)。移植时替换仓库名、入口与构建检查，不要携带 MIoT 等插件特有的前端或生成数据步骤。发布脚本测试应使用本地临时 Git 远端及模拟 Release，覆盖首次发布、换日、序号、文档跳过、批量提交、失败续跑和 tag/源码对应关系，不能向真实仓库发测试包。
