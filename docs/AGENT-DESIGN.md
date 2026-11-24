# Navori 分布式执行 Agent 设计方案（v1.0）

> 状态：**P1–P3 已实现并验收（2026-11-18，提交 4b58903/cba31d8/00a8234）**；P4 真实环境联调待做。
> 关联：`docs/DESIGN.md` §2（v2 范围）、§4（架构）、§12（多实例）、`docs/API.md`（契约，实施时同步）。

## 0. 交接摘要（新会话从这里开始）

**仓库**：`/Users/derek/code/ops/navori`，分支 `main`，基线 `553ea3d`，Go 1.24.5。

**当前状态**：P1 管理端/协议、P2 `internal/runner` 抽离、P3 派发/租约/日志/结果/取消已完成；本地双 agent + 本地 git + fake docker/kubectl 的 e2e 通过，SQLite 下验证了路由、重派、取消、SIGTERM。P4 需真实构建机与 K8s 环境。

**必读顺序**：本文 §1–§8（背景/决策/协议/数据模型）→ §18（文件级实现指南）→ `docs/DESIGN.md` §4.1、§12.1。

**三条硬约束**

1. **不配 selector 时，行为必须与现在完全一致**：本机执行、同样的日志文件、同样的状态与回滚语义。
2. **agent 不读写数据库、不写 `/data`**；所有状态变更只发生在 server。
3. 不新增第三方依赖（当前额外依赖只有 `golang.org/x/sys`，已用于磁盘统计）。

**不要做的事**：不要动 deploy 语义（0 副本短路、失败回滚）；不要把审批下发到 agent；不要另建 jobs 表（job 就是 step）；不要用 agent 本机时钟做租约判断。

**第一步**：`go build ./... && go test ./...` 确认基线绿色，然后按 §18.3 做 P1。

## 1. 背景与约束

现网出现一个 v1 单实例模型无法覆盖的真实场景：

| 环节 | 位置 | 约束 |
|---|---|---|
| navori 服务 | 火山引擎 VKE | 可公网 HTTPS 访问 |
| 构建（build/push） | 国外服务器 | 国内拉 Docker 基础镜像太慢，必须国外构建 |
| 镜像仓库 | 华为云 SWR（国内） | 构建产物必须落到这里 |
| 部署（kubectl） | 萧山机房 K8s | **与火山引擎不互通**，navori 无法直连 |

即：一条流水线的三个步骤分别要在三张网络上完成，而 navori 只能待在其中一张网里。v1 的「单实例 + 本机执行所有步骤」对此无解。

## 2. 目标与非目标

### 目标

1. navori 能调度**分布在不同网络**的执行器完成一条流水线的步骤，run 仍是**一个**、状态与日志**统一**。
2. 执行器是**独立二进制**，直接调用宿主机能力（git / docker 或 podman / kubectl），无需在目标网络暴露入站端口。
3. 与 v1 完全兼容：不配 agent 时行为与今天完全一致（本机执行）。
4. 复用现有执行代码（`internal/gitx`、`internal/buildx`、`internal/deploy`），server 与 agent 走同一套实现，避免行为漂移。

### 非目标（本期不做）

- 多 navori 实例 / 选主 / 高可用（agent 解决的是「跨网络执行」，不是「server HA」）
- DAG / 并行步骤（仍是顺序执行）
- 多租户 RBAC 细化
- 构建多架构（payload 已留 `platform`，但不在验收范围）
- 裸机 SSH 部署目标（v2 原计划的另一半，另做）

## 3. 总体形态

```
                       公网 HTTPS (443)，agent 主动出站
   ┌──────────────┐   ◀───────────────────────────────┐
   │ navori-server│                                   │
   │ (火山 VKE)   │   ──── 任务/日志/结果走同一连接 ────▶│
   └──────┬───────┘                                   │
          │                                  ┌────────┴─────────┐
          │ 只读写自己的 DB / 本地 workspace   │ agent-overseas-1 │
          │                                  │ labels: role=build,
          │                                  │         region=overseas
          │                                  │ 执行 pull/build/push
          │                                  └──────────────────┘
          │                                  ┌──────────────────┐
          └─────────────────────────────────▶│ agent-xiaoshan-1 │
                                             │ labels: role=deploy,
                                             │         site=xiaoshan
                                             │ 执行 deploy(kubectl)
                                             └──────────────────┘
```

关键点：**server 永不主动连 agent**。所有流量都是 agent → server 的出站 HTTPS，因此国外机器、萧山机器都不需要公网入站、不需要 NAT、不需要 VPN。

本期实际部署：`agent-overseas-1` 跑在一台物理服务器上（宿主 Docker，systemd 常驻）；`agent-xiaoshan-1` 跑在萧山机房一台可执行 kubectl 的机器上。

## 4. 关键决策

