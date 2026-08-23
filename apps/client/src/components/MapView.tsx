import { useEffect, useRef, useState } from "react";
import {
  createDefaultViewport,
  createMapViewModel,
  loadMapPack,
  panViewport,
  unprojectFromScreen,
  zoomViewportAt,
  type MapFeature,
  type MapViewModel
} from "@economic-simulator/map-runtime";

import {
  buildMapRenderCache,
  provinceLabel,
  rebuildOwnershipStyles,
  renderMapView,
  type MapRenderCache
} from "./map-renderer";

export interface MapViewProps {
  readonly mapId?: string;
  readonly baseUrl?: string;
  readonly fill?: boolean;
  readonly selectedProvinceId?: string;
  /** Simulated province owner ids keyed by province id. Overrides default adm0A3. */
  readonly provinceOwners?: Readonly<Record<string, string>>;
  readonly onSelectProvince?: (
    provinceId: string | undefined,
    feature: MapFeature | undefined
  ) => void;
}

type LoadState = "loading" | "ready" | "error";

type RuntimeModel = MapViewModel & {
  hitTest(lon: number, lat: number): MapFeature | undefined;
  findProvince(id: string): MapFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
};

function createOwnerLookup(
  model: RuntimeModel,
  provinceOwners: Readonly<Record<string, string>> | undefined
): (provinceId: string) => string | undefined {
  return (provinceId: string) => {
    const override = provinceOwners?.[provinceId];
    if (override !== undefined) {
      return override;
    }
    return model.getProvinceOwner(provinceId);
  };
}

function collectOwnerChanges(
  previous: Readonly<Record<string, string>> | undefined,
  next: Readonly<Record<string, string>> | undefined
): readonly string[] | undefined {
  if (previous === undefined || next === undefined) {
    return undefined;
  }
  const changed: string[] = [];
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const id of ids) {
    if (previous[id] !== next[id]) {
      changed.push(id);
    }
  }
  return changed;
}

function resolveFeatureOwner(
  model: RuntimeModel | undefined,
  feature: MapFeature | undefined,
  provinceOwners: Readonly<Record<string, string>> | undefined
): string {
  if (feature === undefined || model === undefined) {
    return "—";
  }
  return createOwnerLookup(model, provinceOwners)(feature.id) ?? "—";
}

