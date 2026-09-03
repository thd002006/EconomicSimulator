# 大地图道路绘制系统实施规格

> 文档状态：可实施基线（Implementation Baseline）  
> 适用版本：道路地图绘制 V1  
> 相关文档：`economic_simulation_web_architecture.md`、`province_architecture.md`、`economic_unit_architecture.md`、`operating_unit_architecture.md`  
> 核心取舍：道路在地图上以「相邻省份首府之间的可扩展类型段」为权威拓扑；绘制可串联与偏移，经济内核仍按段处理且本阶段不实现

---

## 1. 已定决策

V1 采用以下设计：

1. 任意在成品地图 `boundaries` 中存在共享边界的两个省份之间，可以存在零条或多条不同类型的道路段；省份相邻不等于默认可通行。
2. 道路类型由可扩展注册表定义（普通公路、高速公路、铁路等）；新增类型只需注册样式与偏移参数，不改拓扑 schema。
3. 若两省之间存在某类型道路，地图上优先以地铁线路图式绘制首府直线；若直线穿出 `A∪B`，则在并集域上求可视性最短折线（贴岸绕行，不强制最近共享边附着）。
4. 同类型、共享端点省份的道路段在**绘制层**可串联为更长的连续折线；经济内核与存档仍以分段为权威，串联不合并段身份。
5. 绘制样式对齐现有大地图暖色纸质风（暗褐描边、半透明宽线、与省界/国界/海岸线分层），客户端与地图编辑器共用同一视觉语言。
6. 同一省对上的不同类型道路不得互相完全覆盖；按类型注册表的固定偏移序号沿主路径法线做确定性平行偏移。
7. 地图编辑器提供添加、删除、改类型道路的能力；不修改省份多边形或邻接拓扑。
8. 默认道路数据以 Natural Earth 道路连接强度筛选邻接省对；无足够证据不建路。
9. 道路几何与类型属于地图包 Definition，不写入模拟快照；V1 不创建 `TransportEdge`、不创建道路 Operating Unit、不做运力/寻路/收费。

V1 明确不做：

- 运输经济模拟、运力、维护、收费、寻路与贸易路线；
- 将真实连续公路线（OSM / Natural Earth 折线）直接作为游戏可通行拓扑；
- 省内城市节点、路口 Junction、边境口岸节点的独立绘制；
- 跨不相邻省份的“飞线”道路；
- 因绘制串联而合并或删除 `RoadSegment` 权威记录；
- 运行时动态改建道路几何（建设/拆除的经济命令留待后续规格）；
- 海运航线、运河、管道等非陆路类型的完整规范（注册表可预留，V1 不实现绘制）。

---

## 2. 系统定位与数据分层

```text
Authored Map Package                    Runtime Map View
geometry/roads.json                     RoadCollection + 直线采样
RoadType 注册表（静态）                  偏移 / 串联 / LOD 绘制
           │                                      │
           └────────── 仅展示 ────────────────────┘
                              │
                    （未来）Transport Graph
                    TransportNode / TransportEdge
                    Operating Unit (road / railway)
```

| 数据层 | 道路系统示例 | 是否进入存档 |
| ------ | ------------ | ------------ |
| Definition | `RoadSegment`、道路类型注册表、弯曲覆盖参数 | 记录地图包版本，不逐项复制进模拟快照 |
| State | V1 无 | — |
| Metrics | V1 无 | — |
| View Model | 串联后的绘制路径、偏移后的折线采样 | 否 |

职责划分：

| 模块 | 负责 | 不负责 |
| ---- | ---- | ------ |
| 地图包 / map-pipeline | 校验并发布 `roads.json` | 经济容量、经营状态 |
| 客户端 `MapRenderer` | 直线、串联、偏移、LOD 绘制 | 编辑持久化 |
| 地图编辑器 | 增删改道路段并导出到 L3 | 模拟 Tick |
| Transport / Operating Unit | V1 不介入 | — |

与省份系统的关系（见 `province_architecture.md` §10.3）：运输图将来使用独立 `TransportNode` / `TransportEdge`；省份相邻不等于存在可通行路线。本规格的 `RoadSegment` 是地图制作层的「意图连通」，是未来运输图的候选输入，但 V1 不同步写入模拟状态。

---

## 3. 道路类型注册表

类型是静态配置，可随版本追加；已发布存档若引用未知 `typeId`，加载地图包时拒绝。

