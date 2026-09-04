# Navori — DevOps 流水线产品设计调研

> 调研日期：2026-08-17
> 范围：底层实现、用户交互、UI 设计、产品界面
> 目标：为 Navori 后续 UI/交互/信息架构优化提供可借鉴清单
> 说明：本文基于公开资料与行业认知整理，未实时联网核对；具体版本细节以各产品官方文档为准。

---

## 1. 调研对象总览

按产品形态分四类，便于对照 Navori（轻量、单容器、Web UI、仓库无关、UI 表单配置、无 DSL）：

| 类别 | 代表产品 | 核心特征 |
|---|---|---|
| 托管 CI（SaaS） | GitHub Actions、GitLab CI/CD、CircleCI、Azure DevOps、Travis CI、Codefresh | 与代码托管平台深度集成，YAML 配置，生态完善 |
| 自托管 CI | Jenkins（Blue Ocean）、TeamCity、Bamboo、Buildkite、Drone、Woodpecker、Gitea Actions、GoCD、Concourse | 可私有化，支持复杂流水线，部分偏重 |
| 云原生/K8s 原生 | Tekton Dashboard、Argo Workflows、Argo CD、Spinnaker、KubeSphere DevOps | 以 K8s CRD/控制器为核心，可观测性强，重 |
| 轻量/聚焦型 | Drone、Woodpecker、Navori、Jenkins Blue Ocean | 强调简单、快速上手、UI 化配置 |

---

## 2. 各产品设计要点

### 2.1 GitHub Actions

**底层实现**
- 事件驱动：push / PR / schedule / workflow_dispatch 等触发 workflow。
- Runner 架构：托管 Runner + 自托管 Runner；Job 可跑在独立 VM/容器。
- YAML workflow 描述，`uses` 复用社区 Action，市场生态是核心护城河。
- 日志按 step 分块，支持 group 折叠、annotation（错误/警告定位到源码行）。

**交互/UI**
- **Dashboard**：最近 workflow runs 列表 + 状态徽章 + 可筛选（你参与的、所有、分支）。
- **Run 详情**：左侧 Job 列表，中间 Step 树，右侧实时日志；点击 Step 高亮日志区间。
- **Checks / PR 状态**：把 CI 结果嵌入代码审查流程，开发者不用离开 GitHub。
- **Re-run**：支持重跑失败 job、重跑全部、用相同 commit 重跑；按钮都在 run 页顶部。
- **Secrets/Variables**：分环境级、仓库级、组织级，UI 表格 + “更新时间”，敏感值不回显。

**可借鉴**
- 日志按 step 折叠/分组、错误 annotation 高亮。
- Run 详情采用“Job/Step 树 + 日志联动”布局。
- 状态徽章可直接嵌入 README。
- 重跑失败步骤（而非整条流水线）是高频需求。

### 2.2 GitLab CI/CD

**底层实现**
- `.gitlab-ci.yml` + GitLab Runner（支持 docker、ssh、k8s executor）。
- Pipeline 由 stages 组成，同一 stage 的 job 可并行。
- 内置 Container Registry、环境（environments）、部署看板、审批（manual job / protected environment）。
- 变量体系完善：全局/项目/组/实例/受保护变量。

**交互/UI**
- **Pipeline 编辑体验**：YAML 实时 lint、CI Lint 页面、可视化 pipeline editor（graph editor）。
- **Pipeline 详情**：横向 stage 泳道图，job 按 stage 排列，状态颜色清晰，点击 job 进日志。
- **Merge Request 集成**：流水线结果、覆盖率、安全扫描直接显示在 MR 中。
- **Environments 页面**：环境列表 + 最近部署 + 部署历史 + 一键回滚，把“部署”作为一等公民。
- **审批**：manual job 在 UI 上显示为“播放/手动触发”按钮，受保护环境可要求审批。

