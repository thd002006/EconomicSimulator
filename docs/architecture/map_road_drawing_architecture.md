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
3. 每个存在道路的相邻省份无序对只预制一条首府间基础路线：若直线穿出 `A∪B`，则在真实并集域上求平面可视性最短折线；基础路线在 `map:publish` 生成，客户端不得重新寻路。
4. 同类型、共享端点省份的道路段在**绘制层**可串联为更长的连续折线；经济内核与存档仍以分段为权威，串联不合并段身份。
5. 绘制样式对齐百度地图式道路符号（填充色 + 描边 casing；铁路为深色连续 casing + 白色虚线填充形成深浅相间），客户端与地图编辑器共用同一视觉语言，并与省界/国界/海岸线分层。
6. 单一类型道路直接使用基础路线；同一省对有多个类型时，客户端按类型注册表的固定偏移序号沿基础路线法线做确定性平行偏移。偏移是纯视觉效果，允许小幅越出 `A∪B`。
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
geometry/roads.json                     RoadCollection（L3 拓扑）
compiled/roads.json                     RuntimeRoadCollection + pairRoutes
RoadType 注册表（静态）                  运行时偏移 / 串联 / LOD 绘制
           │                                      │
           └────────── 仅展示 ────────────────────┘
                              │
                    （未来）Transport Graph
                    TransportNode / TransportEdge
                    Operating Unit (road / railway)
```

| 数据层     | 道路系统示例                                | 是否进入存档                         |
| ---------- | ------------------------------------------- | ------------------------------------ |
| Definition | `RoadSegment`、道路类型注册表、弯曲覆盖参数 | 记录地图包版本，不逐项复制进模拟快照 |
| State      | V1 无                                       | —                                    |
| Metrics    | V1 无                                       | —                                    |
| View Model | 串联后的绘制路径、偏移后的折线采样          | 否                                   |

职责划分：

| 模块                       | 负责                                   | 不负责                       |
| -------------------------- | -------------------------------------- | ---------------------------- |
| 地图包 / map-pipeline      | 校验并发布 `roads.json`                | 经济容量、经营状态           |
| 客户端 `MapRenderer`       | 读取预制路线、串联、轻量偏移、LOD 绘制 | 多边形并集与寻路、编辑持久化 |
| 地图编辑器                 | 增删改道路段并导出到 L3                | 模拟 Tick                    |
| Transport / Operating Unit | V1 不介入                              | —                            |

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
  /** 可选底层描边（普通路/高速轮廓；铁路深色连续底） */
  readonly casingColor?: number;
  readonly casingWidth?: number;
  readonly dashSize?: number;
  readonly gapSize?: number;
  /** 大于该 halfHeight 时隐藏（与省界 LOD 同坐标系） */
  readonly maxVisibleHalfHeight: number;
}
```

### 3.1 V1 预置类型

底图仍为暖纸色 `0xc8b898`（海岸 `0x3a2a1a`、省界 `0x5a4030`、国界 `0x2a1c12`）。道路采用不透明填充 + casing，比省界更易辨认，仍画在国界之下。

| typeId       | 含义     | laneIndex | lineWidth / casingWidth | stroke / casing                           | maxVisibleHalfHeight | 备注                                                                         |
| ------------ | -------- | --------- | ----------------------- | ----------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `local_road` | 普通公路 | -1        | 2.0 / 2.8               | 白 `0xffffff` / 浅灰 `0xd0d0d0` @ 1.0     | 32                   | 与省界同级缩放才显示                                                         |
| `highway`    | 高速公路 | 0         | 3.2 / 4.2               | 橙桃 `0xffb366` / 深橙褐 `0xd4893a` @ 1.0 | 90                   | 中距可见，比普通路粗                                                         |
| `railway`    | 铁路     | 1         | 1.8 / 2.8               | 白 `0xffffff` / 深灰 `0x666666` @ 1.0     | 90                   | 深色连续 casing + 白色虚线（`dashSize`/`gapSize` 5）= 深浅相间，白段带深轮廓 |

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

该 schema 仅用于 L3 人工数据。L4 `compiled/roads.json` 使用：

```ts
interface RuntimeRoadCollection {
  readonly schemaVersion: 2;
  readonly routeInputHash: string;
  readonly segments: readonly RoadSegment[];
  readonly pairRoutes: readonly {
    provinceIdA: ProvinceId;
    provinceIdB: ProvinceId;
    mode: "union-shortest" | "bend" | "straight-fallback";
    coordinates: readonly LonLat[];
  }[];
}
```

