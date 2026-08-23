# 制作完成的地图数据

`assets/maps/` 是游戏地图的唯一可维护真相来源。每张地图是一个可以整体添加、移动或分享的自包含目录，保存经过人工整理、拥有稳定 ID 的 GeoJSON、显式关系数据和就地生成的发布文件。

```text
assets/maps/<mapId>/
├── map.json
├── provinces.geojson
├── boundaries.json
├── coastlines.geojson
└── compiled/              # map:publish 自动生成，默认不提交
```

- `provinces.geojson` 和 `coastlines.geojson` 是制作完成、可编辑的地图图层；地图包不包含独立城市图层。
- 每个 Province 的 `properties.capital` 必填，包含省份首府坐标和可选名称；没有真实首府资料时由生成器选择省内视觉中心点。
- `boundaries.json` 保存共享省份边及其两侧省份 ID，支持按模拟中的当前归属绘制国界。
- 运行时优化文件只生成到当前地图的 `compiled/`，该目录默认不提交。
- 新增地图只需加入一个符合上述结构且目录名与 `map.json.id` 相同的目录；校验、编译和客户端打包会自动发现它。
- 图层路径必须留在当前地图目录内；绝对路径、`..` 穿越和符号链接逃逸会被拒绝。
- 编译后的最后一级 LOD 始终保留原始几何；其余 LOD 使用带面积、环方向和自相交保护的自适应简化。
- 当前海岸线发布文件保留原始坐标，避免高倍缩放时偏离省份海岸。
- 相同输入生成字节一致的 `compiled/`，清单中不写动态构建时间。
- `map.json` 必须符合制作格式 Schema v2；Province、Boundary、Coastline 全部要求稳定且唯一的 ID。
- 编译清单使用 Schema v3 / `economic-simulator.map-runtime/v2`，并生成 `[0.25, 0.08, 0]` 三档省份 LOD。
- 游戏构建不会下载 Natural Earth，也不会从外部地理资料制作地图。
- 上游资料下载、缓存和地图草稿制作位于独立的 `mapdata-generator/` 子项目。
- 发行构建会把 `compiled/` 作为只读资源打包；运行时不会向项目或安装目录写文件。
- 未来的玩家地图应整体放在用户数据目录；如果需要运行时编译，其 `compiled/` 也位于同一玩家地图目录。

验证并生成客户端地图：

```powershell
pnpm map:validate
pnpm map:publish
```
