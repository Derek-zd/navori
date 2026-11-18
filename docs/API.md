# Navori API 契约（唯一权威来源）

> 状态：v1 初稿（M0）
> 优先级：P0（所有实现对齐本文档，冲突以本文档为准）
> 配套：DESIGN.md（数据模型 §5、配置模型 §6）

---

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-13 | 初稿 |
| 2026-09-07 | 新增 §13.1 存储管理（用量/清理/策略）；`POST /api/system/storage/cleanup` 增加 `reclaimed` 字段，deep 语义修正为 `rm -af` + `--external` |
| 2026-11-18 | 新增 §十四 分布式执行 agent（P1：鉴权/握手/心跳/管理端；P3：claim/日志/结果/租约/取消）；步骤新增 `queued` 状态；新增 `E_AUTH`、`E_PROTOCOL` |

---

## 〇、通用约定

### 0.1 基础

- 协议：HTTP/JSON；响应头 Content-Type: application/json
- 命名：JSON 字段 camelCase；路径与查询参数 kebab-case；错误码 E_UPPER_SNAKE
- 时间：RFC3339（UTC），如 2026-08-13T09:30:00Z
- 鉴权：登录后 httpOnly cookie「navori_token」；除 POST /api/auth/login、POST /api/webhooks、GET /api/system/health 外均需认证
- 权限：admin 与 user 两级；写操作写审计

### 0.2 响应包裹

单对象成功（HTTP 200）：

    { "data": { ... } }

列表分页：

    { "data": [ ... ], "total": 123, "limit": 20, "offset": 0 }

错误（HTTP 4xx/5xx）：

    { "error": { "code": "E_NOT_FOUND", "message": "repository 12 not found" } }

### 0.3 敏感值

- 密码 / kubeconfig / git 凭证 / secret 变量：仅写入，永不回显
- 读取时返回「是否已设置」布尔 + 掩码，例：{ "passwordSet": true }

### 0.4 通信通道分工

| 通道 | 用途 |
|---|---|
| REST | 状态查询、CRUD、控制（低频） |
| SSE | run 日志流（高频，按行 tail） |

---

## 一、错误码清单

| code | HTTP | 含义 |
|---|---|---|
| E_NOT_FOUND | 404 | 资源不存在 |
| E_UNAUTHORIZED | 401 | 未登录 / token 无效 |
| E_FORBIDDEN | 403 | 权限不足 |
| E_VALIDATION | 400 | 参数校验失败 |
| E_CONFLICT | 409 | 唯一性冲突（同名等） |
| E_DUP_COMMIT | 200 | 同 commit 已跑过（webhook 去重，非错误，标记 skipped） |
| E_INVALID_TAG | 400 | tag 模板渲染结果非法 |
| E_CONNECT_FAILED | 400 | registry / kubeconfig 连通性失败 |
| E_RUN_STATE | 409 | run 状态不允许该操作（如非 awaiting_approval 时审批） |
| E_AUTH | 401 | agent token 无效或执行器已禁用（仅 `/api/agent/*`） |
| E_PROTOCOL | 426 | agent 协议版本不匹配 |
| E_INTERNAL | 500 | 内部错误 |

---

## 二、认证

POST /api/auth/login
    body: { username, password }
    → 200 { data: { user: User } } + Set-Cookie: navori_token
POST /api/auth/logout
    → 200 { data: {} }
GET /api/auth/me
    → 200 { data: User }

User = { id, username, role: "admin" | "user" }

登录失败限速：时间窗防爆破（同 IP / 同用户名）。

---

## 三、仓库

GET /api/repositories?limit=&offset=&scanStatus=
    → 200 { data: [Repository], total, limit, offset }
POST /api/repositories
    body: { name, gitUrl, credentialId?, defaultBranch, dockerfilePath?, buildContext? }
    → 201 { data: Repository }
GET /api/repositories/{id} → 200 { data: Repository }
PATCH /api/repositories/{id} → 200 { data: Repository }
DELETE /api/repositories/{id} → 200 { data: {} }
POST /api/repositories/{id}/scan
    → 202 { data: { scanStatus: "scanning" } }

Repository = {
  id, name, gitUrl, credentialId,
  defaultBranch, dockerfilePath, buildContext,
  scanStatus: "pending" | "scanning" | "done" | "error", scanMessage,
  createdAt, updatedAt
}

扫描：clone/pull + 最多 3 层目录探测 Dockerfile。

---

## 四、Git 凭证

