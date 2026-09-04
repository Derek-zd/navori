# Navori — 轻量 CI/CD 平台 技术方案与实施计划（v2）

> 状态：v2 定稿（按评审收敛：放弃 Jenkinsfile、放弃流水线 DSL、git 仓库无关）
> 配套文档：[RESEARCH.md](./RESEARCH.md)

## 1. 定位

**一句话**：一个「git 托管平台无关」、单容器可启动、带 Web 界面的轻量 CI/CD 工具——只要仓库里有 Dockerfile，就能「按分支触发 → 构建镜像 → 推送仓库 →（可选审批）部署到 K8s」，跑完发送 webhook 通知。

**为什么要自研**：核心诉求是**不绑定任何 git 托管平台**（GitLab / GitHub / Gitea 均可）、**极简、单容器、可控**。现成平台要么绑定托管平台（GitLab CI / Gitea Actions）、要么语法不兼容、要么过重（详见 RESEARCH）。

## 2. 范围与边界

### v1（本计划）

| 能力 | 说明 |
|---|---|
| 仓库管理 | 任意 git 源（HTTPS token / SSH key），Dockerfile 扫描 |
| 触发 | webhook 单入口（通用格式 + GitLab 格式）、手动运行/重跑、定时 |
| 管线 | 固定三段式：pull → build → push → deploy（deploy 可选、可审批） |
| 镜像 tag | 模板化：分支 / commit / 时间 / 全局变量 / 字面量 |
| 部署 | K8s：set image + rollout status + 失败回滚 |
| 审批 | 部署前人工审批（生产环境）—— 引入 admin/user 两级用户 |
| 通知 | 跑完发送 outgoing webhook（HMAC 签名） |
| 存储 | SQLite（默认，单实例）/ MySQL（可选） |
| 可靠性 | 重启后可重跑（不续跑）；webhook 去重 + run 快照 |

### v2（预留，不实现）

- gRPC agent：裸机 SSH 部署目标、横向扩容（多构建节点）
- 多用户 RBAC 细化、多级审批流
- 多实例调度（任务队列/选主）、构建多架构、通知多通道

## 3. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | Go 1.24+ | 单二进制、内嵌 SPA、v2 gRPC agent 原生、K8s/DB 生态成熟 |
| HTTP | chi | 轻量、无魔法、中间件生态好 |
| 存储 | SQLite（modernc.org/sqlite，纯 Go）/ MySQL（go-sql-driver），store 接口 + GORM AutoMigrate | 双后端；SQLite 零依赖默认，MySQL 对接已有设施 |
| 前端 | React + Vite + Tailwind，产物 go:embed | 单容器、无独立静态服务 |
| 构建 | 容器内置 docker/podman 二进制（shell 调用） | 与 aiops 同款已验证；放弃 BuildKit 复杂度 |
| K8s | kubectl 二进制（shell 调用） | 简单一致；client-go 留作备选 |
| Git | 容器内置 git（shell 调用） | 避免 go-git 的 SSH 凭据坑 |
| 实时日志 | SSE | aiops 已验证，简单可靠 |
| 加密 | AES-256-GCM（master key 派生） | 凭证 / 变量加密 |
| 认证 | JWT + 内置 admin/user | 支撑审批 |
| 通知 | outgoing HTTP webhook + HMAC-SHA256 | 通用、接收方可验签 |