**可借鉴**
- **Environment（部署环境）独立页面**：Navori 目前部署环境只是资源列表，没有“某环境当前版本/最近部署/回滚”视图。
- Pipeline 泳道图：Navori 固定三段式（build→push→deploy），即使没有 DAG，也可以用 stage 泳道展示进度。
- 变量分级：Navori 可做“流水线级覆盖/全局变量”的可视化层级。
- 部署审批应展示“将要部署什么、到哪个环境、影响面”，而非只给一个表格行。

### 2.3 Jenkins + Blue Ocean

**底层实现**
- Master/Agent 分布式，Pipeline 即 Groovy 代码（Jenkinsfile）。
- 插件体系极强，但配置复杂、维护成本高。
- Blue Ocean 是新一代 UI，尝试把 Jenkins 的复杂流水线可视化。

**交互/UI**
- **Pipeline 编辑器**：Blue Ocean 提供可视化编辑，但仍基于 Jenkinsfile。
- **Run 详情**：卡片式步骤流（不是表格），每步有状态、耗时、日志按钮；失败步骤红色突出。
- **活动视图**：所有分支的最近运行以“泳道 + 分支”矩阵展示，类似 GitHub 的 commit 状态。
- **日志查看**：支持“仅看失败”、按步骤过滤、时间戳。

**可借鉴**
- Run 详情“卡片式步骤流”比简单 chip 更易读，Navori 的 steps 可以做成垂直时间线。
- “仅看失败日志”/“高亮错误”是排障高频操作。
- 活动视图（分支 × 运行状态矩阵）适合 Navori Dashboard 升级。

### 2.4 CircleCI

**底层实现**
- YAML + 可复用 orbs（类似 GHA 的 actions 市场）。
- 默认 Docker executor，支持 resource class、并行、缓存、测试拆分。
- 后端做队列与调度，UI 反馈“排队中/准备中/运行中”。

**交互/UI**
- **Dashboard**：项目卡片 + 最近构建状态 + 平均时长 + 趋势。
- **Pipeline 详情**：左侧 job 列表，中间 workflow 可视化，右侧日志；workflow 可看到并行/依赖关系。
- **Insights**：构建时长趋势、Flakiness、信用消耗，偏团队效能。
- **快捷操作**：Rerun（从头/从失败）、SSH into job、Cancel、Approve job（手动门禁）。

**可借鉴**
- Dashboard 用“项目卡片 + 状态 + 时长 + 趋势”比纯表格更有信息密度。
- 手动门禁（approval job）在 UI 上直接显示“等待批准”按钮，和 Navori 审批类似，但会展示前后 job 上下文。
- 从失败重跑、SSH 调试这类操作对自托管工具也有参考意义（Navori 可以“从失败步骤重跑”）。

### 2.5 Azure DevOps Pipelines

**底层实现**
- YAML 或经典可视化编辑器双模式；Agent Pool / Microsoft-hosted agents。
- 与 Azure Repos / GitHub 集成，支持多平台构建。
- 内置 Release Pipeline（经典部署流程）与 approvals、gates。

**交互/UI**
- **经典编辑器**：左侧任务列表，右侧参数表单，拖拽式阶段编排。
- **Pipeline 页面**：列表 + 最近运行 + 可编辑 YAML。
- **Release 视图**：阶段泳道（Dev→Test→Prod），每个阶段显示部署状态、审批人、时间；一键部署/回滚。
- **审批通知**：邮件/Teams 等通知 + 审批链接。

**可借鉴**
- “流水线（CI）+ 发布（CD）分离但关联”的模型：Navori 可以把“构建推送”和“部署环境”拆成两段视图。
- 阶段泳道 + 审批门禁的展示方式，适合 Navori 的“构建 → 审批 → 部署”。
- 可视化编辑器+表单混合：Navori 的纯表单配置可参考“左列表右表单”布局。

### 2.6 TeamCity

**底层实现**
- Java 服务端 + Agent；Build Step 可视化配置，非纯 YAML。
- 增量构建、VCS 集成、快照依赖、构建链（Build Chains）。
- 自带用户/角色/审计，适合企业内部。

