import { useEffect, useRef, useState } from "react";
import type { LoadedMapPack } from "@economic-simulator/map-runtime";
import { createMapViewModel, type ProvinceFeature } from "@economic-simulator/map-runtime";

import {
  boundaryOwnerChanges,
  DEFAULT_MAP_LAYER_VISIBILITY,
  GlobeRenderer,
  provinceLabel,
  showProvinceBorders,
  type GlobeRuntimeModel,
  type MapLayerVisibility
} from "./map-renderer";
import { MapHoverCard } from "../ui/MapHoverCard";
import type { GameUiLookups, MapDisplayLookups } from "../ui/game-lookups";
import { sameSelection, selectionFromPick, type MapSelection } from "../ui/selection";

export interface MapViewProps {
  readonly pack: LoadedMapPack;
  readonly mapId?: string;
  readonly baseUrl?: string;
  readonly fill?: boolean;
  readonly selection?: MapSelection;
  readonly uiLookups?: GameUiLookups;
  readonly provinceOwners?: Readonly<Record<string, string>>;
  readonly onSelect?: (selection: MapSelection | undefined) => void;
  readonly onHoverChange?: (selection: MapSelection | undefined) => void;
  readonly onMapDisplayChange?: (lookups: MapDisplayLookups | undefined) => void;
}

type LoadState = "loading" | "ready" | "error";

type PointerPosition = { readonly x: number; readonly y: number };

