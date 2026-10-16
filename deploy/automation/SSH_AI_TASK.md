# 给已通过 SSH 连接服务器的 AI：配置 MYGAME 自动更新

请直接完成以下工作。用户已授权为自己服务器上的 MYGAME 配置自动更新；现有游戏已能访问。请检查实际环境，自行确定常规参数，不要反复要求用户查目录、端口或服务名。若缺少 GitHub 登录授权，只让用户完成必要的安全授权，不要让用户在聊天中发送密码、私钥或 Token。

## 目标与边界

- 仓库：`https://github.com/zhazhahao0512/MYGAME`，生产分支 `main`。
- 开发者将更新提交并推送到 `main` 后，由 GitHub Actions 测试、构建，再通过 SSH 更新这台服务器。仅在聊天里改了代码、没有推送，不会触发更新。
- 玩家继续通过现有公网网址访问，不需要 ChatGPT 或 GitHub 登录，不使用 GPT 托管。
- 保留现有域名、HTTPS、反向代理及游戏端口；不要清除浏览器存档。存档在浏览器 `localStorage`，同一协议、域名、端口是保留现有存档访问的前提。
- 游戏服务以普通用户运行。部署使用专用 SSH 密钥、严格校验主机公钥、受限 sudo helper。
- 更新前检查包和启动；切换后检查版本，失败自动切回旧版。systemd 重启会有短暂中断，这不是零停机方案。已经打开的游戏不会强制刷新，玩家刷新页面后加载新版。
- 默认不启用自动部署，完成服务器准备后才设置开关。不要修改无关服务、防火墙规则或删除现有游戏目录。

## 本次交接的文件

若用户上传了 `MYGAME-auto-update-kit.zip`，解压后 `MYGAME-source/` 是完整源码快照（含锁文件、测试和隐藏目录 `.github/`，不含 `.git`、依赖和密钥）。`START-HERE.md` 就是本说明。

关键文件：

| 文件 | 用途 |
| --- | --- |
| `.github/workflows/deploy.yml` | main 推送 / 手动触发构建，PR 仅测试 |
| `scripts/push-deploy.sh` | 使用 GitHub Secrets 上传并执行远程部署 |
| `deploy/automation/apply-release.py` | 安装为服务器 root 拥有的部署 helper |
| `tests/test_deploy.py` | 校验失败、启动失败和回滚测试 |
| `deploy/server.mjs` | 独立 Node HTTP 服务，支持 `/_health` 和 `/_version` |
| `deploy/DEPLOY.md` | 原独立服务器部署说明 |

运行时 Node.js 要求 22.12+，推荐 24 LTS；部署 helper 要求 Python 3.9+、systemd、sudo、OpenSSH/SFTP。只有 GitHub 构建机器需要 npm 安装项目依赖，目标服务器不需要 `node_modules`。

## 一、先识别现有安装和代码来源

1. 检查当前运行服务、监听端口、进程命令行、systemd 单元和 Nginx/Caddy 配置，找出实际游戏目录、服务名、运行用户、Node 绝对路径、HOST/PORT、公网网址和 SSH 入口。不要直接假定都是默认值。不要打印环境文件中的凭证。
2. 记录当前首页和 `/_health` 的响应；旧版没有 `/_version` 是正常的。备份安装目录、服务单元及本次要改的配置到带时间戳目录，记录还原方法。
3. 检查 GitHub 仓库的实际 refs。云端准备时远端尚无提交，之后可能已更新，以实时结果为准。
4. 若仓库已有当前源码及自动更新配置，正常 clone/pull 使用；若仓库为空，将交接包 `MYGAME-source/` 内容作为初始提交推送到 `main`（必须包含 `.github/`）。若远端已有不同内容，先比较并合并，禁止强制推送覆盖。排除压缩包、依赖、构建产物和所有凭证。先用已有 GitHub 身份尝试，缺授权再指导安全登录。首次推送时保持部署开关关闭。
5. 若没有 GitHub 管理权限，先完成服务器准备；准确报告剩下的 GitHub 配置，不能声称自动更新已经启用。

## 二、将现有游戏迁移到可回退的目录布局

以下用默认 `/opt/mygame` 举例，按实际路径调整，并同步后面的配置与 GitHub Variable。路径须为绝对路径，仅使用字母、数字、下划线、短横线和 `/`，不使用空格或符号链接目录。

```text
/opt/mygame/                    root:root 0755
  releases/                    root:root 0755
    bootstrap-日期/             现有可用版本，root 拥有，服务用户可读
    <releaseId>/                后续自动部署版本
  current -> releases/某版本    当前版本，root 控制
  previous -> releases/旧版本   上次成功切换前的版本
  incoming/                    root:mygame-deploy 0770，上传目录
  .deploy.lock                 由 helper 创建
```