```ts
type RoadTypeId = string;

interface RoadTypeDefinition {
  readonly id: RoadTypeId;
  readonly nameKey: string;
  /** 绘制排序：数值越小越先画（被后画的压在上方时可按需反转） */
  readonly drawOrder: number;
  /**
   * 同一省对上多类型并行时的车道序号。
   * 0 表示贴主路径；正负表示法线两侧。注册表内必须两两不同。
   */
  readonly laneIndex: number;
  /** 相对 lane 间距的乘数，默认 1 */
  readonly laneSpacingScale: number;
  readonly strokeColor: number;
  readonly strokeOpacity: number;
  readonly lineWidth: number;
  /** 可选第二描边（铁路双线感） */
  readonly casingColor?: number;
  readonly casingWidth?: number;
  readonly dashSize?: number;
  readonly gapSize?: number;
  /** 大于该 halfHeight 时隐藏（与省界 LOD 同坐标系） */
  readonly maxVisibleHalfHeight: number;
}
```

### 3.1 V1 预置类型

样式数值对齐现有地图常量：海岸 `0x3a2a1a`、省界 `0x5a4030`、国界 `0x2a1c12`、纸色背景 `0xc8b898`。道路应比省界更易辨认，但不得压过国界的视觉权重。

| typeId | 含义 | laneIndex | lineWidth | stroke | maxVisibleHalfHeight | 备注 |
| ------ | ---- | --------- | --------- | ------ | -------------------- | ---- |
| `local_road` | 普通公路 | -1 | 1.6 | `0x6b5340` @ 0.55 | 32 | 与省界同级缩放才显示 |
| `highway` | 高速公路 | 0 | 2.2 | `0x4a3428` @ 0.72 | 90 | 中距可见 |
| `railway` | 铁路 | 1 | 1.8 | `0x2a1c12` @ 0.85 | 90 | 建议 casing + 短虚线节奏 |

追加类型时必须分配未占用的 `laneIndex`，并更新本表。禁止两个类型共用同一 `laneIndex`。

---

## 4. `RoadSegment` 与地图包 Schema

### 4.1 权威记录

```ts
type ProvinceId = string;
type RoadSegmentId = string;
type LonLat = readonly [number, number];

interface RoadSegment {
  readonly id: RoadSegmentId;
  readonly typeId: RoadTypeId;
  /** 端点省份；写入时规范化为字典序 a < b，运行时仍保留该顺序 */
  readonly provinceIdA: ProvinceId;
  readonly provinceIdB: ProvinceId;
  /** 可选显示名 */
  readonly name?: string;
  readonly nameEn?: string;
  /**
   * 可选弯曲覆盖。缺省时由渲染器按 §5 自动生成控制点。
   * 坐标为 EPSG:4326；不得要求与真实公路重合。
   */
  readonly bend?: RoadBendOverride;
}

interface RoadBendOverride {
  /** 二次 Bezier 单控制点，或三次的两个控制点 */
  readonly controlPoints: readonly LonLat[];
}
```

规范化键：

```text
segmentKey(typeId, a, b) = `${typeId}|${min(a,b)}|${max(a,b)}`
```

同一 `segmentKey` 至多一条段。

### 4.2 集合与清单

成品地图目录扩展：

```text
assets/maps/<mapId>/
├── map.json
├── geometry/
│   ├── provinces.geojson
│   ├── boundaries.json
│   ├── coastlines.geojson
│   └── roads.json          ← 新增
└── ...
```

`roads.json`：

```ts
interface RoadCollection {
  readonly schemaVersion: 1;
  readonly segments: readonly RoadSegment[];
}
```

`map.json` 的 `layers` 增加：

```json
"roads": "geometry/roads.json"
```

缺省图层：若清单无 `roads`，运行时视为空集合（兼容旧地图包）。

### 4.3 编译与运行时

`tools/map-pipeline` 编译时：

1. 解析并校验 `RoadCollection`；
2. 确认每个端点省份存在且含首府坐标；
3. 确认存在 `left/right` 对应该省对的 `MapBoundary`（`rightProvinceId !== null`）；
4. 确认 `typeId` 均在注册表中；
5. 将道路集合写入 compiled 运行时包，供 `loadMapPack` / `MapViewModel` 挂载。

运行时类型落在 `@economic-simulator/map-runtime`（与 `MapBoundary` 并列），不进入 `simulation-core` 的 World State。

### 4.4 邻接判定

唯一邻接真相为成品 `boundaries.json` 中的共享省界：