| # | 决策 | 理由 | 被否方案 |
|---|---|---|---|
| D1 | **pull 模式**（agent 轮询领任务） | 两个执行点都只能出站；pull 让网络要求降到最低 | server push（要入站/反向隧道） |
| D2 | **HTTP + JSON 长轮询**，不用 gRPC | 复用 chi 路由与现有鉴权/错误码；无额外端口、无 HTTP/2 依赖；便于 curl 调试。docs/DESIGN.md §4 架构图里的 gRPC 是原设想，可后续替换，协议层已隔离 | gRPC（重、调试成本高） |
| D3 | **步骤级路由**，不是流水线级 | 场景天然跨机：build 在国外、deploy 在萧山，一条流水线必须拆到两个 agent | 流水线绑定单 agent（做不到）；拆两条流水线（状态割裂、tag 要人工传） |
| D4 | **job == step**（1:1，不建独立 jobs 表） | 步骤本就是顺序执行的最小单元；直接复用 `steps` 行做租约与状态，少一张表、少一套状态同步 | 独立 jobs 表 + 映射 |
| D5 | **执行器参数化重构**（`internal/runner`） | agent 上没有 DB，必须把「读 DB 拿凭据」与「真正执行」拆开；两边共用同一实现 | agent 内复制一份执行代码（必然漂移） |
| D6 | **selector 用 label 表达式**（`role=build,region=overseas`） | 与 K8s 心智一致；多台同类 agent 可自动负载分担，不需要流水线绑死某台机器 | 流水线直接绑 agent ID（换机器要改流水线） |
| D7 | **凭据随任务下发，不落 agent 磁盘** | agent 无 DB、无配置中心；TLS + 短时效 + 用完即删是当前最简可行方案 | agent 本地保存凭据（泄露面更大） |
| D8 | **审批步骤永远在 server** | 人工闸门属于控制面，不应下放到执行面 | 审批也下发 |

## 5. 协议

### 5.1 端点

所有 agent 端点前缀 `/api/agent`，鉴权 `Authorization: Bearer <agent-token>`（与用户 JWT 完全隔离的中间件）。

| 方法 | 路径 | 作用 | 频率 |
|---|---|---|---|
| POST | `/api/agent/hello` | 握手，返回协议版本/心跳间隔/上限 | 启动时 + 重连 |
| POST | `/api/agent/heartbeat` | 心跳 + 续租 + 取取消指令 | 15s |
| POST | `/api/agent/jobs/claim` | 长轮询领任务 | 空闲时循环（服务端 hold 25s） |
| POST | `/api/agent/jobs/{id}/log` | 日志批量上行 | 1s 或 200 行 |
| POST | `/api/agent/jobs/{id}/result` | 终态上报 | 步骤结束 |

### 5.2 握手

```json
POST /api/agent/hello
{ "version": "0.1.0", "labels": {"role":"build","region":"overseas"}, "host": "build-01" }

200 { "protocol": 1, "name": "overseas-build-1", "serverVersion": "1.x", "heartbeatSeconds": 15,
      "claimWaitSeconds": 25, "maxStepSeconds": 3600, "now": "2026-11-18T02:00:00Z" }
```

agent 身份由 token 对应的登记记录决定，`name` 由 hello 响应返回供日志/展示；`labels` 以服务端登记的为准（agent 上报只用于展示，防止越权领取）。版本不匹配（`protocol` 不同）时 server 返回 426，agent 记录日志并退出，避免半兼容状态。

### 5.3 心跳

```json
POST /api/agent/heartbeat
{ "version": "0.1.0", "running": [{"stepId": 812, "runId": 88, "startedAt": "..."}],
  "disk": {"workspaceBytes": 123, "imagesBytes": 456} }

200 { "ok": true, "cancel": [812] }
```

心跳同时续租该 agent 名下所有 `running` 步骤的 `lease_expires_at`。`cancel` 是 server 侧已请求取消的步骤，agent 收到后杀进程组（复用本机取消逻辑：`Setpgid` + 负 PID kill）。

### 5.4 领取任务（长轮询）

```json
POST /api/agent/jobs/claim      (服务端最多 hold 25s)
200 { "job": { ... } }
204 (无任务，agent 立即再发)
```

服务端逻辑：

1. 查 `steps.status='queued'` 且 `agent_selector` 与本 agent labels 匹配（Go 侧匹配，量小）；
2. 条件更新抢占：`UPDATE steps SET status='running', agent_id=?, lease_expires_at=? WHERE id=? AND status='queued'`，`RowsAffected==0` 说明被抢，重试；
3. 组装 payload（读 DB 解密 git/registry/kubeconfig），返回。

### 5.5 任务载荷（按步骤）

公共字段：

```json
{ "jobId": 812, "runId": 88, "stepOrder": 2, "stepName": "build",
  "leaseSeconds": 120, "deadline": "2026-11-18T03:00:00Z", "imageTag": "gh/tmt:main-e410be4" }
```

| step | params |
|---|---|
| `pull` | `{ "gitUrl": "https://oauth2:TOKEN@.../repo.git", "branch": "main", "dir": "/var/lib/navori-agent/workspace/1" }` |
| `build` | `{ "dir": "...", "dockerfile": "Dockerfile", "context": ".", "args": {"A":"1"}, "platform": "" }` |
| `push` | `{ "image": "swr.cn-north-4.myhuaweicloud.com/ns/tmt:tag", "registryUrl": "...", "username": "...", "password": "...", "insecureSkipTLS": false }` |
| `deploy` | `{ "kubeconfig": "<base64>", "kind": "Deployment", "name": "tmt", "namespace": "prod", "container": "tmt", "image": "...", "timeoutSeconds": 300 }` |

`approve` 永不下发（server 本地执行）。凭据字段只在 TLS 上传输，agent **不落盘**（kubeconfig 写 0600 临时文件，步骤结束 `defer os.Remove`）；日志中禁止回显。

