# Navori — AI Agent 导航指南

> 本文档供 AI 编码助手（及新成员）在新会话中快速定位项目。
> 会话工作目录：/Users/derek/code/ops/navori/

---

## 一、项目概要

Navori 是一个「git 托管平台无关」、单容器可启动、带 Web 界面的轻量 CI/CD 工具：只要仓库里有 Dockerfile，就能「按分支触发 → 构建镜像 → 推送仓库 →（可选审批）部署到 K8s」，跑完发 webhook 通知。

技术栈：Go 单二进制 + React 内嵌 SPA + SQLite/MySQL 双存储 + docker/podman 构建 + kubectl 部署。

---

## 二、必读文档（按顺序）

| 顺序 | 文档 | 为什么读 |
|---|---|---|
| 1 | docs/API.md | 唯一权威：REST + SSE + webhook 契约 |
| 2 | docs/DESIGN.md | 技术方案 + 数据模型（§5）+ 配置模型（§6） |
| 3 | docs/RESEARCH.md | 调研与选型背景 |
| 4 | docs/UX-RESEARCH.md | 产品设计/UI/交互调研与优化路线图 |
| 5 | ../ENGINEERING-DISCIPLINE.md（ops 根目录） | 通用工程纪律（方法论） |

---

## 三、按任务速查

| 你要做的事 | 读 |
|---|---|
| 实现某个 API | docs/API.md（唯一权威）+ docs/DESIGN.md |
| 实现 tag 模板 / 分支规则 | docs/DESIGN.md §8 / §6 |
| 实现执行引擎 / 状态机 | docs/DESIGN.md §7 |
| 写测试 | docs/TESTING.md（M0 后建） |
| 查边界 / 错误码 | docs/EDGE-CASES.md（M0 后建） |
| 做 UX/UI 优化 | docs/UX-RESEARCH.md + docs/MILESTONES.md M6/M7 |

---

## 四、关键决策速查

| 决策 | 结论 |
|---|---|
| 无 DSL | v1 纯 UI 表单配置，不解析 Jenkinsfile / YAML |
| 存储 | SQLite 默认 / MySQL 可选，store 接口 + GORM AutoMigrate |
| 构建 | docker/podman（shell 调用），容器内 podman rootless |
| 部署 | kubectl set image + rollout status + 失败回滚 |
| 认证 | JWT httpOnly cookie（navori_token）+ admin/user 两级 |
| 命名 | Go snake_case / JSON camelCase / 路径 kebab-case / 错误码 E_UPPER_SNAKE |
| 凭据隔离 | 禁止 docker login 写入全局配置/系统钥匙串；测试用 Registry v2 HTTP，推送用临时 DOCKER_CONFIG |

---

## 五、编码约定

- 模块目录见 docs/DESIGN.md §15
- 错误统一 { code, message }，错误码见 docs/API.md 第一节
- 敏感值（kubeconfig / registry 密码 / git 凭证 / secret 变量）AES-256-GCM 加密，API 永不回显（只回「是否已设置」）
- shell 参数转义审查；image_name 白名单正则
- 写操作（含审批）写 audit_logs，失败不阻断主流程

---

## 六、项目状态

- [x] 方案 + 调研（DESIGN.md v2 / RESEARCH.md v2）
- [x] 改名 lightcicd → Navori
- [x] M0：API 契约 + 三件套 + 测试策略 + 里程碑
- [x] M1：骨架 + 认证
- [x] M2：仓库 + 触发
- [x] M3：构建推送
- [x] M4：部署 + 审批 + 通知
- [x] M5：打磨
- [x] UX 产品设计调研（docs/UX-RESEARCH.md）
- [x] M6：UX 体验优化（P0，已完成）
- [x] M7：体验深化（P1，已完成）
- [x] 定时任务 D9–D11、通知模块、审计、取消等
- [x] **V1 已收官（2026-08-18）** —— 新会话做 V2 请读 CONTEXT §7A + DEFERRED + DESIGN

