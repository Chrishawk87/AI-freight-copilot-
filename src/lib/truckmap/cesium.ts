"use client";

// ---------------------------------------------------------------------------
// CesiumJS loader + viewer factory for the Truck Map module.
//
// Cesium (Apache-2.0) is loaded from the jsDelivr CDN — same pattern the
// MapLibre LiveMap uses — so there's no npm install or webpack/worker config to
// maintain. We pin the major range so we always get the latest stable 1.x.
//
// Imagery has two modes behind one factory:
//   • "ion"  — a Cesium Ion token is present (NEXT_PUBLIC_CESIUM_ION_TOKEN):
//              premium world imagery + World Terrain + geocoder.
//   • "open" — no token: token-free OpenStreetMap raster + a smooth ellipsoid.
// The Ion token is a public client token but still lives in an env var, never
// in source. Community Ion is non-commercial; a commercial product needs an
// Ion Commercial plan (see docs/truck-map-fuel-architecture.md §2).
// ---------------------------------------------------------------------------

const CESIUM_BASE = "https://cdn.jsdelivr.net/npm/cesium@1/Build/Cesium/";

let cesiumPromise: Promise<any> | null = null;

function loadCss(href: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${src}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("load error")));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.body.appendChild(s);
  });
}

export function ionToken(): string | null {
  return process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || null;
}

export function imageryMode(): "ion" | "open" {
  return ionToken() ? "ion" : "open";
}

/** Load the Cesium global once, wiring the Ion token if configured. */
export async function loadCesium(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("Cesium is browser-only");
  }
  const w = window as any;
  if (w.Cesium) return w.Cesium;
  if (!cesiumPromise) {
    w.CESIUM_BASE_URL = CESIUM_BASE;
    loadCss(CESIUM_BASE + "Widgets/widgets.css");
    cesiumPromise = loadScript(CESIUM_BASE + "Cesium.js").then(() => {
      const C = (window as any).Cesium;
      if (!C) throw new Error("Cesium failed to load");
      const token = ionToken();
      if (token) C.Ion.defaultAccessToken = token;
      return C;
    });
  }
  return cesiumPromise;
}

// Widgets we don't want on a driver-facing map — kept minimal + touch-friendly.
function baseViewerOptions(): any {
  return {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: false, // we attach imagery ourselves so "open" mode uses no Ion
  };
}

async function applyImagery(
  viewer: any,
  Cesium: any,
  mode: "ion" | "open",
): Promise<void> {
  const addOsm = () => {
    const osm = new Cesium.OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
    });
    viewer.imageryLayers.addImageryProvider(osm);
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  };

  if (mode === "open") {
    addOsm();
    return;
  }

  // Ion mode — premium imagery + world terrain, with a hard OSM fallback so a
  // bad/limited token never leaves the driver staring at a black globe.
  try {
    if (typeof Cesium.ImageryLayer?.fromWorldImagery === "function") {
      viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery({}));
    } else {
      addOsm();
      return;
    }
    if (typeof Cesium.createWorldTerrainAsync === "function") {
      viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
    }
  } catch {
    // Wipe any half-added layers, then fall back to token-free OSM.
    try {
      viewer.imageryLayers.removeAll();
    } catch {
      /* ignore */
    }
    addOsm();
  }
}

/**
 * Build a dark, driver-focused Cesium viewer on `container`. Created once by the
 * CesiumMap component; entities/cameras are then updated imperatively so the map
 * never tears down mid-drive.
 */
export async function createTruckViewer(
  container: HTMLElement,
  Cesium: any,
): Promise<any> {
  const viewer = new Cesium.Viewer(container, baseViewerOptions());

  // Dark globe + subtle atmosphere for the night-drive look.
  try {
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0B1220");
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0B1220");
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.enableLighting = false;
  } catch {
    /* cosmetic only */
  }

  await applyImagery(viewer, Cesium, imageryMode());
  return viewer;
}