### 5.6 日志上行

```json
POST /api/agent/jobs/812/log
{ "seq": 17, "lines": ["[build] STEP 1/7: FROM node:20-alpine", "..."] }
```

- agent 批量（1s 或 200 行）发送；`seq` 单调递增（每次 attempt 从 0 开始），服务端只用于诊断（重复/乱序按到达顺序追加），不跨 attempt 去重；
- 服务端以 `O_APPEND` 追加到 `runLogDir/<runID>/<step>.log`；
- **现有 SSE（`internal/api/logs.go`）每 500ms 轮询该文件，无需改动**，UI 体验与本机构建一致；
- 单行截断 8KB；日志总量超过 `RUN_LOG_MAX`（默认 20MB/step）后 agent 丢弃并追加一行 `[log truncated]`。

### 5.7 结果上报

```json
POST /api/agent/jobs/812/result
{ "status": "success" }            // success | failed | cancelled
{ "status": "failed", "exitCode": 1, "error": "docker build: exit status 1" }
```

服务端以 `(stepId, status)` 幂等处理：步骤已是终态则忽略并返回 200（agent 停止重试）。

## 6. 数据模型

### 6.1 新表 `agents`

```go
type Agent struct {
    ID         uint
    Name       string    `gorm:"size:64;uniqueIndex;not null"`
    Labels     string    `gorm:"size:512"`          // "role=build,region=overseas"
    TokenHash  string    `gorm:"size:128;not null"` // sha256(token)
    Status     string    `gorm:"size:16;not null;default:offline"` // online|offline|disabled
    Version    string    `gorm:"size:32"`
    Protocol   int       `gorm:"not null;default:1"`
    Hostname   string    `gorm:"size:128"`
    LastSeenAt *time.Time
    LastSeenIP string    `gorm:"size:64"`
    CreatedAt  time.Time
    UpdatedAt  time.Time
}
```

token 用 32 字节随机（base64url），创建时**只显示一次**，DB 只存 sha256。

### 6.2 `steps` 新增字段

```go
AgentSelector  string     `gorm:"size:128"`   // 空 = 本机执行
AgentID        uint       `gorm:"index"`      // 实际执行者，派发时写入
LeaseExpiresAt *time.Time
Attempt        int        `gorm:"not null;default:0"`
```

### 6.3 步骤状态机

```
pending ──(engine 到达该步)──▶ queued ──(agent claim)──▶ running ──▶ success
                                 ▲                          │
                                 └──(租约过期且 attempt<2)───┤
                                                            └──▶ failed / cancelled
```

新增状态 `queued`（UI 显示「等待执行器」/「已派发」）。其余状态沿用。

### 6.4 流水线配置新增

`pipelines.config_json` 增加：

```json
"execution": {
  "buildAgent": "role=build,region=overseas"
}
```

映射：`pull`/`build`/`push` → `buildAgent`；`approve` → 本地；字段为空 → 本地。
`deploy` 的执行器不再放在流水线，而是由部署环境的 `DeployTarget.agentId` 派生（0 = 本机）；
这样内网 kubeconfig 与能访问它的机器绑定在一起，多条流水线复用同一部署环境时不会重复配置。

## 7. 执行器重构（`internal/runner`）

### 7.1 目标接口

新增包 `internal/runner`，把「执行」与「取参数」分离：

```go
type PullSpec   struct { GitURL, Branch, Dir string }
type BuildSpec  struct { Dir, Dockerfile, Context, Platform string; Args map[string]string }
type PushSpec   struct { Image, RegistryURL, Username, Password string; InsecureSkipTLS bool }
type DeploySpec struct { Kubeconfig, Kind, Name, Namespace, Container, Image string; Timeout time.Duration }

func Pull(ctx context.Context, w io.Writer, sp PullSpec) error
func Build(ctx context.Context, w io.Writer, sp BuildSpec) error
func Push(ctx context.Context, w io.Writer, sp PushSpec) error
func Deploy(ctx context.Context, w io.Writer, sp DeploySpec) error
```

内部直接复用 `gitx.CloneW/CheckoutW`、`buildx.Build/Push/WriteAuthConfig`、`deploy.SetImage/Replicas/RolloutStatus/RolloutUndo`，行为与今天一致（含 0 副本短路、失败回滚）。

> **注意（实现时不要丢）**：`Build` 需要一个空的 `DOCKER_CONFIG` 目录，避免读取宿主全局凭据（见 DESIGN.md §4.2）——`BuildSpec` 增加 `DockerConfigDir string`：server 传 `DATA_DIR/docker-config`，agent 传 `AGENT_WORKDIR/docker-config`，runner 负责 `MkdirAll` 并在 `config.json` 不存在时写入 `{"auths":{}}`。`Push` 的凭据由 runner 内部调 `buildx.WriteAuthConfig` 生成临时目录并 `defer os.RemoveAll`。

### 7.2 server 侧

`engine.executeStep` 变成：

```
1. 建日志文件、置 running（不变）
2. 若 step.AgentSelector != "" → s.dispatch(ctx, step)   // 派发并等待
   否则 → runner.Xxx(ctx, f, specFromDB(...))            // 今天的行为
```

`specFromDB` 就是现在 `stepPull/stepBuild/...` 里读 DB 的那几行（`s.cloneURL(repo)`、解密 `store.Registry`、解密 `store.DeployTarget`），挪到 server 侧组装 spec。

