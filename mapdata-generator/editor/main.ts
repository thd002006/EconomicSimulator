import {
  computeBBox,
  EditorMapRenderer,
  type BaseProvinceFeature,
  type EditorBaseData,
  type EditorProject,
  type ProjectGroup
} from "./renderer.js";

const baseSelect = document.querySelector<HTMLSelectElement>("#baseSelect")!;
const projectSelect = document.querySelector<HTMLSelectElement>("#projectSelect")!;
const countrySelect = document.querySelector<HTMLSelectElement>("#countrySelect")!;
const groupsEl = document.querySelector<HTMLDivElement>("#groups")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const exportMapId = document.querySelector<HTMLInputElement>("#exportMapId")!;
const selectedCountEl = document.querySelector<HTMLSpanElement>("#selectedCount")!;
const tooltipEl = document.querySelector<HTMLDivElement>("#tooltip")!;
const canvas = document.querySelector<HTMLCanvasElement>("canvas#map-canvas")!;

const roadTypeSelect = document.querySelector<HTMLSelectElement>("#roadTypeSelect")!;
const roadListEl = document.querySelector<HTMLDivElement>("#roadList")!;

let editMode: "select" | "addRoad" = "select";
let roadPickFirstId: string | undefined;

function ensureRoads(project: EditorProject): EditorProject {
  if (project.roads?.schemaVersion === 1 && Array.isArray(project.roads.segments)) {
    return project;
  }
  return { ...project, roads: { schemaVersion: 1, segments: [] } };
}

function groupAdjacencyKeys(): Set<string> {
  const keys = new Set<string>();
  if (!currentProject || !currentBaseData) return keys;
  const memberToGroup = new Map<string, string>();
  for (const group of currentProject.groups) {
    for (const member of group.members) memberToGroup.set(member, group.id);
  }
  for (const boundary of currentBaseData.boundaries) {
    if (!boundary.rightProvinceId) continue;
    const a = memberToGroup.get(boundary.leftProvinceId);
    const b = memberToGroup.get(boundary.rightProvinceId);
    if (!a || !b || a === b) continue;
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

function renderRoadList(): void {
  if (!currentProject) {
    roadListEl.innerHTML = "";
    return;
  }
  const segments = currentProject.roads.segments;
  if (segments.length === 0) {
    roadListEl.textContent = "暂无道路";
    return;
  }
  roadListEl.innerHTML = segments
    .slice(0, 80)
    .map(
      (segment) =>
        `<div data-road-id="${segment.id}">${segment.typeId}: ${segment.provinceIdA} ↔ ${segment.provinceIdB}</div>`
    )
    .join("");
  if (segments.length > 80) {
    roadListEl.innerHTML += `<div>…另有 ${segments.length - 80} 条</div>`;
  }
}

function addRoadBetween(groupA: string, groupB: string): void {
  if (!currentProject) return;
  if (groupA === groupB) {
    setStatus("道路两端不能是同一组");
    return;
  }
  const a = groupA < groupB ? groupA : groupB;
  const b = groupA < groupB ? groupB : groupA;
  const pair = `${a}|${b}`;
  if (!groupAdjacencyKeys().has(pair) && !renderer.canBridgeRoadPair(a, b)) {
    setStatus("所选两组既不相邻，也没有 20 km 内的合法水域桥接");
    return;
  }
  const typeId = roadTypeSelect.value;
  const duplicate = currentProject.roads.segments.some(
    (segment) => segment.typeId === typeId && segment.provinceIdA === a && segment.provinceIdB === b
  );
  if (duplicate) {
    setStatus(`已存在 ${typeId} 道路 ${a} ↔ ${b}`);
    return;
  }
  currentProject = {
    ...currentProject,
    roads: {
      schemaVersion: 1,
      segments: [
        ...currentProject.roads.segments,
        {
          id: `road-${typeId}-${a}-${b}`,
          typeId,
          provinceIdA: a,
          provinceIdB: b
        }
      ]
    }
  };
  renderer.setProject(currentProject);
  renderRoadList();
  setStatus(`已添加 ${typeId}: ${a} ↔ ${b}（记得保存工程）`);
}

const renderer = new EditorMapRenderer(canvas);

let currentProject: EditorProject | null = null;
let currentBaseData: EditorBaseData | null = null;
const selectedGroupIds = new Set<string>();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function updateSelectedCount(): void {
  selectedCountEl.textContent = String(selectedGroupIds.size);
}

function findGroupByProvinceId(provinceId: string): ProjectGroup | undefined {
  if (!currentProject) return undefined;
  return currentProject.groups.find((g) => g.members.includes(provinceId));
}

function getCountryDisplayName(countryId: string): string {
  if (!countryId) return "";
  const entry = currentBaseData?.countryNames?.[countryId];
  if (entry) {
    if (entry.name && entry.nameEn && entry.name !== entry.nameEn) {
      return `${entry.name} (${entry.nameEn}, ${countryId})`;
    }
    return `${entry.name || entry.nameEn} (${countryId})`;
  }
  return countryId;
}

function renderGroups(): void {
  const groupStatsEl = document.querySelector<HTMLDivElement>("#groupStats");
  if (!currentProject) {
    groupsEl.innerHTML = "";
    if (groupStatsEl) groupStatsEl.textContent = "";
    updateSelectedCount();
    return;
  }
  const country = countrySelect.value;
  const visible = currentProject.groups
    .filter((g) => country === "" || g.countryId === country)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));

  if (groupStatsEl) {
    const totalMemberCount = visible.reduce((sum, g) => sum + g.members.length, 0);
    groupStatsEl.textContent = country
      ? `${getCountryDisplayName(country)}: 共 ${visible.length} 组 / ${totalMemberCount} 省`
      : `全球所有国家: 共 ${visible.length} 组 / ${totalMemberCount} 省`;
  }

  groupsEl.innerHTML = visible
    .map((g) => {
      const isSelected = selectedGroupIds.has(g.id);
      const title =
        g.nameEn && g.name && g.name !== g.nameEn
          ? `${g.nameEn} (${g.name})`
          : g.nameEn || g.name || g.id;
      return `
        <div class="group-item ${isSelected ? "selected" : ""}" data-id="${g.id}">
          <input type="checkbox" data-id="${g.id}" ${isSelected ? "checked" : ""} />
          <div class="group-info">
            <div class="group-title">${title}</div>
            <div class="group-meta">${g.id} · ${g.members.length}省</div>
          </div>
        </div>
      `;
    })
    .join("");

  groupsEl.querySelectorAll<HTMLDivElement>(".group-item").forEach((el) => {
    const gid = el.dataset.id!;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.shiftKey) {
        if (selectedGroupIds.has(gid)) selectedGroupIds.delete(gid);
        else selectedGroupIds.add(gid);
      } else {
        selectedGroupIds.clear();
        selectedGroupIds.add(gid);
      }
      onSelectionChanged();
      focusGroup(gid);
    });

    const checkbox = el.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedGroupIds.add(gid);
      else selectedGroupIds.delete(gid);
      onSelectionChanged();
    });
  });

  updateSelectedCount();
}

