# 制作完成的地图数据（L3 Authored）

`assets/maps/` 是游戏可加载地图的正式制作层（**L3**）。每张地图是一个自包含目录：几何只读，玩法数据以 CSV 分目录保存；`compiled/`（**L4**）由 `map:publish` 生成。

制作链完整层级见 [`mapdata-generator/README.md`](../../mapdata-generator/README.md)（L0 Raw → L1 基础图 → L2 编辑工程 → **L3** → **L4**）。

```text
assets/maps/<mapId>/
├── map.json                 # schemaVersion 3
├── geometry/                # 省界 / 共享边 / 海岸线（不 CSV 化）
│   ├── provinces.geojson
│   ├── boundaries.json
│   └── coastlines.geojson
├── countries.csv
├── companies/<companyId>/   # 可选；含 company.csv + shareholders.csv
├── provinces/<provinceId>/
│   ├── province.csv
│   ├── classes/<socialClassId>.csv
│   └── operating-units.csv
└── compiled/                # L4：map:publish 生成，默认不提交
```

| 命令 | 工具 | 作用 |
|---|---|---|
| `mapdata-generator` 内 `pnpm generate:base` / 编辑器导出 | L0→L1、L2→L3 | 基础图与导出正式包（不进游戏构建） |
| `pnpm map:validate` / `pnpm map:publish` | L3→L4 `tools/map-pipeline` | 校验并编译 LOD / scenario-seed |

- 首府坐标在 `geometry/provinces.geojson`；名称可在 `province.csv` 覆盖。
- `boundaries.json` 保存共享省边；国界由两侧归属在运行时推导。
- 编译产物含 `scenario-seed.json` 与 `province-definitions.json`；`world-modern` 发布时同步写出 `packages/game-data/data/provinces.json`。
- 游戏构建不下载 Natural Earth；玩家自定义地图只跑 publish。
- 编辑器导出不会覆盖已有 mapId；撞名自动加后缀。

```powershell
pnpm map:validate
pnpm map:publish
# 仅编译一张图：
pnpm --filter @economic-simulator/map-pipeline publish-maps -- --map world-modern
```