每个被 segment 引用的无序省对必须恰有一条 `pairRoute`；多个类型共享该路线。

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
5. 按无序省对去重，在完整 `A∪B` 上生成一条基础路线；
6. 将 `segments`、`pairRoutes` 与 `routeInputHash` 写为 compiled `roads.json` schemaVersion 2，供 `loadMapPack` / `MapViewModel` 挂载；输入哈希未变时复用已有路线。

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

### 5.1 省对基础路径（直线优先 + A∪B 并集域最短路）

对段 `S`，取两端首府地图坐标 `P_a`、`P_b`（经 `lonLatToMapXY`，处理 360° wrap 时选择短经度差）。

**默认路径：**

1. 使用完整 Polygon/MultiPolygon 计算真实并集，并按首府 A 的经度展开日期变更线附近坐标。
2. 若精确线段包含判定确认 `P_a → P_b` 全部位于并集内，则输出两点直线。
3. 否则从并集外环和孔洞提取反射顶点，建立仅包含完全位于闭合并集内的可视边，并按地图平面欧氏距离求最短路径。
4. 只有两个首府确实落在不同并集连通分量时，才输出带 `straight-fallback` 标记的直线并报告 `ROAD_ROUTE_UNREACHABLE_FALLBACK`；算法失败必须拒绝发布。

不做弧线/微弧骨架；不再用「最近共享边强制附着 + 分段省内路径」——那种选点易被拽到海湾外侧并产生怪折点。

若作者提供 `bend.controlPoints`（编辑器手工弯折）：

- 1 个点 → 二次 Bezier 覆盖；
- 2 个点 → 三次 Bezier 覆盖；
- 其他长度 → 校验失败。
- bend 属于整个省对的基础路线；同省对多个 segment 的 bend 必须缺省或完全一致，否则以 `ROAD_BEND_CONFLICT` 拒绝发布。
- bend 采样后的每条绘制线段都必须位于 `A∪B`，否则以 `ROAD_BEND_OUTSIDE_UNION` 拒绝发布。

道路基础几何只在地图发布时计算。运行时包按省对保存一份 `pairRoute`；`routeInputHash` 覆盖被道路引用的省对、端点几何、首府、共享边界、bend 与寻路算法版本，但不包含道路类型、名称、颜色、线宽或偏移配置。

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

对每个省对 `{a,b}`，收集该省对上所有类型的段，并读取唯一预制基础路线 `M`。省对只有一个类型时偏移量固定为 0；只有多个类型同时存在时才应用下式：

对类型 `T`：

```text
offsetDistance = laneIndex(T) * baseLaneSpacing * laneSpacingScale(T)
baseLaneSpacing = 0.35                                      // 当前地图平面单位
```

偏移采用**电路板走线**（非整段鼓包）：

- `laneIndex === 0`：沿预制基础路线。
- 否则：端点钉首府；端点附近各加一段短折线引出；中段对整条主路径做恒定法线平行偏移（多折点走廊保留拐点）。
- `jog = min(固定地图单位, 0.12 * 路径长)`，并保证两端 jog 之和小于路径长。

法线取邻段平均，避免同省对多类型法线翻转。

偏移后不做多边形包含校验；小幅穿出基础路线所在并集属于允许的视觉误差。确定性要求：相同输入地图包 + 相同视角缩放，偏移结果字节级一致（禁止依赖哈希随机扰动）。

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

客户端与编辑器均使用 Three.js `LineSegments2` + `LineMaterial`，先画可选 casing、再画 stroke；有 `dashSize`/`gapSize` 时顶层虚线。铁路：深色连续 casing + 白色虚线 fill，gap 露出深色块、dash 为白心深边。样式数值来自 `road-types.ts`，禁止客户端/编辑器各写一套颜色。

---

## 7. 客户端与编辑器职责

### 7.1 客户端

[`apps/client/src/components/map-renderer.ts`](../../apps/client/src/components/map-renderer.ts)（或并列的道路图层模块）在地图加载后：

1. 读取 compiled `RuntimeRoadCollection` 与唯一省对 `pairRoutes`；
2. 按省对关联 segment；单类型直接使用基础路线，多类型轻量偏移后再按类型串联；
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

**其他操作：** 删除段、更改类型、按类型过滤显示、列表搜索省对。V1 可不做控制点拖拽；若未提供 `bend`，预览使用 §5 的并集最短路径。

编辑器按省对缓存基础路线。道路类型增删只重算 §6 的轻量偏移；省份组合、首府、基础几何、共享边界或 bend 变化才使对应省对的缓存失效。合并组的预览几何必须包含其所有成员 Polygon/MultiPolygon，不能只取首个成员。

**导出：** 扩展现有 `export-map` 管线，将道路集合写入 `assets/maps/<mapId>/geometry/roads.json` 并更新 `map.json` layers；随后可走 `map:publish`。

编辑器不得：