function onSelectionChanged(): void {
  renderer.selectedGroupIds = selectedGroupIds;
  renderer.rebuildHighlight();
  renderer.render();
  renderGroups();
}

function focusGroup(groupId: string): void {
  if (!currentProject || !currentBaseData) return;
  const group = currentProject.groups.find((g) => g.id === groupId);
  if (!group) return;

  const memberFeatures = currentBaseData.provinces.filter((p) => group.members.includes(p.id));
  if (memberFeatures.length === 0) return;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const f of memberFeatures) {
    if (f.bbox.minLon < minLon) minLon = f.bbox.minLon;
    if (f.bbox.maxLon > maxLon) maxLon = f.bbox.maxLon;
    if (f.bbox.minLat < minLat) minLat = f.bbox.minLat;
    if (f.bbox.maxLat > maxLat) maxLat = f.bbox.maxLat;
  }

  renderer.focusBBox({ minLon, minLat, maxLon, maxLat });
}

function focusCountry(countryId: string): void {
  if (!currentBaseData || !countryId) return;
  const countryProvinces = currentBaseData.provinces.filter((p) => p.countryId === countryId);
  if (countryProvinces.length === 0) return;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const f of countryProvinces) {
    if (f.bbox.minLon < minLon) minLon = f.bbox.minLon;
    if (f.bbox.maxLon > maxLon) maxLon = f.bbox.maxLon;
    if (f.bbox.minLat < minLat) minLat = f.bbox.minLat;
    if (f.bbox.maxLat > maxLat) maxLat = f.bbox.maxLat;
  }

  renderer.focusBBox({ minLon, minLat, maxLon, maxLat });
}

