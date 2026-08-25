# Map Data Generator

独立的地图资料制作子项目。它负责固定版本 Natural Earth 资料的下载与规范化、统一规则区划归并、拓扑简化、首府选择和审查报告生成。

它不属于游戏的构建链：主项目的 `dev`、`build:web` 和 `tauri:build` 都不会调用这里的脚本。

```powershell
cd mapdata-generator
pnpm install
pnpm generate:world-modern
```

边界简化默认保留 50% 的加权弧点，可通过命令行调整：

```powershell
# 小数和百分数写法等价；允许范围为 (0, 1] 或 (0%, 100%]
pnpm generate:world-modern -- --retain 0.5
pnpm generate:world-modern -- --retain 50%
```

该比例是基础目标。面积误差超过 5%、环方向改变或几何退化的省份会自动保留更多点；`review-report.json` 中的 `requestedRetainedFraction` 和 `retainedFraction` 分别记录请求值与最终采用值。

- 原始下载缓存：`cache/natural-earth/`
- 可审计的全局归并参数：`config/world-modern-merges.json`
- 手工覆盖（拆分/重划不合理合并省）：`config/world-modern-manual-groups.json`，允许突破最低面积限制
- 生成的最终候选与审查报告：`output/world-modern/`
- 游戏采用的制作完成地图：`../assets/maps/<mapId>/`

生成流程依次执行：下载与规范化 → 官方宏观区连通分组 → 同国完全包围合并 → 动态最低面积合并 → 700 km 群岛合并 → 手工覆盖强制拆分/重组（`world-modern-manual-groups.json`）→ TopoJSON dissolve 与简化 → 输出报告。面积严格超过 5,000,000 km² 的国家跳过官方宏观区，直接从一级政区开始执行后续规则。除 Baikonur 租借地还原给哈萨克斯坦这一源数据归属修正外，所有国家使用同一套参数，不存在按国家 ID 编写的特殊分组。最低省面积从 10,000 km² 随国家面积线性增长，在国家面积达到 500,000 km² 时封顶为 50,000 km²。普通合并必须共享线段边界，仅群岛可以在多边形边缘距离不超过 700 km 时形成 MultiPolygon。手工覆盖在自动合并完成后应用，允许将狭长/跨文化屏障的大省拆为多个可低于阈值的合理省，示例见埃及（23省合并体拆为 Sinai/Canal/Delta/Cairo/Upper 五省）。

生成器保持独立，不加入根 workspace，也不参与游戏构建。`review-report.json` 会逐国记录国家面积、动态阈值、合并前后数量和无法合法继续合并的低面积例外。

最终省份来自具有完整官方宏区数据的国家时，使用“–”连接并去重宏区名；没有宏区数据时，本地名和英文名分别按稳定的源数据顺序连接一级政区名。未合并省份保持原名。

输出目录仅包含可发布图层 `map.json`、`provinces.geojson`、`boundaries.json`、`coastlines.geojson` 和 `countries.json`（`adm0A3 → nameEn` 国名表），以及不会进入发行包的 `review-report.json`。地图没有独立城市图层；每个省份都内嵌一个首府。将候选导入主项目前必须审查报告并执行根项目的 `pnpm map:validate` 与 `pnpm map:publish`。

仅需补写或刷新国名表、不必重跑归并/简化时：

```powershell
pnpm generate:countries
```

该模式只读取 Natural Earth admin_1 源数据中的 `adm0_a3` / `admin`，写出 `countries.json` 并更新 `map.json` 的 `layers.countries`。写 manifest 前会确认 `provinces.geojson`、`boundaries.json`、`coastlines.geojson` 已在 `output/world-modern/` 中；若缺失则从 `../assets/maps/world-modern/` 复制，仍缺失则报错退出（避免生成残缺地图包）。若 output 或 assets 中存在 `provinces.geojson`，会按其中的 `adm0A3` 过滤国家集合。
