# Navori

一个「git 托管平台无关」、单容器可启动、带 Web 界面的轻量 CI/CD 工具。
只要仓库里有 Dockerfile，就能「按分支触发 → 构建镜像 → 推送仓库 →（可选审批）部署到 K8s」，跑完发 webhook 通知。

## 功能

- 仓库接入（任意 git 源，HTTPS/SSH），Dockerfile 扫描
- 触发：webhook（通用格式 + GitLab）、手动运行/重跑、按分支规则
- 构建推送：docker/podman build + push，tag 模板（分支/commit/时间/全局变量/字面量）
- 部署：kubectl set image + rollout status + 失败回滚
- 审批：部署前人工审批（admin/user 两级）
- 通知：跑完发 outgoing webhook（HMAC 签名）；可把执行器上线/离线告警投递到指定通道
- 存储：SQLite（默认）/ MySQL 可选
- 实时日志：SSE 流式输出

## 快速开始（本地 / 裸机）

```bash
# 需要本机装 go 1.24+、node 20+；或直接用 Docker（见下节）
go build -o navori ./cmd/server   # 前端由 go:embed 内嵌，需先 cd web && npm ci && npm run build
DATA_DIR=./data ADMIN_PASSWORD=your-password ./navori
```

首次启动会生成 admin 账号（默认用户名 admin），密码来自 ADMIN_PASSWORD（留空则自动生成并打印到日志）。
浏览器打开 http://localhost:3000 登录。

## 配置

配置来源只有两种（**环境变量 > 配置文件**，环境变量非空时覆盖配置文件；都不设则用默认）：

1. **环境变量** —— K8s/容器用 `-e` 或 Secret 注入
2. **配置文件（可选）** —— `.env` 风格 `KEY=VALUE` 文本，与 .env.example 同格式：
   ```bash
   ./navori -config /path/to/navori.env      # 显式指定
   ./navori                                  # 不指定则自动探测 ./navori.env → /etc/navori/navori.env
   ```
   模板见 [.env.example](.env.example)（`cp .env.example navori.env` 改之即可）。

完整变量表见 [.env.example](.env.example)。几个关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| DB_DRIVER / DB_DSN | sqlite / - | `sqlite` 或 `mysql`；mysql 需 DSN：`user:pass@tcp(host:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local` |
| DATA_DIR | data | 仓库克隆缓存 + run 日志（**纯缓存**，非业务状态） |
| MASTER_KEY | - | AES 主密钥（`openssl rand -hex 32`）；**生产必设**，否则自动生成到 DATA_DIR/master.key |
| JWT_SECRET | - | JWT 密钥；生产建议显式设置，否则自动生成到 DATA_DIR/jwt.secret |
| ADMIN_PASSWORD | - | admin 初始密码；留空首启自动生成并打印日志 |
| BASE_URL | http://localhost:3000 | webhook 展示用外网地址 |

> **为什么 MySQL 还要设 MASTER_KEY/JWT_SECRET**：凭据（Git/镜像仓库密码、kubeconfig）以 AES 密文存库，解密靠 `MASTER_KEY`。它不设就会落到 `DATA_DIR/master.key`；`DATA_DIR` 只是缓存目录，Pod 重建即丢 → 密钥重建 → 旧密文全解不开。设了 env/文件里的 `MASTER_KEY` 就不依赖 DATA_DIR 持久化（PVC 也就不用挂了）。

## Docker 镜像

```bash
docker build -t navori:latest .
# 国内网络慢可指定镜像源：
docker build \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg GOPROXY=https://goproxy.cn,direct \
  --build-arg ALPINE_MIRROR=https://mirrors.aliyun.com/alpine \
  -t navori:latest .
```

镜像内嵌前端，内置 **rootful podman**（软链为 `docker`，与 aiops 同款方案）作为业务镜像构建器。K8s Pod 内直接 build/push 需要 **`privileged: true`**（构建时挂载 overlay 存储），裸机/单机 docker run 需要加 `--privileged`。运行：

```bash
# 裸机/单机：privileged 供 podman 挂载 overlay；数据目录挂出来（可选）
docker run -d --name navori -p 3000:3000 --privileged \
  -e ADMIN_PASSWORD=your-password -e MASTER_KEY=$(openssl rand -hex 32) \
  -v navori-data:/data navori:latest
```

K8s 部署（MySQL + Secret 注入密钥）直接用模板：[examples/k8s/navori.yaml](examples/k8s/navori.yaml) —— 替换占位值后 `kubectl apply -f` 即可；是否挂 PVC（保历史日志）按模板顶部注释可选。

