# Navori — 调研报告（v2 收敛）

> 调研日期：2026-08-13
> 状态：v2 收敛（已按评审：放弃 Jenkinsfile、放弃流水线 DSL、git 仓库无关）
> 配套文档：[DESIGN.md](./DESIGN.md)

## 1. 背景与目标

团队当前用 KubeSphere，实际只用到其 DevOps 的 CI/CD（内嵌 Jenkins），其余组件闲置。为「一个功能引入整个 KubeSphere」不划算，故自建轻量工具。

### 需求清单（最终）

| # | 需求 | 说明 |
|---|---|---|
| R1 | 单容器启动 | 可部署在普通服务器或 K8s |
| R2 | Web 界面 | 管理仓库/流水线/镜像仓库/部署目标 |
| R3 | 仓库无关 | **不绑定 git 托管平台**，任意仓库有 Dockerfile 即可 |
| R4 | 触发可配 | webhook / 手动 / cron，按分支触发 |
| R5 | 构建推送 | 构建镜像并推送至可配置仓库 |
| R6 | 部署更新 | 更新 K8s 镜像，失败回滚 |
| R7 | 部署审批 | 生产部署需人工审批（引入用户） |
| R8 | 跑完通知 | outgoing webhook 通知 |
| R9 | 双存储 | SQLite（默认）/ MySQL（可选） |
| R10 | 服务器 agent（后期） | v2，不阻塞 v1 |

**已明确放弃**：Jenkinsfile 兼容、任意流水线 DSL。

## 2. 为何自研：现成平台对比（含此前遗漏的 GitLab CI）

| 维度 | Woodpecker | Drone CE | Gitea Actions | Tekton | Zadig | GitLab CI | 自研(本方案) |
|---|---|---|---|---|---|---|---|
| 单容器/轻量 | ✅ | ✅ | ⚠️ 需 Gitea | ❌ | ❌ | ⚠️ 需 Runner | ✅ |
| **仓库无关** | ✅ | ✅ | ❌ 绑 Gitea | ✅ | ✅ | ❌ 绑 GitLab | ✅ |
| 分支触发 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 部署审批 | ⚠️ 部分 | ⚠️ 部分 | ⚠️ | ❌ | ✅ | ✅(environments) | ✅ |
| 通知 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| 语法 | 自有 YAML | 自有 YAML | GHA 语法 | 自有 | 自有 | 自有 .gitlab-ci.yml | 无 DSL(UI) |

**关键结论**：GitLab CI 功能最贴合（原生 variables 控制台、SSH executor、commit 变量、审批 environment），**但它绑定 GitLab**；Gitea Actions 绑定 Gitea。其余「仓库无关」的（Woodpecker/Drone/Tekton/Zadig）要么引入自有语法学习成本、要么过重（Tekton/Zadig 需完整 K8s）。**当「不绑定托管平台」是硬约束时，无一现成平台命中全部需求**，故自研成立。

> 说明：初版调研遗漏了 GitLab CI 的对比，本版补上；结论未变——git 仓库无关是自研的核心理由。

## 3. 为何放弃 Jenkinsfile 与流水线 DSL

- **Jenkinsfile 是 Groovy（代码）**，免 Jenkins 执行需自研解释器子集，长尾无穷（script{} / @Library / 共享库），工作量 3-6 人月；且团队存量 Jenkinsfile 实质只有「按分支 build → push → update k8s 镜像」，子集解释器是过度设计。
- **GitHub Actions / GitLab CI 是 YAML（数据）**，解析容易，但「真兼容」= 重写 act / Gitea Actions（uses 市场 + 表达式 + contexts），成本不亚于自研平台。
- 最终决策：**v1 不引入任何 DSL，纯 UI 表单配置**，内部存 JSON。这消除了解析器工作量与语法学习成本，且仓库里只需 Dockerfile。后续按需加「导出/导入 YAML」。

## 4. 构建/部署技术选型

### 镜像构建

| 方式 | 结论 |
|---|---|
| docker/podman（shell 调用） | **选定**。与 aiops 同款已验证；daemon 层缓存；简单 |
| BuildKit（库内嵌） | 否决。client 库需连 buildkitd，进程内嵌依赖非稳定 API，成本高 |
| Kaniko | 备选。无特权无 socket，但约 14 个月停滞 |
| Buildah | 备选。rootless 需节点预配 subuid |

### K8s 部署

选定 **kubectl 二进制（shell 调用）**：与 docker build 方式一致、aiops 已验证；client-go 留作备选（需更多代码但无外部二进制）。

## 5. 部署审批与通知

- 审批：参照 Jenkins input / GitLab CI environments 的「部署前人工确认」模式；v1 用最小用户模型（admin/user）+ 每流水线可选 approvers，不引入多级审批。
- 通知：参照 GitHub/Discord 的 outgoing webhook + HMAC-SHA256 签名模式，接收方可验签防伪；失败仅记日志不阻断主流程。

## 6. 选型结论

**自研 Go 单二进制平台 + docker/podman 构建 + kubectl 部署 + 无 DSL 的 UI 配置 + SQLite/MySQL 双存储 + 部署审批 + webhook 通知**。

理由：
- 「仓库无关」是硬约束，现成平台无一命中；
- 固定三段式管线 + UI 表单配置，把复杂度压到最低；
- Go 单二进制 + 内嵌 SPA 是轻量自托管工具黄金标准（参考 Woodpecker/Gitea）；
- 复用 aiops 已验证经验：shell 出 git/docker/kubectl、SSE 日志、rollout undo、AES 加密、admin/user 用户模型；
- 存储抽象（SQLite/MySQL）为未来「对接已有设施 + 横向扩容」铺路。

## 7. 信息来源

- KubeSphere DevOps：https://github.com/kubesphere/ks-devops
- Woodpecker CI：https://woodpecker-ci.org/
- Drone：https://docs.drone.io/
- Gitea Actions：https://docs.gitea.com/usage/actions/overview
- Tekton：https://github.com/tektoncd/pipeline
- Zadig：https://github.com/koderover/zadig
- GitLab CI：https://docs.gitlab.com/ci/
- BuildKit：https://github.com/moby/buildkit
- Kaniko：https://github.com/GoogleContainerTools/kaniko
- Jenkins Pipeline：https://www.jenkins.io/doc/book/pipeline/syntax/
