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

## 配置

配置来源（优先级从高到低）：

1. **环境变量**（推荐容器 / K8s：`-e` 或 Secret 注入）
2. **JSON 配置文件**：路径取 `NAVORI_CONFIG`，缺省探测 `./navori.json`、`/etc/navori/navori.json`。字段名 = 环境变量名小写（snake_case）。模板见 [examples/navori.example.json](examples/navori.example.json)
3. 内置默认值

env 非空时覆盖配置文件。两者都不设时用默认。

> 生产建议：**`MASTER_KEY` 与 `JWT_SECRET` 务必显式设置**（生成：`openssl rand -hex 32`）。留空会首启自动生成并持久化到 `DATA_DIR` 下——裸机没问题，但 K8s 若 `DATA_DIR` 不挂 PVC，Pod 重建会重新生成，导致**已存凭据全部无法解密 / 所有会话失效**。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 3000 | 监听端口 |
| DB_DRIVER | sqlite | sqlite 或 mysql |
| DB_PATH | DATA_DIR/navori.db | sqlite 文件路径 |
| DB_DSN | - | mysql DSN |
| DATA_DIR | data | 数据目录（仓库 / 日志，见下） |
| MASTER_KEY | - | AES-256-GCM 主密钥（32 字节 hex）；留空自动生成到 DATA_DIR/master.key |
| ADMIN_USER | admin | 内置管理员用户名 |
| ADMIN_PASSWORD | - | 管理员密码（留空自动生成） |
| JWT_SECRET | - | JWT 密钥（留空自动生成并持久化；建议显式设置） |
| JWT_EXPIRES_IN | 168h | JWT 有效期 |
| BASE_URL | http://localhost:3000 | 对外地址（webhook 展示用） |
| RUN_RETENTION | 10 | 每流水线保留最近 N 次 run |
| HEALTH_CHECK_INTERVAL | 5 | 镜像仓库/部署环境健康检测间隔（分钟） |
| NAVORI_CONFIG | - | 配置文件路径（可选） |

> 数据库存 MySQL 后，`DATA_DIR` 只放**可重建缓存**（克隆的仓库）与**运行日志**；不再承担业务状态。见下文「存储与持久化」。

### 存储与持久化

| 数据 | 存储 | 说明 |
|---|---|---|
| 业务状态（仓库/流水线/run/凭据密文…） | 数据库 | SQLite（`DB_PATH`）或 MySQL（`DB_DSN`），AutoMigrate 自动建表 |
| 凭据加密密钥 | 内存 | 由 `MASTER_KEY` 提供；未设则首启生成到 `DATA_DIR/master.key` |
| 克隆的仓库（构建缓存） | `DATA_DIR/repos` | 每次 run 增量 pull；**删除后自动重新 clone** |
| run 日志 | `DATA_DIR/logs/{run}/step.log` | 历史详情页读取；按保留策略自动清理，删了不影响新 run |

**结论**：`DATA_DIR` 不需要作为「真持久层」——删掉只是丢缓存和历史日志，凭据、配置、业务数据都在数据库里。

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

## Kubernetes 部署（MySQL）

镜像内置 **podman rootless** 作为构建器（Dockerfile 已将 `podman` 软链为 `docker`），Pod 内即可直接 build/push 业务镜像，**无需宿主 docker socket、无需 privileged**。数据分三层：

| 数据 | 存储 | 说明 |
|---|---|---|
| 业务状态（仓库/流水线/Run/凭据密文） | **MySQL** | `DB_DRIVER=mysql` + `DB_DSN`，AutoMigrate 自动建表 |
| 加密与签名密钥 | **环境变量 / Secret** | `MASTER_KEY`（AES 主密钥）、`JWT_SECRET`（签名），推荐显式注入，见下 |
| 仓库克隆缓存 + run 日志 | **PVC（可选）** 挂 `/data` | 纯缓存；不挂则重启后自动重新 clone、历史日志丢失 |

> **PVC 不是必须的**：`MASTER_KEY` + `JWT_SECRET` 已通过 Secret 注入时，凭据可解密、会话不失效，业务状态全在 MySQL。是否挂 PVC 只影响「仓库克隆缓存是否保留」和「历史 run 日志是否留存」——日志本来就有保留策略自动清理。想省事可先不挂，跑一阵确认需要历史日志再补。

### 1. 准备密钥与 MySQL

