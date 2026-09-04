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

## 快速开始

    # 构建前端
    cd web && npm install && npm run build && cd ..
    # 构建后端（内嵌前端）
    go build -o navori ./cmd/server
    # 运行
    DATA_DIR=./data ADMIN_PASSWORD=your-password ./navori

首次启动会生成 admin 账号（默认用户名 admin），密码来自 ADMIN_PASSWORD（留空则自动生成并打印到日志）。
浏览器打开 http://localhost:3000 登录。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 3000 | 监听端口 |
| DB_DRIVER | sqlite | sqlite 或 mysql |
| DB_PATH | DATA_DIR/navori.db | sqlite 文件路径 |
| DB_DSN | - | mysql DSN |
| DATA_DIR | data | 数据目录（master key / jwt secret / 仓库 / 日志） |
| ADMIN_USER | admin | 内置管理员用户名 |
| ADMIN_PASSWORD | - | 管理员密码（留空自动生成） |
| JWT_SECRET | - | JWT 密钥（留空自动生成并持久化） |
| BASE_URL | http://localhost:3000 | 对外地址（webhook 展示用） |
| RUN_RETENTION | 10 | 每流水线保留最近 N 次 run |

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

---

## Kubernetes 部署（MySQL + PVC）

镜像内置 **podman rootless** 作为构建器（Dockerfile 已将 `podman` 软链为 `docker`），Pod 内即可直接 build/push 业务镜像，**无需宿主 docker socket、无需 privileged**。平台数据分两层：

| 数据 | 存储 | 说明 |
|---|---|---|
| 结构化元数据（仓库/流水线/Run/凭据加密密文等） | **MySQL** | `DB_DRIVER=mysql` + `DB_DSN`，GORM AutoMigrate 自动建表 |
| master.key / 克隆的仓库 / 日志 / 临时 docker config | **PVC** 挂载到 `/data` | 凭据 AES 密钥在此，**必须持久化**，否则重启后所有已存凭据无法解密 |

> ⚠️ 即使使用 MySQL，PVC 也**不可省略**：`/data/master.key` 是凭据解密的信任根，且仓库克隆、运行日志都写在 `/data` 下。

### 1. 准备 MySQL

建一个独立库与账号（字符集建议 `utf8mb4`）：

```sql
CREATE DATABASE navori CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'navori'@'%' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON navori.* TO 'navori'@'%';
```

DSN 格式（Go `go-sql-driver/mysql`，需 `parseTime=true`）：

```
navori:<strong-password>@tcp(mysql.host:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local
```

### 2. 构建并推送镜像

```bash
# 前端会由多阶段构建自动在容器内编译并 go:embed，无需本机 npm
docker build -t <your-registry>/navori:latest .
docker push <your-registry>/navori:latest
```

### 3. 部署清单

`navori.yaml`（替换 `<your-registry>`、MySQL DSN、密码与 Ingress 域名）：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: navori-data
  namespace: navori
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 10Gi
  # storageClassName: <你的 SC，若集群无默认需指定>
---
apiVersion: v1
kind: Secret
metadata:
  name: navori-env
  namespace: navori
type: Opaque
stringData:
  # MySQL 模式
  DB_DRIVER: "mysql"
  DB_DSN: "navori:<strong-password>@tcp(mysql.host:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local"
  # 首启自动生成并持久化到 /data/jwt.secret；留空即可，也可显式指定
  JWT_SECRET: ""
  JWT_EXPIRES_IN: "168h"
  ADMIN_USER: "admin"
  ADMIN_PASSWORD: "<admin-password>"   # 留空则首启打印到日志
  BASE_URL: "https://navori.your.domain"
  RUN_RETENTION: "10"
  HEALTH_CHECK_INTERVAL: "5"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: navori
  namespace: navori
  labels: { app: navori }
spec:
  replicas: 1
  selector:
    matchLabels: { app: navori }
  template:
    metadata:
      labels: { app: navori }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000          # 对应镜像内 navori 用户，podman rootless 需要
        fsGroup: 1000
      containers:
        - name: navori
          image: <your-registry>/navori:latest
          ports: [{ containerPort: 3000 }]
          envFrom:
            - secretRef: { name: navori-env }
          # /data 必须在 podman rootless 下可写；entrypoint 已负责 chown
          volumeMounts:
            - { name: data, mountPath: /data }
          readinessProbe:
            httpGet: { path: /api/system/health, port: 3000 }
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /api/system/health, port: 3000 }
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests: { cpu: "100m", memory: "256Mi" }
            limits:   { cpu: "2",    memory: "2Gi" }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: navori-data }
---
apiVersion: v1
kind: Service
metadata:
  name: navori
  namespace: navori
spec:
  selector: { app: navori }
  ports: [{ port: 3000, targetPort: 3000 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: navori
  namespace: navori
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  ingressClassName: nginx
  rules:
    - host: navori.your.domain
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: navori
                port: { number: 3000 }
```

### 4. 应用

```bash
kubectl create namespace navori
kubectl apply -f navori.yaml
```

- 单副本即可（SQLite/MySQL 均单实例；横向扩容是 v2 的 agent 方向，见 DEFERRED.md）。
- 首启会自动 `AutoMigrate` 建表，并创建 `admin` 账号；密码取自 `ADMIN_PASSWORD`，留空则打印在 Pod 日志里。
- 健康检查端点为 `GET /api/health`（请确认该路由存在；若不存在，可临时去掉探针或用 `/` 代替）。

### 5. 镜像构建能力说明

- 容器内 `docker` 命令实为 `podman`（已软链），以 uid 1000 的 rootless 模式工作，依赖 `/etc/subuid`、`/etc/subgid` 的 `100000:65536` 映射（已写入镜像）。
- 推送镜像到私有仓库时，在 Web 的「镜像仓库」里配置凭证，引擎会用临时 `DOCKER_CONFIG`（位于 `/data/docker-config`）登录，**不会污染全局凭据**。
- 不需要给 Pod 加 `privileged`，也不需要挂载宿主 `/var/run/docker.sock`。


