# WinPlate Health for iPhone

这是 WinPlate 的第一个原生 iOS 小版本，目前只做健康概览：

- 读取 HealthKit 中最近一次心率；
- 汇总今天的步数和活动能量；
- 支持首次授权、手动刷新和下拉刷新；
- 健康数据只从 HealthKit 读取，不写入 HealthKit；Mac 通过加密的近距离设备连接接收，Windows 通过带配对令牌的局域网地址接收，不发送到互联网。Windows 同步会在本机应用沙盒中暂存一条最新健康概览，以支持后台重试，不保存 HealthKit 原始样本。

工程位于 [`WinPlateHealth`](./WinPlateHealth)。最低支持 iOS 17，目标设备为 iPhone 真机。

## 用 Xcode 运行

1. 用完整 Xcode 打开 `WinPlateHealth/WinPlateHealth.xcodeproj`。
2. 在 Xcode 的 `Settings > Apple Accounts` 登录你的 Apple Account。
3. 选中 `WinPlateHealth` target，在 `Signing & Capabilities` 中选择你的 Team，并保持 `Automatically manage signing`。
4. 如果 Xcode 要求修改 Bundle Identifier，将 `com.kiko.winplate.health` 换成你自己的唯一值。
5. 连接 iPhone，选择它作为 Run Destination，点击 Run；首次运行时在手机的 `设置 > 隐私与安全性 > 开发者模式` 开启开发者模式，并信任该开发者。
6. 在 App 内点击“开启健康数据”，允许读取心率、步数和活动能量。

## 7 天签名说明

不加入 Apple Developer Program 时，Xcode 的 Personal Team 可以用于个人真机测试，但安装用 provisioning profile 只持续 7 天。到期后需要重新 Build & Run，不能把这个签名当作长期分发方案。

本工程已预置 `com.apple.developer.healthkit` entitlement。HealthKit 属于受限能力；如果你的 Personal Team 无法生成包含该 entitlement 的 provisioning profile，Xcode 会在签名阶段报错，此时需要加入付费 Apple Developer Program，或先移除 HealthKit entitlement 仅运行 UI 演示版。仓库不包含任何证书、私钥或 provisioning profile。

## 隐私边界

本版本不保存健康原始数据，不上传到互联网，也不申请写入权限。iPhone 只持久化最新一条待发送的健康概览，用于系统允许的后台重试；Mac 和 Windows 端只保留当前运行期间收到的健康概览。Windows 接收服务仅开放独立的 `8766` 端口，使用 WinPlate 生成的配对令牌；现有本地 API 仍只监听 `127.0.0.1:8765`。

当 HealthKit 产生心率、步数或活动能量变化时，系统会通过 `HKObserverQuery` 尝试唤醒应用并触发后台 HTTP 上传。iOS 的后台调度由系统决定，不承诺固定 30 秒周期；用户从多任务界面强制关闭 App 后，也不保证继续后台同步。

## 连接 Windows 版

1. 在 Windows WinPlate 的“健康”页面复制与 iPhone 使用同一局域网的“Windows 接收地址”；如果 Windows 显示多个地址，请逐个尝试。
2. 确认 iPhone 和 Windows 电脑连接到同一个局域网；首次启动 Windows 版时，在 Windows 防火墙提示中允许专用网络访问。
3. 在 iPhone WinPlate Health 的 `WinPlate 通信` 卡片中粘贴地址，点击“保存地址并测试”。
4. 测试成功后，iPhone 每次刷新 HealthKit 数据都会同步到 Windows；Windows 页面会显示连接状态、最近心率、步数和活动能量。

如果 iPhone 显示无法连接，请检查 Windows 健康卡片上的同步状态：`waiting` 表示接收端未收到数据，`error` 通常表示令牌或端口问题；同时确认 Windows 防火墙允许专用网络访问 TCP `8766`。

Windows 版使用的是局域网 HTTP 接收端，配对地址包含随机令牌。不要把该地址分享给不受信任的设备；后续若需要跨网或更高强度的传输保护，应升级为 TLS 或设备级加密配对。
