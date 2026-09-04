# Navori 测试策略

> 状态：v1 初稿（M0）
> 配套：API.md（契约）、DESIGN.md（模块目录 §15）

---

## 一、测试金字塔

            E2E / 手动验收      ← 每个里程碑验收清单逐条（本地 git + 临时 registry + kind 集群）
          集成测试             ← 真实外部依赖（store 双后端 / git clone / SSE / 真实 kubectl）
         单元测试(表驱动+mock)  ← 纯逻辑，不碰外部依赖

| 层级 | 框架 | 覆盖目标 | 覆盖率目标 |
|---|---|---|---|
| 单元 | go test（表驱动）+ 接口 mock | 纯逻辑模块 | > 80% |
| 集成 | go test（本地 fixture / testcontainers） | 核心链路 | 100% |
| E2E/手动 | 里程碑验收清单 | 全功能 | 每个版本发布前 |

---

## 二、关键纪律

1. 纯逻辑重仓单测：tagx（模板/清洗）、分支规则、engine 状态机、webhook 去重、notify HMAC——表驱动覆盖边界。
2. 外部依赖接口化：buildx / deploy / gitx 定义接口，单测 mock，不真跑 docker/kubectl/git；真跑放集成。
3. store 双后端同 schema：同一套测试分别跑 sqlite 与 mysql 两个 driver。
4. 回归阈值：编译失败零容忍；单测通过率 < 95% 阻塞合并。

---

## 三、逐模块用例清单

### 3.1 tagx（tag 模板 + 分支名清洗）

| # | 用例 | 验证点 |
|---|---|---|
| TG1 | 变量替换 | {branch}-{commit_short} 渲染正确 |
| TG2 | 字面量 | 无占位符时原样输出（v1.2.3） |
| TG3 | 分支名清洗 | 大写→小写、/ 与非法字符→-、去首尾 .- |
| TG4 | 超长截断 | 分支名截到 60 字符 |
| TG5 | 空分支名 | 回退 branch |
| TG6 | 非法 tag 拒绝 | 首字符非 [a-zA-Z0-9_] 或超 128 → E_INVALID_TAG |
| TG7 | {var.KEY} | 引用全局变量正确 |
| TG8 | 未定义变量 | 报错（不静默） |
| TG9 | {timestamp}/{unix}/{build_number} | 时间与序号变量正确 |

### 3.2 分支规则