### 7.3 agent 侧

`cmd/agent` 收到 payload → 反序列化成 spec → 调同一个 `runner.Xxx`，stdout/stderr 经 io.Writer 接日志批量上行。

### 7.4 兼容性

- 所有 selector 为空时，代码路径与今天完全一致（本地 spec 组装 + runner），只是多了一层函数调用；
- 重构阶段**先只改结构不改行为**，用现有测试与一次真实构建验证后再接 agent。

## 8. 调度与租约

### 8.1 一条跨机流水线的时序

```
engine            DB                agent-overseas        agent-xiaoshan
  │  step=pull     │                      │                     │
  │  selector=build│                      │                     │
  │───────────────▶│ queued               │                     │
  │  等待           │◀──── claim ──────────│                     │
  │                │──── payload ────────▶│ git clone / pull    │
  │                │◀──── log chunks ─────│                     │
  │                │◀──── result success ─│                     │
  │  step=build …  │                      │                     │
  │  step=push …   │                      │                     │
  │  step=deploy   │                      │                     │
  │───────────────▶│ queued               │                     │
  │  等待           │◀──────────────────────── claim ────────────│
  │                │──── payload(kubeconfig) ──────────────────▶│ kubectl set image …
  │                │◀──────────────────────── result ───────────│
  │  run=success   │                      │                     │
```

等待实现：`dispatch` 在 `s.stepWait[stepID]` 上阻塞，result handler 写入并 close；`ctx.Done()`（用户取消）也唤醒。

### 8.2 租约与故障

| 场景 | 处理 |
|---|---|
| 心跳续租 | 每次 heartbeat / log 上行都刷新 `lease_expires_at = now + 120s` |
| 租约过期 | janitor（15s tick）把 `running` 且过期的步骤 `attempt++`；`attempt <= 2` → 回 `queued` 重新派发（清 agent_id）；否则 `failed`，engine 报「执行器失联」 |
| 迟到结果 | 步骤已终态 → 忽略并返回 200 |
| agent 主动取消 | result `cancelled` → engine 终止 run，后续步骤 `skipped` |
| server 侧取消 | ctx cancel → 步骤 `cancelled`；agent 心跳拿到 `cancel` 后杀进程组；30s 未确认则仅记录（宿主机进程可能残留，与今天本机构建同一已知限制） |
| agent 版本过旧 | hello 返回 426，agent 退出；排队中的任务不受影响 |
| 时钟偏移 | 租约与 deadline 全部由 server 计算；agent 只用相对时长，不依赖本机时钟 |

重派安全性：pull（幂等）、build（幂等）、push（覆盖同名 tag，幂等）、deploy（set image 幂等，重复执行结果一致）。因此最多重试 2 次是安全的。

## 9. 凭据与安全边界

**核心事实：agent 拿到的凭据 ≈ navori 的部署权限。** 因此 agent 主机必须是受控主机。

| 项 | 措施 |
|---|---|
| 传输 | 强制 HTTPS（agent 校验证书；`insecureSkipVerify` 仅限实验环境，配置里显式标注） |
| agent token | 32B 随机、只显示一次、DB 存 sha256；只能访问 `/api/agent/*`；可禁用/轮换/删除 |
| 权限范围 | server 只下发**该步骤需要的**凭据（build 不给 kubeconfig，deploy 不给 registry 密码） |
| 落地 | kubeconfig 写 0600 临时文件、结束时删除；registry 密码只进临时 `DOCKER_CONFIG`；git token 只在内存 URL 中 |
| 日志 | runner 不打印凭据；payload 中的 URL 在日志里做掩码（`oauth2:***@`） |
| 宿主机权限 | **已确认（2026-11-18）**：不额外收窄 kubeconfig。部署对象的 kind/name/namespace 由流水线配置限定，agent 只按 payload 执行，不做别的。残余风险：agent 主机被入侵 ≈ 该 kubeconfig 的集群权限泄露，靠「主机受控 + token 可轮换」兜底 |
| 审计 | `agent.register/disable/rotate`、`step.dispatch`、`step.result` 写 `audit_logs` |
| 网络 | 建议在入口对 `/api/agent/*` 做限速（心跳 15s/台，claim 长轮询） |

## 10. 日志与可观测性

- UI：Run 详情步骤行显示「执行器: agent-xiaoshan-1」；`queued` 状态显示「等待执行器」并给 agent 在线提示（无在线 agent 时提示检查 agent 状态）。
- 服务端日志：派发/领取/结果/租约过期各一行（含 runID、stepID、agent 名）。
- 指标（可选，后续）：按 agent 的排队时长、执行时长、失败率；磁盘用量随心跳上报，可在 Agent 页面展示。

## 11. Agent 部署形态

### 11.1 二进制

- 名称 `navori-agent`，`CGO_ENABLED=0` 静态编译，linux/amd64 + arm64；
- 构建：`go build -o navori-agent ./cmd/agent`（与 server 同一 repo，共享 `internal/runner`）；
- 前置依赖（宿主机安装）：`git`、`docker` 或 `podman`、`kubectl`（仅部署型 agent 需要）。
- 启动自检：`navori-agent -check -config ...` 检查工作目录和工具；`-version` 输出版本。systemd 示例见 `examples/navori-agent.service`。
- **本期落地形态（已确认）**：构建机 = 一台物理服务器，宿主机已装 Docker，agent 以 systemd 常驻并**直接使用宿主 Docker**（镜像层缓存留在该机，重复构建才有加速）；部署机 = 萧山机房一台能执行 kubectl 的机器。容器形态不在本期。