```ts
interface MapBoundary {
  readonly id: string;
  readonly leftProvinceId: string;
  readonly rightProvinceId: string | null;
  readonly coordinates: LonLat[];
}
```

仅当存在某 boundary 满足无序对 `{left, right} == {provinceIdA, provinceIdB}` 时，该省对合法。海岸弧（`rightProvinceId === null`）不能作为道路端点对。

---

## 5. 直线路径与同类型串联

### 5.1 单段默认路径（直线优先 + A∪B 并集域最短路）

对段 `S`，取两端首府地图坐标 `P_a`、`P_b`（经 `lonLatToMapXY`，处理 360° wrap 时选择短经度差）。

**默认路径：**

1. 若直线 `P_a → P_b` 密采样均落在 `A∪B` 内 → 两点直线（地铁图式）。
2. 否则在 **A∪B 并集域**上求可视性最短折线：
   - 节点 = `{P_a, P_b}` ∪ 两端省外环稀疏顶点（各 ≤48）∪ 可选共享边界稀疏采样（加强连通，**不**强制最近附着点）；
   - 边 = 密采样点均在 `A∪B`（边界算内）；
   - Dijkstra 欧氏最短路，再 Douglas-Peucker（内点上限约 8）。
3. 无省份几何或图中无通路 → 退回直线（best-effort）。

不做弧线/微弧骨架；不再用「最近共享边强制附着 + 分段省内路径」——那种选点易被拽到海湾外侧并产生怪折点。

若作者提供 `bend.controlPoints`（编辑器手工弯折）：

- 1 个点 → 二次 Bezier 覆盖；
- 2 个点 → 三次 Bezier 覆盖；
- 其他长度 → 校验失败。

道路几何在地图加载时算一次；可视性为 O(n²)，可接受。

### 5.2 同类型串联（仅绘制）

目标：同 `typeId` 的段若在首府节点相连，视觉上成为一条连续折线，避免在首府处断开。

算法：

1. 建图：节点 = `ProvinceId`，边 = 该 `typeId` 的所有 `RoadSegment`。
2. 将连通分量拆成路径与环：度为 1 的节点作路径端点；纯环任选起点打断成路径。
3. 对路径上连续段按端点衔接排列采样点；在共享首府处**去重一个顶点**。
4. 每个权威 `RoadSegment` 仍保留独立 id；串联结果是纯 View 缓存。

经济内核说明（前瞻）：串联不改变段数；未来每段仍可对应独立经营单元或 `TransportEdge`。

```text
绘制：A—B—C—D 一条连续 highway 折线
权威：AB、BC、CD 三条 RoadSegment
```

### 5.3 日期变更线与 wrap

与现有边界线一致：跨 ±180° 的段在采样后按 `clipSegmentToWorld` / tile 复制策略绘制，不得出现横穿整张地图的错误长线。

---

## 6. 多类型偏移与绘制样式

### 6.1 偏移规则

对每个省对 `{a,b}`，收集该省对上所有类型的段。计算**主路径** `M`：优先取 `laneIndex === 0` 的类型直线；若无，则取 `drawOrder` 最小者的未偏移路径。

对类型 `T`：

```text
offsetDistance = laneIndex(T) * baseLaneSpacing * laneSpacingScale(T)
baseLaneSpacing = max(2.5px, 0.035 * currentLinePixelScale)   // 随缩放略变，保持可分可读
```

偏移采用**电路板走线**（非整段鼓包）：

- `laneIndex === 0`：沿主路径折线（直线或边界走廊）。
- 否则：端点钉首府；端点附近各加一段短折线引出；中段对整条主路径做恒定法线平行偏移（多折点走廊保留拐点）。
- `jog = min(固定地图单位, 0.12 * 路径长)`，并保证两端 jog 之和小于路径长。

法线取邻段平均，避免同省对多类型法线翻转。

确定性要求：相同输入地图包 + 相同视角缩放，偏移结果字节级一致（禁止依赖哈希随机扰动）。

### 6.2 图层顺序

建议 Z / renderOrder：

```text
陆地填充 < 海岸线 < 省界 < 道路（按 drawOrder） < 国界 < 首府点 < 标签
```

国界保持最高线权，道路在国界之下，避免“路压国境”的错觉。首府环标仍在道路之上，保证枢纽可读。

### 6.3 LOD

复用 `halfHeight` 语义（省界详情阈值当前为 32）：

