# Map Data Generator

独立的地图资料制作子项目。它负责下载和缓存 Natural Earth 原始资料，并生成供人工整理的 GeoJSON 草稿。

它不属于游戏的构建链：主项目的 `dev`、`build:web` 和 `tauri:build` 都不会调用这里的脚本。

```powershell
cd mapdata-generator
pnpm install
pnpm generate:world-modern
```

- 原始下载缓存：`cache/natural-earth/`
- 生成草稿：`output/world-modern/`
- 游戏采用的制作完成地图：`../assets/maps/<mapId>/`

将草稿导入主项目前必须经过人工检查、稳定 ID 审核和地图包校验；不要直接把生成器输出覆盖到游戏资产目录。