**交互/UI**
- **项目页**：构建配置列表 + 最近构建卡片 + 状态。
- **Build 详情**：左侧 build 树，右侧 tab（Overview/Changes/Tests/Build Log/Parameters）。
- **变更列表**：每次构建显示关联 commit、作者、变更内容。
- **测试报告**：失败测试聚合、历史 flaky 标记。

**可借鉴**
- Build 详情用 **Tabs** 组织（概览/变更/参数/日志/测试），比单页长滚动清晰。
- Navori 可以在 Run 详情增加“变更/参数/步骤耗时”等 tab。
- 每次构建展示关联 commit 和作者，对团队协作有价值。

### 2.7 Buildkite

**底层实现**
- 混合模型：控制面 SaaS，构建在用户自己的 agent 上执行，隐私和弹性兼得。
- Pipeline YAML 可以来自代码仓库，UI 也可以配置。
- Agent 自动注册，支持队列、并发、动态伸缩。

**交互/UI**
- **Build 页面**：左侧 job 列表，中间实时日志（自动滚动 + 搜索），右侧元数据；整体非常干净。
- **Pipeline 页面**：分支、最近 builds、状态徽章。
- **Annotations**：允许 job 输出富文本/指标到 build 页面。
- **Scheduling / Block step**：人工确认步骤用“Blocked”状态，UI 显示“Unblock”按钮。

**可借鉴**
- 日志支持 **搜索 + 自动滚动 + 折叠**，是 Navori SSE 日志区可以立刻优化的点。
- 人工确认（Block step）比独立审批页更贴合上下文：在 run 详情内直接展示等待/通过/拒绝。
- 元数据面板（commit、分支、作者、时间、机器）放在右侧，比顶部堆字段更易扫读。

### 2.8 Drone / Woodpecker

**底层实现**
- 轻量自托管 CI，容器化执行，YAML pipeline。
- Drone 与 Git 托管平台深度绑定；Woodpecker 是 Drone 的社区分支，支持 Forgejo/Gitea/GitHub/GitLab。
- 单二进制 + 内嵌 UI，和 Navori 形态最接近。

**交互/UI**
- **极简信息架构**：左侧 Repositories，点击仓库进入该仓库的 Builds 列表。
- **Build 详情**：顶部状态/commit/作者/时间，中间步骤卡片（success/failure/running），下方日志按步骤切换。
- **设置**：仓库级 Secrets / Settings / Cron 都在仓库详情页内。
- 没有复杂 DAG，突出“轻、快、够用”。

**可借鉴**
- Navori 与 Woodpecker 形态最像，可以学习它的“仓库为中心”组织方式，但 Navori 已有“流水线”概念，应保持流水线为中心。
- Secrets 放在对应资源详情页内，而不是全部堆在全局设置。
- 步骤卡片 + 按步骤切换日志，是轻量工具最务实的日志 UI。

### 2.9 Gitea Actions

**底层实现**
- 兼容 GitHub Actions workflow 语法，由 Gitea 的 runner 执行。
- 与 Gitea 仓库深度集成，天然支持 PR/Issue 事件。
- 相对轻量，单二进制 + 内嵌 UI。

**交互/UI**
- **仓库 Actions 页**：左侧 workflow 文件列表，右侧最近 runs；点 run 进详情。
- **Run 详情**：类似 GitHub 的 job 树 + 日志，但更朴素。
- **Secrets** 在仓库设置里管理。

**可借鉴**
- 如果未来 Navori 要支持多流水线/多工作流，可以参考“文件/配置列表 + 运行历史”的左右布局。

### 2.10 Tekton Dashboard

**底层实现**
- Tekton Pipelines 是 K8s CRD：Task/Pipeline/PipelineRun/TaskRun，控制器执行。
- Dashboard 是纯 Web 查看器/操作器，不负责调度。

