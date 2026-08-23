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