GET /api/credentials → 200 { data: [Credential] }
POST /api/credentials
    body: { name, type: "https" | "ssh", username?, secret }  // secret 仅写入
    → 201 { data: Credential }
DELETE /api/credentials/{id} → 200 { data: {} }

Credential = { id, name, type, username, secretSet }

---

## 五、镜像仓库

GET /api/registries → 200 { data: [Registry] }
POST /api/registries
    body: { name, url, username?, password?, namespace, insecureSkipTls?, isDefault? }
    → 201 { data: Registry }
GET /api/registries/{id} → 200 { data: Registry }
PATCH /api/registries/{id} → 200 { data: Registry }
DELETE /api/registries/{id} → 200 { data: {} }
POST /api/registries/{id}/test
    → 200 { data: { ok: true } } 或 E_CONNECT_FAILED

Registry = { id, name, url, username, passwordSet, namespace, insecureSkipTls, isDefault }

---

## 六、部署目标

GET /api/deploy-targets → 200 { data: [DeployTarget] }
POST /api/deploy-targets
    body: { name, type: "k8s", kubeconfig?, defaultNamespace?, isDefault? }  // type=ssh 为 v2 预留
    → 201 { data: DeployTarget }
GET /api/deploy-targets/{id} → 200 { data: DeployTarget }
PATCH /api/deploy-targets/{id} → 200 { data: DeployTarget }
DELETE /api/deploy-targets/{id} → 200 { data: {} }
POST /api/deploy-targets/{id}/test
    → 200 { data: { ok: true } } 或 E_CONNECT_FAILED

DeployTarget = { id, name, type, defaultNamespace, kubeconfigSet, isDefault }

---

## 七、变量

GET /api/variables → 200 { data: [Variable] }
POST /api/variables
    body: { key, value, secret?, description? }  // value 仅写入
    → 201 { data: Variable }
PATCH /api/variables/{id} → 200 { data: Variable }
DELETE /api/variables/{id} → 200 { data: {} }

Variable = { id, key, secret, description, valueSet }  // value 不回显

引用：tag 模板以 {var.KEY} 引用。

---

## 八、流水线

GET /api/pipelines?repoId=&limit=&offset= → 200 { data: [Pipeline] }
POST /api/pipelines
    body: { repoId, config: PipelineConfig, branchRules: [BranchRule], notify: NotifyConfig }
    → 201 { data: Pipeline }
GET /api/pipelines/{id} → 200 { data: Pipeline }
PATCH /api/pipelines/{id} → 200 { data: Pipeline }
DELETE /api/pipelines/{id} → 200 { data: {} }
POST /api/pipelines/{id}/run
    body: { ref?, tagOverride?, vars? }   // 手动运行；缺省 = 流水线分支规则中首个精确分支（若存在），否则仓库默认分支，最新 HEAD
    → 202 { data: { runId, number } }

PipelineConfig（defaults）= {
  dockerfilePath, buildContext, buildArgs: { k: v }, platform,
  imageName, tagTemplate, registryId,
  deploy: {
    targetId, kind: "Deployment" | "StatefulSet", name, namespace,
    containers: { "容器名": "镜像名或空(用刚构建)" },
    approval: bool, approvers: [username]   // 空 = 任意 admin
  },
  execution: {                             // v2 分布式执行；空 = 本机执行
    buildAgent: "role=build,region=overseas",  // pull/build/push 的 selector
    deployAgent: "role=deploy"                 // deploy 的 selector；approve 永远本机
  }
}

BranchRule = { branch: glob, overrides: Partial<PipelineConfig> }  // 浅合并覆盖 defaults；顺序敏感

NotifyConfig = { webhookUrl, secret, on: ["success","failure","cancelled","rejected"] }

Pipeline = { id, repoId, config, branchRules, notify, webhookUrl, createdAt, updatedAt }
    // webhookUrl 为平台生成的回显（展示用，非存储字段）

---

## 九、执行（run）

GET /api/runs?pipelineId=&status=&limit=&offset= → 200 { data: [Run] }
GET /api/runs/{id} → 200 { data: Run }
POST /api/runs/{id}/stop → 200 { data: { status: "cancelling" } }
POST /api/runs/{id}/approve → 200 { data: Run }        // 仅 awaiting_approval；admin 或 approvers
POST /api/runs/{id}/reject
    body: { reason? } → 200 { data: Run }
POST /api/runs/{id}/rerun → 202 { data: { runId, number } }  // 回放快照（同 commit + 同解析配置）
GET /api/runs/{id}/logs → SSE（见 9.1）