**交互/UI**
- **PipelineRuns 列表**：命名空间筛选 + 状态 + 时间。
- **Run 详情**：Pipeline DAG 可视化 + TaskRun 日志。
- 强调 **云原生可观测性**：CRD 状态、条件、事件都可查看。
- 支持日志下载、重试、取消。

**可借鉴**
- DAG 可视化适合复杂流水线；Navori 是固定三段式，不需要完整 DAG，但可以用“阶段泳道”表达依赖。
- K8s 风格的 Conditions/Events 展示对排障有帮助，但 Navori 面向更轻用户，应简化。

### 2.11 Argo Workflows / Argo CD

**底层实现**
- Argo Workflows：K8s 原生工作流引擎，DAG/步骤模板，控制器 + CRD。
- Argo CD：GitOps 持续交付，应用状态与仓库期望状态双向收敛。

**交互/UI**
- **Workflow 详情**：实时 DAG 图，节点颜色随状态变化，点击节点看日志/参数。
- **Argo CD UI**：应用卡片、资源树、同步状态、健康状态、历史部署 + 回滚。
- 同步/回滚操作非常显眼，状态色（绿/红/黄）全局一致。

**可借鉴**
- **“资源树”式部署视图**：Navori 的部署环境页面可以展示 workload 当前镜像、健康状态、最近部署历史、回滚按钮。
- 状态颜色体系（成功/失败/进行中/未知）可以统一定义到前端组件，Navori 已有 Status 组件，但可补充“健康/降级”等状态。
- 操作按钮（同步/回滚）在详情页顶部常驻，符合部署工具直觉。

### 2.12 Spinnaker

**底层实现**
- Netflix 开源，面向多云 CD，Pipeline 是 stage 编排，支持手动判断、并行分支、回滚。
- 微服务架构较重，适合大规模平台团队。

**交互/UI**
- **Pipeline 可视化**：stage 卡片流式布局，点击 stage 看配置/执行详情。
- **应用视图**：集群/负载均衡/防火墙等云资源拓扑。
- **Manual Judgment**：人工判断 stage 在 UI 中非常直观，显示等待/继续/中止。

**可借鉴**
- 手动判断（Manual Judgment）的“卡片式 stage + 等待状态”设计，比独立审批表格更有上下文。
- Navori 的审批可以嵌入 run 详情中的 deploy stage 位置，而不是单独列表。

### 2.13 KubeSphere DevOps

**底层实现**
- 基于 Jenkins 做 CI + 可选 Argo CD 做 CD；通过 ks-devops CRD 抽象 Jenkins Pipeline。
- 统一 Web 控制台管理多租户、DevOps 项目、凭证、流水线。

**交互/UI**
- **DevOps 项目页**：流水线列表 + 最近运行状态 + 创建入口。
- **流水线详情**：Jenkins Blue Ocean 风格步骤视图 + 日志 + 参数。
- **凭证管理**：独立菜单，统一管理集群/仓库/镜像凭证。
- 多租户：项目/空间隔离，权限模型完整。

**可借鉴**
- **统一凭证管理**：Navori 目前 kubeconfig/registry 密码/变量分散在各资源页，可以做一个“凭证”聚合视图，但保持实际归属清晰。
- 多租户/项目空间对 Navori 是 v2 方向，UI 可以先预留“项目/空间”切换概念。
- 流水线列表显示最近运行状态矩阵，信息密度高。

### 2.14 GoCD

**底层实现**
- 开源 CD，Pipeline 依赖（fan-in/fan-out）建模强，Value Stream Map（VSM）是其标志。
- Server + Agent，配置可 XML/JSON，UI 也支持编辑。

**交互/UI**
- **Value Stream Map**：端到端可视化从 commit 到部署的价值流，节点显示阶段状态、时长。
- **Pipeline 活动页**：时间轴 + 多 pipeline 状态。
- 强调“看到整个交付链路”，而不只是单个构建。

**可借鉴**
- 如果 Navori 未来支持多流水线/多环境，VSM 式“端到端价值流”可成为 Dashboard 的高级形态。

