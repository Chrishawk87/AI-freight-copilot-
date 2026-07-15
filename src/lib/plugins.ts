// Per-client plugin state. A driver connects the apps they already use, and any
// API keys they enter are stored on their own device. The Maps section reads this
// to automatically switch to a provider the client has connected (e.g. Trimble).

export const PLUGINS_KEY = "aifc_plugins";
export const PLUGIN_KEYS_KEY = "aifc_plugin_keys";

export type EnabledMap = Record<string, boolean>;
export type KeyMap = Record<string, string>;

// Map providers that can power the Navigation screen when the client supplies a key.
// Order = priority when more than one is connected.
export const KEYED_MAP_PROVIDERS = ["trimble", "googlemaps", "herewego"] as const;
export type KeyedMapProvider = (typeof KEYED_MAP_PROVIDERS)[number];

export function readEnabled(): EnabledMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PLUGINS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function readKeys(): KeyMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PLUGIN_KEYS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeKeys(keys: KeyMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLUGIN_KEYS_KEY, JSON.stringify(keys));
}

// Which map engine should this client see? First connected provider that has a key,
// otherwise the free OpenStreetMap engine that works for everyone.
export function resolveMapEngine(enabled: EnabledMap, keys: KeyMap): string {
  for (const id of KEYED_MAP_PROVIDERS) {
    if (enabled[id] && keys[id]?.trim()) return id;
  }
  return "osm";
}
