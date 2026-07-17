"use client";

// Vehicle (truck) profiles for the Truck Map. Loads the carrier's trucks from
// the API and tracks the "active" one — the profile fed to the truck routing
// engine so routes come back legal for the rig. The active choice is persisted
// in localStorage so it survives reloads; if the stored id is gone (deleted on
// another device) we fall back to the carrier default, then the first truck.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Truck, type TruckInput, type VehicleProfile } from "@/lib/api";

const ACTIVE_KEY = "aifc_active_truck";

function readStoredActive(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}
function writeStoredActive(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_KEY);
}

export function truckToProfile(t: Truck | null): VehicleProfile | undefined {
  if (!t) return undefined;
  return {
    heightIn: t.heightIn,
    widthIn: t.widthIn,
    lengthIn: t.lengthIn,
    weightLbs: t.weightLbs,
    axles: t.axles,
    hazmatClass: t.hazmatClass,
  };
}

export interface VehicleProfilesState {
  trucks: Truck[];
  active: Truck | null;
  activeProfile: VehicleProfile | undefined;
  loading: boolean;
  error: string | null;
  setActiveId: (id: string) => void;
  refresh: () => Promise<void>;
  create: (body: TruckInput) => Promise<Truck | null>;
  update: (id: string, body: TruckInput) => Promise<Truck | null>;
  remove: (id: string) => Promise<void>;
}

export function useVehicleProfiles(): VehicleProfilesState {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.trucks();
      setTrucks(res.trucks);
    } catch (e: any) {
      setError(e?.message || "Could not load trucks");
      setTrucks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveIdState(readStoredActive());
    void refresh();
  }, [refresh]);

  // Resolve the active truck: stored id → carrier default → first truck.
  const active = useMemo(() => {
    if (!trucks.length) return null;
    const byStored = activeId ? trucks.find((t) => t.id === activeId) : null;
    if (byStored) return byStored;
    return trucks.find((t) => t.isDefault) ?? trucks[0];
  }, [trucks, activeId]);

  // Keep storage aligned with the resolved active truck.
  useEffect(() => {
    if (active && active.id !== activeId) {
      setActiveIdState(active.id);
      writeStoredActive(active.id);
    }
  }, [active, activeId]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    writeStoredActive(id);
  }, []);

  const create = useCallback(
    async (body: TruckInput) => {
      try {
        const truck = await api.addTruck(body);
        await refresh();
        setActiveId(truck.id);
        return truck;
      } catch (e: any) {
        setError(e?.message || "Could not add truck");
        return null;
      }
    },
    [refresh, setActiveId],
  );

  const update = useCallback(
    async (id: string, body: TruckInput) => {
      try {
        const truck = await api.updateTruck(id, body);
        await refresh();
        return truck;
      } catch (e: any) {
        setError(e?.message || "Could not update truck");
        return null;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.removeTruck(id);
        if (activeId === id) {
          setActiveIdState(null);
          writeStoredActive(null);
        }
        await refresh();
      } catch (e: any) {
        setError(e?.message || "Could not remove truck");
      }
    },
    [activeId, refresh],
  );

  return {
    trucks,
    active,
    activeProfile: truckToProfile(active),
    loading,
    error,
    setActiveId,
    refresh,
    create,
    update,
    remove,
  };
}