### 2.15 Concourse

**底层实现**
- 云原生 CI/CD，Pipeline 即代码（YAML），资源（Resource）抽象统一输入输出。
- 每个任务跑在容器中，强调可重入、可组合。

**交互/UI**
- **Pipeline 总览**：所有 pipeline 的实时 DAG 图平铺，节点状态颜色。
- **Job 详情**：构建历史 + 输入输出资源 + 日志。
- 极简、极客风，不强调引导。

**可借鉴**
- 实时 DAG 总览适合复杂系统；Navori 不需要，但“pipeline 总览卡片 + 状态点阵”可以借鉴。

---

## 3. 横向对比：Navori 可借鉴的产品设计维度

### 3.1 信息架构 / 导航

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| Woodpecker | 仓库为中心，设置/Secrets 放仓库内 | 可保持“流水线为中心”，但资源详情可内聚设置 |
| GitLab | Environments 独立一等页面 | 部署环境页应升级为“环境+最近部署+回滚” |
| Azure DevOps | CI（Pipelines）与 CD（Releases）分离又关联 | 可在 Run 详情区分构建段与部署段 |
| KubeSphere | DevOps 项目 + 凭证独立菜单 | v2 可考虑项目空间；凭证可聚合展示 |
| Argo CD | 应用/环境卡片 + 资源树 | 部署环境卡片化 |

### 3.2 Run 详情 / 日志

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| GitHub Actions | Job/Step 树 + 日志联动，group 折叠，annotation | 日志按 step 分组，点击步骤定位日志 |
| Buildkite | 日志搜索 + 自动滚动 + 右侧元数据 | SSE 日志加搜索/过滤/复制 |
| Jenkins Blue Ocean | 卡片式步骤流 + 仅看失败 | 步骤时间线 + 失败高亮 + 过滤 |
| TeamCity | Tabs 组织 Build 详情 | 增加“概览/变更/参数/日志”Tabs |
| Tekton/Argo | DAG/资源树 | 固定阶段可做泳道，不必做 DAG |

### 3.3 配置体验

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| GitLab | YAML lint + 可视化编辑器 | 当前无 DSL，可做配置 JSON 校验/预览 |
| Azure DevOps | 左任务列表 + 右参数表单 | 流水线编辑弹窗可改成“步骤配置 + 预览” |
| Drone/Woodpecker | Secrets 放在仓库/资源详情 | 环境变量/凭据与使用场景关联展示 |
| GitHub Actions | Variables 分级（repo/env/org） | 环境变量支持流水线级覆盖 |

### 3.4 Dashboard / 列表

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| CircleCI | 项目卡片 + 状态 + 趋势 | Dashboard 从表格升级为运行概览卡片 |
| GoCD | VSM 端到端价值流 | v2 方向 |
| GitHub Actions | 最近 runs + 筛选 + 徽章 | 增加筛选（分支/状态/触发者） |
| Concourse | 总览 DAG 状态点阵 | 可简化为“流水线状态矩阵” |

### 3.5 审批 / 人工门禁

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| Buildkite | Block step 在 run 详情内 Unblock | 审批嵌入 Run 详情，而非只靠待审批页 |
| Spinnaker | Manual Judgment stage 卡片 | 审批上下文展示更完整 |
| GitLab | 受保护环境审批 | 展示环境/镜像/影响面 |
| Azure DevOps | Release 阶段审批门禁 | 阶段泳道 + 审批状态 |

### 3.6 视觉 / 组件

| 产品 | 做法 | Navori 借鉴点 |
|---|---|---|
| 多数现代产品 | 状态色统一、图标语义化 | Navori Status 已具备，可补充“等待/健康/降级” |
| Argo CD | 应用卡片 + 健康状态 | 部署环境卡片化 |
| Buildkite | 高密度但克制的布局 | 减少表格，增加卡片/分组 |
| GitHub/GitLab | 空状态有引导按钮 | 空列表加“新建 xx”按钮，而不只是文案 |
| Blue Ocean | 失败步骤红色突出 | 步骤时间线失败节点更醒目 |

