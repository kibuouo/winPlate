# WinPlate 多平台单仓库架构设计

日期：2026-07-01

## 目标

WinPlate 将 Windows Electron、macOS、iOS 与 watchOS 客户端统一放在一个仓库的 `main` 分支中。平台实现按目录隔离，跨平台业务能力放入共享包，本地 FastAPI 服务继续采用无服务器、本机运行模式。

本次重构优先保持现有 Windows Electron 版和已完成的 macOS 菜单栏能力，不借目录迁移重写界面或改变产品行为。iOS 与 watchOS 本轮只建立目录边界和平台路线，不声明尚未完成的健康数据能力。

## 分支策略

- `main` 是唯一长期集成分支，承载所有平台和共享能力。
- 远端 `codex/macos-menu-bar` 中尚未进入 `main` 的实现先迁入并完成验证。
- 确认该分支的独有工作均可在 `main` 追溯且通过验收后，删除远端 `codex/macos-menu-bar`。
- 后续短期功能分支可以按正常开发流程创建，但不再为平台维护永久分支。

## 目标目录

```text
winPlate/
  apps/
    windows-electron/
    macos/
    ios/
    watchos/

  packages/
    core/
      notification/
      digest/
      module-registry/
      usage-models/
    shared-types/
    icons/

  backend/
    local-api/
      weather/
      mail/
      github/
      ai-usage/

  docs/
    architecture.md
    notification-center.md
    platform-roadmap.md
```

## 目录职责

### `apps/windows-electron`

保留现有 Electron 应用，包括主进程、preload、renderer、Windows 窗口与托盘、系统通知、开机启动以及本地后端进程管理。迁移以路径调整和行为保持为主，不同时进行界面重写。

### `apps/macos`

承载 macOS 客户端。现有 Electron macOS 菜单栏实现先作为可运行的过渡实现和行为基准迁入；未来的 SwiftUI/AppKit 原生实现稳定并达到同等能力后，再单独设计过渡实现的退役方案。

### `apps/ios` 与 `apps/watchos`

为 Apple 健康数据授权、采集、同步和移动端展示预留平台边界。健康权限、数据所有权、设备同步协议及隐私策略须在实现前另行设计，本次不加入占位业务逻辑。

### `packages/core`

存放与操作系统、界面框架和持久化技术无关的纯业务规则：

- `notification`：通知归一化、状态与优先级规则。
- `digest`：智能摘要输入整理、聚合与降级规则。
- `module-registry`：状态模块的注册、启停、排序和刷新策略模型。
- `usage-models`：AI/Codex 等用量、额度和重置时间模型。
- 通用颜色分级和图标语义匹配规则按所属业务模块组织，避免形成无边界的工具集合。

`packages/core` 不得导入 Electron、Node 平台 API、SwiftUI、AppKit、FastAPI 或 SQLite。其公开接口必须能通过纯单元测试验证。

### `packages/shared-types`

定义通知、摘要、模块状态、天气、邮件、GitHub、AI 用量和健康数据等跨进程、跨语言数据契约。JavaScript/TypeScript、Python 与 Swift 实现应以这些契约的语义为准；如无法直接共享源码，则通过版本化 schema 和契约测试保持一致。

### `packages/icons`

管理业务语义到图标标识的映射和可共享资源。各平台负责把统一图标标识转换为 Electron/Web、SF Symbols 或 watchOS 可渲染资源，不在 core 中引入平台图标 API。

### `backend/local-api`

继续提供只在本机运行的 FastAPI 服务，负责外部数据获取、本地缓存、SQLite 持久化和 localhost API。首批模块为天气、邮件、GitHub 与 AI 用量。服务不引入云端部署要求，密钥不通过渲染层或公网暴露。

## 数据流

```text
外部服务 / 系统数据
        |
        v
backend/local-api
        |
        v
packages/shared-types 数据契约
        |
        v
packages/core 归一化、摘要、分级
        |
        v
apps/windows-electron | apps/macos | apps/ios | apps/watchos
```

本地 API 负责 I/O 和持久化，core 负责确定性业务规则，apps 负责平台生命周期、权限、系统集成和渲染。平台客户端不得复制摘要、分级或模块注册规则。

## 错误与降级

- 外部服务失败时，本地 API 保留最后成功数据并返回明确的陈旧状态和错误类别。
- core 只处理结构化结果，不吞掉来源错误；摘要不可用时回退到确定性聚合。
- 单个平台集成失败不得阻止其他模块启动。
- schema 变更必须具有明确版本或兼容策略，并由契约测试覆盖。
- 本地服务只监听 loopback 地址；日志和错误响应不得泄露访问令牌、邮件凭据或健康数据。

## 迁移方案

采用“一次建立骨架、分阶段搬迁”的方式，每一步都保持仓库可测试：

1. 将 `codex/macos-menu-bar` 的独有提交整合进 `main`，先解决与 Windows 最新提交的差异。
2. 建立 `apps`、`packages`、`backend/local-api` 的目录骨架和根工作区配置。
3. 原样迁移现有 Electron 应用至 `apps/windows-electron`，修正脚本、资源、测试和 Python 启动路径。
4. 将 FastAPI 与相关模块迁入 `backend/local-api`，保持 localhost 端口、缓存和 SQLite 行为兼容。
5. 从被验证的现有代码中逐步提取 `packages/core`、`packages/shared-types` 和 `packages/icons`；不先创建未被实际消费者使用的抽象。
6. 将现有 Electron macOS 菜单栏代码迁入 `apps/macos` 的明确过渡区域，并记录原生 SwiftUI/AppKit 路线。
7. 更新 `docs/architecture.md`、`docs/notification-center.md` 与 `docs/platform-roadmap.md`。
8. 完成全量验收并确认提交可追溯后，删除远端 `codex/macos-menu-bar`。

## 测试与验收

- Windows Electron 的启动、悬浮窗、通知、邮件、天气、GitHub、Codex、设置和刷新功能无行为回退。
- 已完成的 macOS 菜单栏、设置、窗口策略和系统集成功能在迁移后继续通过现有测试。
- 本地 API 继续只监听 localhost、使用本地 SQLite，且不增加云端依赖。
- 根目录提供统一且有文档说明的开发、检查和测试命令。
- Windows 与 macOS 测试在同一 `main` 分支和 CI 中执行。
- `packages/core` 的纯业务逻辑由平台无关单元测试覆盖。
- `shared-types` 与本地 API、Electron/Swift 消费方之间具有契约测试。
- 路径迁移后，应用资源、Python 解释器发现、打包入口和测试 fixture 均从新位置解析。
- 删除 `codex/macos-menu-bar` 前，使用 Git 历史核对其独有提交均已合入或被有记录地替代。

## 非目标

- 本轮不重写 Windows Electron 界面。
- 本轮不承诺完成 SwiftUI/AppKit、iOS 或 watchOS 产品实现。
- 本轮不引入云端后端、账号同步服务或远程数据库。
- 本轮不为了目录统一而强行跨语言共享运行时代码；跨语言共享以契约和一致行为为目标。