1. 若已是上述结构，检查并复用，不重复迁移。否则把**现有运行文件**复制到 `releases/bootstrap-日期/`，至少含 `server.mjs`、`dist/`、原 `package.json`，以及原运行所需文件。不要递归把新建的 releases/incoming 复制进去。原文件和完整备份先保留。
2. 用当前普通服务用户验证 bootstrap 版本可读并能运行，再建立 `current`。base、releases、current、所有版本代码目录及其父目录都不能让部署用户或游戏进程写入；默认 root 所有，目录 0755、文件 0644。
3. 若旧服务以 root 运行，建立专用普通服务用户（例如 `mygame`），仅给游戏运行所需权限。
4. 修改或添加 systemd override：`WorkingDirectory=/opt/mygame/current`，清空原 `ExecStart=` 后设为真实 Node 路径加 `/opt/mygame/current/server.mjs`；保留实际 HOST/PORT 和必要参数、普通 User/Group、Restart 策略。Node 应安装于服务用户可访问的系统路径，不依赖 root 家目录的 nvm。
5. `systemctl daemon-reload` 后重启该游戏服务，检查本地健康、首页及现有公网网址。失败立即恢复备份单元和旧启动方式，排查后再继续。自动更新依赖当前独立 Node 服务；若发现实际是其他部署方式，请先完成等价迁移并验证，不能直接套用路径。
6. 不需要开放 Node 端口到公网；本地反代可继续连 `127.0.0.1:实际端口`。运行配置须使该地址可做健康检查。

## 三、安装受限部署入口

1. 建立专用登录用户/组，例如 `mygame-deploy`，密码锁定、无普通 sudo 权限；允许 SSH 公钥执行命令和 SFTP（`/bin/sh` 或 `/bin/bash`，不能用 nologin）。建立 `incoming`，仅这个上传目录交给部署组写，不要把整个游戏目录 chown 给部署用户。
2. 从本仓库安装 helper：

```sh
sudo install -o root -g root -m 0755 deploy/automation/apply-release.py /usr/local/sbin/mygame-deploy
```

3. 以 root 创建 `/etc/mygame-deploy.json`，填实际值，root:root、0644 或 0600，不得组/其他用户可写：

```json
{
  "base": "/opt/mygame",
  "node": "/usr/bin/node",
  "service": "mygame.service",
  "user": "mygame",
  "port": 8080
}
```

4. 用独立 sudoers 文件只允许这个命令，例如实际部署用户为 `mygame-deploy`：

```sudoers
mygame-deploy ALL=(root) NOPASSWD: /usr/local/sbin/mygame-deploy *
```

文件 root:root、0440，先用 `visudo -cf` 校验再启用。不要授予任意 shell、Python、systemctl、cp 或通用 sudo 权限。helper 只接受版本 ID 和 SHA-256 两个参数，配置固定从 root 文件读取，不能由部署用户提供配置路径。

5. helper 会校验压缩包 SHA-256、每个文件校验和、路径和版本 ID；拒绝链接和特殊文件；以游戏普通用户预启动；原子切换 current，重启并校验实际版本，失败回退。首次 bootstrap 不要求版本端点。代码部署权限本身允许更新游戏程序，所以该密钥仍需严格保管。

## 四、配置专用密钥与 GitHub Actions

在可信机器上生成本项目专用 Ed25519 密钥，无口令以供 Actions 自动运行；私钥只落在权限 0700 目录内的 0600 文件中，临时文件处理完删除。不复用现有管理员 SSH 私钥，不打印私钥或 Token，不写入仓库、说明或聊天。

1. 公钥加入部署用户的 `~/.ssh/authorized_keys`，使用 `restrict` 选项禁用转发和 PTY；目录 0700、文件 0600，用户所有。不要设置会阻止 scp/SFTP 或 sudo helper 的 forced-command；不得改动其他用户的授权。
2. 使用当前可信 SSH 会话读取服务器实际启用的 SSH **公钥**，例如 `/etc/ssh/ssh_host_ed25519_key.pub`，核实指纹。构造 known_hosts 行：22 端口用 `公网主机名 ssh-ed25519 公钥`，非 22 端口用 `[公网主机名]:端口 ssh-ed25519 公钥`。地址必须与 Actions 使用的 HOST 相同。若入口经过跳板/NAT 或使用别的 host key 类型，核实入口真正提供的主机公钥。不要关闭 StrictHostKeyChecking；不能把未经比对的 ssh-keyscan 结果当作可信依据。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 设置以下 **Repository secrets**（本工作流不使用 Environment secrets）：

| Secret | 值 |
| --- | --- |
| `MYGAME_SSH_HOST` | Actions 能连到的公网 IPv4 或 DNS 名，不加协议 |
| `MYGAME_SSH_PORT` | 实际 SSH 端口，缺省 22 |
| `MYGAME_SSH_USER` | 专用部署用户，例如 mygame-deploy |
| `MYGAME_SSH_KEY` | 新生成的专用私钥完整内容 |
| `MYGAME_KNOWN_HOSTS` | 上一步可信主机公钥行 |

