# 开发环境

## 必需工具

- Node.js 24 或更高版本
- pnpm 11.19.0
- Git

运行 Web、Worker、CLI 和测试：

```powershell
pnpm install
pnpm check
pnpm dev
```

## Tauri 桌面开发

额外需要：

- Rust stable 和 Cargo
- Windows 上的 Microsoft C++ Build Tools 与 WebView2

```powershell
pnpm tauri:dev
```

当前 Tauri Capability 只有 `core:default`，没有文件系统或 Shell 权限。未来加入存档功能时，应通过窄 Tauri Command 或受限插件能力扩展，不能直接给予前端任意路径权限。

## 验证各入口

```powershell
# Node CLI 直接运行 Simulation Core
pnpm sim -- --ticks 100 --seed 42

# 校验 GeoJSON 输入
pnpm map:inspect -- data-src/maps/architecture-probe/provinces.geojson
pnpm map:inspect -- data-src/maps/world-modern/provinces.geojson

# 从 Natural Earth 重新生成默认世界地图（需网络；原始缓存在 data-src/maps/_vendor/）
pnpm map:build-world-modern

# 浏览器 + Web Worker
pnpm dev
```