Run = {
  id, pipelineId, number,
  triggerType: "manual" | "webhook" | "cron" | "rerun",
  ref, commit, commitShort, status, imageTag, error,
  approvalRequired, approvedBy, approvedAt, rejectedReason,
  startedAt, finishedAt,
  steps: [Step]
}

status: pending | running | awaiting_approval | success | failed | cancelled | rejected

Step = { name: "pull" | "build" | "push" | "approve" | "deploy", status, startedAt, finishedAt,
         agentId, agentName?, agentSelector, attempt }
    // steps.status: pending | queued | running | success | failed | skipped | cancelled
    // agentSelector 为空 = 本机执行；agentName 仅在已派发后出现
    // queued = 已派发给执行器，等待 agent 领取

### 9.1 SSE 日志流

GET /api/runs/{id}/logs
    Content-Type: text/event-stream
    事件：
      event: step     data: {"step":"build","line":"..."}
      event: end      data: {"status":"success"}
约定：连接时先回放已写日志，再 tail 新增行；run 达终态后发 end 并关闭。

---

## 十、Webhook（入站）

POST /api/webhooks

- 每流水线独立 secret token（Header: X-Navori-Token 或 query ?token=）
- 通用格式 body: { ref: "refs/heads/main", commit: "sha", repoUrl: "..." }
- GitLab push 格式：解析 object_kind=push、ref、checkout_sha、repository.git_http_url
- 路由：repoUrl 归一化 → 匹配 pipeline
- 去重：commit 落 webhook_events；同 sha 重复 → 200 + E_DUP_COMMIT（标记 skipped）
- 未匹配到 pipeline → E_NOT_FOUND
- 响应：200 { data: { runId?, skipped? } }

---

## 十一、通知（出站 webhook）

run 达终态后 POST 到 NotifyConfig.webhookUrl：

- Header: X-Navori-Signature: sha256=HMAC(secret, body)
- body: { event: "run.finished", pipelineId, repo, branch, commit, commitShort, status, imageTag, error, startedAt, finishedAt }
- 重试：3 次指数退避；失败仅记日志，不阻断 run

---

## 十二、用户（admin）

GET /api/users → 200 { data: [User] }
POST /api/users   body: { username, password, role } → 201 { data: User }
PATCH /api/users/{id} → 200 { data: User }
DELETE /api/users/{id} → 200 { data: {} }

---

## 十三、审计 / 系统

GET /api/audit-logs?limit=&offset= → 200 { data: [AuditLog], total, limit, offset }
    AuditLog = { id, username, action, target, createdAt }
GET /api/system/info → { data: { version, gitCommit, buildTime } }
GET /api/system/health → { data: { status: "ok", db: "sqlite" | "mysql" } }  // 无需认证
GET /api/system/config → { data: { webhookBaseUrl } }  // 供展示 webhook 地址

### 13.1 存储管理（admin）

GET /api/system/storage → 200 { data: { usage: [DiskUsage], cleanup: CleanupPolicy } }
    DiskUsage    = { path, exists, percent, usedGi, totalGi }
                   // path: /var/lib/containers（podman 构建缓存）与 /data
    CleanupPolicy = { frequency: "off"|"daily"|"weekly"|"monthly", threshold, lastAt, lastMode }

POST /api/system/storage/cleanup
    body { mode: "prune" | "deep" }
    → 200 { data: { usage: [DiskUsage], output, reclaimed } }   // reclaimed 形如 "3.372GB"
    → 500 有构建正在运行（running/pending）时拒绝，避免中断构建
    prune = podman system prune -f（停用容器 + dangling 镜像/缓存，保留 tagged 与基础镜像缓存）
    deep  = podman rm -af → image prune -af --external → system prune -f --external
            // --external 才能清掉被残留 build 容器占用的中间层；会清空全部未用镜像，
            // 下次构建需重新拉取基础镜像

PATCH /api/system/storage
    body { frequency: "off"|"daily"|"weekly"|"monthly", threshold: 50-99 }
    → 200 { data: { usage, cleanup } }
    自动清理：按 frequency 到期先 prune；清理后用量仍 ≥ threshold 时自动升级 deep。

---

## 十四、分布式执行 agent

执行器（agent）是与用户 JWT 完全隔离的独立认证面：所有 `/api/agent/*` 请求使用
`Authorization: Bearer <agent-token>`，响应为**裸 JSON**（不套 `{ data }`）。
协议版本 `protocol = 1`；时间均为 RFC3339 UTC。token 由 server 生成（32 字节
base64url），数据库只保存 sha256，明文仅在创建/轮换时返回一次。