export function MapView(props: MapViewProps): React.JSX.Element {
  const mapId = props.mapId ?? "world-modern";
  const baseUrl = props.baseUrl ?? "/maps";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<RuntimeModel | undefined>(undefined);
  const cacheRef = useRef<MapRenderCache | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | undefined>(
    undefined
  );
  const interactiveRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  const dprRef = useRef(1);
  const ownersRef = useRef<Readonly<Record<string, string>> | undefined>(props.provinceOwners);
  const prevOwnersRef = useRef<Readonly<Record<string, string>> | undefined>(undefined);

  ownersRef.current = props.provinceOwners;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<MapFeature | undefined>(undefined);
  const [selected, setSelected] = useState<MapFeature | undefined>(undefined);

  const scheduleDraw = (): void => {
    if (rafRef.current !== undefined) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = undefined;
      const canvas = canvasRef.current;
      const model = modelRef.current;
      const cache = cacheRef.current;
      if (canvas === null || model === undefined || cache === undefined) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      renderMapView(ctx, model, cache, dprRef.current, {
        interactive: interactiveRef.current
      });
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setErrorMessage(undefined);
    cacheRef.current = undefined;

    void loadMapPack(`${baseUrl}/${mapId}`)
      .then((pack) => {
        if (cancelled) {
          return;
        }
        const canvas = canvasRef.current;
        const model = createMapViewModel(
          pack,
          createDefaultViewport(canvas?.clientWidth ?? 960, canvas?.clientHeight ?? 540),
          {
            getProvinceOwner: (provinceId) => ownersRef.current?.[provinceId]
          }
        );
        if (props.selectedProvinceId !== undefined) {
          model.selectedProvinceId = props.selectedProvinceId;
          setSelected(model.findProvince(props.selectedProvinceId));
        }
        modelRef.current = model;
        const ownerLookup = createOwnerLookup(model, props.provinceOwners);
        cacheRef.current = buildMapRenderCache(model, ownerLookup);
        setLoadState("ready");
        scheduleDraw();
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : "地图加载失败。");
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, mapId]);

  useEffect(() => {
    const model = modelRef.current;
    const cache = cacheRef.current;
    if (model === undefined || cache === undefined) {
      return;
    }
    const ownerLookup = createOwnerLookup(model, ownersRef.current);
    const changed = collectOwnerChanges(prevOwnersRef.current, props.provinceOwners);
    rebuildOwnershipStyles(cache, model, ownerLookup, changed);
    prevOwnersRef.current = props.provinceOwners;
    scheduleDraw();
  }, [props.provinceOwners]);

  useEffect(() => {
    const model = modelRef.current;
    if (model === undefined) {
      return;
    }
    model.selectedProvinceId = props.selectedProvinceId;
    setSelected(
      props.selectedProvinceId === undefined
        ? undefined
        : model.findProvince(props.selectedProvinceId)
    );
    scheduleDraw();
  }, [props.selectedProvinceId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const resize = (): void => {
      const model = modelRef.current;
      if (model === undefined) {
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      dprRef.current = ratio;
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      model.viewport.width = width;
      model.viewport.height = height;
      scheduleDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [loadState]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== undefined) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    canvasRef.current?.setPointerCapture(event.pointerId);
    interactiveRef.current = true;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const model = modelRef.current;
    if (canvas === null || model === undefined) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag !== undefined && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        drag.moved = true;
      }
      panViewport(model.viewport, dx, dy);
      drag.x = event.clientX;
      drag.y = event.clientY;
      scheduleDraw();
      return;
    }
    const [lon, lat] = unprojectFromScreen(
      event.clientX - rect.left,
      event.clientY - rect.top,
      model.viewport
    );
    const feature = model.hitTest(lon, lat);
    if (feature?.id !== model.hoveredProvinceId) {
      model.hoveredProvinceId = feature?.id;
      setHovered(feature);
      scheduleDraw();
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const model = modelRef.current;
    const drag = dragRef.current;
    if (canvas === null || model === undefined || drag === undefined) {
      return;
    }
    if (drag.pointerId !== event.pointerId) {
      return;
    }
    canvas.releasePointerCapture(event.pointerId);
    dragRef.current = undefined;
    interactiveRef.current = false;
    if (drag.moved) {
      scheduleDraw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const [lon, lat] = unprojectFromScreen(
      event.clientX - rect.left,
      event.clientY - rect.top,
      model.viewport
    );
    const feature = model.hitTest(lon, lat);
    model.selectedProvinceId = feature?.id;
    setSelected(feature);
    props.onSelectProvince?.(feature?.id, feature);
    scheduleDraw();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const model = modelRef.current;
    if (canvas === null || model === undefined) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    interactiveRef.current = true;
    zoomViewportAt(
      model.viewport,
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.deltaY < 0 ? 1.12 : 1 / 1.12
    );
    scheduleDraw();
    window.setTimeout(() => {
      interactiveRef.current = false;
      scheduleDraw();
    }, 120);
  };

  const displayCountry =
    resolveFeatureOwner(modelRef.current, selected, props.provinceOwners) !== "—"
      ? resolveFeatureOwner(modelRef.current, selected, props.provinceOwners)
      : resolveFeatureOwner(modelRef.current, hovered, props.provinceOwners);

  return (
    <section
      className={props.fill === true ? "map-panel map-panel-fill" : "map-panel"}
      aria-label="世界地图"
    >
      {props.fill === true ? null : (
        <div className="map-toolbar">
          <div>
            <p className="label">地图包</p>
            <strong>{mapId}</strong>
          </div>
          <div>
            <p className="label">悬停</p>
            <strong>{provinceLabel(hovered)}</strong>
          </div>
          <div>
            <p className="label">选中</p>
            <strong>{provinceLabel(selected)}</strong>
          </div>
          <div>
            <p className="label">国家</p>
            <strong>{displayCountry}</strong>
          </div>
        </div>
      )}
      <div className="map-stage">
        <canvas
          ref={canvasRef}
          className="map-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        />
        {loadState === "loading" ? <p className="map-overlay">正在加载世界地图…</p> : null}
        {loadState === "error" ? (
          <p className="map-overlay map-overlay-error">{errorMessage}</p>
        ) : null}
        {props.fill === true && hovered !== undefined ? (
          <div className="map-tooltip">
            <strong>{provinceLabel(hovered)}</strong>
            <span>{resolveFeatureOwner(modelRef.current, hovered, props.provinceOwners)}</span>
          </div>
        ) : null}
      </div>
      {props.fill === true ? null : <p className="map-hint">拖拽平移 · 滚轮缩放 · 点击选择省份</p>}
    </section>
  );
}
