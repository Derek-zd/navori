# Navori

轻量、自托管的 CI/CD 控制台。仓库里只要有 Dockerfile，就能按分支触发：

**拉取代码 → 构建镜像 → 推送仓库 →（可选审批）→ 部署到 Kubernetes**

单容器启动，SQLite 默认 / MySQL 可选，自带 Web 界面和实时日志。

## 功能

- **仓库**：接入任意 git 源（HTTPS / SSH），自动扫描默认分支与 Dockerfile。
- **触发**：GitLab Push / 通用 webhook、手动运行与重跑、cron、分支规则（glob，首个命中生效）。
- **构建推送**：docker / podman，tag 模板支持分支、commit、时间、变量。
- **部署**：kubectl set image + rollout status，失败自动回滚；0 副本直接跳过。
- **审批**：部署前人工审批，审批始终在 server 执行。
- **执行器**：构建和部署可交给不同机器；部署执行器绑定在部署环境上，测试连接与真实部署走同一路径。
- **通知**：REST / 邮件 / 飞书 / 钉钉 / 企业微信；支持执行器上线、离线告警。
- **其他**：管理员/成员两级权限、审计日志、运行日志 SSE、环境变量与加密凭证。

## 快速开始

需要 Go 1.24+、Node 20+。前端由 `go:embed` 内嵌，所以先构建前端：

```bash
cd web
npm ci
npm run build
cd ..

go build -o navori ./cmd/server
DATA_DIR=./data ADMIN_PASSWORD=your-password ./navori
```

打开 <http://localhost:3000>，用 `admin` / `ADMIN_PASSWORD` 登录。
`ADMIN_PASSWORD` 留空时首次启动会自动生成并打印到日志。

## Docker 构建与运行

```bash
docker build -t navori:latest .

# 先生成并保存，后续启动继续使用同一个值
MASTER_KEY=$(openssl rand -hex 32)

docker run -d --name navori -p 3000:3000 --privileged \
  -e ADMIN_PASSWORD=your-password \
  -e MASTER_KEY="$MASTER_KEY" \
  -v navori-data:/data \
  navori:latest
```

镜像内使用 rootful podman 构建业务镜像，所以 Docker 运行需要 `--privileged`。
国内网络可用 `--build-arg NPM_REGISTRY=... --build-arg GOPROXY=... --build-arg ALPINE_MIRROR=...` 换源。

Kubernetes 模板见 [examples/k8s/navori.yaml](examples/k8s/navori.yaml)：
单实例 + RWO PVC 时，Deployment 请使用 `Recreate`，不要用默认滚动更新。

## 分布式执行器（可选）

默认所有步骤都在 server 本机执行。需要跨网络构建或部署时，在「执行器」页登记 agent。

- **构建执行器**：在流水线的「构建与推送」里选择；留空 = server 本机。
- **部署执行器**：在「部署环境」里绑定；流水线只选部署环境，deploy 自动使用绑定机器。
- 一台 agent 可同时承担构建和部署。
- 选了执行器但机器离线时，步骤保持排队，不会自动回退本机。
- 审批永远在 server，agent 不访问数据库。

构建 agent：

```bash
# 在目标机器上
go build -o navori-agent ./cmd/agent

# 或交叉编译 Linux amd64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags="-s -w" \
  -o dist/navori-agent-linux-amd64 ./cmd/agent
```

在页面创建执行器并复制一次性 token，然后写配置：

```bash
cp examples/navori-agent.env.example navori-agent.env
# 填 NAVORI_URL、AGENT_TOKEN、AGENT_WORKDIR
./navori-agent -check -config navori-agent.env   # 自检
./navori-agent -config navori-agent.env
```

名称在页面登记，token 自动识别，不需要在配置里写 `AGENT_NAME`。
构建机需要 git + docker/podman，部署机需要 kubectl。

生产环境用 systemd 常驻，示例见 [examples/navori-agent.service](examples/navori-agent.service)。
配置项见 [examples/navori-agent.env.example](examples/navori-agent.env.example)。

## 配置

环境变量优先于配置文件；不指定 `-config` 时自动查找 `./navori.env` → `/etc/navori/navori.env`。
完整变量表见 [.env.example](.env.example)。

常用配置：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | Web 端口 |
| `DB_DRIVER` / `DB_DSN` | `sqlite` / - | `sqlite` 或 `mysql` |
| `DATA_DIR` | `data` | 仓库缓存、运行日志、密钥 |
| `MASTER_KEY` | - | 凭据加密密钥（32 字节 hex）；生产必设 |
| `JWT_SECRET` | - | 登录 token 密钥；生产建议设置 |
| `ADMIN_PASSWORD` | - | admin 初始密码；留空自动生成 |
| `BASE_URL` | `http://localhost:3000` | 对外地址，用于 webhook 展示 |

MySQL 场景务必显式设置 `MASTER_KEY`，否则密钥会落在 `DATA_DIR`，Pod 重建后旧密文无法解密。

## 文档

- [docs/API.md](docs/API.md)：接口契约
- [docs/DESIGN.md](docs/DESIGN.md)：技术方案
- [docs/AGENT-DESIGN.md](docs/AGENT-DESIGN.md)：分布式执行设计
- [docs/RESEARCH.md](docs/RESEARCH.md)：调研与选型
- [docs/TESTING.md](docs/TESTING.md)：测试策略
