import maplibregl from "maplibre-gl";

interface ProjectGroup {
  id: string;
  countryId: string;
  members: string[];
  name: string;
  nameEn: string;
}

interface EditorProject {
  meta: {
    projectId: string;
    baseMapId: string;
    suggestedMapId: string;
    name: string;
  };
  groups: ProjectGroup[];
}

const baseSelect = document.querySelector<HTMLSelectElement>("#baseSelect")!;
const projectSelect = document.querySelector<HTMLSelectElement>("#projectSelect")!;
const countrySelect = document.querySelector<HTMLSelectElement>("#countrySelect")!;
const groupsEl = document.querySelector<HTMLDivElement>("#groups")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const exportMapId = document.querySelector<HTMLInputElement>("#exportMapId")!;

let project: EditorProject | null = null;
let selected = new Set<string>();

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap"
      }
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  },
  center: [10, 30],
  zoom: 2
});

map.on("load", () => {
  map.addSource("provinces", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "province-fill",
    type: "fill",
    source: "provinces",
    paint: {
      "fill-color": "#3498db",
      "fill-opacity": 0.45
    }
  });
  map.addLayer({
    id: "province-line",
    type: "line",
    source: "provinces",
    paint: { "line-color": "#1a5276", "line-width": 1 }
  });
  map.on("click", "province-fill", (event) => {
    const feature = event.features?.[0];
    if (feature === undefined || project === null) return;
    const sourceId = String(feature.id ?? "");
    if (sourceId === "") return;
    const group = project.groups.find((entry) => entry.members.includes(sourceId));
    if (group === undefined) return;
    if (selected.has(group.id)) selected.delete(group.id);
    else selected.add(group.id);
    renderGroups();
  });
});

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

async function refreshLists(): Promise<void> {
  const bases = await api<{ bases: string[] }>("/api/bases");
  baseSelect.innerHTML = bases.bases
    .map((id) => `<option value="${id}">${id}</option>`)
    .join("");
  if (bases.bases.includes("world-admin1")) baseSelect.value = "world-admin1";
  const projects = await api<{ projects: string[] }>("/api/projects");
  projectSelect.innerHTML = projects.projects
    .map((id) => `<option value="${id}">${id}</option>`)
    .join("");
}

function renderGroups(): void {
  if (project === null) {
    groupsEl.innerHTML = "";
    return;
  }
  const country = countrySelect.value;
  const visible = project.groups
    .filter((group) => country === "" || group.countryId === country)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  groupsEl.innerHTML = visible
    .map((group) => {
      const checked = selected.has(group.id) ? "checked" : "";
      return `<label><input type="checkbox" data-id="${group.id}" ${checked}/> <span><strong>${group.nameEn}</strong> <span class="muted">(${group.id}, ${group.members.length})</span></span></label>`;
    })
    .join("");
  groupsEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.id!;
      if (input.checked) selected.add(id);
      else selected.delete(id);
    });
  });
}

async function loadCountryGeojson(): Promise<void> {
  if (project === null) return;
  const country = countrySelect.value;
  if (country === "") {
    (map.getSource("provinces") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: []
    });
    return;
  }
  const data = await api<GeoJSON.FeatureCollection>(
    `/api/bases/${encodeURIComponent(project.meta.baseMapId)}/geojson?country=${encodeURIComponent(country)}`
  );
  for (const feature of data.features) {
    if (feature.id === undefined && feature.properties && "id" in feature.properties) {
      feature.id = String((feature.properties as { id: string }).id);
    }
  }
  (map.getSource("provinces") as maplibregl.GeoJSONSource).setData(data);
}

async function openProject(projectId: string): Promise<void> {
  project = await api<EditorProject>(`/api/projects/${encodeURIComponent(projectId)}`);
  selected = new Set();
  exportMapId.value = project.meta.suggestedMapId;
  const index = await api<{ countries: string[] }>(
    `/api/bases/${encodeURIComponent(project.meta.baseMapId)}/index`
  );
  countrySelect.innerHTML =
    `<option value="">（选择国家以预览）</option>` +
    index.countries.map((id) => `<option value="${id}">${id}</option>`).join("");
  setStatus(
    `已打开 ${project.meta.projectId}\nbase=${project.meta.baseMapId}\n组数=${project.groups.length}`
  );
  renderGroups();
  await loadCountryGeojson();
}

document.querySelector("#btnRefresh")!.addEventListener("click", () => {
  void refreshLists().catch((error) => setStatus(String(error)));
});

document.querySelector("#btnNew")!.addEventListener("click", () => {
  void (async () => {
    const baseMapId = baseSelect.value;
    if (!baseMapId) throw new Error("没有可用的 L1 基础图，请先 pnpm generate:base");
    const created = await api<EditorProject>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        baseMapId,
        suggestedMapId: "exported-map",
        name: `from ${baseMapId}`
      })
    });
    await refreshLists();
    projectSelect.value = created.meta.projectId;
    await openProject(created.meta.projectId);
  })().catch((error) => setStatus(String(error)));
});

document.querySelector("#btnOpen")!.addEventListener("click", () => {
  void openProject(projectSelect.value).catch((error) => setStatus(String(error)));
});

document.querySelector("#btnSave")!.addEventListener("click", () => {
  void (async () => {
    if (project === null) throw new Error("无工程");
    await api(`/api/projects/${encodeURIComponent(project.meta.projectId)}`, {
      method: "PUT",
      body: JSON.stringify(project)
    });
    setStatus(`已保存 ${project.meta.projectId}`);
  })().catch((error) => setStatus(String(error)));
});

countrySelect.addEventListener("change", () => {
  selected = new Set();
  renderGroups();
  void loadCountryGeojson().catch((error) => setStatus(String(error)));
});

document.querySelector("#btnMerge")!.addEventListener("click", () => {
  void (async () => {
    if (project === null) throw new Error("无工程");
    const groupIds = [...selected];
    if (groupIds.length < 2) throw new Error("请至少勾选两个组");
    project = await api<EditorProject>(
      `/api/projects/${encodeURIComponent(project.meta.projectId)}/merge`,
      { method: "POST", body: JSON.stringify({ groupIds }) }
    );
    selected = new Set();
    setStatus(`已合并 → ${project.groups.length} 组`);
    renderGroups();
  })().catch((error) => setStatus(String(error)));
});

document.querySelector("#btnSplit")!.addEventListener("click", () => {
  void (async () => {
    if (project === null) throw new Error("无工程");
    if (selected.size !== 1) throw new Error("请只勾选一个要拆分的组");
    const groupId = [...selected][0]!;
    project = await api<EditorProject>(
      `/api/projects/${encodeURIComponent(project.meta.projectId)}/split`,
      { method: "POST", body: JSON.stringify({ groupId }) }
    );
    selected = new Set();
    setStatus(`已拆分 → ${project.groups.length} 组`);
    renderGroups();
  })().catch((error) => setStatus(String(error)));
});

document.querySelector("#btnExport")!.addEventListener("click", () => {
  void (async () => {
    if (project === null) throw new Error("无工程");
    setStatus("导出中（dissolve + publish）…");
    const result = await api<{ mapId: string; provinceCount: number }>(
      `/api/projects/${encodeURIComponent(project.meta.projectId)}/export`,
      {
        method: "POST",
        body: JSON.stringify({ mapId: exportMapId.value || project.meta.suggestedMapId })
      }
    );
    setStatus(`导出完成\nmapId=${result.mapId}\nprovinces=${result.provinceCount}`);
  })().catch((error) => setStatus(String(error)));
});

void refreshLists().catch((error) => setStatus(String(error)));
