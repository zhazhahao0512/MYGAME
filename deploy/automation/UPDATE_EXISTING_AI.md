# 给已连接服务器的 AI：更新现有 8080 游戏并核验自动部署

用户已授权将现有已实现成果更新到正在玩的 8080 服务。目标为用户确认的 `http://66.154.108.212:8080/`；不要新建一个无关端口后声称原站已更新。先读仓库 AGENTS.md 和 docs/PROGRESS.md，保留并行改动与玩家存档。

## 本次可核验发布

- 仓库：zhazhahao0512/MYGAME，分支 main。
- 公网目标：`http://66.154.108.212:8080/`；健康 `http://66.154.108.212:8080/_health`；版本 `http://66.154.108.212:8080/_version`。Repository variable `MYGAME_PUBLIC_URL` 应与这个玩家入口一致（若已有明确反代网址，核实后保留实际入口）。
- 本次准备的 ZIP：MYGAME-server-20261019.zip。
- commit：`27e751e3a735ab6fdbd0fae5c79acd89db7b307b`（游戏源码包含 fb22adb 的逐技能三模式及 R039 属性排版；此提交仅追加发布认领）。
- releaseId：`release-27e751e-20261019`。
- ZIP SHA-256：`1c06d6e54661f27e57903955c529bdc0a7d0a13ca5f915ec32dd83b05faa82c2`。
- 已在独立目录验证打包产物、HTTP/缓存/压缩/端口/真实 Phaser 战斗与暂停；不是线上验收证据。
- 岚牙、正式技能加点、新装备与精准/闪避仍有未接入设计；这次打包不会自动实现文档内容，不宣称这些已上线。

## 先定位旧版本来源

1. 从用户实际网址请求 `/_version`、`/_health` 和首页，记录状态码、commit/releaseId、首页 JS/CSS 文件名；旧服务没有版本端点也要如实记录。
2. 在已连接的服务器执行 `ss -ltnp 'sport = :8080'`，根据 PID 核对 cwd、systemd 单元或实际 supervisor、ExecStart、WorkingDirectory、当前发布目录。只读取相关信息，不输出环境或密钥文件内容。不要假定 /opt/mygame 就是正在服务的目录。
3. 若有 Nginx/容器/反向代理，追踪用户网址实际转到哪个服务及发布卷。比较本机 8080 和公网资源指纹；确认旧的是进程目录、产物、代理缓存还是已打开的浏览器页。
4. 在已有 GitHub 授权下查看 deploy.yml 最近 main 工作流与部署步骤。检查 Repository variables 的 MYGAME_DEPLOY_ENABLED 是否精确 true、MYGAME_PUBLIC_URL 是否为用户实际网址；只核对 secrets 名称/存在性，不打印值。构建成功但 Deploy 步骤 skipped 不算上线。

## 更新现有服务

- 自动部署已正确配置：使用现有工作流对 main 发起部署，等待 Test/build、Deploy to own server、Verify live public deployment 真正结束；保留 run URL 和实际 commit。出现失败先读日志修复具体问题，不盲目重试或关闭验证。
- 自动部署未配置：按同目录 SSH_AI_TASK.md 完成现有服务迁移/受限部署配置，保持原端口和存档；先准备并验证所有文件，再在已有用户授权范围更新。
- 若暂时使用本次 ZIP 手工更新：校验上述 SHA-256、解压到新的版本目录、校验包内 SHA256SUMS；按包内 DEPLOY.md 验证新目录，在空闲临时端口健康及浏览器检查通过后，再让已确认的原服务指向新目录并重启。保留上一个目录/服务配置用于失败恢复，不能只覆盖 dist 而漏掉 server.mjs 或 VERSION.json；不要启动第二个进程抢占 8080。
- 若已有受限 apply-release helper，用现有受限入口和配置发布，保持 current/previous 与校验流程；不要临时赋任意 sudo 权限或改 helper 权限来省步骤。

## 必须验收后才报告完成

1. 本机与用户实际公网网址均返回新 `/_version`；若用本 ZIP，commit/releaseId 应与上文完全相同，若用 Actions 则对应实际最新成功 run。
2. 首页返回新 JS/CSS 哈希且资源可读取；首页 no-cache、版本 no-store，浏览器普通刷新加载新入口。不能要求清空 localStorage 来更新，以免删存档。
3. 用独立浏览器上下文进入战斗：英雄四组属性、主要/次要切换、技能右上圆钮“托→自→点”及独立手动释放可用；战斗推进、暂停正常。检查新开局与旧档恢复，不修改真实玩家存档。
4. 若本机新而公网旧，检查代理/CDN实际上游和HTML缓存；不要仅重启无关服务。
5. 最终回报：用户原网址、实际服务/目录、部署 commit/releaseId、Actions run URL（若有）、检查结果、未完成项。回写仓库进度；没有线上成功证据就不能说已更新。

本文件是可执行交接说明，不代表当前会话已连接目标服务器。用户已经给出实际网址；当前云工作区没有对应 8080 服务，请求公网版本端点被平台代理以 `403 Domain forbidden` 拦截，并非游戏服务器返回的诊断。GitHub Actions API 也被当前环境网络策略阻止。所需 66.154.108.212/api.github.com 已保存为云环境配置草稿，尚未发布，不代表已获得 SSH 或 GitHub API 授权。已有 SSH 环境可继续处理，不要在聊天中传密码或私钥。
