# MYGAME 开发技能

用户于 2026-10-19（北京时间）批准接入 UI、动态、动画、数值平衡和性能技能。它们安装在仓库 `.agents/skills/`，随 Git 同步；游戏本身不加载这些文件，不增加运行依赖。

## 按任务使用

先读 [共用约定](../.agents/skills/PROJECT.md)；只加载当前需要的 SKILL.md 和参考文件。

| 技能 | 何时使用 | 来源 |
| --- | --- | --- |
| [frontend-design](../.agents/skills/frontend-design/SKILL.md) | UI层级、字体、配色、布局及参考图落实 | Anthropic；Apache-2.0，项目适配 |
| [phaser-engineer](../.agents/skills/phaser-engineer/SKILL.md) | Phaser 3 场景、资源、动画/tween、生命周期与引擎问题 | LazyIsEfficient；MIT，项目适配 |
| [mygame-motion](../.agents/skills/mygame-motion/SKILL.md) | UI动态、弹道、出手/命中/受击/死亡节奏、暂停一致性 | 本项目原创 |
| [mygame-balance](../.agents/skills/mygame-balance/SKILL.md) | 英雄/装备/被动/成长/资源平衡，复用HB和金币工具 | 本项目原创 |
| [mygame-performance](../.agents/skills/mygame-performance/SKILL.md) | 完整帧耗时、对象池、长期内存、资源与手机性能 | 本项目原创 |
| [playwright](../.agents/skills/playwright/SKILL.md) | 实际页面操作、截图和交互复现 | OpenAI；Apache-2.0，项目适配 |

可直接要求“按 mygame-motion 检查攻击动画”“按 mygame-balance 比较这两件装备”或“用 mygame-performance 找出战斗卡顿原因”。助手按路径读取即可使用，不要求用户每次手工选技能。

## 加载与环境

从 MYGAME 仓库目录开始工作。支持项目技能发现的客户端可扫描 `.agents/skills/*/SKILL.md`；已有会话是否热刷新由客户端决定，必要时重新打开项目或新会话。AGENTS.md 已提供显式路径路由，自动发现不可用时按路径读取，不依赖技能菜单显示。

这是项目级安装，不写 `/workspace/.agents`、`/workspace/.codex` 或用户全局目录，不代表账号插件已注册。新云环境须拉取包含本次接入的 Git 提交；仅连接同名仓库不等于已经同步。依赖、浏览器和工具权限仍由该环境提供。

Playwright 优先复用已有 `scripts/*check.mjs`。临时 CLI 复现可在仓库根目录运行：

```bash
PWCLI="$PWD/.agents/skills/playwright/scripts/playwright_cli.sh"
bash "$PWCLI" --help
```

包装脚本固定 `@playwright/cli@0.1.22`，首次运行需网络下载，缓存默认置于临时目录，不修改游戏 package.json/lockfile。该 CLI 顶层版本固定，不承诺 npm 的全部传递依赖不可变。浏览器依赖另行核验；本环境可通过 CLI 配置的 `browser.launchOptions.executablePath` 指向 `/usr/bin/chromium`，不要求下载第二套浏览器。共享网络仍遵守环境代理和授权，不改代理绕过限制。

## 项目适配与来源

[sources.lock.json](../.agents/skills/sources.lock.json) 记录上游仓库、固定提交、文件原始/安装后 SHA-256、许可证和适配说明。第三方正文及参考文件仅按任务读取，许可证随技能保留；没有运行上游整仓安装器。

- UI 不把模板审美当硬规定，按最新用户范围及 D018 处理参考图。
- Phaser 保留独立固定步模拟和 DOM HUD；通用物理/tween 示例不能取代伤害结算。外部可选技能链接改为固定提交网页，不存在的关联技能不会被自动安装。
- Playwright 修正用户全局路径和产物目录示例为项目入口/`test-results/`，固定 CLI 版本并处理可写缓存。上游 `agents/openai.yaml` 的默认提示适配为本地 `$playwright`。
- 数值候选 `Yuki001/game-dev-skills` 在审查提交 `f0885d41a2db45e2a97eede248f6e94a0f786a8b` 未找到明确许可证；本仓库没有复制其技能或参考正文，改用项目规范原创数值流程。
- Phaser 官方 master 的动画技能针对 Phaser 4，本次不导入，不由此升级引擎。此前暂存的 gh-fix-ci 不纳入本次安装。

## 校验和更新

```bash
python3 scripts/check-skills.py
```

校验技能名称/描述、目录清单、来源固定提交和许可证、文件哈希、本地 Markdown 链接、agent 图标与包装脚本语法。此检查不证明第三方每条技术建议正确，也不证明游戏平衡或客户端自动发现。

更新时先确认上游提交及许可证，再检查正文、脚本和依赖变化；保留 PROJECT.md 的规则和本地适配，重新记录哈希并校验。不要用自动更新覆盖整个技能目录。卸载或替换时同时维护 AGENTS 路由、来源清单与此索引。