| # | 用例 | 验证点 |
|---|---|---|
| BR1 | 命中规则 | 取首个命中规则的 overrides |
| BR2 | 顺序敏感 | release/* 排在 ** 之前，先匹配先赢 |
| BR3 | 浅合并 | deploy 子字段按字段覆盖，未写继承 defaults |
| BR4 | 无命中 | 回退 defaults |
| BR5 | 无规则 | 仅 default_branch 触发 |
| BR6 | glob 语义 | * 单段、** 跨段（含 /） |
| BR7 | 未收录分支 | 不触发 |

### 3.3 engine（状态机，mock builder/deployer）

| # | 用例 | 验证点 |
|---|---|---|
| EN1 | 成功路径 | pull→build→push→deploy→success |
| EN2 | build 失败 | run=failed，后续步骤 skipped |
| EN3 | 审批通过 | approval=true → awaiting_approval → approve → deploy |
| EN4 | 审批拒绝 | → rejected，deploy skipped |
| EN5 | 取消 | → cancelled |
| EN6 | 重启 reaper | running/pending → failed（服务重启中断） |
| EN7 | awaiting_approval 幸存 | 重启后仍可审批 |
| EN8 | 并发 | 每流水线 1 in-flight，新 push 排队只留最新 |
| EN9 | 快照重跑 | 同 commit + 同解析配置，确定可复现 |

### 3.4 webhook（解析/去重/路由）

| # | 用例 | 验证点 |
|---|---|---|
| WH1 | GitLab push | object_kind/ref/checkout_sha 解析正确 |
| WH2 | 通用格式 | { ref, commit, repoUrl } 解析正确 |
| WH3 | secret 校验 | 错误 token → E_UNAUTHORIZED |
| WH4 | 去重 | 同 sha 重复 → E_DUP_COMMIT（skipped） |
| WH5 | 未匹配 | repoUrl 无 pipeline → E_NOT_FOUND |
| WH6 | repoUrl 归一化 | 带/不带 .git、大小写归一 |

### 3.5 notify（出站 webhook）

| # | 用例 | 验证点 |
|---|---|---|
| NT1 | HMAC 签名 | X-Navori-Signature 正确 |
| NT2 | 终态触发 | success/failed/cancelled/rejected 触发 |
| NT3 | 失败重试 | 3 次指数退避，失败不阻断 run |

### 3.6 store（双后端同 schema）

| # | 用例 | 验证点 |
|---|---|---|
| ST1 | sqlite 迁移 | AutoMigrate 建全 11 张表 |
| ST2 | mysql 迁移 | 同 schema，方言差异正确 |
| ST3 | CRUD | 全资源增删改查 |
| ST4 | 敏感值 | 加密存储，读取不回显（只回 valueSet） |

### 3.7 auth

| # | 用例 | 验证点 |
|---|---|---|
| AU1 | JWT | 签发/校验/过期 |
| AU2 | 登录限速 | 时间窗防爆破 |
| AU3 | 角色 | admin 与 user 权限边界 |

### 3.8 buildx / deploy / gitx（接口 mock）

| # | 用例 | 验证点 |
|---|---|---|
| BD1 | build 命令拼接 | 参数（dockerfile/context/args/platform）正确 |
| BD2 | push 命令拼接 | 目标 registry + tag 正确 |
| BD3 | deploy set image | kind/name/container/image 正确 |
| BD4 | 回滚判定 | 非首次部署失败 → rollout undo |

---

## 四、集成测试

| 场景 | 方式 |
|---|---|
| store 双后端 | sqlite 内存 + mysql testcontainers |
| git clone/pull | 本地 bare repo fixture |
| docker build/push | 本地临时 registry |
| kubectl 部署 | kind 集群 + 临时 namespace |
| SSE 日志流 | httptest 连接，验证 step/end 事件 |

---

## 五、CI 阶段

lint（go vet + gofmt）→ unit（go test ./internal/...）→ integration（-tags=integration）→ build（docker build）

---

## 六、依赖清单

- Go：标准库 testing + testify（可选）
- mock：接口手写 mock（builder/deployer/git 接口）
- 集成：testcontainers-go（mysql）、kind（k8s）、本地 registry


---

## 七、手动验收步骤（新功能 + 真实环境）

### 7.1 健康检测（D9）
1. 启动：HEALTH_CHECK_INTERVAL=1 ./navori（1 分钟便于观察）
2. 镜像仓库/部署环境页：不手动点测试，等 1 分钟
3. 预期：状态灯自动变为「正常」或「失败」
4. 负向：故意填错误 kubeconfig/registry 凭据 → 自动变为「失败」

### 7.2 流水线 cron 定时触发（D10）
1. 给某条流水线配 cron：*/1 * * * *
2. 打开流水线详情，观察是否每分钟出现新的 cron run

### 7.3 定时触发 + 有新 commit 才跑（D11）
1. 配 cron */1 * * * *
2. 首次到点触发一次
3. 不推送新提交，观察后续到点是否跳过（不新增空跑 run）
4. 推送一个新 commit，观察下一次到点是否触发

### 7.4 真实验证
- K8s 部署/回滚：触发带部署流水线 → kubectl 确认 workload 就绪；让部署失败 → 观察自动 rollout undo
- MySQL 双后端：DB_DRIVER=mysql 启动 → 验证迁移与 CRUD
- outgoing webhook：配置可接收的 webhook 地址（如 nc/网钩）→ 跑完 run → 验证收到 HMAC 签名 payload
- 长构建取消：构建中停止 run → 验证 build 进程组被取消