async function loadBase(baseMapId: string): Promise<void> {
  setStatus(`正在加载基础地图 ${baseMapId}...`);
  const raw = await api<{
    provinces: GeoJSON.FeatureCollection;
    coastlines: GeoJSON.FeatureCollection;
    boundaries: { type: string; features: unknown[] };
    demographics: Record<string, { pop?: number; gdpPpp?: number }>;
    countryNames?: Record<string, { name?: string; nameEn: string }>;
  }>(`/api/bases/${encodeURIComponent(baseMapId)}/full`);

  const provinces: BaseProvinceFeature[] = raw.provinces.features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const id = String(f.id ?? props.id ?? "");
    const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const capitalRaw = props.capital as
      { name?: string | undefined; coordinates: [number, number] } | undefined;
    const capital = capitalRaw
      ? {
          name: capitalRaw.name,
          coordinates: capitalRaw.coordinates
        }
      : undefined;
    return {
      id,
      countryId: String(props.adm0A3 ?? "UNK"),
      name: String(props.name ?? id),
      nameEn: String(props.nameEn ?? id),
      geometry: geom,
      bbox: computeBBox(geom),
      capital
    };
  });

  const coastlines = (raw.coastlines?.features ?? []).map((f: unknown) => {
    const feature = f as {
      id?: string | number;
      geometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
      coordinates?: [number, number][];
    };
    let coords: [number, number][] = [];
    if (feature.coordinates && Array.isArray(feature.coordinates)) {
      coords = feature.coordinates;
    } else if (feature.geometry) {
      coords =
        feature.geometry.type === "LineString"
          ? (feature.geometry.coordinates as [number, number][])
          : ((feature.geometry.coordinates as [number, number][][]).flat() as [number, number][]);
    }
    return {
      id: String(feature.id ?? ""),
      coordinates: coords
    };
  });

  const boundaries = (raw.boundaries?.features ?? []).map((f: unknown) => {
    const feature = f as {
      id?: string | number;
      leftProvinceId?: string;
      rightProvinceId?: string | null;
      coordinates?: [number, number][];
      properties?: Record<string, unknown>;
      geometry?: GeoJSON.LineString;
    };
    const leftProvinceId = String(
      feature.leftProvinceId ?? feature.properties?.leftProvinceId ?? ""
    );
    const rightProvinceId =
      feature.rightProvinceId !== undefined
        ? feature.rightProvinceId !== null
          ? String(feature.rightProvinceId)
          : null
        : feature.properties?.rightProvinceId !== undefined &&
            feature.properties?.rightProvinceId !== null
          ? String(feature.properties.rightProvinceId)
          : null;
    const coordinates = (feature.coordinates ?? feature.geometry?.coordinates ?? []) as [
      number,
      number
    ][];

    return {
      id: String(feature.id ?? ""),
      leftProvinceId,
      rightProvinceId,
      coordinates
    };
  });

  const countries = [...new Set(provinces.map((p) => p.countryId))].sort((a, b) => {
    const nameA = raw.countryNames?.[a]?.nameEn ?? a;
    const nameB = raw.countryNames?.[b]?.nameEn ?? b;
    return nameA.localeCompare(nameB);
  });

  currentBaseData = {
    provinces,
    boundaries,
    coastlines,
    demographics: raw.demographics ?? {},
    countries,
    countryNames: raw.countryNames ?? {}
  };

  renderer.setBaseData(currentBaseData);
  countrySelect.innerHTML =
    `<option value="">（全球总览 / 选择国家聚焦）</option>` +
    countries
      .map((c) => {
        const displayName = getCountryDisplayName(c);
        return `<option value="${c}">${displayName}</option>`;
      })
      .join("");
}

async function openProject(projectId: string): Promise<void> {
  const project = await api<EditorProject>(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!currentBaseData || currentProject?.meta.baseMapId !== project.meta.baseMapId) {
    await loadBase(project.meta.baseMapId);
  }
  currentProject = ensureRoads(project);
  selectedGroupIds.clear();
  editMode = "select";
  roadPickFirstId = undefined;
  exportMapId.value = project.meta.suggestedMapId || project.meta.projectId;
  if (currentProject) {
    renderer.setProject(currentProject);
  }

  setStatus(
    `已打开 ${project.meta.projectId}\nbase=${project.meta.baseMapId}\n总组数=${project.groups.length}`
  );
  renderGroups();
  renderRoadList();
  onSelectionChanged();
}

async function refreshLists(): Promise<void> {
  const bases = await api<{ bases: string[] }>("/api/bases");
  baseSelect.innerHTML = bases.bases.map((id) => `<option value="${id}">${id}</option>`).join("");
  if (bases.bases.includes("world-admin1")) baseSelect.value = "world-admin1";

  const projects = await api<{ projects: string[] }>("/api/projects");
  projectSelect.innerHTML = projects.projects
    .map((id) => `<option value="${id}">${id}</option>`)
    .join("");
}

