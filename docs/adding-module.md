# 新增 WinPlate 模块

WinPlate 的模块由同一个 ID 贯穿渲染层、Electron 主进程和 Python 后端。新增模块时不要直接往应用外壳添加新的定时器。

## 1. 注册元数据

在 `apps/windows-electron/src/shared/moduleRegistry.js` 增加 `ModuleMeta`：

```js
{
  id: "example",
  title: "Example",
  section: "Example",
  views: ["dashboard", "detail", "floating"],
  defaultEnabled: true,
  defaultOrder: 80,
  defaultRefreshSeconds: 60,
  minRefreshSeconds: 15,
  maxRefreshSeconds: 3600,
  configurable: true
}
```

设置页、启停状态、顺序和刷新周期都从这份注册表派生。

## 2. 实现渲染契约

渲染模块必须通过 `apps/windows-electron/src/renderer/modules/contract.mjs` 校验，并实现：

```js
{
  meta,
  load(context),
  normalize(raw, previous),
  getStatus(data, health),
  renderDashboard(context),
  renderDetail(context),
  renderFloating(context),
  bind(root, context)
}
```

所有可刷新的根元素使用 `data-module-id="example"`。刷新时只同步这些根元素，不得调用 `renderMain()`。

## 3. 注册数据边界

- Electron IPC 边界登记在 `apps/windows-electron/src/main/modules/index.js`。
- Python 数据服务登记在 `backend/local-api/winplate_local_api/modules/registry.py`。
- 已存在的 IPC 和 FastAPI 路径保持兼容；新模块可以增加路径，但不要复用其他模块的私有状态。

## 4. 错误与缓存

- 成功时提交新数据并将健康状态设为 `live`。
- 失败时保留最后成功数据，状态设为 `stale`；没有成功数据时才设为 `error`。
- 定时刷新不得与同模块的在途请求重叠；用户强制刷新只排队一次。
- 密钥只能由 Electron 主进程或 Python 后端读取，不能通过 preload 回传。

## 5. 通知来源约定

- 如果模块会向通知中心发通知，优先提供稳定 `sourceId`，例如消息 ID、告警 ID 或任务 ID。
- 模块若支持“从通知跳回源模块”，应保证主进程能根据 `sourceId` 读取详情并定位到对应记录。
- 未提供专用通知动作时，通知中心会自动回退为 `copy + markRead`；完整接入后应至少支持 `navigate` 或可解析的详情。

## 6. 验证

至少补充以下覆盖：

- 模块元数据与契约校验。
- 刷新成功、失败保留旧数据、重复请求去重。
- Dashboard、详情页和悬浮态渲染。
- 模块禁用后隐藏界面并停止计时器。

完成后运行：

```powershell
npm run check
npm run backend:test
```