### 11.2 配置

复用 `.env` KEY=VALUE 风格（导出 `config.ParseEnvFile` 供 agent 使用），`-config` 指定路径，默认 `./navori-agent.env`：

```ini
NAVORI_URL=https://navori.example.com
AGENT_TOKEN=<创建时显示的一次性 token>
AGENT_WORKDIR=/var/lib/navori-agent
AGENT_CONCURRENCY=1
AGENT_INSECURE_SKIP_VERIFY=false
```

标签由「执行器」页面登记（server 为准），本文件不配置 `AGENT_LABELS`；`AGENT_TOKEN` 每台唯一。名称在页面登记，agent 通过 token 自动识别。

### 11.3 运行

- systemd（**默认形态**，裸机/物理服务器）：

```ini
[Unit]
Description=Navori Agent
After=network-online.target docker.service
[Service]
ExecStart=/usr/local/bin/navori-agent -config /etc/navori/agent.env
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

- 容器形态（可选）：需要挂 `-v /var/run/docker.sock`（或 privileged + podman）与 workspace 卷；国内/国外都可直接跑，无入站端口。

### 11.4 本地目录

```
/var/lib/navori-agent/
├── workspace/<repoID>/     # git clone（可随时删，重拉即可）
└── tmp/                    # 临时 kubeconfig / DOCKER_CONFIG（步骤结束清理）
```

## 12. 执行器本地磁盘

agent 使用**宿主 Docker**（构建机已安装），镜像层缓存天然留在该机。缓存只增不减，约定：

- 每个步骤结束删除本次构建的**产物镜像**（push 成功后本地那份无用）；基础镜像缓存保留（这是国外构建的意义）；
- 每次构建结束可选执行 `docker image prune -f`（仅 dangling），默认开启；
- 心跳上报 `imagesBytes` / `workspaceBytes`，server 的 Agent 页面展示，超阈值由管理员手动清理（不在本期做自动 deep，避免误删正在被其他本地负载使用的镜像）；
- 若 agent 本身就是 navori 容器（容器内 podman），可复用现成的「存储管理」逻辑。

## 13. UI 改动

| 页面 | 改动 |
|---|---|
| 侧栏 → 执行器（`/agents`，admin） | 列表：名称/状态/标签/版本/最后心跳/磁盘；新建（展示一次性 token）；禁用/启用；轮换 token；删除 |
| 流水线编辑 | 新增「执行位置」区块：构建执行 / 部署执行 两个下拉（本机 / 具体 agent / 按标签自定义），保存时无匹配在线 agent 给警告 |
| 流水线列表 | 部署列展示目标环境（已有）；可选加执行器小标签 |
| Run 详情 | 步骤显示执行器名与 `queued` 状态；无在线 agent 时给明确提示 |
| 设置 → 存储管理 | 不变（server 自身）；agent 磁盘在 Agent 页展示 |

## 14. API 契约草案

> 实施时以 `docs/API.md` 为准，本节先定形状。

### Agent 侧（Bearer agent-token）

```
POST /api/agent/hello
POST /api/agent/heartbeat        → {ok, cancel[]}
POST /api/agent/jobs/claim       → 200 {job} | 204
POST /api/agent/jobs/{id}/log    {seq, lines[]}
POST /api/agent/jobs/{id}/result {status, error?, exitCode?}
```

错误码沿用现有 `E_*`：`E_AUTH`（token 无效/禁用）、`E_NOT_FOUND`（job 不存在或不属于该 agent）、`E_VALIDATION`（载荷不合法）、`E_CONFLICT`（job 已被其他 agent 领取）、`426`（协议版本不匹配）。

### 管理侧（admin）

```
GET    /api/agents
POST   /api/agents              {name, labels} → {agent, token}   // token 仅此一次
PATCH  /api/agents/{id}         {labels?, disabled?}
POST   /api/agents/{id}/rotate-token → {token}
DELETE /api/agents/{id}
```

## 15. 兼容性与迁移

- AutoMigrate 新增 `agents` 表与 3 个步骤字段；SQLite/MySQL 均无需手工迁移。
- 未配置 selector 的流水线零变化；agent 可选启用。
- 老 run 的步骤 `agent_selector` 为空，历史记录展示不受影响。
- v1「单实例」结论不变：agent 解决跨网络执行；server 仍是单实例（多实例/选主另做）。

## 16. 里程碑与工作量

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | 出站连通性确认（§17，两台执行机各一条 curl） | 5 分钟 |
| P1 | `agents` 表 + hello/heartbeat + claim（先跑空任务） | 1 天 |
| P2 | `internal/runner` 抽取，本机路径行为不变（测试全绿 + 一次真实构建） | 1.5 天 |
| P3 | 派发/等待/日志/结果/租约/取消 | 1.5 天 |
| P4 | 海外构建 + 萧山部署端到端（真实环境） | 1 天 |
| P5 | UI（Agent 管理 + 执行位置）+ 文档（API.md 同步、DESIGN.md 链接） | 1 天 |
| 合计 | | **约 6 天**（不含环境排障） |

## 17. 风险与已确认事项

### 环境侧前置确认（不阻塞 agent 设计）

agent 与镜像仓库无关：仓库类型、region、跨境加速都属于环境问题，不在本设计范围（已确认）。与 agent 直接相关、需要环境侧确认的只有出站连通性：

1. 国外构建机 → navori 公网地址（443 出站）
2. 萧山执行机 → navori 公网地址（443 出站）

```bash
# 两台执行机分别执行，期望 200
curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' https://<navori-domain>/api/system/health
```

> 仓库推拉速度、imagePullSecret 等属于现有流水线的环境验证，不影响 agent 设计（payload 只带仓库地址与凭据）。

### 其他风险

| 风险 | 影响 | 对策 |
|---|---|---|
| agent 主机被入侵 | 等同拿到该 agent 的部署凭据 | 专用受控主机 + 只下发该步凭据 + token 可轮换 |
| 跨境链路抖动 | 步骤中途失联 | 租约 + 重派（最多 2 次）+ 幂等步骤 |
| 输出镜像无法被萧山拉取（仓库鉴权） | 部署 CrashLoop | 环境侧确认 imagePullSecret；部署步骤前置一次 manifest 检查（可选增强） |
| 日志量大挤占带宽 | 心跳/任务延迟 | 批量 + 8KB 行截断 + 每步 20MB 上限 |
| agent 版本漂移 | 协议不兼容 | `protocol` 版本号 + 426 拒绝 + 页面展示版本 |
| 多台同 label agent 抢占 | 重复执行 | 条件 UPDATE 抢占 + 结果幂等 |

### 已确认（2026-11-18）

| 问题 | 结论 |
|---|---|
| 镜像仓库 region / 跨境加速 | 与 navori 无关，agent 不感知仓库类型与位置；推拉速度属环境问题，不在本设计范围 |
| kubeconfig 权限 | 不额外收窄；部署对象由流水线配置的 kind/name/namespace 限定（残余风险见 §9） |
| agent 运行形态 | **裸机 systemd 优先**；容器形态后续可选，不在本期 |
| 构建机形态 | 一台物理服务器，宿主机已装 Docker（非 K8s）；agent 直接用宿主 Docker |
| 同 label 多 agent | 允许：任务按 label 匹配后由任意在线 agent 抢占；需要固定某台机器时给它一个唯一标签（如 `id=build-01`）即可「事实绑定」，不需要专门的绑定字段 |

## 18. 实现指南（文件级）

### 18.1 现有代码入口

| 关注点 | 位置 | 现状 |
|---|---|---|
| 路由注册 | `internal/api/server.go` 的 `Handler()` | 三段：public、`requireAuth` 组、SPA catch-all。agent 路由加在 public 段之后，用独立的 `requireAgent` 中间件 |
| 执行循环 | `internal/api/engine.go` 的 `executeRun` | 顺序 `for` 遍历 steps，调用 `executeStep`；失败时后续步骤置 `skipped` |
| 单步执行 | `internal/api/engine.go` 的 `executeStep` | 置 running → `os.Create(logFile)` → `switch step.Name` → 落终态 |
| 各步实现 | `engine.go` 的 `stepPull/stepBuild/stepPush/stepApprove/stepDeploy` | 直接读 DB/config 拿凭据与路径 |
| 日志 SSE | `internal/api/logs.go` 的 `runLogs` | 500ms 轮询 `step.LogFile` 增量按行发 `event: step`。**不需要改** |
| 日志目录 | `engine.go` 的 `s.runLogDir(runID)` | `DATA_DIR/logs/<runID>/<step>.log` |
| 仓库目录 | `internal/api/trigger.go` 的 `s.repoDir(repoID)` | `DATA_DIR/repos/<repoID>` |
| 凭据解析 | `trigger.go` 的 `s.cloneURL(repo)`；`stepPush` 解密 `store.Registry`；`stepDeploy` 解密 `store.DeployTarget` | 组装 spec 时复用 |
| 模型 | `internal/store/models.go` | `Step{ID,RunID,StepOrder,Name,Status,LogFile,StartedAt,FinishedAt}` |
| 迁移 | `internal/store/store.go` 的 `Migrate()` | `AutoMigrate` 列表，加 `&Agent{}` 即可 |
| 执行原语 | `internal/gitx`、`internal/buildx`、`internal/deploy` | `gitx.CloneW/PullW/CheckoutW`；`buildx.Build/Push/WriteAuthConfig`；`deploy.SetImage/Replicas/RolloutStatus/RolloutUndo` |
| 配置解析 | `internal/config/config.go` | `Load`/`parseEnvFile`（未导出，agent 复用需导出为 `ParseEnvFile`） |
| 管理端鉴权 | `internal/api/middleware.go` 的 `requireAuth`；`internal/api/users.go` 的 `isAdmin(r)` | 管理端接口沿用 |
| 前端导航/路由 | `web/src/pages/Shell.tsx`（`mainNav`/`resourceNav`/`bottomNav` + `<Routes>`） | 加「执行器」入口 |
| 前端 API | `web/src/lib/api.ts` 的 `api<T>(path, init)` | 统一封装，错误 `E_*` |
| 前端构建 | `web/`（Vite）→ `web/dist` → `go:embed` | 先 `npm run build` 再 `go build` |

### 18.2 新增/修改文件清单

| 文件 | 内容 | 阶段 |
|---|---|---|
| `internal/agentx/protocol.go` | 协议结构体（`HelloReq/HelloResp/HeartbeatReq/HeartbeatResp/Job/PullParams/BuildParams/PushParams/DeployParams/LogChunk/ResultReq`）、`Protocol = 1`、`MatchSelector(sel, labels string) bool` | P1 |
| `internal/agentx/protocol_test.go` | selector 匹配、JSON 往返 | P1 |
| `internal/store/models.go` | `Agent` 模型；`Step` 加 4 字段 | P1 |
| `internal/store/store.go` | `Migrate()` 加 `&Agent{}` | P1 |
| `internal/api/agent.go` | `requireAgent` + hello/heartbeat/claim/log/result | P1/P3 |
| `internal/api/agents.go` | 管理端 list/create/patch/rotate-token/delete | P1 |
| `internal/runner/runner.go` | `Pull/Build/Push/Deploy` + `PullSpec/BuildSpec/PushSpec/DeploySpec`（纯执行，不读 DB） | P2 |
| `internal/runner/runner_test.go` | 命令拼装/参数校验（fake docker、kubectl 脚本，参考 `internal/api/storage_test.go`） | P2 |
| `internal/api/dispatch.go` | `dispatchStep`、等待通道、租约 janitor、取消联动 | P3 |
| `cmd/agent/main.go` | 配置加载、hello、心跳、claim 循环、执行、日志批量、结果上报、优雅退出 | P1/P3 |
| `examples/navori-agent.env.example` | agent 配置样例 | P5 |
| `web/src/pages/Agents.tsx` | 执行器页面 | P5 |
| `web/src/pages/Shell.tsx` | 导航加「执行器」 | P5 |
| `web/src/pages/PipelinesDetail.tsx` | 「执行位置」区块（构建/部署 selector） | P5 |
| `web/src/pages/RunDetail.tsx` | 步骤显示执行器名 + `queued` 状态 | P5 |
| `docs/API.md` | 新增 agent 协议与管理端接口（契约权威） | P5 |
| `README.md` | agent 安装/配置/systemd | P5 |

### 18.3 分阶段任务与验收

#### P1 — 骨架（agent 能上线）

1. `store.Agent` + `Step` 四字段 + `Migrate`。
2. `internal/agentx`：协议结构体、`MatchSelector`、`Protocol=1`。
3. `internal/api/agent.go`：`requireAgent`（Bearer token → sha256 → 查 `agents`，禁用/未知返回 401）、`hello`（更新 status/version/labels/last_seen，返回 `heartbeatSeconds=15`、`claimWaitSeconds=25`）、`heartbeat`（更新 last_seen，返回 cancel 列表）、`claim`（P1 先返回 204）。
4. `internal/api/agents.go`：创建时生成 32B 随机 token（base64url），只返回一次，DB 存 sha256；列表不返回 token。
5. `cmd/agent`：读配置 → hello → 15s 心跳 → claim 空转（拿到 204 就重试）→ 指数退避重连。
6. 前端最小页：列出 agent（名称/状态/标签/最后心跳）。

**验收**：本地 sqlite 起 server → 创建 agent → 跑 agent 二进制 → 页面显示 online；kill agent 超过 45s 显示 offline；错误 token 返回 401；禁用后立即 401。

#### P2 — 执行器重构（行为不变）

1. 新建 `internal/runner`，把 `stepPull/stepBuild/stepPush/stepDeploy` 里的执行逻辑搬进去；spec 全部是字面参数。
2. server 侧 `stepX` 只负责组装 spec（读 DB/config 解密）并调用 `runner.Xxx`。
3. 保持：`deploy` 的 0 副本短路、失败 `RolloutUndo`、push 的临时 `DOCKER_CONFIG`、日志文案。

**验收**：`go test ./...` 全绿；本地跑一次真实 pull/deploy（或 pull+build）；0 副本 Deployment 仍直接成功；日志内容与改造前一致。

#### P3 — 派发与租约（跨机跑通）

1. `executeStep`：日志文件建好后，若 `step.AgentSelector != ""` → `s.dispatchStep(ctx, step)`；否则走 runner 本地执行。
2. `dispatchStep`：置 `queued` → 在 `s.stepWait[stepID]` 上等待（`ctx.Done()`、结果、硬超时三选一）→ 返回结果错误。
3. `claim`：查 `status='queued'` 且 selector 匹配的步骤 → 条件 `UPDATE ... WHERE id=? AND status='queued'` → 组装 payload（解密凭据）。
4. `log`：`O_APPEND` 追加到 `LogFile`；`result`：条件更新终态（仅 `queued/running` 可改）并唤醒等待者。
5. janitor（15s）：`running` 且租约过期 → `attempt++`；≤2 回 `queued` 重派，否则 `failed` 并唤醒 engine。
6. 取消：`stopRun` 的 ctx cancel → `dispatchStep` 返回 cancelled；heartbeat 响应带 `cancel` 列表；agent 杀进程组。

**验收**：本地起两个 agent（labels 不同）+ 一条 4 步流水线，跑通；中途 kill agent → 租约过期后重派成功；点取消 → 步骤 cancelled；重复 result 被忽略。

#### P4 — 真环境端到端

1. 物理构建机：装 agent（systemd），labels `role=build,region=overseas`；宿主机 Docker 已就绪。
2. 萧山机器：装 agent，labels `role=deploy,site=xiaoshan`；kubectl + kubeconfig 就绪。
3. 流水线 `execution.buildAgent` 填 selector；部署环境绑定 `xs-deploy`，跑真实 run。

**验收**：镜像推进仓库；萧山 Deployment 镜像更新且 rollout 成功；UI 日志完整；断网重连后任务不丢。

#### P5 — UI 与文档

1. `Agents.tsx`：列表、创建（token 一次性弹窗）、禁用/启用、轮换 token、删除、磁盘用量。
2. `PipelinesDetail.tsx`：执行位置（本机 / 具体 agent / 按标签），保存时无匹配在线 agent 给警告。
3. `RunDetail.tsx`：`queued` 文案与配色、执行器名。
4. `docs/API.md` 补 agent 协议与管理端接口；`README.md` 补 agent 安装；`DESIGN.md` 的 v2 状态从「预留」改为「已实现（分布式执行部分）」。

**验收**：按 README 从零能装好一个 agent 并上线；API.md 与实际行为一致。

### 18.4 关键实现细节（易踩坑）

- **抢占**：`UPDATE steps SET status='running', agent_id=?, lease_expires_at=? WHERE id=? AND status='queued'`，用 `RowsAffected` 判断是否抢到；SQLite 单实例也照此写，换 MySQL 天然安全。
- **时钟**：租约、deadline 一律 server 计算；agent 只用相对时长（心跳间隔、超时），不要比较本机时间。
- **日志写入**：server 侧必须 `os.OpenFile(path, O_APPEND|O_CREATE|O_WRONLY, 0o644)`；`executeStep` 现在用 `os.Create` 截断，派发重试不会重进 `executeStep`，所以不会清日志，但新增的 append 路径不要用 `os.Create`。
- **等待不能只等 channel**：必须有 `maxStepSeconds` 硬超时，否则 agent 消失且 janitor 失效时会永久挂住。
- **结果幂等**：只允许 `queued/running → success/failed/cancelled`，其余情况返回 200 丢弃。
- **长轮询超时**：agent 的 `http.Client.Timeout` 必须大于 server 的 hold 时间（25s → 设 40s），否则每次 claim 都超时。
- **优雅退出**：agent 收到 SIGTERM 时把在跑的步骤上报 `failed("agent shutting down")`，不等租约过期。
- **payload 大小**：kubeconfig 用 base64，正常 < 100KB；不要放仓库全量配置。
- **selector 语义**：逗号分隔 `k=v`，全部相等才算匹配；两侧 trim 空格；空 selector = 本机执行（不派发）。标签以 server 登记为准，agent 上报只做展示。
- **重派安全**：pull/build/push/deploy 都幂等，最多重试 2 次；不要给 `approve` 配 selector（校验时拒绝）。

### 18.5 验收与测试

```bash
# 基线
go build ./... && go test ./...
cd web && npm run build && cd ..