// Map Click & Hover
let mouseDownPos = { x: 0, y: 0 };
canvas.addEventListener("pointerdown", (e) => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointerup", (e) => {
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return; // was dragging

  const [lon, lat] = renderer.screenToLonLat(e.clientX, e.clientY);
  const hit = renderer.spatialIndex?.hitTest(lon, lat);
  if (!hit || !currentProject) return;

  const group = findGroupByProvinceId(hit.id);
  if (!group) return;

  if (e.shiftKey) {
    if (selectedGroupIds.has(group.id)) selectedGroupIds.delete(group.id);
    else selectedGroupIds.add(group.id);
  } else if (editMode === "addRoad") {
    if (roadPickFirstId === undefined) {
      roadPickFirstId = group.id;
      selectedGroupIds.clear();
      selectedGroupIds.add(group.id);
      setStatus(`道路起点: ${group.id}，请再点选相邻终点`);
    } else {
      const first = roadPickFirstId;
      roadPickFirstId = undefined;
      addRoadBetween(first, group.id);
      selectedGroupIds.clear();
      selectedGroupIds.add(group.id);
    }
  } else {
    selectedGroupIds.clear();
    selectedGroupIds.add(group.id);
  }

  // Auto set country filter or keep
  if (countrySelect.value !== "" && countrySelect.value !== group.countryId) {
    countrySelect.value = group.countryId;
  }

  onSelectionChanged();

  // Scroll into view in list
  const activeEl = groupsEl.querySelector(`[data-id="${group.id}"]`);
  activeEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

canvas.addEventListener("pointermove", (e) => {
  const [lon, lat] = renderer.screenToLonLat(e.clientX, e.clientY);
  const hit = renderer.spatialIndex?.hitTest(lon, lat);

  if (hit) {
    renderer.hoveredProvinceId = hit.id;
    renderer.rebuildHighlight();
    renderer.render();

    const group = findGroupByProvinceId(hit.id);
    const demo = currentBaseData?.demographics[hit.id];
    const popStr = demo?.pop ? `${(demo.pop / 10000).toFixed(1)}万人` : "暂无人口";
    const gdpStr = demo?.gdpPpp ? `$${(demo.gdpPpp / 1e9).toFixed(2)}B` : "";

    const countryName = getCountryDisplayName(hit.countryId);
    tooltipEl.style.display = "block";
    tooltipEl.style.left = `${e.clientX}px`;
    tooltipEl.style.top = `${e.clientY}px`;
    tooltipEl.innerHTML = `
      <strong>${hit.nameEn} (${hit.name})</strong>
      <div>国家: ${countryName} | 省份代码: ${hit.id}</div>
      <div>所属合并组: ${group ? `${group.nameEn} (${group.id}, 包含${group.members.length}省)` : "未分组"}</div>
      <div class="muted">人口: ${popStr} ${gdpStr ? `| GDP: ${gdpStr}` : ""}</div>
    `;
  } else {
    if (renderer.hoveredProvinceId !== undefined) {
      delete renderer.hoveredProvinceId;
      renderer.rebuildHighlight();
      renderer.render();
    }
    tooltipEl.style.display = "none";
  }
});

canvas.addEventListener("pointerleave", () => {
  tooltipEl.style.display = "none";
  if (renderer.hoveredProvinceId !== undefined) {
    delete renderer.hoveredProvinceId;
    renderer.rebuildHighlight();
    renderer.render();
  }
});

// UI Controls
countrySelect.addEventListener("change", () => {
  renderGroups();
  focusCountry(countrySelect.value);
});

document.querySelector("#btnRefresh")!.addEventListener("click", () => {
  void refreshLists().catch((e) => setStatus(String(e)));
});

document.querySelector("#btnNew")!.addEventListener("click", () => {
  void (async () => {
    const baseMapId = baseSelect.value;
    if (!baseMapId) throw new Error("请先选择 L1 基础图");
    const created = await api<EditorProject>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        baseMapId,
        suggestedMapId: "world-modern",
        name: `from ${baseMapId}`
      })
    });
    await refreshLists();
    projectSelect.value = created.meta.projectId;
    await openProject(created.meta.projectId);
  })().catch((e) => setStatus(String(e)));
});

document.querySelector("#btnOpen")!.addEventListener("click", () => {
  void openProject(projectSelect.value).catch((e) => setStatus(String(e)));
});

document.querySelector("#btnSave")!.addEventListener("click", () => {
  void (async () => {
    if (!currentProject) throw new Error("无打开的工程");
    await api(`/api/projects/${encodeURIComponent(currentProject.meta.projectId)}`, {
      method: "PUT",
      body: JSON.stringify(currentProject)
    });
    setStatus(`已成功保存工程 ${currentProject.meta.projectId}`);
  })().catch((e) => setStatus(String(e)));
});