- `local_road`：仅 `halfHeight <= 32` 显示（与省界/首府同级）；
- `highway` / `railway`：`halfHeight <= 90` 显示；
- 超出类型阈值的段不参与串联缓存构建（或构建后隐藏），以免远景噪点。

### 6.4 实现提示

客户端继续使用 Three.js `LineSegments2` + `LineMaterial`（与 `map-renderer.ts` 一致）。铁路可用 casing 宽线底层 + 虚线顶层两次绘制表达。编辑器 `EditorMapRenderer` 使用同一颜色与宽度常量表，避免两套皮肤。

---

## 7. 客户端与编辑器职责

### 7.1 客户端

[`apps/client/src/components/map-renderer.ts`](../../apps/client/src/components/map-renderer.ts)（或并列的道路图层模块）在地图加载后：

1. 读取 `RoadCollection`；
2. 按类型分组 → 串联 → 采样 → 按省对偏移；
3. 生成宽线几何并纳入 tile wrap；
4. 在缩放回调中按 LOD 切换可见性。

交互 V1：道路不可点选为经济实体；可选实现 hover 高亮段（非必须）。省份选择逻辑保持不变。

### 7.2 地图编辑器

落点：[`mapdata-generator/editor/`](../../mapdata-generator/editor/)，与现有 merge/split 模式并列。

**添加道路模式：**

1. 选择 `typeId`；
2. 依次点选两个省份（或两个首府标记）；
3. 校验邻接与 `segmentKey` 唯一；
4. 写入当前编辑项目的道路草稿（建议 `projects/<id>/roads.json`，导出时写入 L3）。

**其他操作：** 删除段、更改类型、按类型过滤显示、列表搜索省对。V1 可不做控制点拖拽；若未提供 `bend`，预览使用 §5 默认路径（直线或边界走廊）。

**导出：** 扩展现有 `export-map` 管线，将道路集合写入 `assets/maps/<mapId>/geometry/roads.json` 并更新 `map.json` layers；随后可走 `map:publish`。

编辑器不得：

- 因道路编辑修改 `groups.json` 合并关系或省份几何；
- 允许不相邻省对建路；
- 静默覆盖已存在的同键段（必须提示替换或拒绝）。

---

## 8. 默认数据生成与源数据评估

### 8.1 现状结论

| 来源 | 仓库现状 | 结论 |
| ---- | -------- | ---- |
| `geometry/boundaries.json` + 省份首府 | 已有 | 提供候选邻接省对与绘制骨架 |
| Natural Earth `ne_10m_roads` | 生成时下载到 `cache/natural-earth/` | **强度真相**：决定哪些邻接对建路 |
| Natural Earth `ne_10m_railroads` | 未接入 | 后续可对 `railway` 做同类打分 |
| OSM 公路网 | 未使用 | 本阶段不纳入 |

因此：默认道路数据由 **NE 道路连接强度** 筛选邻接省对生成；游戏拓扑仍是省对段，不直接矢量化 NE 折线。

### 8.2 推荐种子算法（强度筛选）

输入：成品 `boundaries` / `provinces`，以及缓存的 `ne_10m_roads.geojson`。

步骤：

1. 枚举合法邻接省对（含跨境），过滤过短共享边界；
2. 沿 NE 道路折线按步长采样，用省份空间索引判定所属省；
3. 相邻采样点落在不同且相邻的省 `A/B` 时，累加 `length × typeWeight × scalerankFactor`（排除 Ferry）；
4. 分数 ≥ `highwayThreshold` → `highway`；≥ `localThreshold` → `local_road`；无证据不建路；
5. 输出 `RoadCollection` 并更新 `map.json.layers.roads`。

脚本：`mapdata-generator/src/generate-default-roads.ts`（`pnpm generate:roads`）。

### 8.3 禁止事项

禁止：把 NE 折线坐标直接写入 `RoadSegment` 作为游戏路径（与首府枢纽模型冲突，且无法稳定映射到省对经营单元）。

### 8.4 生成验收

- 路网明显稀疏于全邻接；跨境仅在有 NE 证据处出现；
- 无重复 `segmentKey`、无未知类型；
- 客户端加载与编辑器预览无校验错误。

---

## 9. 与 Transport / Operating Unit 的未来边界

本节不实现，只锁定接口方向，避免绘制方案绑死经济模型。

### 9.1 概念对照