## 流水线模型

一仓库一流水线，固定步骤：pull → build → push →（approve，可选）→ deploy（可选）。
分支规则按顺序匹配（glob，* 单段 / ** 跨段），首个命中生效，规则字段浅合并覆盖 defaults。
配置见 examples/pipeline-config.json。

## 构建执行形态

构建镜像时 shell 出 docker/podman。K8s 容器部署采用 **rootful podman + privileged**（与 aiops 同款、已验证）；
裸机部署则直接使用宿主 docker/podman + git + kubectl。详见 docs/DESIGN.md §4.1。

## 分布式执行（可选）

默认所有步骤在本机执行。需要跨网络构建/部署时，可在「执行器」页登记 agent，并把流水线的
`execution.buildAgent` / `execution.deployAgent` 设为 label selector。

执行器页面用「可以执行构建 / 可以执行部署」两个开关设置能力，分别写入 `build=true` / `deploy=true`
标签；流水线的构建 selector 填 `build=true`，部署 selector 填 `deploy=true`。一台机器可以同时勾选两类，
两个 selector 分别指向这两个标签即可。已有的 `role=build` / `role=deploy` 标签仍可继续使用。

pull/build/push 走构建执行器，deploy 走部署执行器，审批始终留在 server。
如果两个 selector 都留空，步骤仍由 server 本机执行；一旦填了 selector 但没有匹配的在线执行器，
步骤会保持排队直到超时，不会自动回退本机。

构建 agent 二进制：

```bash
go build -o navori-agent ./cmd/agent
cp examples/navori-agent.env.example navori-agent.env
# 在「执行器」页创建 agent，把一次性 token 复制到 AGENT_TOKEN，然后：
./navori-agent -config navori-agent.env
```

启动前可以先做一次本地自检（只检查工作目录和 git/docker/podman/kubectl，不连接 server）：

```bash
./navori-agent -version
./navori-agent -check -config navori-agent.env
```

生产环境用 systemd 常驻（示例：[examples/navori-agent.service](examples/navori-agent.service)）：

```bash
sudo useradd --system --home /var/lib/navori-agent --shell /usr/sbin/nologin navori
sudo install -d -o navori -g navori /var/lib/navori-agent /etc/navori
sudo install -m 0600 -o navori -g navori navori-agent.env /etc/navori/navori-agent.env
sudo install -m 0755 navori-agent /usr/local/bin/navori-agent
sudo install -m 0644 examples/navori-agent.service /etc/systemd/system/navori-agent.service
# 如果使用 Docker，把 navori 加入 docker 组（或改用 podman 并配置对应 socket 权限）
sudo usermod -aG docker navori
sudo systemctl daemon-reload
sudo systemctl enable --now navori-agent
sudo journalctl -u navori-agent -f
```

`-check` 缺失工具时只打印警告并返回 0，因为同一份二进制可能只承担构建或只承担部署；
实际派发由执行器标签和流水线 selector 决定。

所有 agent 使用同一个二进制和同一套配置模板，但每台必须使用独立的 `AGENT_TOKEN`；
名称在「执行器」页面登记，agent 通过 token 自动识别，不需要在配置文件里填写名称。
标签在「执行器」页面维护（server 为准，agent 上报的 `AGENT_LABELS` 不会覆盖登记值）。能执行什么由
机器上实际安装的工具决定：构建机需要 git + docker（或软链为 docker 的 podman），部署机需要 kubectl。

agent 只主动发起出站 HTTPS（hello/心跳/领任务/传日志/报结果），不监听端口、不访问数据库、
不写 server 的 DATA_DIR。凭据随任务下发，仅以 0600 临时文件或临时 DOCKER_CONFIG 使用后删除。
配置项见 [examples/navori-agent.env.example](examples/navori-agent.env.example)，协议见 docs/API.md §十四。

## 项目结构

    cmd/server/       服务端入口
    cmd/agent/        分布式执行 agent 入口
    internal/         后端（api/store/runner/tagx/buildx/deploy/notify/...）
    web/              React SPA（Vite + Tailwind）
    docs/             方案与契约（API.md 为唯一权威）

## 文档

- docs/API.md — 接口契约（唯一权威）
- docs/DESIGN.md — 技术方案
- docs/RESEARCH.md — 调研与选型
- docs/TESTING.md — 测试策略
- docs/MILESTONES.md — 里程碑验收