document.querySelector("#btnMerge")!.addEventListener("click", () => {
  void (async () => {
    if (!currentProject) throw new Error("无打开的工程");
    const groupIds = [...selectedGroupIds];
    if (groupIds.length < 2) throw new Error("请在地图上或列表中至少选择 2 个组进行合并");

    const parts = currentProject.groups.filter((g) => groupIds.includes(g.id));
    const firstCountry = parts[0]?.countryId;
    if (parts.some((g) => g.countryId !== firstCountry)) {
      throw new Error("只能合并同一个国家内的省份/组！");
    }

    currentProject = ensureRoads(
      await api<EditorProject>(
        `/api/projects/${encodeURIComponent(currentProject.meta.projectId)}/merge`,
        { method: "POST", body: JSON.stringify({ groupIds }) }
      )
    );
    selectedGroupIds.clear();
    renderer.setProject(currentProject);
    renderRoadList();
    setStatus(`已成功合并 → 剩余 ${currentProject.groups.length} 组`);
    onSelectionChanged();
  })().catch((e) => setStatus(String(e)));
});

document.querySelector("#btnSplit")!.addEventListener("click", () => {
  void (async () => {
    if (!currentProject) throw new Error("无打开的工程");
    if (selectedGroupIds.size !== 1) throw new Error("请只选择一个要拆分的组");
    const groupId = [...selectedGroupIds][0]!;
    const group = currentProject.groups.find((g) => g.id === groupId);
    if (!group || group.members.length <= 1)
      throw new Error("该组仅含单个原子省份，无法进一步拆分");

    currentProject = ensureRoads(
      await api<EditorProject>(
        `/api/projects/${encodeURIComponent(currentProject.meta.projectId)}/split`,
        { method: "POST", body: JSON.stringify({ groupId }) }
      )
    );
    selectedGroupIds.clear();
    renderer.setProject(currentProject);
    renderRoadList();
    setStatus(`已拆分组 ${groupId} → 现有 ${currentProject.groups.length} 组`);
    onSelectionChanged();
  })().catch((e) => setStatus(String(e)));
});

document.querySelector("#btnAddRoad")!.addEventListener("click", () => {
  if (!currentProject) {
    setStatus("请先打开工程");
    return;
  }
  editMode = "addRoad";
  roadPickFirstId = undefined;
  setStatus("道路添加模式：依次点选两个相邻或可桥接的合并组");
});

document.querySelector("#btnDeleteRoad")!.addEventListener("click", () => {
  if (!currentProject) {
    setStatus("请先打开工程");
    return;
  }
  if (selectedGroupIds.size !== 2) {
    setStatus("请先选中恰好两个组，将删除它们之间的当前类型道路");
    return;
  }
  const [g0, g1] = [...selectedGroupIds];
  const a = g0! < g1! ? g0! : g1!;
  const b = g0! < g1! ? g1! : g0!;
  const typeId = roadTypeSelect.value;
  const before = currentProject.roads.segments.length;
  currentProject = {
    ...currentProject,
    roads: {
      schemaVersion: 1,
      segments: currentProject.roads.segments.filter(
        (segment) =>
          !(segment.typeId === typeId && segment.provinceIdA === a && segment.provinceIdB === b)
      )
    }
  };
  const removed = before - currentProject.roads.segments.length;
  renderer.setProject(currentProject);
  renderRoadList();
  setStatus(removed > 0 ? `已删除 ${removed} 条道路（记得保存）` : "未找到匹配道路");
});

document.querySelector("#btnExport")!.addEventListener("click", () => {
  void (async () => {
    if (!currentProject) throw new Error("无打开的工程");
    setStatus("正在导出中（dissolve 几何合并 + L3 资产生成 + publish 自动编译）...");
    const result = await api<{ mapId: string; provinceCount: number }>(
      `/api/projects/${encodeURIComponent(currentProject.meta.projectId)}/export`,
      {
        method: "POST",
        body: JSON.stringify({
          mapId: exportMapId.value.trim() || currentProject.meta.suggestedMapId
        })
      }
    );
    setStatus(
      `✅ 导出完成！\nmapId = ${result.mapId}\n包含省份数 = ${result.provinceCount}\n已自动发布至 assets/maps/`
    );
  })().catch((e) => setStatus(String(e)));
});

// Init
void (async () => {
  await refreshLists();
  if (projectSelect.value) {
    await openProject(projectSelect.value);
  } else if (baseSelect.value) {
    await loadBase(baseSelect.value);
  }
})().catch((e) => setStatus(String(e)));