function pointerSpread(
  pointers: ReadonlyMap<number, PointerPosition>
): { readonly distance: number; readonly x: number; readonly y: number } | undefined {
  const [first, second] = pointers.values();
  if (first === undefined || second === undefined) return undefined;
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function createOwnerLookup(
  provinceOwners: Readonly<Record<string, string>> | undefined,
  fallback?: (provinceId: string) => string | undefined
): (provinceId: string) => string | undefined {
  return (provinceId: string) => provinceOwners?.[provinceId] ?? fallback?.(provinceId);
}

function buildMapDisplay(model: GlobeRuntimeModel): MapDisplayLookups {
  return {
    findProvince: (id) => model.findProvince(id),
    getCountryName: (ownerId) => model.getCountryName(ownerId),
    getCountryGdpPpp: (ownerId) => model.getCountryAggregate(ownerId)?.gdpPpp
  };
}

function resolvePick(
  globe: GlobeRenderer,
  model: GlobeRuntimeModel | undefined,
  provinceOwners: Readonly<Record<string, string>> | undefined,
  feature: ProvinceFeature | undefined
): MapSelection | undefined {
  const owner =
    feature === undefined
      ? undefined
      : createOwnerLookup(provinceOwners, model?.getProvinceOwner.bind(model))(feature.id);
  return selectionFromPick(feature?.id, owner, showProvinceBorders(globe.getHalfHeight()));
}

export function MapView(props: MapViewProps): React.JSX.Element {
  const mapId = props.mapId ?? props.pack.manifest.id;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<GlobeRuntimeModel | undefined>(undefined);
  const globeRef = useRef<GlobeRenderer | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | undefined>(
    undefined
  );
  const pointersRef = useRef(new Map<number, PointerPosition>());
  const pinchRef = useRef<{ distance: number } | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const loopingRef = useRef(false);
  const lastFrameTimeRef = useRef<number | undefined>(undefined);
  const ownersRef = useRef<Readonly<Record<string, string>> | undefined>(props.provinceOwners);
  const previousOwnersRef = useRef<Readonly<Record<string, string>> | undefined>(undefined);
  const onMapDisplayChangeRef = useRef(props.onMapDisplayChange);
  const onHoverChangeRef = useRef(props.onHoverChange);
  ownersRef.current = props.provinceOwners;
  onMapDisplayChangeRef.current = props.onMapDisplayChange;
  onHoverChangeRef.current = props.onHoverChange;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<MapSelection | undefined>(undefined);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [layerVisibility, setLayerVisibility] = useState<MapLayerVisibility>(
    DEFAULT_MAP_LAYER_VISIBILITY
  );

  const publishMapDisplay = (next: MapDisplayLookups | undefined): void => {
    onMapDisplayChangeRef.current?.(next);
  };

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
    publishMapDisplay(undefined);

    const pack = props.pack;
    try {
      const canvas = canvasRef.current;
      if (canvas === null) throw new Error("Map canvas is unavailable.");
      const model = createMapViewModel(pack, {
        getProvinceOwner: (provinceId) => ownersRef.current?.[provinceId]
      }) as GlobeRuntimeModel;
      modelRef.current = model;
      createdGlobe = new GlobeRenderer(
        canvas,
        model,
        createOwnerLookup(ownersRef.current, model.getProvinceOwner.bind(model)),
        scheduleDraw
      );
      if (cancelled) {
        createdGlobe.dispose();
        return;
      }
      globeRef.current = createdGlobe;
      createdGlobe.setLayerVisibility(layerVisibility);
      if (props.selection !== undefined) {
        createdGlobe.setSelected(props.selection);
      }
      previousOwnersRef.current = ownersRef.current;
      publishMapDisplay(buildMapDisplay(model));
      setLoadState("ready");
      scheduleDraw();
    } catch (error: unknown) {
      if (cancelled) return;
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load the map.");
    }

    return () => {
      cancelled = true;
      if (globeRef.current === createdGlobe) globeRef.current = undefined;
      if (modelRef.current !== undefined) modelRef.current = undefined;
      createdGlobe?.dispose();
      publishMapDisplay(undefined);
    };
  }, [props.pack, contextEpoch]);

  useEffect(() => {
    const model = modelRef.current;
    const globe = globeRef.current;
    if (model === undefined || globe === undefined) return;
    const changed = boundaryOwnerChanges(previousOwnersRef.current, props.provinceOwners);
    globe.updateOwners(
      createOwnerLookup(props.provinceOwners, model.getProvinceOwner.bind(model)),
      changed
    );
    previousOwnersRef.current = props.provinceOwners;
  }, [props.provinceOwners]);

  useEffect(() => {
    globeRef.current?.setSelected(props.selection);
  }, [props.selection]);

  useEffect(() => {
    globeRef.current?.setLayerVisibility(layerVisibility);
  }, [layerVisibility]);

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
      setErrorMessage("WebGL context lost; waiting for restore…");
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

  const updateHover = (selection: MapSelection | undefined): void => {
    setHovered((current) => {
      if (sameSelection(selection, current)) return current;
      globeRef.current?.setHovered(selection);
      onHoverChangeRef.current?.(selection);
      return selection;
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const spread = pointerSpread(pointersRef.current);
    if (spread !== undefined) {
      dragRef.current = undefined;
      pinchRef.current = { distance: spread.distance };
      globeRef.current?.endDrag();
      return;
    }

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
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (globe === undefined) return;

    const spread = pointerSpread(pointersRef.current);
    if (spread !== undefined) {
      const pinch = pinchRef.current;
      if (pinch !== undefined && pinch.distance > 0 && spread.distance > 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        globe.zoomAt(spread.x - rect.left, spread.y - rect.top, pinch.distance / spread.distance);
        pinch.distance = spread.distance;
      }
      return;
    }

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
    updateHover(resolvePick(globe, modelRef.current, props.provinceOwners, globe.pick(x, y)));
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const remainingSpread = pointerSpread(pointersRef.current);
    pinchRef.current =
      remainingSpread === undefined ? undefined : { distance: remainingSpread.distance };
    if (remainingSpread !== undefined) return;

    const globe = globeRef.current;
    if (globe === undefined) return;

    const remaining = [...pointersRef.current.entries()][0];
    if (remaining !== undefined) {
      const [pointerId, position] = remaining;
      const rect = event.currentTarget.getBoundingClientRect();
      dragRef.current = { pointerId, x: position.x, y: position.y, moved: true };
      globe.beginDrag(position.x - rect.left, position.y - rect.top);
      return;
    }

    const drag = dragRef.current;
    if (drag === undefined || drag.pointerId !== event.pointerId) return;

    globe.endDrag();
    dragRef.current = undefined;
    startAnimationLoop();
    if (drag.moved) return;
    const [x, y] = localPointer(event);
    const selection = resolvePick(globe, modelRef.current, props.provinceOwners, globe.pick(x, y));
    globe.setSelected(selection);
    props.onSelect?.(selection);
  };

  const onPointerLeave = (): void => {
    if (dragRef.current === undefined) updateHover(undefined);
  };

  const hoverLookups = props.uiLookups;
  const displaySelection = props.selection ?? hovered;
  const layers: ReadonlyArray<readonly [keyof MapLayerVisibility, string]> = [
    ["labels", "名称"],
    ["capitals", "首府标点"],
    ["roads", "道路"],
    ["countryBorders", "国界"],
    ["provinceBorders", "省界"]
  ];

  return (
    <section
      className={props.fill === true ? "map-panel map-panel-fill" : "map-panel"}
      aria-label="World map"
    >
      {props.fill === true ? null : (
        <div className="map-toolbar">
          <div>
            <p className="label">Map pack</p>
            <strong>{mapId}</strong>
          </div>
          <div>
            <p className="label">Hover</p>
            <strong>
              {hovered === undefined
                ? "—"
                : hovered.kind === "province"
                  ? provinceLabel(modelRef.current?.findProvince(hovered.id))
                  : (hoverLookups?.getCountryName(hovered.id) ?? hovered.id)}
            </strong>
          </div>
          <div>
            <p className="label">Selected</p>
            <strong>
              {props.selection === undefined
                ? "—"
                : props.selection.kind === "province"
                  ? provinceLabel(modelRef.current?.findProvince(props.selection.id))
                  : (hoverLookups?.getCountryName(props.selection.id) ?? props.selection.id)}
            </strong>
          </div>
          <div>
            <p className="label">Level</p>
            <strong>{displaySelection?.kind ?? "—"}</strong>
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
        {loadState === "loading" ? <p className="map-overlay">Loading world map…</p> : null}
        {loadState === "error" ? (
          <p className="map-overlay map-overlay-error">{errorMessage}</p>
        ) : null}
        {props.fill === true ? <MapHoverCard selection={hovered} lookups={hoverLookups} /> : null}
        <fieldset
          className="map-layer-panel"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <legend>地图图层</legend>
          {layers.map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={layerVisibility[key]}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setLayerVisibility((current) => ({
                    ...current,
                    [key]: checked
                  }));
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
      {props.fill === true ? null : (
        <p className="map-hint">
          Drag to pan · scroll or pinch to zoom · click to select a province or country
        </p>
      )}
    </section>
  );
}