| 地图绘制 V1 | 未来经济内核（既有架构） |
| ----------- | ------------------------ |
| `RoadSegment` | 候选生成一条或多条 `TransportEdge` |
| 省份首府 | 通常对应 `ProvinceHub` 类 `TransportNode`（见 `economic_simulation_web_architecture.md` §11.2） |
| 绘制串联 | 无对应；路径查询走运输图 |
| `RoadTypeId` | 映射到 `TransportEdgeDefinition.kind`（Road / Railway / …） |
| 无 | `InfrastructureOperatorState` / 道路 Operating Unit 绑定 edge |

既有约束（必须遵守，绘制不得违背）：

- 每个 Operating Unit 只属于一个 Province；跨省道路/铁路在省界处分段为多个 Unit，由 Transport Graph 连接（`economic_unit_architecture.md` §11、`operating_unit_architecture.md`）。
- 因此未来可能出现：地图仍画首府到首府一条直线，但权威经济边为 `Hub_A → BorderNode → Hub_B` 两段或多段；**绘制几何可以继续用直线，经济边另存。**
- Province 转属不改写道路几何（`province_architecture.md` §10.3）；贸易限制由节点所在省归属派生。

### 9.2 映射原则（前瞻）

```text
RoadSegment (map)
  → ensure TransportNode at capital of A and B
  → optionally insert Border nodes on shared boundary
  → create TransportEdge(s) with kind from RoadTypeId
  → create Operating Unit(s) per province-owned edge slice
```

V1 禁止在未完成运输规格前暗含上述对象的半成品状态。

---

## 10. 不变量、错误与校验

加载或导出时必须强制：

1. `provinceIdA < provinceIdB`（字典序）；若输入颠倒，规范化或拒绝（实现二选一，全管线一致）。
2. `provinceIdA != provinceIdB`。
3. 两端省份存在且 `capital.coordinates` 有效。
4. 存在对应共享 `MapBoundary`。
5. `typeId` ∈ 注册表。
6. `segmentKey` 唯一。
7. `bend.controlPoints` 长度为 0（视为缺省）、1 或 2。
8. `schemaVersion` 受支持。

建议错误码（地图管线 / 编辑器 API）：

| 码 | 含义 |
| -- | ---- |
| `ROAD_PROVINCE_NOT_FOUND` | 端点省份不存在 |
| `ROAD_CAPITAL_MISSING` | 首府坐标缺失 |
| `ROAD_NOT_ADJACENT` | 无共享边界 |
| `ROAD_TYPE_UNKNOWN` | 未知类型 |
| `ROAD_DUPLICATE_SEGMENT` | 同类型同省对重复 |
| `ROAD_BEND_INVALID` | 控制点非法 |
| `ROAD_ID_DUPLICATE` | id 冲突 |

调试模式可额外断言：串联缓存覆盖的段集合等于权威段集合（无丢段、无幻段）。

---

## 11. 验收标准

功能：

- 给定含多类型道路的地图包，客户端在合适缩放级画出首府间道路（直线或共享边界走廊），多类型平行可辨。
- 同类型多段在共享首府处视觉连续。
- 同省对上 `local_road` + `highway` + `railway` 三者可同时存在且彼此偏移可辨。
- 远景隐藏 `local_road`，中近景显示高速/铁路；风格与纸质地图一致。
- 编辑器可添加/删除/改类型道路，导出后客户端可见。
- NE 强度种子脚本能对 `world-modern` 产出可校验的默认 `roads.json`。

非功能：

- 道路图层不得显著拖垮现有地图帧率；应批合成按类型的线几何，避免一段一个 draw call。
- 校验失败必须拒绝发布，不得静默丢段。

---

## 12. 建议实现阶段（排期指引）

本文件只定规格；实现顺序建议：

1. **Schema 与 pipeline**：`RoadCollection` 类型、`map.json` layer、编译校验、空集合兼容。
2. **客户端绘制**：单段直线 → 多类型偏移 → 同类型串联 → LOD。
3. **编辑器**：添加/删除/改类型与预览；导出接入。
4. **默认种子脚本**：NE 道路强度筛选邻接省对 → `highway` / `local_road`；生成报告；compile 入库。
5. **（可选）NE 增强**：下载 roads/railroads，走廊匹配提升类型。
6. **（后续规格）** Transport Graph 与 Operating Unit 对接。

---

## 13. 修订记录

| 版本 | 说明 |
| ---- | ---- |
| 2026-09-03 | 初版：地图绘制 V1 基线，经济模拟明确排除 |
