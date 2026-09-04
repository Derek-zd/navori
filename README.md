# Navori

一个「git 托管平台无关」、单容器可启动、带 Web 界面的轻量 CI/CD 工具。
只要仓库里有 Dockerfile，就能「按分支触发 → 构建镜像 → 推送仓库 →（可选审批）部署到 K8s」，跑完发 webhook 通知。

## 功能

- 仓库接入（任意 git 源，HTTPS/SSH），Dockerfile 扫描
- 触发：webhook（通用格式 + GitLab）、手动运行/重跑、按分支规则
- 构建推送：docker/podman build + push，tag 模板（分支/commit/时间/全局变量/字面量）
- 部署：kubectl set image + rollout status + 失败回滚
- 审批：部署前人工审批（admin/user 两级）
- 通知：跑完发 outgoing webhook（HMAC 签名）
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

镜像内嵌前端，内置 podman rootless（软链为 `docker`）作为业务镜像构建器，K8s Pod 内可直接 build/push，**无需宿主 docker socket、无需 privileged**。运行：

```bash
# 裸机/单机：数据目录挂出来（可选）
docker run -d --name navori -p 3000:3000 \
  -e ADMIN_PASSWORD=your-password -e MASTER_KEY=$(openssl rand -hex 32) \
  -v navori-data:/data navori:latest
```

K8s 部署（MySQL + Secret 注入密钥）直接用模板：[examples/k8s/navori.yaml](examples/k8s/navori.yaml) —— 替换占位值后 `kubectl apply -f` 即可；是否挂 PVC（保历史日志）按模板顶部注释可选。

## 流水线模型

一仓库一流水线，固定步骤：pull → build → push →（approve，可选）→ deploy（可选）。
分支规则按顺序匹配（glob，* 单段 / ** 跨段），首个命中生效，规则字段浅合并覆盖 defaults。
配置见 examples/pipeline-config.json。

## 构建执行形态

构建镜像时 shell 出 docker/podman。容器部署推荐「podman rootless」（无需宿主 docker、无需 privileged），
裸机部署则要求宿主安装 docker/podman + git + kubectl。详见 docs/DESIGN.md §4.1。

## 项目结构

    cmd/server/       入口
    internal/         后端（api/store/engine/tagx/buildx/deploy/notify/...）
    web/              React SPA（Vite + Tailwind）
    docs/             方案与契约（API.md 为唯一权威）

## 文档

- docs/API.md — 接口契约（唯一权威）
- docs/DESIGN.md — 技术方案
- docs/RESEARCH.md — 调研与选型
- docs/TESTING.md — 测试策略
- docs/MILESTONES.md — 里程碑验收