```bash
# 生成两个密钥（各一次，妥善保存）
openssl rand -hex 32   # -> MASTER_KEY
openssl rand -hex 32   # -> JWT_SECRET（也可用长随机字符串）
```

MySQL 建库（字符集建议 `utf8mb4`）：

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

`navori.yaml`（替换 `<your-registry>`、`<master-key>`、`<jwt-secret>`、MySQL DSN、密码与 Ingress 域名）。**无 PVC 版**：

```yaml
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
  # 密钥显式注入 -> 重启不失效、不依赖 /data
  MASTER_KEY: "<master-key>"        # openssl rand -hex 32
  JWT_SECRET: "<jwt-secret>"
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
      # 无 securityContext.runAsNonRoot：entrypoint 需以 root 启动一次，
      # chown /data 后经 su-exec 降到 uid 1000(navori) 运行——最终业务进程非 root。
      # 若集群强制非 root(PSA)，见文末「非 root 强制策略」。
      containers:
        - name: navori
          image: <your-registry>/navori:latest
          ports: [{ containerPort: 3000 }]
          envFrom:
            - secretRef: { name: navori-env }
          env:
            # 无 PVC：缓存/日志放容器可写层（Pod 删除即清空）
            - { name: DATA_DIR, value: /data }
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

**要保留克隆缓存与历史日志**：在上面 Deployment 的 `containers[0]` 增加 `volumeMounts`，`spec` 增加 `volumes`，并额外 apply 一个 PVC：

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
```

```yaml
# Deployment spec 内追加（与 containers 同级）
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: navori-data }
# containers[0] 内追加
          volumeMounts:
            - { name: data, mountPath: /data }
```

### 4. 应用

```bash
kubectl create namespace navori
kubectl apply -f navori.yaml
```

- 单副本即可（SQLite/MySQL 均单实例；横向扩容是 v2 的 agent 方向，见 DEFERRED.md）。
- 首启自动 `AutoMigrate` 建表并创建 `admin` 账号；密码取自 `ADMIN_PASSWORD`，留空则打印在 Pod 日志里（`kubectl logs`）。
- 健康检查端点 `GET /api/system/health`。

### 5. 镜像构建能力说明

- 容器内 `docker` 命令实为 `podman`（已软链），以 uid 1000 的 rootless 模式工作，依赖 `/etc/subuid`、`/etc/subgid` 的 `100000:65536` 映射（已写入镜像）。
- 推送镜像到私有仓库时，在 Web 的「镜像仓库」里配置凭证，引擎会用临时 `DOCKER_CONFIG`（位于 `/data/docker-config`）登录，**不会污染全局凭据**。
- 不需要给 Pod 加 `privileged`，也不需要挂载宿主 `/var/run/docker.sock`。

### 6. 集群强制非 root（PSA）时的调整

镜像默认启动流程：`entrypoint.sh` **以 root 运行一次** → chown `/data` 与 `/run/user/1000` → `su-exec` 降到 **uid 1000**（navori）执行。业务进程始终非 root。若你的集群启用了 Pod Security Admission（如 `restricted`）强制 `runAsNonRoot`，把 Deployment 的 `spec` 改为：

```yaml
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      initContainers:
        - name: fix-data-dir
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /data && chown -R 1000:1000 /data /run/user/1000 || true"]
          securityContext: { runAsUser: 0 }
          volumeMounts:
            - { name: data, mountPath: /data }
          env:
            - { name: XDG_RUNTIME_DIR, value: /run/user/1000 }
      containers:
        # ... 同前；entrypoint 以 uid 1000 启动时会跳过 chown，直接 exec navori
```

- `runAsUser: 1000` + `fsGroup: 1000` 让挂载卷对 uid 1000 可写（或由上面的 initContainer 以 root chown）。
- **注意**：此模式下 `/run/user/1000` 是 tmpfs 每次清空，initContainer 只修了镜像层副本；podman 运行时若报 `XDG_RUNTIME_DIR` 问题，可给主容器加 `emptyDir` 挂 `/run`：

```yaml
      volumes:
        - { name: data, mountPath: /data }   # PVC（可选）
        - name: run
          emptyDir: {}
      # containers[0] 追加
          volumeMounts:
            - { name: run, mountPath: /run }
```

> 简化建议：非强制 PSA 的集群直接用上面的「无 PVC 版」清单（root entrypoint 自动 chown + 降权），最省事。


