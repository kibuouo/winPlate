# WinPlate

<div align="center">

Windows 桌面悬浮状态板，聚合 GitHub、Codex、天气、通知、邮件与网络信息。

轻量常驻、信息集中、交互直接，适合把高频状态放回桌面可见区域。

</div>

<p align="center">
  <img src="./assets/winplate-ui-preview.png" alt="WinPlate 软件界面预览" width="690" />
</p>

<p align="center">
  <strong>Electron</strong> + <strong>FastAPI</strong> + <strong>SQLite</strong>
</p>

## 项目简介

WinPlate 是一个面向 Windows 的悬浮状态面板。它将开发者日常最常看的几类信息收拢到一个紧凑的胶囊界面中，包括：

- GitHub 账号状态与贡献信息
- Codex 使用额度与重置时间
- 和风天气与位置选择
- 系统通知与智能通知摘要
- QQ 邮箱 IMAP 摘要
- 心率占位模块与网络速率显示

相比频繁切换网页、客户端和系统面板，WinPlate 更强调“抬眼即见”的桌面信息密度。

## 软件界面展示

上图展示的是 WinPlate 的悬浮主胶囊界面，整体布局分为三层：

- 左侧为 GitHub、Codex 等高频开发状态
- 中间为智能通知摘要区，突出当前最值得关注的信息
- 右侧为天气、心率、网络和设置入口等辅助信息

界面设计重点：

- 信息块足够紧凑，但仍保持清晰分组
- 核心数值使用强对比强调，适合桌面快速扫读
- 悬浮窗适合长期常驻，不会像完整应用窗口那样打断工作流

## 核心能力

### 1. GitHub 状态聚合

- 拉取公开 GitHub 资料、仓库信息与贡献日历
- 支持缓存与失败回退，避免 GitHub 接口偶发波动影响展示
- 可结合 Token 提升请求额度并启用官方 GraphQL 贡献数据

### 2. Codex 使用情况读取

- Electron 主进程独立启动隐藏 Codex CLI PTY
- 通过 `/status` 提取额度剩余百分比与重置时间
- 结果缓存 30 秒，避免频繁拉起命令造成干扰

### 3. 天气与位置管理

- 由本地 FastAPI 后端统一请求 QWeather
- 支持系统定位、手动城市选择与环境变量兜底
- 包含天气用量统计与预警通知同步逻辑

### 4. 智能通知摘要

- 聚合原始通知并按来源、优先级、风险变化做归类
- 对天气预警、GitHub 动态、开发任务状态做统一视图整理
- 支持未读数、批量已读、清空与测试通知注入

### 5. 邮件摘要与收件箱接入

- 支持 QQ 邮箱 IMAP 连接
- 提供邮件列表摘要、正文读取与已读同步
- 让邮件提醒进入同一个桌面信息面板

### 6. 桌面悬浮体验

- 独立浮窗显示，不必总停留在主应用页
- 主界面与悬浮态共享数据源
- 适合做常驻桌面开发状态总览

### 7. 模块化刷新与设置中心

- GitHub、Codex、邮件、通知、天气、心率和网络使用统一模块注册表
- 自动刷新按模块独立调度，失败时保留最后成功数据并显示降级状态
- 设置页支持模块启停、排序、刷新周期、界面密度、透明度和 AI 摘要开关
- GitHub Token 等密钥继续保存在 Windows 用户环境变量中，不会回显到渲染层

## 技术架构

```text
Electron Main
  |- 启动桌面窗口 / 托盘 / 悬浮窗
  |- 读取 Codex CLI 状态
  |- 管理系统交互与 IPC
  |
  |- FastAPI Backend (backend/main.py)
      |- GitHub 数据拉取
      |- QWeather 天气与预警
      |- QQ Mail IMAP 摘要
      |- SQLite 本地缓存与状态持久化
      |- 通知归档与聚合
  |
  |- Renderer
      |- Dashboard 主界面
      |- Floating 悬浮界面
      |- Settings / Mail / Notifications / QWeather 交互
```

## 快速开始

### 环境要求

- Windows
- Python 3.x
- Node.js

### 开发启动

```powershell
npm run venv:create
npm run backend:install
npm install
npm run dev
```

启动流程如下：

1. Electron 拉起本地 Python 后端 `backend/main.py`
2. 等待 `http://127.0.0.1:8765/api/health` 返回正常
3. 创建主窗口与悬浮窗口
4. 渲染层按模块刷新；默认 Codex 30 秒、通知 60 秒、网络 2 秒，其余周期由设置中心管理

如果仓库根目录存在 `.venv\Scripts\python.exe`，Electron 会优先使用它；不需要先手动激活虚拟环境。

如需手动激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

## 常用脚本

```powershell
npm run dev
npm run check
npm run backend:test
```

说明：

- `npm run dev`：启动 Electron 开发环境
- `npm run check`：执行主进程、渲染层语法检查与 Node 测试
- `npm run backend:test`：运行后端 Python 单元测试

## 配置说明

### GitHub

默认 GitHub 账号为 `kibuouo`。如需切换：

```powershell
$env:WINPLATE_GITHUB_USERNAME = "your-login"
$env:GITHUB_TOKEN = "github_pat_..."
npm run dev
```

说明：

- `WINPLATE_GITHUB_USERNAME`：指定展示的 GitHub 用户
- `GITHUB_TOKEN`：可选，但推荐配置，用于提升速率限制并启用 GraphQL 贡献数据

### QWeather

天气数据由本地后端请求 QWeather，并在本地缓存 10 分钟。

```powershell
[Environment]::SetEnvironmentVariable("QWEATHER_API_KEY", "your-api-key", "User")
[Environment]::SetEnvironmentVariable("QWEATHER_API_HOST", "your-project-api-host", "User")
npm run dev
```

补充说明：

- `QWEATHER_LOCATION` 可作为系统定位失败时的后备位置
- 如果未授权定位且未配置后备位置，界面会提示手动设置城市
- API Key 保留在本地后端，不会暴露到渲染层

### Python 解释器覆盖

如果你不想使用默认 `.venv`，可以显式指定解释器：

```powershell
$env:WINPLATE_PYTHON = "C:\path\to\python.exe"
npm run dev
```

## 项目结构

```text
winPlate/
|- assets/        图标与 README 展示资源
|- backend/       FastAPI、天气、GitHub、邮件、SQLite
|- src/main/      Electron 主进程、窗口、托盘、状态读取
|- src/preload/   预加载桥接层
|- src/renderer/  主界面、悬浮态、设置页与样式
|- src/shared/    共享 mock 数据与常量
|- docs/          模块开发与维护说明
```

新增模块请参阅 [`docs/adding-module.md`](./docs/adding-module.md)。

## 当前定位

这个项目更像一个“桌面开发状态中枢”，而不只是一个天气或 GitHub 小组件。它把多来源信息压缩到同一个稳定、轻量、低打扰的桌面入口中。

适合的使用场景：

- 一边开发一边关注 GitHub / Codex / 邮件变化
- 想在桌面常驻看到天气与网络速率
- 希望把通知整合成更有优先级的摘要，而不是散落在多个应用里

## 打包方向

后端已经通过 `src/main/pythonService.js` 与 Electron 主进程解耦，后续可以打包为单文件可执行程序：

```powershell
python -m pip install pyinstaller
pyinstaller --onefile --name winplate-backend backend/main.py
```

后续只需将生成的后端可执行文件作为 Electron 资源一并打包，并在生产模式切换启动入口即可。

## 版本

当前项目版本：`v0.1.0`