---

## 4. Navori 可借鉴优化清单（供决策）

按投入产出和与当前定位匹配度分级：

### P0（高价值，轻量改动，建议优先）
1. **Run 详情日志体验升级**
   - 按 step 分组/折叠日志，支持“仅看失败/错误”。
   - 日志区加搜索、自动滚动开关、复制日志按钮。
   - 步骤从 chip 改为垂直时间线，显示耗时与状态。
2. **审批嵌入 Run 详情**
   - 在 Run 详情中 deploy/approve 步骤位置直接显示“等待审批 / 通过 / 拒绝”及审批人，不只在待审批页操作。
   - 待审批页保留，但增加“查看上下文”链接。
3. **Dashboard 概览化**
   - 从“最近运行表格”升级为：总运行数/成功率/进行中 + 最近运行列表 + 按状态筛选。
   - 显示流水线状态点阵（类似 Concourse/CI 总览）。
4. **空状态引导**
   - 所有空列表页增加“新建/添加”主按钮和简短说明，引导用户完成首个仓库→流水线→运行。
5. **统一状态与色彩体系**
   - 扩展 Status 组件：等待、健康、降级、未知等；全局按钮/图标/状态色统一。

### P1（中价值，需要一定设计/开发量）
6. **部署环境页面升级**
   - 从“部署目标列表”升级为“部署环境卡片/列表”：显示当前镜像、最近部署时间、部署历史、回滚入口。
   - 需要后端补充环境最近部署信息（可先从 run 历史聚合）。
7. **Run 详情 Tabs 化**
   - 增加“概览 / 变更 / 参数 / 日志 / 部署”Tabs，把当前单页长滚动拆开。
   - 变更 tab 显示 commit、作者、message（需要 git 数据保留）。
8. **流水线创建/编辑表单增强**
   - 参考 Azure DevOps 左列表右表单：分支规则单独管理，支持规则顺序拖拽。
   - 增加配置校验实时反馈（镜像名正则、tag 模板预览、部署目标连通性提示）。
9. **环境变量分级**
   - 支持流水线级变量覆盖全局变量，并在表单中展示最终生效值（类似 GitLab variables）。
10. **列表筛选与搜索**
    - 运行列表支持按流水线、分支、状态、触发方式筛选；仓库/流水线列表支持搜索。

### P2（方向性，适合 v2 或后续）
11. **凭证聚合视图**
    - 将 kubeconfig、registry 密码、git 凭证等聚合到统一“凭证”页，同时保留资源归属关系。
12. **价值流视图（VSM）**
    - 仿 GoCD，展示 commit→构建→推送→审批→部署的端到端时间线。
13. **项目/多租户空间**
    - 仿 KubeSphere/GitLab group，为多团队隔离做准备。
14. **流水线可视化编辑器**
    - 虽然无 DSL，但可以用“步骤卡片 + 连线”方式编辑固定三段式流水线。
15. **Webhook/通知测试工具**
    - 在通知配置里提供“发送测试事件”按钮，降低集成成本。

---

## 5. 结论

- Navori 的形态最接近 **Woodpecker / Drone / Blue Ocean 的轻量路线**，核心优势是“仓库无关 + 无 DSL + 单容器”，应继续强化轻量与易上手，而不是模仿 Jenkins/Argo 的复杂度。
- 最值得优先借鉴的是**运行详情与日志体验**（GitHub Actions/Buildkite/Blue Ocean）、**部署环境视图**（GitLab/Argo CD）、**审批上下文**（Buildkite/Spinnaker）、**Dashboard 概览**（CircleCI/Concourse）。
- 底层实现上，Navori 的 SSE 日志、shell 执行、SQLite/MySQL、审批/通知已覆盖核心；可优化的是**数据保留与展示**（变更信息、部署历史聚合、步骤耗时）为 UI 升级提供数据基础。