## 4. 总体架构

    ┌──────────────────── 单容器 navori-server ────────────────────┐
    │ Go 单二进制（embed: React SPA + SQLite/MySQL + docker/podman）     │
    │                                                                   │
    │   Web UI ── HTTP API(/api/*) ── Trigger(webhook/手动/cron)         │
    │                                     │                             │
    │                               Engine(固定三段式调度/状态机)         │
    │                ┌──────────┬─────────┴──────────┬─────────────┐    │
    │                ▼          ▼                    ▼             ▼    │
    │              git        docker/podman         kubectl       通知   │
    │            (pull)      (build/push)       (set image/回滚)  (webhook)│
    │                                                                   │
    │   SSE 实时日志     (v2) gRPC:9000 ◀── agent 注册/拉任务             │
    └───────────────────────────────────────────────────────────────────┘

运行时依赖：目标 git 仓库、镜像仓库、目标 K8s 集群（kubeconfig），以及一个**镜像构建器**（docker/podman，见下）。SQLite 模式无外部数据库依赖。

### 4.1 构建执行形态（「docker build」的依赖）

平台构建镜像时 shell 出 `docker build`/`docker push`（或 podman），因此**构建永远需要一个构建器**——这是无法消除的物理约束（要产出 OCI 镜像就必然有 builder；Kaniko/BuildKit 只是换成别的形态，v1 为求简单未采用）。按部署形态分三种：

| 部署形态 | 构建器在哪 | 前置要求 |
|---|---|---|
| 裸机直接运行二进制 | 宿主机的 docker/podman | 服务器需安装 dockerd（或 podman） |
| 容器 + 挂载 docker.sock | 宿主机的 dockerd | 容器内只需 docker CLI；`-v /var/run/docker.sock:/var/run/docker.sock`；代价是把宿主 docker 能力交给容器 |
| 容器 + podman rootless（aiops 已验证） | 容器内的 podman | 镜像内装 podman + fuse-overlayfs + shadow（配置 subuid），软链为 docker；**无需宿主 docker、无需 privileged，自包含** |

**v1 默认推荐第 3 种**（容器内 podman rootless），与 aiops 现网一致；裸机部署则要求宿主安装 docker/podman。构建层缓存直接用 daemon 的本地层缓存。

依赖安装方式：容器形态下 git/kubectl/podman 全部打进镜像（自包含，宿主零安装）；裸机形态下 git/kubectl 可随二进制分发（静态链接），docker/podman 因依赖容器运行时栈（crun/runc + conmon + 存储驱动）无法打包进 tarball，须宿主经系统包管理器安装，由 README「前置依赖」清单 + 可选 install 脚本声明。


### 4.2 凭据处理原则（不污染宿主/容器 Docker 配置）

**强制约束**：Navori 不得修改宿主机或容器的全局 Docker 配置，不得调用 `docker login` 写入系统钥匙串/全局 `~/.docker/config.json`，不得触发 `docker-credential-osxkeychain` 等系统凭据助手。

- 镜像仓库**测试连接**：使用 Registry v2 HTTP API 直接验证账号密码（含 Bearer Token 认证流程），完全不走 Docker CLI。
- 镜像**构建**：设置 `DOCKER_CONFIG` 指向应用数据目录 `DATA_DIR/docker-config`（空 `auths`），避免 BuildKit/daemon 读取宿主机全局 Docker 配置与钥匙串。
- 镜像**构建推送**：先手工将用户名/密码 base64 写入临时目录的 `config.json`（`auths`），再通过 `DOCKER_CONFIG` 环境变量让 `docker push` 使用，用完立即删除临时目录。
- Git 拉取凭证：仅通过 clone URL 内嵌 token 或 SSH 环境变量传递，不写入全局 git credential store。
- 这样在裸机 Linux、容器内、macOS 上行为一致，且不会留下全局凭据残留。


## 5. 数据模型（SQLite/MySQL 同 schema，GORM AutoMigrate）

| 表 | 关键字段 | 说明 |
|---|---|---|
| users | id, username, password_hash, role(admin/user) | 审批用；v1 内置 admin + 可增 user |
| registries | id, name, url, username, password_enc, namespace, insecure_skip_tls, is_default | 镜像仓库；密码加密 |
| deploy_targets | id, name, type(k8s/ssh), kubeconfig_enc/ssh_enc, default_namespace, is_default | 部署目标；ssh 为 v2，type 字段现预留 |
| repositories | id, name, git_url, credential_id, default_branch, dockerfile_path, build_context, scan_status | 仓库；扫描状态 |
| git_credentials | id, name, type(https/ssh), secret_enc | git 凭证，加密 |
| pipelines | id, repo_id, config_json, branch_rules_json, notify_json | 一仓库一流水线；配置见 §6 |
| runs | id, pipeline_id, number, trigger_type, ref, commit, status, image_tag, config_snapshot_json, approval_required, approved_by, approved_at, log_dir, error, started_at, finished_at | 执行记录；快照支撑重跑 |
| steps | id, run_id, step_order, name(pull/build/push/approve/deploy), status, log_file | 固定 5 步 |
| variables | id, key, value_enc, secret, description | 全局变量；tag 模板以 {var.KEY} 引用 |
| webhook_events | id, pipeline_id, payload_digest, created_at | webhook 去重审计 |
| audit_logs | id, username, action, target, created_at | 写操作审计（含审批） |

枚举：runs.status = pending/running/awaiting_approval/success/failed/cancelled/rejected；steps.status 同 + skipped。

## 6. 配置模型（无 DSL，纯 UI 表单）

**v1 不引入任何流水线 DSL**（不解析 Jenkinsfile、不解析 YAML）。配置全部经 Web 表单完成，内部存 JSON；提供「导出/导入 YAML」仅作备份/二次编辑，不承诺兼容第三方语法。

### 6.1 defaults（全局默认）

    dockerfile_path: Dockerfile        # 构建用 Dockerfile 路径
    build_context: .                    # 构建上下文
    build_args: {}                      # --build-arg
    platform: linux/amd64
    image_name: myapp                   # 镜像名（不含 registry/namespace）
    tag_template: "{branch}-{commit_short}-{timestamp}"
    registry: default                   # 引用 registries
    deploy:                             # 引用 deploy_targets + workload
      target: prod
      kind: Deployment
      name: myapp
      namespace: prod
      containers: { myapp: {} }         # 空 = 用刚构建镜像；多容器显式映射
      approval: false                   # 是否需审批
      approvers: []                     # 空 = 任意 admin

### 6.2 branch_rules（分支规则，UI 表格，可拖拽排序）

一仓库一流水线；分支规则**同时承担「何时触发」和「用什么配置跑」**：

1. 触发：分支命中任一规则的 branch glob → 触发；无任何规则 → 仅触发 default_branch。
2. 配置：取**首个命中**规则，其字段**浅合并**覆盖 defaults（写了的覆盖、没写的继承；deploy 按子字段浅合并）。
3. 顺序敏感：先匹配先赢（release/* 须排在 ** 之前）。

每条规则可覆盖：dockerfile_path / build_context / build_args / image_name / tag_template / registry / deploy。

    branch_rules:
      - branch: "release/*"
        dockerfile_path: "deploy/release.Dockerfile"
        image_name: "myapp-release"
        deploy: { name: myapp-release, namespace: release, approval: true }
      - branch: "feature/*"
        image_name: "myapp-dev"
        deploy: { name: myapp-dev, namespace: dev }
      - branch: "**"                    # 兜底：其余分支触发，全用 defaults

注意：未写进规则的分支不触发（保守默认）。glob 语义：* 单段、** 跨段（含 /）。

## 7. 管线执行

固定 5 步：pull → build → push →（approve，可选）→ deploy。

- 状态机：runs 见 §5；deploy 步骤为 pending → awaiting_approval → running → success/failed；被拒 → run=rejected（deploy 步骤 skipped）。
- 工作区：每 run 独立 data/workspaces/{run_id}；同仓库同分支增量 pull 复用缓存。
- 并发：每流水线最多 1 个 in-flight；运行中新 push 排队，只保留最新（合并中间排队）。
- 去重：commit sha 落 webhook_events，同 sha 已跑过 → 跳过并记审计；可手动重跑打破。
- 取消：context 级联；build 杀进程组；deploy 阶段不可中断（已知限制，同 aiops）。
- 日志：每 step 一个文件，DB 只存路径，SSE 按行 tail。
- 快照与重跑：每 run 存 config_snapshot_json（分支规则解析后的最终配置）。「重跑」回放快照（同 commit + 同解析配置），确定可复现；「运行」拉默认分支最新 HEAD 用当前配置。

### 重启语义（reaper）

启动时：runs 中 running/pending → 标记 failed（reason=「服务重启中断」）。awaiting_approval 为持久状态**不受影响**，重启后仍可审批。即「可重跑、不续跑」。

## 8. tag 模板与变量

模板为 {var} 占位 + 字面量；无占位符即纯字面量（如 "v1.2.3"）。

| 变量 | 含义 | 例 |
|---|---|---|
| {branch} | 清洗后分支名 | feature-login |
| {branch_raw} | 原始分支名 | feature/login_v2 |
| {commit} | 完整 sha | 8f3a9c1... |
| {commit_short} | 前 7 位 | 8f3a9c1 |
| {timestamp} | YYYYMMDD-HHMMSS | 20260813-171522 |
| {unix} | epoch 秒 | 1765633000 |
| {build_number} | run 序号 | 42 |
| {var.KEY} | 全局变量 | 引用 variables 表 |

- 分支名清洗：小写 → 非法字符换 - → 去首尾 .- → 截 60 字符 → 空则回退 branch。
- 最终 tag 校验：匹配 [a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}。
- 手动运行弹窗可临时覆盖 tag 模板与全局变量（不影响已保存配置），满足「打特定版本」。

## 9. 触发

| 类型 | 实现 |
|---|---|
| webhook | 单入口 /api/webhooks；支持通用格式 {ref, commit, repo_url} 与 GitLab push 原生格式；每流水线 secret token 校验；按仓库 URL 归一化路由；payload digest 去重 |
| 手动 | 「运行」（默认分支 HEAD）/「重跑」（快照回放） |
| 定时 | 每流水线可配 cron 表达式 |

所有入口统一走 triggerPipeline(pipelineId, triggerType, ref, commit, params)，保证日志与审计一致。


### 9.1 定时任务与状态检测（Scheduler）

**目标**：程序产生的所有数据/状态都只在自己数据目录内；提供两类定时能力：

1. **资源状态检测**：周期检测镜像仓库 / 部署环境连通性，自动更新 `last_test_status` / `last_test_at`，前端状态灯无需手动刷新。
2. **流水线定时触发**：除 webhook / 手动外，按 cron 触发流水线；可选“有新 commit 才跑”减少空跑。

**设计约束**
- 单实例实现，启动时加载任务；不引入分布式锁；v2 多实例再做选主/队列。
- 所有调度器数据落库，重启后恢复。
- 不引入外部 cron 服务；优先使用纯 Go `robfig/cron`（或内置 `time.Ticker` 扫表）。

**数据模型**
- 流水线表（或独立 scheduled_runs）增加 `schedule_cron` 字段（cron 表达式），`schedule_enabled` 开关。
- 资源状态检测不需要建表，复用现有 `last_test_status` / `last_test_at` 字段。

**实现**
- `internal/scheduler` 包：启动时启动 goroutine，每 30s 扫一次 `schedule_enabled=true` 的流水线，命中 cron 则复用 `triggerPipeline`。
- `internal/healthchecker` 包：每 N 分钟（默认 5 分钟）遍历 registries / deploy_targets，调用现有 `registryx.CheckLogin` / `kubectl get ns`，结果写回数据库。
- 日志统一写到 `DATA_DIR/logs/`，临时构建凭据写到 `DATA_DIR/buildx` / 临时目录，绝不写用户 `~/.docker`、`~/.kube`。

**里程碑**
- P0：资源状态检测定时任务（补全状态灯闭环）
- P1：流水线 cron 定时触发（基础）
- P2：定时触发 + 有新 commit 才跑

## 10. 部署与审批

- 部署：kubectl set image {kind}/{name} {container}={image} -n {ns} → kubectl rollout status --timeout=5m → 全部容器就绪判定（aiops 同款严格判定）→ 失败且非首次部署自动 rollout undo。
- 审批：deploy.approval=true 时，deploy 步骤进入 awaiting_approval；admin（或 approvers 名单内用户）点通过/拒绝；拒绝 → run=rejected。审批动作写 audit_logs。
- 多容器：容器名==镜像名自动对应，配不上的显式映射，未映射容器不动（绝不清空）。

## 11. 通知（多通道模块）

**v1 现状**：每流水线配单一 notify_webhook_url + notify_secret，run 到终态后 POST（HMAC-SHA256 签名），重试 3 次。

**演进为独立通知模块（规划）**：把通知从「单通道裸 webhook」升级为可配置、可复用、多通道的模块。

### 11.1 模型三层

```
NotifyChannel（通知通道，可复用资源）
  ├── 通用 REST API（兼容现有 webhook + HMAC）
  ├── 飞书机器人 / 钉钉机器人 / 企业微信机器人
  └── 邮件（SMTP：发信服务器 + 账号 + 收件人）

NotifyRule（流水线 → 通道绑定）
  └── 流水线选择「用哪些通道」+「哪些事件通知」（成功/失败/审批等）

Template（可选，后续）
  └── 每种通道可定制消息格式（飞书卡片 / 钉钉 markdown / 邮件 HTML）
```

### 11.2 事件与渲染

- 统一生成事件 payload（沿用现有：event/pipeline/repo/branch/commit/status/image_tag/error/finished_at）。
- 按通道类型渲染：REST 用 JSON、飞书/钉钉/企微按各自机器人消息格式、邮件用 SMTP + HTML。
- 每种通道一个 sender，复用现有重试与「失败不阻断 run」。

### 11.3 里程碑

- P0：通用 REST + 邮件（SMTP）；通道管理页；流水线选择通道+事件。
- P1：飞书/钉钉/企业微信 机器人（本质都是「往 webhook 发特定格式」）。
- P2：模板定制、按事件细分、重试可配、审批通知。

### 11.4 与入站 webhook 区别

- 入站 webhook（/api/webhooks）：外部事件触发流水线，是「触发」。
- 出站通知：流水线终态后主动通知第三方，是「通知」。
- 两者不混；通用 REST 通道可兼容现有裸 webhook 用法。

## 12. 存储与多实例

- SQLite（默认）：DB_DRIVER=sqlite，DB_PATH=data/navori.db，WAL 模式，**单实例**。
- MySQL：DB_DRIVER=mysql，DB_DSN=...，store 接口同一套。
- 多实例：**v1 明确单实例**。原因：构建执行在容器内（docker/podman + 本地 workspace）是节点本地资源，多副本无法迁移在途构建；要横向扩容需任务队列/选主/run 归属协调，这正是 v2 agent 的职责。MySQL 双存储是「对接已有设施 + 为未来铺路」的卫生措施，不是 v1 扩容手段。
- 性能瓶颈评估：CI 触发频率（webhook 每分钟个位数）下，数据库（含 SQLite）远非瓶颈；真正瓶颈是构建执行器（docker/podman 并发上限，默认并发 2 可配）。

## 13. 安全

- 加密：master key（环境变量或首启生成 data/master.key，0600）派生 AES-256-GCM，加密 kubeconfig/registry 密码/git 凭证/secret 变量；API 返回脱敏。
- 认证：JWT（httpOnly cookie）；登录失败限速；v1 内置 admin + 初始化改密。
- webhook：每流水线 secret token；payload digest 去重防重放。
- 注入防护：image_name/app 名白名单正则、SQL 全参数化、shell 参数转义审查。
- 审计：audit_logs 记录写操作与审批（action/target/username），失败不阻断主流程。
- 构建隔离：构建上下文仅限仓库目录；build/push/deploy 经 shell 在平台容器内执行（与 aiops 相同信任模型，文档明示）。

## 14. UI 页面清单

| 页面 | 内容 |
|---|---|
| Login | 登录 |
| Dashboard | 流水线/最近 run 概览、系统健康、磁盘占用 |
| 仓库 | 列表（扫描状态）、添加/删除、手动扫描 |
| 镜像仓库 | 列表、表单、登录校验 |
| 部署目标 | 列表、表单（kubeconfig）、连通性测试 |
| 流水线 | 列表；创建向导；详情（分支规则表格、构建/部署/通知配置） |
| Run 详情 | step 视图、SSE 日志、运行/重跑/停止、审批通过/拒绝、参数覆盖 |
| 待审批 | 等待审批的 run 列表（快速入口） |
| 设置 | webhook 地址展示、全局变量、用户管理、审计 |

## 15. 目录结构

    navori/
    ├── cmd/server/main.go          # 入口：配置、迁移、reaper、服务组装
    ├── internal/
    │   ├── api/                    # HTTP handlers（按资源分组）
    │   ├── webhook/                # webhook 解析/校验/去重/路由
    │   ├── engine/                 # 固定三段式调度、状态机、取消、快照
    │   ├── gitx/                   # git clone/pull/扫描
    │   ├── buildx/                 # docker/podman build + push 封装
    │   ├── tagx/                   # tag 模板引擎 + 分支名清洗
    │   ├── deploy/                 # kubectl 部署/回滚/审批
    │   ├── notify/                 # outgoing webhook + HMAC
    │   ├── store/                  # store 接口 + sqlite/mysql 实现 + 迁移
    │   ├── secrets/                # AES-256-GCM 加密
    │   └── auth/                   # JWT + 用户
    ├── web/                        # React SPA（Vite）
    ├── docs/                       # 本目录
    ├── examples/                   # 示例配置/分支规则
    ├── Dockerfile                  # 多阶段构建（含 git/docker(podman)/kubectl）
    └── go.mod

## 16. 里程碑（每阶段验收后才进入下一阶段）

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| M1 骨架(1-2天) | go mod、config、store(SQLite/MySQL)+迁移、SPA 壳 embed、auth(admin/user)、Dockerfile、health | 单容器启动，UI 可访问，登录可用 |
| M2 仓库+触发(2-3天) | repo/凭证 CRUD、git clone/pull、Dockerfile 扫描、webhook(通用+GitLab)、去重、分支规则 | 任意 git 仓库接入 → push 触发 run |
| M3 构建推送(3-4天) | registry CRUD、docker build、tag 模板、push、run/steps 状态机、SSE 日志、reaper、快照重跑 | 仓库 → 镜像按模板 tag 推送成功 |
| M4 部署+审批+通知(3-4天) | deploy_target CRUD、kubectl set image/rollout/rollback、审批闸门、outgoing webhook | 镜像更新 → 就绪；需审批则等待；跑完收到通知 |
| M5 打磨(2-3天) | 核心单测(tagx/engine/分支规则)、审计、README、示例 | 核心路径单测覆盖；文档齐全 |

> 依赖：M3 依赖 M2；M4 依赖 M3；M1 贯穿。总工期约 2-3 周。

## 17. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 生产部署误操作 | 事故 | 审批闸门 + 审计 + 失败自动回滚 |
| 构建在平台容器内执行 | 隔离性弱 | v1 明示信任模型；v2 步骤容器化/agent |
| 单实例 | 无 HA | v1 明确；横向扩容走 v2 agent |
| 同秒 tag 冲突 | 镜像覆盖 | 默认 tag 含 commit_short（不可变）；手动指定 tag 由用户负责 |
| docker build 不可中途取消 | 长构建卡住 | 杀进程组尽力取消；长 build 不可中断为已知限制 |

---

## 18. 领域模型方向（2026-08-18 决策记录）

- 部署历史/回滚 **不属于**「部署环境」；DeployTarget 仅作为环境资源，可被多流水线/应用共用。
- 部署历史与回滚应归属「应用/流水线」维度；短期以「重跑目标 commit」作为回滚手段，正式回滚在应用版本管理模型落地后实现（切历史镜像）。
- 流水线引入「分组」字段作为应用/产品雏形，把多流水线（如前后端）归到一个产品；后续可升级为 Application 实体并支持多环境、版本管理。
