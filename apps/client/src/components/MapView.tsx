import { useEffect, useRef, useState } from "react";
import {
  createMapViewModel,
  loadMapPack,
  type ProvinceFeature
} from "@economic-simulator/map-runtime";

import {
  boundaryOwnerChanges,
  GlobeRenderer,
  provinceLabel,
  type GlobeRuntimeModel
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
    feature: ProvinceFeature | undefined
  ) => void;
}

type LoadState = "loading" | "ready" | "error";

function createOwnerLookup(
  model: GlobeRuntimeModel,
  provinceOwners: Readonly<Record<string, string>> | undefined
): (provinceId: string) => string | undefined {
  return (provinceId: string) => provinceOwners?.[provinceId] ?? model.getProvinceOwner(provinceId);
}

function resolveFeatureOwner(
  model: GlobeRuntimeModel | undefined,
  feature: ProvinceFeature | undefined,
  provinceOwners: Readonly<Record<string, string>> | undefined
): string {
  if (feature === undefined || model === undefined) return "—";
  return createOwnerLookup(model, provinceOwners)(feature.id) ?? "—";
}

export function MapView(props: MapViewProps): React.JSX.Element {
  const mapId = props.mapId ?? "world-modern";
  const baseUrl = props.baseUrl ?? "/maps";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<GlobeRuntimeModel | undefined>(undefined);
  const globeRef = useRef<GlobeRenderer | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | undefined>(
    undefined
  );
  const rafRef = useRef<number | undefined>(undefined);
  const loopingRef = useRef(false);
  const lastFrameTimeRef = useRef<number | undefined>(undefined);
  const ownersRef = useRef<Readonly<Record<string, string>> | undefined>(props.provinceOwners);
  const previousOwnersRef = useRef<Readonly<Record<string, string>> | undefined>(undefined);
  ownersRef.current = props.provinceOwners;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<ProvinceFeature | undefined>(undefined);
  const [selected, setSelected] = useState<ProvinceFeature | undefined>(undefined);
  const [contextEpoch, setContextEpoch] = useState(0);

  const scheduleDraw = (): void => {
    if (loopingRef.current || rafRef.current !== undefined) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = undefined;
      globeRef.current?.render();
    });
  };

  const stopAnimationLoop = (): void => {
    if (rafRef.current !== undefined) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    loopingRef.current = false;
    lastFrameTimeRef.current = undefined;
  };

  const startAnimationLoop = (): void => {
    if (loopingRef.current) return;
    if (rafRef.current !== undefined) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    loopingRef.current = true;
    lastFrameTimeRef.current = undefined;
    const loop = (time: number): void => {
      const globe = globeRef.current;
      if (globe === undefined) {
        rafRef.current = undefined;
        loopingRef.current = false;
        lastFrameTimeRef.current = undefined;
        return;
      }
      const lastTime = lastFrameTimeRef.current ?? time;
      lastFrameTimeRef.current = time;
      // Planar map lines don't need a time step; advance view and let the controller decide.
      // Keeping the clamp logic locally avoids changing the frame loop structure.
      void Math.min((time - lastTime) / 1000, 0.05);
      const animating = globe.update();
      globe.render();
      if (animating || dragRef.current !== undefined) {
        rafRef.current = window.requestAnimationFrame(loop);
      } else {
        rafRef.current = undefined;
        loopingRef.current = false;
        lastFrameTimeRef.current = undefined;
      }
    };
    rafRef.current = window.requestAnimationFrame(loop);
  };

  useEffect(() => {
    let cancelled = false;
    let createdGlobe: GlobeRenderer | undefined;
    setLoadState("loading");
    setErrorMessage(undefined);
    setHovered(undefined);

    void loadMapPack(`${baseUrl}/${mapId}`)
      .then((pack) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (canvas === null) throw new Error("地图画布不可用。");
        const model = createMapViewModel(pack, {
          getProvinceOwner: (provinceId) => ownersRef.current?.[provinceId]
        }) as GlobeRuntimeModel;
        modelRef.current = model;
        if (props.selectedProvinceId !== undefined) {
          model.selectedProvinceId = props.selectedProvinceId;
          setSelected(model.findProvince(props.selectedProvinceId));
        }
        createdGlobe = new GlobeRenderer(
          canvas,
          model,
          createOwnerLookup(model, ownersRef.current),
          scheduleDraw
        );
        if (cancelled) {
          createdGlobe.dispose();
          return;
        }
        globeRef.current = createdGlobe;
        createdGlobe.setSelected(model.selectedProvinceId);
        previousOwnersRef.current = ownersRef.current;
        setLoadState("ready");
        scheduleDraw();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : "平面地图加载失败。");
      });

    return () => {
      cancelled = true;
      if (globeRef.current === createdGlobe) globeRef.current = undefined;
      if (modelRef.current !== undefined) modelRef.current = undefined;
      createdGlobe?.dispose();
    };
  }, [baseUrl, mapId, contextEpoch]);

  useEffect(() => {
    const model = modelRef.current;
    const globe = globeRef.current;
    if (model === undefined || globe === undefined) return;
    const changed = boundaryOwnerChanges(previousOwnersRef.current, props.provinceOwners);
    globe.updateOwners(createOwnerLookup(model, props.provinceOwners), changed);
    previousOwnersRef.current = props.provinceOwners;
  }, [props.provinceOwners]);

  useEffect(() => {
    const model = modelRef.current;
    if (model === undefined) return;
    model.selectedProvinceId = props.selectedProvinceId;
    const feature =
      props.selectedProvinceId === undefined
        ? undefined
        : model.findProvince(props.selectedProvinceId);
    setSelected(feature);
    globeRef.current?.setSelected(props.selectedProvinceId);
  }, [props.selectedProvinceId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || loadState !== "ready") return;
    const resize = (): void => globeRef.current?.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [loadState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || loadState !== "ready") return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(event.deltaY * 0.0015);
      globeRef.current?.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [loadState]);

  useEffect(() => {
    return () => {
      stopAnimationLoop();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const lost = (event: Event): void => {
      event.preventDefault();
      setLoadState("error");
      setErrorMessage("WebGL 上下文已丢失，正在等待恢复…");
    };
    const restored = (): void => setContextEpoch((value) => value + 1);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, []);

  const localPointer = (
    event: React.PointerEvent<HTMLCanvasElement>
  ): readonly [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const updateHover = (feature: ProvinceFeature | undefined): void => {
    const model = modelRef.current;
    if (model === undefined || feature?.id === model.hoveredProvinceId) return;
    model.hoveredProvinceId = feature?.id;
    globeRef.current?.setHovered(feature?.id);
    setHovered(feature);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
    const [x, y] = localPointer(event);
    globeRef.current?.beginDrag(x, y);
    startAnimationLoop();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const globe = globeRef.current;
    if (globe === undefined) return;
    const drag = dragRef.current;
    if (drag !== undefined && drag.pointerId === event.pointerId) {
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 2) {
        drag.moved = true;
      }
      const [x, y] = localPointer(event);
      globe.drag(x, y);
      return;
    }
    const [x, y] = localPointer(event);
    updateHover(globe.pick(x, y));
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const globe = globeRef.current;
    const model = modelRef.current;
    const drag = dragRef.current;
    if (
      globe === undefined ||
      model === undefined ||
      drag === undefined ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    globe.endDrag();
    dragRef.current = undefined;
    startAnimationLoop();
    if (drag.moved) return;
    const [x, y] = localPointer(event);
    const feature = globe.pick(x, y);
    model.selectedProvinceId = feature?.id;
    globe.setSelected(feature?.id);
    setSelected(feature);
    props.onSelectProvince?.(feature?.id, feature);
  };

  const onPointerLeave = (): void => {
    if (dragRef.current === undefined) updateHover(undefined);
  };

  const displayCountry =
    resolveFeatureOwner(modelRef.current, selected, props.provinceOwners) !== "—"
      ? resolveFeatureOwner(modelRef.current, selected, props.provinceOwners)
      : resolveFeatureOwner(modelRef.current, hovered, props.provinceOwners);

  return (
    <section
      className={props.fill === true ? "map-panel map-panel-fill" : "map-panel"}
      aria-label="世界平面地图"
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
          onPointerLeave={onPointerLeave}
          onContextMenu={(event) => event.preventDefault()}
        />
        {loadState === "loading" ? <p className="map-overlay">正在加载世界平面地图…</p> : null}
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