### 14.1 管理端（admin）

Agent = {
  id, name, labels,                    // labels 形如 "role=build,region=overseas"
  status: "online" | "offline" | "disabled",
  version, protocol, hostname,
  lastSeenAt, lastSeenIp, createdAt
}

GET /api/agents                       // admin；按 id 倒序
    → 200 { data: [Agent] }
    超过 45s 没有心跳的 online 执行器显示为 offline（服务端 janitor 15s 巡检）。

POST /api/agents
    body: { name, labels? }           // name 必须与 agent 的 AGENT_NAME 一致，≤64 字节
    → 201 { data: { agent: Agent, token: "<一次性 token>" } }
    token 只在此响应出现；labels 由服务端登记并用于路由，agent 上报的 labels 不参与路由。

PATCH /api/agents/{id}
    body: { labels?, disabled? }      // 只更新给出的字段
    → 200 { data: Agent }
    disabled=true 后该 agent 的现有 token 立即 401；disabled=false 后等下一次心跳恢复 online。

POST /api/agents/{id}/rotate-token
    → 200 { data: { token: "<新一次性 token>" } }
    旧 token 立即失效；agent 需更新配置并重启。

DELETE /api/agents/{id}
    → 200 { data: {} }

### 14.2 Agent 协议

POST /api/agent/hello
    body: { name, version, labels?, host?, protocol? }
    → 200 { protocol: 1, serverVersion, heartbeatSeconds: 15, claimWaitSeconds: 25,
            maxStepSeconds: 3600, now }
    name 与登记不一致 → 400 E_VALIDATION；protocol 不为 1 → 426 E_PROTOCOL。
    labels 以服务端登记为准（本字段仅用于展示/诊断）。

POST /api/agent/heartbeat
    body: { version, running?: [{ stepId, runId, startedAt }], disk?: { workspaceBytes, imagesBytes } }
    → 200 { ok: true, cancel: [stepId...] }
    刷新 lastSeenAt，并续租该 agent 名下所有 running 步骤（lease = 120s）。
    cancel 是服务端要求终止的 stepId：步骤已取消/失败，或已被重新派给其他 agent。

POST /api/agent/jobs/claim
    → 200 { job } | 204
    长轮询领取步骤（服务端最多 hold 25s，每 500ms 扫一次）；204 = 暂无任务。
    只返回 status=queued 且 agentSelector 与本 agent labels 匹配的步骤；
    抢占使用条件 UPDATE，并发 claim 只有一个成功。payload 中的凭据已解密。

Job = {
  jobId, runId, stepOrder, stepName,     // jobId == steps.id
  leaseSeconds: 120, deadline, imageTag,
  params: PullParams | BuildParams | PushParams | DeployParams
}
PullParams   = { gitUrl, branch, dir }                 // dir 相对 AGENT_WORKDIR
BuildParams  = { dir, dockerfile, context, args, platform }
PushParams   = { image, registryUrl, username, password, insecureSkipTls }
DeployParams = { kubeconfig(base64), kind, name, namespace, container, image,
                 timeoutSeconds }                       // kubeconfig 解码后 <100KB

POST /api/agent/jobs/{id}/log
    body: { seq, lines: [string] }
    → 200 { ok: true } | { ok: true, ignored: true } | { ok: true, truncated: true }
    追加写入该步骤日志（O_APPEND），SSE 日志流无需变更；每行超过 8KB 截断，
    单步日志上限 20MB，超过后返回 truncated 并丢弃。请求同时续租 120s。
    404 = 步骤不存在或不属于该 agent；终态步骤返回 ignored（幂等）。

POST /api/agent/jobs/{id}/result
    body: { status: "success" | "failed" | "cancelled", exitCode?, error? }
    → 200 { ok: true } | { ok: true, ignored: true }
    仅允许把 queued/running 且属于该 agent 的步骤改为终态；已终态返回 ignored，
    重复上报不会覆盖结果（幂等）。failed 的 error 会写入 run.error 并唤醒引擎。

租约与重试：心跳/日志续租 120s；janitor 每 15s 检查过期 running 步骤，
attempt+1 后重新置 queued（最多重试 2 次），仍失联则 failed 并唤醒引擎。
迟到的日志/结果按终态幂等规则忽略。server 取消 run 时步骤置 cancelled，
下一次心跳把 cancel 下发给 agent，agent 终止进程组。
