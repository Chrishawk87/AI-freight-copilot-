"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin, X } from "lucide-react";
import { searchAddresses, type AddressSuggestion } from "@/components/LiveMap";
import type { LatLon } from "@/lib/geolocation";

// ---------------------------------------------------------------------------
// Address field with live dropdown suggestions (free OpenStreetMap Nominatim).
// As the driver types we debounce a US-biased search and show matches; picking
// one resolves exact coordinates so routing never depends on a lucky free-text
// geocode. The Start field can also offer a "Use my location" shortcut.
// ---------------------------------------------------------------------------

type Props = {
  value: string;
  onChange: (text: string) => void;
  // Fired when the driver picks a suggestion (exact coordinates resolved).
  onSelect: (coords: LatLon, label: string) => void;
  placeholder?: string;
  icon?: "start" | "dest";
  // When set, shows a "Use my location" row at the top of the dropdown.
  onUseMyLocation?: () => void;
  onClear?: () => void;
  onEnter?: () => void;
};

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  icon = "dest",
  onUseMyLocation,
  onClear,
  onEnter,
}: Props) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Skip the next search right after a pick so the dropdown doesn't reopen.
  const suppressRef = useRef(false);

  // Debounced search as the user types.
  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3 || q.toLowerCase() === "my location") {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const hits = await searchAddresses(q);
        setItems(hits);
        setOpen(true);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (s: AddressSuggestion) => {
    suppressRef.current = true;
    onChange(s.label);
    onSelect({ lat: s.lat, lon: s.lon }, s.label);
    setItems([]);
    setOpen(false);
  };

  const Icon = icon === "start" ? LocateFixed : MapPin;
  const iconColor = icon === "start" ? "text-emerald-400/70" : "text-white/40";

  return (
    <div ref={boxRef} className="relative">
      <Icon
        className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${iconColor}`}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (items.length || onUseMyLocation) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setOpen(false);
            onEnter?.();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-white/40 focus:border-electric"
      />
      {loading ? (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
      ) : value ? (
        <button
          onClick={() => {
            onClear?.();
            setItems([]);
            setOpen(false);
          }}
          aria-label="Clear"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-white/40 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {open && (onUseMyLocation || items.length > 0) && (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#0F1729] shadow-2xl">
          {onUseMyLocation && (
            <button
              onClick={() => {
                onUseMyLocation();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2.5 text-left text-sm text-emerald-300 hover:bg-white/5"
            >
              <LocateFixed className="h-4 w-4 flex-none" />
              Use my location
            </button>
          )}
          {items.map((s, i) => (
            <button
              key={`${s.lat},${s.lon},${i}`}
              onClick={() => pick(s)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-white/80 hover:bg-white/5"
            >
              <MapPin className="mt-0.5 h-4 w-4 flex-none text-white/40" />
              <span className="line-clamp-2">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