4. 设置 **Repository variables**：`MYGAME_DEPLOY_ROOT` 为实际 base 路径，`MYGAME_PUBLIC_URL` 为玩家使用的完整网址（包含协议与端口）；先不设置 `MYGAME_DEPLOY_ENABLED`，或设为 `false`。
5. 优先使用已有授权的 `gh`，例如 `gh secret set MYGAME_SSH_KEY --repo zhazhahao0512/MYGAME < 私钥文件`；不要把密钥放进命令行参数或 shell 历史。若没有权限，引导用户在 GitHub 安全页面直接填写或通过终端授权，聊天里只汇报字段名与是否配置。
6. 检查 Actions 已启用且允许工作流中的官方 checkout/setup-node/upload-artifact actions。此仓库的 Actions job 权限仅需 contents:read，部署密钥与仓库管理令牌分离。
7. 从服务器之外验证专用 SSH 登录、SFTP 上传、严格 host key 校验、`sudo -n` helper 权限；可先上传临时无害文件，再调用无效测试版本/hash确认 helper 拒绝且当前版本不变。不要只用服务器本机 SSH 回连来判断公网可达。GitHub 托管 runner 必须能访问 SSH 入口；有 IP 白名单时按服务器实际政策处理，不能擅自开放所有管理端口。

## 五、启用并验收

1. 在源码目录执行 `python3 -m unittest discover -s tests -p 'test_deploy.py' -v`；这 10 项测试不操作系统服务，验证包校验和失败回退逻辑。
2. 首次 Actions 构建先保持自动部署关闭，确认测试、构建和真实浏览器部署包检查通过。下载 artifact 可作备份。
3. 确认服务器准备完成、密钥配置完成后，把 Repository variable `MYGAME_DEPLOY_ENABLED` 设为字符串 `true`。
4. 在 GitHub Actions 手动执行 `Test, build and deploy MYGAME`，分支选择 main（或 `gh workflow run deploy.yml --repo zhazhahao0512/MYGAME --ref main`）。等待到远程部署步骤成功，不以“触发成功”代替部署成功。
5. 检查 `current` 指向本次 `<commit>-<run_id>-<run_attempt>`；本地 `/_health` 返回 ok；`/_version` 的 commit/releaseId 与本次工作流一致；确认 `Verify live public deployment` 从 GitHub runner 检查公网首页、版本、资源和真实浏览器战斗通过。该步骤会验证独立浏览器的开局、暂停及刷新后读取存档，不操作玩家存档。公网验收失败会令工作流失败，但不会仅因外部网络异常回退本机健康的版本。另外在更新前后验证同一浏览器的既有存档保持不变。
6. 故障路径已由单元测试覆盖；不要为测试回退故意破坏线上版本。如需服务器实测回退，在独立测试目录、测试服务和空闲端口进行。
7. 若 Actions 构建成功但部署跳过，检查开关是否精确等于 `true`、是否 main、是否 PR。若 SSH 失败，检查 host/user/port、公钥、可信 host key、防火墙和 SFTP。若 helper 报错，查看 Actions 日志、`journalctl -u 实际服务`、config 权限及 current。不要反复盲目重跑或用关闭校验来修复。
8. 相同已成功的部署可以安全重试；失败且已生成版本目录时，重新运行工作流会生成新的 run_attempt，不要覆盖旧版本目录。
9. current/previous 及 bootstrap 备份先保留。上传包和历史版本目前不自动清理；旧哈希静态资源会保留供已打开页面使用，后续需按磁盘实际使用安排清理，不要删除 current/previous 指向的版本。部署 helper 自身的修改也需管理员审查安装，不会随着每次游戏更新自动替换。

## 六、需要时的人工回退

先将 `MYGAME_DEPLOY_ENABLED` 设为 `false`，等待正在运行的发布结束。在 root 下取得与 helper 相同的 `base/.deploy.lock` 文件锁，再把 current 原子改为之前验证过的 releases 目录，重启实际游戏服务并检查健康和公网网址。通常可使用 previous；确认目标存在后才切换。持锁期间完成切换和验证，避免与自动更新并发。不要删除新旧版本或直接覆盖 current 中的文件。

## 完成后请向用户汇报

只报告实际结果：公网游戏网址、实际安装目录/服务名、GitHub Actions 地址、部署的 commit/releaseId，以及端到端是否验证通过。若权限或网络阻止某一步，明确剩余操作；不要将“文件已写好”称为“自动更新已启用”。不要在报告里附密钥、Token 或服务器私密配置。

配置成功后告知用户：以后开发完成并推送到 main，测试通过才会更新服务器；用户继续使用原网址，刷新即可玩到新版本。
