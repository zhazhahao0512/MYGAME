# MYGAME 独立服务器部署包

本包包含已构建的完整网页游戏及静态服务器。部署在你自己的服务器上，不使用 GPT 托管，不依赖 GPT、OpenAI API、外部 CDN 或在线字体服务。服务器只提供文件，战斗运算在玩家浏览器中执行。

## 1. 环境与文件

需要 **Node.js 22.12 或更高版本，推荐 Node.js 24 LTS**。不需要数据库，不需要 API 密钥，不需要执行 `npm install`，不需要在服务器上构建前端。安装好 Node.js 后可在没有外网出口的服务器上运行。

```text
MYGAME-server/
  dist/                       已构建的网页、Phaser、脚本和样式
  server.mjs                  使用 Node.js 内置模块的 HTTP 静态服务器
  start.sh                    Linux/macOS 启动脚本
  package.json                可选的 npm start 入口，无第三方依赖
  DEPLOY.md                   本说明
  mygame.service.example      Linux systemd 常驻服务示例
  nginx.conf.example          自有域名反向代理示例
  licenses/                   第三方开源许可
  VERSION.json                打包版本、构建时间与运行环境要求
  SHA256SUMS                  包内文件校验清单
```

`.zip` 和 `.tar.gz` 内容相同，任选一个解压。请保留整个目录，尤其是 `dist/assets/`。不要直接双击 HTML 使用 `file://` 打开。

## 2. 解压并启动

Linux 示例：

```sh
unzip MYGAME-server-20261016.zip
cd MYGAME-server
node --version
sh start.sh 8080
```

或者使用 tar 包：

```sh
tar -xzf MYGAME-server-20261016.tar.gz
cd MYGAME-server
sh start.sh 8080
```

默认端口为 **8080**，默认监听 **0.0.0.0**。浏览器访问 `http://你的服务器IP:8080/`。服务器安全组/防火墙需允许你选择的 TCP 端口。前台运行时按 Ctrl+C 停止，关闭终端也可能停止进程；长期运行使用下方 systemd 配置。

以下启动方式任选一种：

```sh
# 脚本参数指定端口
sh start.sh 9000

# 环境变量指定端口及监听地址
PORT=9000 HOST=0.0.0.0 sh start.sh

# 不依赖 Shell 脚本，直接用 Node.js
node server.mjs --port 9000 --host 0.0.0.0

# 可选 npm 入口，不需要 npm install
npm start -- --port 9000
```

端口参数优先于 `PORT`，`--host` 优先于 `HOST`。支持 1–65535；建议使用 1024 以上端口，以普通用户运行。错误端口或端口被占用时，会显示错误并退出，不会偷偷换端口。启动脚本可从任意工作目录调用。

Windows 可在 PowerShell 中进入解压目录，执行 `node .\server.mjs --port 9000`；无需使用 `start.sh`。本包已在 Linux 验证，Windows 启动命令未在本次环境实测。

本机健康检查：

```sh
curl --fail http://127.0.0.1:8080/_health
# 返回 {"status":"ok"}
```

## 3. Linux 后台常驻与开机启动

下面操作在你自己的服务器执行，需要管理员权限。先将解压目录放到 `/opt/mygame`；确保该路径就是包含 `server.mjs` 和 `dist/` 的目录。

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mygame
sudo mkdir -p /opt/mygame
sudo cp -R MYGAME-server/. /opt/mygame/
sudo chown -R root:root /opt/mygame
sudo find /opt/mygame -type d -exec chmod 755 {} +
sudo find /opt/mygame -type f -exec chmod 644 {} +
command -v node
```

如果 `mygame` 用户已存在，跳过 `useradd`。将 `mygame.service.example` 复制到 `/etc/systemd/system/mygame.service`，修改：

- `ExecStart` 中的 Node 路径，必须与 `command -v node` 一致，且服务用户有权限访问。推荐安装在系统公共路径，不要引用其他用户私有的版本管理器目录。
- `WorkingDirectory` 和 `server.mjs` 路径必须对应实际目录。
- `PORT` 改为所需端口。
- 示例 `HOST=127.0.0.1` 用于同机 Nginx 反向代理；直接通过公网端口访问时改为 `HOST=0.0.0.0`。

```sh
sudo cp /opt/mygame/mygame.service.example /etc/systemd/system/mygame.service
sudo nano /etc/systemd/system/mygame.service
sudo systemctl daemon-reload
sudo systemctl enable --now mygame
sudo systemctl status mygame
sudo journalctl -u mygame -f
```

更新部署包时先停止服务，再替换该目录的部署文件，最后启动。保留上一版完整目录便于回滚。服务不需要写入游戏目录。

```sh
sudo systemctl stop mygame
# 替换部署文件后：
sudo systemctl start mygame
```

## 4. 域名与 HTTPS

可以直接用 IP 和端口访问，也可使用自己服务器上的 Nginx。`nginx.conf.example` 是域名根路径的反向代理示例：将 `game.example.com` 换成你的域名，将上游 8080 与实际 Node 端口保持一致，按你的 Nginx 目录规则启用，执行 `nginx -t` 后重载。

HTTPS 证书及 TLS 在 Nginx 或已有反向代理中配置。本包自带服务器提供 HTTP，不自动申请证书。域名解析、证书与 systemd/Nginx 示例需要在目标服务器配置，本次只验证了自带 Node 服务器。

如果已经有自己的静态网站服务器，也可以只发布 `dist/` 的内容，站点入口设为 `index.html`，正确提供 JavaScript/CSS MIME 类型即可；运行时无需 Node。构建使用相对资源路径。包内的 `.gz` 和 `.br` 是同名资源的预压缩副本，不要直接修改 HTML 去引用这些后缀；自带服务器按浏览器请求自动选择。

## 5. 存档、缓存与排查

- 进度和设置保存在每个玩家浏览器的 `localStorage`，不是保存在服务器上。没有账号、云存档或多人联机。
- **改变协议、域名或端口，会进入不同的浏览器存档空间。** 例如 HTTP 改 HTTPS、8080 改 9000 后，原存档不会自动迁移。保持相同访问地址可继续使用当前格式的存档。
- 战斗中刷新或退出后，从本关开战前恢复；关卡之间自动保存。
- `index.html` 要求重新验证缓存，带版本散列的资源长期缓存；新版本部署后刷新页面。包内已附 gzip/Brotli，服务器无运行时压缩依赖。
- 访问不到：先用 `/_health` 在服务器本机检查，再确认监听地址、端口、安全组、防火墙和反向代理配置。
- 页面打开但战场无法加载：确认完整上传 `dist/assets/`，浏览器支持 WebGL 或 Canvas，检查浏览器控制台是否有缺失资源。
- 端口占用：停止占用该端口的服务，或指定另一个端口。
- 校验包内文件：在解压根目录执行 `sha256sum -c SHA256SUMS`。

首次体验可点「开始远征」，或「浏览界面 → 战斗界面」直接试用磐石、三种橙装与坚韧共鸣示例组合。当前英雄数值、美术占位及未完成机制与打包时的项目一致。