# 本地端到端（sqlite）
DB_DRIVER=sqlite DB_PATH=/tmp/navori-agent.db DATA_DIR=/tmp/navori-data PORT=3999 ./navori &
./navori-agent -config /tmp/agent.env
# 触发一条流水线后检查
ls /tmp/navori-data/logs/<runID>/ && tail -f /tmp/navori-data/logs/<runID>/*.log
```

单测覆盖：`agentx.MatchSelector`（空/单标签/多标签/缺标签/空格）、协议 JSON 往返、租约过期判定纯函数、runner 命令拼装。

### 18.6 提交与文档纪律

- 每个阶段一个提交，中文说明，风格对齐现有 `git log`（如 `feat(agent): ...`）。
- `docs/API.md` 是契约唯一权威；实现与文档不一致时改代码或同步文档，不能只改一边。
- 不提交 `LOCAL-NOTES.md`（已在 `.gitignore`）。

## 19. 开工提示（可直接粘贴到新会话）

> 读 `navori/docs/AGENT-DESIGN.md`（重点 §0、§5–§8、§18）和 `docs/DESIGN.md` §4.1/§12。
> 从 §18.3 的 P1 开始实现分布式执行 agent。先跑 `go build ./... && go test ./...` 确认基线绿色。
> 硬约束：不配 agent 时行为与现在完全一致；agent 不读写 DB；不加新依赖；deploy 语义（0 副本、失败回滚）不许改。
> 每个阶段完成即提交，并在 `docs/API.md` 同步新增接口。

## 20. 附录：替代方案对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 各站点各部署一套 navori + 共享 MySQL | 不改代码 | MySQL 要暴露公网（跨区延迟 + 安全）；配置/状态分散；仍无法一条流水线跨两地 | 仅临时救急 |
| B. VPN / SD-WAN 打通 | 现有功能全可用 | 跨公有云+机房专线成本高、运维重 | 有专线时可选 |
| C. Agent（本方案） | 网络要求最低（只需出站）、状态统一、与 v2 规划一致 | 需执行器重构 + 调度模型 | **推荐** |
| D. 拆两条流水线（build 完 API 触发 deploy） | 改动最小 | 状态割裂、tag 传递靠人、失败定位困难 | 不推荐 |

过渡期（agent 上线前）：国外机器手动 `docker build/push`，萧山机器 `kubectl set image`，navori 里手动触发记录 run。
