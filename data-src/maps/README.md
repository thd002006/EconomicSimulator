# 地图源数据

每份地图都是一个独立地图包，目录名使用稳定的 `mapId`：

```text
maps/
├── index.json
├── world-modern/
│   ├── map.json
│   ├── provinces.geojson
│   ├── coastlines.geojson
│   ├── cities.geojson
│   ├── ports.geojson
│   ├── roads.geojson
│   ├── railways.geojson
│   └── sea-lanes.geojson
└── world-historical/
    └── ...
```

规则：

- `index.json` 登记所有可用地图包。
- 每个地图包必须有 `map.json`。
- 地图包目录名、`map.json.id` 和总索引中的 `id` 必须一致。
- GeoJSON Feature 必须拥有在该地图包内唯一且长期稳定的 `id`。
- 地图几何中不保存人口、GDP、价格等运行时经济状态。
- 构建生成的数据写入 `public/generated/maps/<mapId>/`，不得手工修改。

## `world-modern`

默认现代世界地图，几何来自 [Natural Earth](https://www.naturalearthdata.com/)（public domain），比例尺 **1:10m**：

- `provinces`：Admin 1 一级行政区（`ne_10m_admin_1_states_provinces_lakes`）
- `coastlines`：海岸线（`ne_10m_coastline`）
- `cities`：人口聚居点（`ne_10m_populated_places`，`SCALERANK <= 6`）

当前仅包含上述核心三层；`ports` / `roads` / `railways` / `sea-lanes` 尚未纳入。

从 Natural Earth 重新生成：

```bash
pnpm map:build-world-modern
```

原始下载缓存位于 `data-src/maps/_vendor/`（已 gitignore），不要提交。