- 因道路编辑修改 `groups.json` 合并关系或省份几何；
- 允许不相邻省对建路；
- 静默覆盖已存在的同键段（必须提示替换或拒绝）。

---

## 8. 默认数据生成与源数据评估

### 8.1 现状结论

| 来源                                  | 仓库现状                            | 结论                             |
| ------------------------------------- | ----------------------------------- | -------------------------------- |
| `geometry/boundaries.json` + 省份首府 | 已有                                | 提供候选邻接省对与绘制骨架       |
| Natural Earth `ne_10m_roads`          | 生成时下载到 `cache/natural-earth/` | **强度真相**：决定哪些邻接对建路 |
| Natural Earth `ne_10m_railroads`      | 未接入                              | 后续可对 `railway` 做同类打分    |
| OSM 公路网                            | 未使用                              | 本阶段不纳入                     |

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

| 地图绘制 V1   | 未来经济内核（既有架构）                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `RoadSegment` | 候选生成一条或多条 `TransportEdge`                                                              |
| 省份首府      | 通常对应 `ProvinceHub` 类 `TransportNode`（见 `economic_simulation_web_architecture.md` §11.2） |
| 绘制串联      | 无对应；路径查询走运输图                                                                        |
| `RoadTypeId`  | 映射到 `TransportEdgeDefinition.kind`（Road / Railway / …）                                     |
| 无            | `InfrastructureOperatorState` / 道路 Operating Unit 绑定 edge                                   |

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
8. L4 每个被引用省对恰有一条 `pairRoute`，坐标有限且端点等于两端首府。
9. 旧 compiled schema 必须提示重新执行 `map:publish`。

建议错误码（地图管线 / 编辑器 API）：

| 码                                | 含义                                     |
| --------------------------------- | ---------------------------------------- |
| `ROAD_PROVINCE_NOT_FOUND`         | 端点省份不存在                           |
| `ROAD_CAPITAL_MISSING`            | 首府坐标缺失                             |
| `ROAD_NOT_ADJACENT`               | 无共享边界                               |
| `ROAD_TYPE_UNKNOWN`               | 未知类型                                 |
| `ROAD_DUPLICATE_SEGMENT`          | 同类型同省对重复                         |
| `ROAD_BEND_INVALID`               | 控制点非法                               |
| `ROAD_BEND_CONFLICT`              | 同省对存在不一致 bend                    |
| `ROAD_BEND_OUTSIDE_UNION`         | bend 路线越出两省并集                    |
| `ROAD_ROUTE_UNREACHABLE_FALLBACK` | 两首府位于并集不同连通分量，显式直线降级 |
| `ROAD_ID_DUPLICATE`               | id 冲突                                  |

调试模式可额外断言：串联缓存覆盖的段集合等于权威段集合（无丢段、无幻段）。

---

## 11. 验收标准

功能：

- 给定含多类型道路的地图包，客户端在合适缩放级画出预制的首府间并集最短路线，多类型平行可辨。
- 同类型多段在共享首府处视觉连续。
- 同省对上 `local_road` + `highway` + `railway` 三者可同时存在且彼此偏移可辨。
- 远景隐藏 `local_road`，中近景显示高速/铁路；普通路白底灰边、高速橙底深边、铁路深浅相间。
- 编辑器可添加/删除/改类型道路，导出后客户端可见。
- NE 强度种子脚本能对 `world-modern` 产出可校验的默认 `roads.json`。

非功能：

- 道路图层不得显著拖垮现有地图帧率；应批合成按类型的线几何，避免一段一个 draw call。
- 校验失败必须拒绝发布，不得静默丢段。

---

## 12. 建议实现阶段（排期指引）

本文件只定规格；实现顺序建议：

1. **Schema 与 pipeline**：L3 `RoadCollection`、L4 `RuntimeRoadCollection`、编译校验、空集合兼容。
2. **编译期路线**：按省对生成并缓存 `pairRoutes`，发布 schema v2。
3. **客户端绘制**：读取基础路线 → 多类型偏移 → 同类型串联 → LOD。
4. **编辑器**：添加/删除/改类型、省对路线缓存与预览；导出接入。
5. **默认种子脚本**：NE 道路强度筛选邻接省对 → `highway` / `local_road`；生成报告；compile 入库。
6. **（可选）NE 增强**：下载 roads/railroads，走廊匹配提升类型。
7. **（后续规格）** Transport Graph 与 Operating Unit 对接。

---

## 13. 修订记录

| 版本       | 说明                                                  |
| ---------- | ----------------------------------------------------- |
| 2026-09-03 | 初版：地图绘制 V1 基线，经济模拟明确排除              |
| 2026-09-04 | 每省对编译期预制 `A∪B` 最短路线，运行时仅做多类型偏移 |
