# Map Data Generator

独立的地图资料制作子项目（含基础图生成与合并/拆分编辑器）。不属于游戏构建链：`dev` / `build:web` / `tauri:build` 不会调用这里。

## 五层数据模型

| 层 | 名称 | 目录 | 谁写 | 谁读 | 进 git |
|---|---|---|---|---|---|
| **L0** | Raw | `cache/` | 下载脚本 | 仅 generator | 否 |
| **L1** | 基础地图 | `base/<baseMapId>/` | `generate:base` + socioeconomic | 编辑器导入；导出派生 | 生成物默认 **gitignore**；若入库须走 LFS（见根 `.gitattributes`） |
| **L2** | 编辑工程 | `projects/<projectId>/` | 地图编辑器 | 编辑器再打开；导出 | 是（轻量分组） |
| **L3** | Authored | `../assets/maps/<mapId>/`（不含 compiled） | 编辑器导出；人工/模组 | validate / publish | 是 |
| **L4** | Runtime | `../assets/maps/<mapId>/compiled/` | `map:publish` | 客户端 / Worker | 否 |

旧文档里的「L1 Authored / L2 Runtime」分别对应本表的 **L3 / L4**。

```text
L0 Raw → generate:base → L1 base
L1 → 编辑器导入 → 保存 L2 projects/
L2 → 导出 → L3 assets/maps/<mapId>/ → 自动 publish → L4 compiled/
```

`habitability` / `cultivation_condition` / `arable_land_km2` 在 L1 中写 **0** 表示尚未制作，不是真实宜居度为零。

## 命令

```powershell
cd mapdata-generator
pnpm install

# L0 → L1：零合并基础图（默认 base/world-admin1）
# --base 未传 --retain 时默认保留率至少 0.8（高于合并管线的 0.5）
pnpm generate:base
pnpm generate:base -- --retain 0.8
pnpm generate:base -- --retain 1

# 对 L1 多边形跑社会经济（人口 / GDP），写入 demographics.json 与 province.csv 的 gdp_ppp
pnpm generate:base:socioeconomic

# 旧管线：合并版候选（仍写 output/world-modern，不进 L1）
# world-modern-output 金标测试依赖该输出；缺报告会直接 fail
pnpm generate:world-modern

# 地图编辑器（导入 L1 / 编辑 / 存 L2 / 导出 L3+L4）
pnpm editor
```

导出 **禁止覆盖** 已有 `assets/maps/<mapId>/`；撞名时自动加 `-2`、`-3`… 后缀，并更新 `map.json` 的 `id`。

## L1 布局（`base/world-admin1/`）

与 schema v3 子集对齐，另含 `demographics.json`（栅格聚合结果）。**不**创建 `classes/`；新建 L2 工程时再拆成可编辑的 class CSV。

本地用 `pnpm generate:base`（及可选 `generate:base:socioeconomic`）生成。`base/**` 默认不进 git，只保留 `base/.gitkeep`；需要入库时先确认根 `.gitattributes` 已对 `mapdata-generator/base/**/*.geojson` 与 `boundaries.json` 启用 LFS，再单独提交数据。

## L2 布局（`projects/<projectId>/`）

```text
project.json                      # baseMapId、建议导出 mapId、显示名…
groups.json                       # 完整分区：id / countryId / members[] / name…
provinces/<sourceProvinceId>/
  classes/<socialClassId>.csv     # 可编辑人口（按 L1 原子省）；新建工程时从 L1 demographics 拆出
```

`members` 必须是所引用 L1 源省 ID 的完全划分（无交叉、无遗漏）。工程不存 dissolve 后的全球几何。人口以 L2 class CSV 为准（方便直接改）；合并/拆分只改 `groups.json`，导出时按 members 汇总 class。

导出 L3 时：按组成员汇总 L2 `classes/*.csv`，写出游戏省的 class CSV；`gdp_ppp` 从 L1 `demographics.json` 求和写入；**不**写 `demographics.json`。

## 遗留合并管线

`pnpm generate:world-modern` 仍使用 `config/world-modern-merges.json` 与 `world-modern-manual-groups.json`，输出到 `output/world-modern/`。新制作请走 L1 → 编辑器 → L2 → 导出 L3。
