# AI Freight Co-Pilot — Truck Map & Fuel Intelligence Module

**Architecture & Design Specification**
Version 1.0 · Prepared for Origin Management Solutions · July 2026

---

## 0. Executive summary

This document specifies a ground-up rebuild of the map and fuel experience in AI Freight Co-Pilot as a single **Truck Map & Fuel Intelligence** module intended to match or exceed Trucker Path and Truckstop for an owner-operator / small-fleet audience — without depending on either company's proprietary APIs.

The design uses **CesiumJS** as a 3D map engine, a **Next.js 14 + TypeScript** front end, a **NestJS 10 + PostgreSQL (PostGIS) + Redis** back end, and a **plugin framework** so data providers and AI capabilities can be swapped per-carrier without code changes. Every external data source in the baseline design is **free or open** (OpenStreetMap/Overpass, EIA, NWS/Open-Meteo, state 511/DOT feeds, OpenRouteService / self-hosted Valhalla). Paid providers (commercial diesel-price feeds, Trimble/HERE truck routing, fuel-card networks) are designed in as swappable adapters but are not required to ship.

The module replaces the current MapLibre-based Navigation and Fuel tabs.

### The 7 deliverables, mapped to sections

| # | Deliverable | Section |
|---|-------------|---------|
| 1 | Complete UI design | §3 |
| 2 | Database schema | §5 |
| 3 | API architecture | §6 |
| 4 | Component architecture | §4 |
| 5 | Data ingestion architecture | §7 |
| 6 | AI recommendation engine | §8 |
| 7 | Voice assistant integration | §9 |

---

## 1. Goals & design principles

The product target is parity-or-better with Trucker Path / Truckstop for a driver who owns 1–10 trucks. That drives five principles:

1. **Driver-first, glanceable UI.** Everything a driver needs while rolling — next turn, next legal parking, cheapest diesel on the lane — is reachable in one tap or one spoken sentence. Large touch targets, high-contrast dark theme, no dense tables in the cab view.
2. **Truck-accurate, not car-accurate.** Routing, POIs, and alerts respect vehicle profile (height, weight, length, axle count, hazmat class). A route that is illegal for an 80,000 lb rig is a bug, not a rounding error.
3. **Free/open baseline, paid-optional.** The app must run at zero marginal data cost so it scales to thousands of subscribers. Paid feeds improve accuracy but are adapters behind interfaces, never hard dependencies.
4. **Offline-tolerant.** Connectivity drops in freight corridors. The current route, the next several POIs, and the last known prices must survive a dead zone.
5. **Built for scale.** Redis caching, tiled/bounded queries, background ingestion, and per-carrier plugin state so one busy fleet never degrades another.

### Non-goals

Dispatch/TMS, ELD/HOS logging, and load-board sourcing already exist elsewhere in the app and are out of scope here except where the AI engine *reads* them (loads, P&L) to score decisions.

---

## 2. External data & service dependencies

This is the spine of the whole design, so it comes first. Every capability names a **free/open baseline** and an optional **paid upgrade adapter**.

### 2.1 Map engine & tiles — the Cesium Ion decision

**CesiumJS** (Apache-2.0) is free and open and can render entirely without a Cesium Ion account **if you supply your own imagery and terrain**. An Ion token unlocks Cesium World Terrain, Bing/photorealistic imagery, and the Ion geocoder — but the **free Ion "Community" tier is licensed for non-commercial / non-government use only**, and Bing imagery is capped (~1,000 sessions/month). A commercial subscriber product needs **Ion Commercial** (~$1,788/yr individual, ~$6,288/yr team at July-2026 pricing) *or* a token-free open-imagery configuration.

**Design decision:** introduce an `ImageryProvider` abstraction with two implementations from day one, selected by env/plugin config:

- `openBaseline` — token-free: OpenStreetMap raster (or MapTiler/OpenFreeMap raster) imagery + open-data terrain (e.g. flat ellipsoid or a self-hosted quantized-mesh terrain from public DEMs). $0, commercial-OK, scales.
- `cesiumIon` — Ion Commercial token: World Terrain + premium imagery + geocoder. Better visuals; billed.

Ship on `openBaseline`; flip a fleet to `cesiumIon` by dropping in a token. This keeps Chris's "thousands of subscribers" rule satisfiable at $0 while leaving the premium path one config change away. **Geocoding never depends on Ion** — see §2.6.

### 2.2 Truck POIs (fuel, parking, rest areas, weigh stations, repair)

**Baseline:** OpenStreetMap via the **Overpass API** (already in use). Categories map to OSM tags:

| POI | OSM query |
|-----|-----------|
| Fuel | `amenity=fuel` (+ `fuel:diesel`, `fuel:HGV_diesel`, `hgv=yes`) |
| Truck parking | `amenity=parking` + `hgv=yes`/`access=hgv` |
| Rest area | `highway=rest_area`, `highway=services` |
| Weigh station | `amenity=weighbridge`, `highway=weigh_station` |
| Repair facility | `shop=truck_repair`, `shop=car_repair`+`hgv=yes`, `craft=tyres` |

Overpass is rate-limited and not real-time, so all POIs are **ingested into our own PostGIS** on a schedule (§7) and served from there — Overpass is never on the request hot path.

**Paid upgrade adapter:** a commercial truck-POI dataset (600k+ facilities) can populate the same tables via a different ingestion adapter without touching the API or UI.

### 2.3 Diesel price intelligence

**Baseline:** U.S. EIA regional diesel averages (already integrated) as the price floor, optionally enriched with per-city averages via the existing Tavily scrape path. Station-level prices where OSM/user submissions provide them.

**Crowd-sourced layer:** driver price submissions (our own `PriceReport` table) — this is how Trucker Path/GasBuddy get station-level accuracy without a feed. Confidence-weighted and decayed over time (§8.1).

**Paid upgrade adapter:** a commercial diesel-price API (GasBuddy-style / fuel-card network feed) writes station-level `FuelPrice` rows via an adapter. Slot reserved, not required.

### 2.4 Fuel card discount support

No free network feed exists. Design a **`FuelCardProgram`** model holding per-network discount rules (cents-per-gallon off retail, or contract price by brand/location) that a carrier configures or that a paid card-network adapter (RTS, EFS, Comdata-style) populates. The optimizer (§8.2) treats discounted price as the real price. Baseline ships with manual/CSV discount entry; the network adapter is optional.

### 2.5 Routing (truck-legal)

**Baseline:** **OpenRouteService `driving-hgv`** profile (hosted free tier + self-hostable) which accepts vehicle `height`, `width`, `length`, `weight`, `axleload`, and `hazardous_material` restrictions and returns legal HGV routes with steps. For scale and no rate limits, **self-host Valhalla** (open source, truck costing model with the same dimensional/hazmat constraints) — this is the recommended production engine.

Free car routing (OSRM, current) remains the fallback when no vehicle profile is set. A `RoutingProvider` interface abstracts ORS / Valhalla / (paid) Trimble / HERE so a fleet needing certified PC\*Miler-grade routing can pay for it without a rewrite.

### 2.6 Geocoding & search

**Baseline:** Nominatim (OSM) for address search and reverse geocoding (already in use), fronted by our Redis cache and our own POI index for "nearest Love's" style queries. Never Ion-dependent.

### 2.7 Traffic, weather, construction

| Layer | Free/open baseline |
|-------|--------------------|
| Weather | **NWS api.weather.gov** (US, no key) + **Open-Meteo** (global, no key) for along-route forecast, alerts, radar tiles |
| Traffic | State **511 / DOT** open feeds and the national **Work Zone Data Exchange (WZDx)** for incidents & speeds; where coverage is thin, degrade gracefully |
| Construction | **WZDx** work-zone GeoJSON feeds (federal standard, many state DOTs publish it) |

All three are ingested to PostGIS/Redis (§7) and rendered as toggleable Cesium layers. Paid upgrade: HERE/TomTom real-time traffic adapter.

### 2.8 Dependency summary

Nothing in the baseline requires a paid contract or a proprietary Trucker Path/Truckstop API. The only *optional* paid line item to reach premium visuals is Cesium Ion Commercial; everything else has a free/open production path.

---

## 3. UI design (Deliverable 1)

### 3.1 Design language

Dark, high-contrast, cab-legible. One accent (electric blue `#246BFD`) for primary actions, semantic colors for status (green savings, amber caution, red restriction). Type scale bottoms out at 14px in the cab view; primary buttons are ≥56px tall (glove-friendly). The existing app tokens (`navy-900`, `electric`, `success`, `warning`) carry over so the module feels native.

### 3.2 Two layouts, one module

The module is **mobile-first** and responds into a desktop layout at ≥1024px. Same components, different chrome.

```
MOBILE (cab)                          DESKTOP (planning)
┌─────────────────────────┐          ┌───────────┬─────────────────────┐
│  ⌕ search / 🎙 voice     │          │  sidebar  │   ⌕ / 🎙   layers ▸  │
│                          │          │           │                     │
│      CESIUM 3D MAP       │          │  • Route  │                     │
│      (full-bleed)        │          │  • Fuel   │    CESIUM 3D MAP     │
│                          │          │  • Parking│                     │
│   ┌───────────────────┐  │          │  • Alerts │                     │
│   │ NEXT TURN banner  │  │          │  • Trip$  │   ┌──────────────┐   │
│   └───────────────────┘  │          │           │   │ detail card  │   │
│  [layers] [recenter][3D] │          │           │   └──────────────┘   │
│   ┌───────────────────┐  │          │           │                     │
│   │ bottom sheet      │  │          └───────────┴─────────────────────┘
│   │ (drag to expand)  │  │
│   └───────────────────┘  │
│  [ Map ] [ Fuel ] [ AI ] │
└─────────────────────────┘
```

**Mobile** is a full-bleed map with floating overlays: a top search/voice bar, a next-turn banner while navigating, a right-edge control stack (layers, recenter, 2D/3D tilt), and a **draggable bottom sheet** that is the primary surface for lists and detail cards (peek → half → full). A 3-item bottom tab switches the sheet's content between Map (POIs near you), Fuel (price-ranked list), and AI (recommendations & voice log).

**Desktop** promotes the bottom sheet to a persistent left sidebar and floats detail cards over the map. Layer controls become a top-right dropdown.

### 3.3 Core screens & states

**Map / navigation view.** Cesium map centered on the driver (blue heading cone). While a route is active: a route ribbon on the 3D terrain, a next-turn banner (maneuver icon + distance + street), an ETA/miles/arrival chip, and voice guidance. Idle: POIs for the enabled layers with the driver's vehicle profile applied (only truck-legal parking, HGV diesel, etc.).

**Layer control.** A panel of toggles, each with count and legend: Fuel, Truck parking, Rest areas, Weigh stations, Repair, Traffic, Weather, Construction. Toggles persist per user. On mobile it's a bottom-sheet grid of large toggle chips; on desktop a dropdown.

**Fuel view.** Price-ranked list (nearby / along-route / cheapest) with each station card showing brand badge, **discounted price if a fuel card is configured** (struck-through retail), distance, detour minutes if on a route, truck amenities (HGV lanes, DEF, showers, parking count), and a **Go** button. A route-fuel-optimization strip shows the recommended fill plan (§8.2). A savings calculator (gallons slider → $ saved vs. national).

**POI detail card.** Brand/name, category glyph, address, hours, amenities, truck-access flag, live/last-updated price, distance + detour, and actions: Navigate, Add as fuel stop, Report price/availability. Rest areas/weigh stations show status where crowd data exists.

**Voice view.** A large mic button, live transcript, the assistant's spoken/written reply, and a scrollable log of recent voice actions ("Found parking in 12 mi," "Cheapest diesel on your route is Love's, $3.71").

**Alerts.** Traffic/weather/construction incidents on the route surface as dismissible cards ordered by distance ahead, each mappable to a Cesium billboard.

### 3.4 3D & layer rendering in Cesium

- **Driver**: a `Entity` with a heading-aligned cone/model; camera chase mode (`trackedEntity` or manual `lookAt` with pitch) while navigating, free-orbit when idle. A 2D/3D button toggles pitch between 0° (top-down "map" feel) and ~55° (tilted "drive" feel).
- **Route**: a `PolylineGraphics` clamped to terrain (`clampToGround: true`) with a casing + core line, plus origin/destination billboards.
- **POIs**: clustered `Billboard`/`Label` entities per layer, brand-colored, declutter via Cesium's `EntityCluster`. Tap → detail card + camera `flyTo`.
- **Traffic/construction**: colored polylines / billboards from ingested GeoJSON; **weather**: raster overlay (radar tiles) + alert polygons.
- **Performance**: bound every query to the current view rectangle + zoom; request-render mode (`requestRenderMode: true`) to cut GPU/battery; cap entity counts with clustering. This is what keeps a 3D globe usable on a phone in a truck.

### 3.5 Accessibility & cab safety

Voice-first for anything done while moving; primary actions reachable one-handed in the thumb zone; motion-reduced option; the module can detect motion (speed from GPS) and auto-simplify the UI above ~5 mph (hide dense lists, enlarge the turn banner) — a "drive mode."

---

## 4. Component architecture (Deliverable 4)

### 4.1 Front-end stack

Next.js 14 App Router, TypeScript, Tailwind (existing tokens), CesiumJS loaded client-side only (`next/dynamic`, `ssr:false`) with the Cesium static assets served from `/public/cesium`. State via lightweight stores (Zustand or React context) plus TanStack Query for server data + caching; a thin WebSocket/SSE client for real-time updates (§10).

### 4.2 Route & tree

```
src/app/map/                         # the module (replaces /navigation & /fuel)
  page.tsx                           # MapModule shell: layout switch, providers
  layout.tsx

src/features/truckmap/
  MapModule.tsx                      # top-level: composes map + panels + voice
  providers/
    MapEngineProvider.tsx            # Cesium Viewer lifecycle, imagery/terrain provider
    VehicleProfileProvider.tsx       # height/weight/len/axles/hazmat for the active truck
    LayerStateProvider.tsx           # which layers on; persisted per user
    RealtimeProvider.tsx             # WS/SSE subscription fan-out

  map/
    CesiumViewer.tsx                 # builds Viewer once; exposes imperative ref
    DriverEntity.tsx                 # driver cone + chase camera
    RouteLayer.tsx                   # route polyline + O/D billboards + turn geometry
    PoiLayer.tsx                     # generic clustered POI layer (fuel/parking/…)
    TrafficLayer.tsx  WeatherLayer.tsx  ConstructionLayer.tsx
    LayerControl.tsx                 # toggles + legend + counts
    MapControls.tsx                  # recenter / 2D-3D / zoom
    useCesium.ts  useViewRectangle.ts  useClusteredEntities.ts

  nav/
    TurnBanner.tsx  EtaChip.tsx  ArrivalBar.tsx  RouteSettings.tsx  useNavigation.ts

  fuel/
    FuelPanel.tsx                    # nearby / along-route / cheapest tabs
    StationCard.tsx                  # brand, discounted price, amenities, Go
    FuelPlanStrip.tsx                # route fuel-optimization plan
    SavingsCalculator.tsx  useFuelPrices.ts  useFuelPlan.ts

  poi/
    BottomSheet.tsx                  # draggable peek/half/full (mobile)
    PoiList.tsx  PoiDetailCard.tsx  useNearbyPois.ts

  voice/
    VoiceButton.tsx  VoicePanel.tsx  TranscriptLog.tsx  useVoiceAssistant.ts

  ai/
    RecommendationCards.tsx          # fuel/parking/reload/profitability nudges
    ProfitabilityBadge.tsx  useRecommendations.ts

  alerts/
    AlertList.tsx  AlertCard.tsx  useRouteAlerts.ts

src/lib/truckmap/
  api.ts            # typed client for the NestJS module (§6)
  types.ts          # shared DTOs (Station, Poi, Route, Recommendation, …)
  cesium.ts         # imagery/terrain provider factory (open vs Ion)
  cluster.ts geo.ts # helpers
```

### 4.3 Key patterns

- **Build the Viewer once.** `CesiumViewer` creates the `Viewer` in an init effect and hands an imperative handle to children; layers/entities update via refs keyed on data signatures — never tear down the globe on a GPS tick (this is the fix for the "clunky" feel the current app had).
- **One generic `PoiLayer`.** Fuel/parking/rest/weigh/repair are the same component parameterized by category + style; keeps every pin consistent and kills the "green circle vs pink circle" inconsistency.
- **Vehicle profile is context.** Any query that needs truck-legality reads `VehicleProfileProvider`; changing trucks re-queries automatically.
- **Server-driven, cache-first.** Components ask the NestJS module (never Overpass/EIA directly). TanStack Query holds results; the Realtime provider invalidates on push.
- **Provider factory for imagery.** `cesium.ts#createImagery(config)` returns the open baseline or the Ion provider from a single config flag (§2.1).

---

## 5. Database schema (Deliverable 2)

PostgreSQL with the **PostGIS** extension for geospatial queries (nearest-neighbor, radius, along-route corridor) and a **GiST** index on every geometry column. Prisma manages the relational models; the raw `geometry`/`geography` columns are added via a migration and queried with `$queryRaw` where Prisma's spatial support is thin. Everything is scoped by `carrierId` for multi-tenant isolation, consistent with the existing app.

### 5.1 Entity overview

```
Carrier ─┬─< Truck (vehicle profile) ─< TripPlan >─ RouteLeg
         ├─< FuelCardProgram ─< FuelCardDiscount
         ├─< SavedPlace / Favorite
         └─< PriceReport (crowd) / PoiReport (crowd)

Poi ─┬─ (category: fuel|parking|rest_area|weigh_station|repair|services)
     ├─< FuelPrice        (for fuel POIs; retail by source+time)
     ├─< PoiAmenity       (showers, DEF, scales, HGV lanes, parking count)
     └─< PoiStatusReport  (crowd: parking full/open, scale open/closed)

RegionalDieselPrice      (EIA baseline, by PADD region + date)
TrafficIncident / WorkZone / WeatherAlert   (ingested, TTL'd)
Recommendation           (AI outputs, audit trail)
IngestionRun             (pipeline bookkeeping)
```

### 5.2 Prisma models (abridged)

```prisma
// Geospatial columns (geometry(Point,4326) / geometry(LineString,4326)) are
// added in a follow-up SQL migration with GiST indexes; shown here as comments.

model Poi {
  id            String       @id @default(cuid())
  source        String       // "osm" | "commercial" | "user"
  sourceId      String       // e.g. osm node id — unique per source
  category      PoiCategory
  name          String
  brand         String?      // normalized network (Love's, Pilot, TA, …)
  lat           Float
  lon           Float
  // geom        geometry(Point,4326)  <-- SQL migration, GiST indexed
  address       String?
  city          String?
  state         String?
  hoursRaw      String?      // OSM opening_hours
  hgv           Boolean      @default(false) // truck-accessible
  diesel        Boolean      @default(false)
  defAvailable  Boolean?
  parkingSpaces Int?
  amenities     PoiAmenity[]
  prices        FuelPrice[]
  statusReports PoiStatusReport[]
  lastSeenAt    DateTime     // ingestion freshness
  active        Boolean      @default(true)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  @@unique([source, sourceId])
  @@index([category, state])
}

enum PoiCategory { fuel parking rest_area weigh_station repair services }

model FuelPrice {
  id         String   @id @default(cuid())
  poiId      String
  poi        Poi      @relation(fields: [poiId], references: [id])
  fuelType   String   @default("diesel") // diesel | def
  price      Float    // retail $/gal
  source     String   // "eia_region" | "scrape" | "user" | "commercial"
  confidence Float    @default(0.5) // 0..1, decays with age (§8.1)
  reportedAt DateTime @default(now())
  @@index([poiId, fuelType, reportedAt])
}

model RegionalDieselPrice {
  id       String   @id @default(cuid())
  region   String   // PADD region key
  price    Float
  asOf     DateTime
  live     Boolean  @default(false)
  @@unique([region, asOf])
}

model Truck {
  id          String  @id @default(cuid())
  carrierId   String
  label       String
  heightIn    Int     // vehicle profile drives truck-legal routing (§2.5)
  widthIn     Int
  lengthIn    Int
  weightLbs   Int
  axles       Int
  hazmatClass String? // null = non-hazmat
  createdAt   DateTime @default(now())
  @@index([carrierId])
}

model FuelCardProgram {
  id         String  @id @default(cuid())
  carrierId  String
  network    String  // "RTS" | "EFS" | "Comdata" | custom
  active     Boolean @default(true)
  discounts  FuelCardDiscount[]
}

model FuelCardDiscount {
  id          String  @id @default(cuid())
  programId   String
  program     FuelCardProgram @relation(fields: [programId], references: [id])
  brand       String?  // null = all brands
  state       String?  // null = all states
  centsOff    Float?   // cpg off retail
  contractPrice Float? // absolute $/gal if contracted
  @@index([programId, brand, state])
}

model TripPlan {
  id          String     @id @default(cuid())
  carrierId   String
  loadId      String?    // links to existing Load for profitability (§8.3)
  originLat   Float
  originLon   Float
  destLat     Float
  destLon     Float
  vehicleId   String?
  profile     String     @default("driving-hgv")
  distanceMi  Float?
  durationHr  Float?
  geometry    Json?      // encoded route geometry (cache)
  legs        RouteLeg[]
  fuelPlan    Json?      // optimizer output (§8.2)
  createdAt   DateTime   @default(now())
  @@index([carrierId, createdAt])
}

model RouteLeg {
  id         String   @id @default(cuid())
  tripId     String
  trip       TripPlan @relation(fields: [tripId], references: [id])
  seq        Int
  text       String   // "Turn right onto I-40 E"
  road       String?
  distanceMi Float
  lat        Float
  lon        Float
}

model PriceReport {          // crowd-sourced diesel prices
  id         String   @id @default(cuid())
  poiId      String
  carrierId  String
  price      Float
  reportedAt DateTime @default(now())
  @@index([poiId, reportedAt])
}

model PoiStatusReport {      // crowd-sourced parking/scale status
  id         String   @id @default(cuid())
  poiId      String
  carrierId  String
  status     String   // "parking_full" | "parking_open" | "scale_open" | "scale_closed"
  reportedAt DateTime @default(now())
  @@index([poiId, reportedAt])
}

model TrafficIncident {
  id        String   @id @default(cuid())
  source    String   // "wzdx" | "state511"
  kind      String   // accident | congestion | closure
  lat       Float
  lon       Float
  geometry  Json?
  severity  Int
  startedAt DateTime
  expiresAt DateTime // TTL — pruned by ingestion
  @@index([expiresAt])
}

model WorkZone {  // construction — same shape, WZDx feed
  id        String   @id @default(cuid())
  sourceId  String   @unique
  lat       Float
  lon       Float
  geometry  Json?
  description String?
  startedAt DateTime
  expiresAt DateTime
}

model WeatherAlert {
  id        String   @id @default(cuid())
  source    String   // "nws"
  event     String   // "Winter Storm Warning"
  severity  String
  geometry  Json     // alert polygon
  startedAt DateTime
  expiresAt DateTime
}

model Recommendation {   // AI audit trail (§8)
  id        String   @id @default(cuid())
  carrierId String
  tripId    String?
  kind      String   // "fuel" | "parking" | "reload" | "profitability"
  payload   Json     // structured suggestion + reasons + score
  createdAt DateTime @default(now())
  @@index([carrierId, kind, createdAt])
}

model IngestionRun {
  id        String   @id @default(cuid())
  source    String   // "overpass" | "eia" | "wzdx" | "nws"
  status    String   // ok | partial | failed
  count     Int      @default(0)
  startedAt DateTime @default(now())
  finishedAt DateTime?
  note      String?
}
```

### 5.3 Spatial migration & key indexes

A raw SQL migration adds PostGIS and geometry columns with triggers to keep them in sync with `lat/lon`, then GiST indexes:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE "Poi" ADD COLUMN geom geometry(Point,4326);
UPDATE "Poi" SET geom = ST_SetSRID(ST_MakePoint(lon,lat),4326);
CREATE INDEX poi_geom_gix ON "Poi" USING GIST (geom);
-- nearest fuel to a point, truck-legal, freshest price:
-- SELECT * FROM "Poi" WHERE category='fuel' AND hgv
--   ORDER BY geom <-> ST_SetSRID(ST_MakePoint($lon,$lat),4326) LIMIT 40;
-- along-route corridor (5 mi buffer):
-- WHERE ST_DWithin(geom::geography, route_line::geography, 8046);
```

The `<->` KNN operator gives O(log n) nearest-neighbor; `ST_DWithin` on `geography` powers "fuel within N miles of my route."

---

## 6. API architecture (Deliverable 3)

### 6.1 Shape

A single NestJS feature area, `TruckMapModule`, composed of focused sub-modules, all behind the existing `JwtAuthGuard` and carrier scoping. Redis sits in front of every external call and every expensive spatial query.

```
server/src/truckmap/
  truckmap.module.ts
  poi/         poi.controller.ts   poi.service.ts        # /pois
  fuel/        fuel.controller.ts  fuel.service.ts       # /fuel  (prices, plan)
  routing/     routing.controller.ts routing.service.ts  # /route
  cards/       cards.controller.ts cards.service.ts      # /fuel-cards
  conditions/  conditions.controller.ts .service.ts      # /traffic /weather /construction
  recommend/   recommend.controller.ts .service.ts       # /recommend (AI, §8)
  voice/       voice.controller.ts voice.service.ts      # /voice (intent, §9)
  ingestion/   *.ingest.ts + scheduler (§7)
  providers/                                             # swappable adapters
    routing.provider.ts  (ORS | Valhalla | Trimble | HERE)
    imagery.config.ts    (open | ion)
    price.provider.ts    (eia | scrape | commercial)
    poi.provider.ts      (overpass | commercial)
  redis/redis.service.ts
```

### 6.2 Endpoints

| Method & path | Purpose | Cache |
|---|---|---|
| `GET /pois?lat&lon&radius&categories[]&hgv` | POIs near a point, filtered by layer + vehicle legality | Redis, key by geo-cell+filters, 5–15 min |
| `GET /pois/along-route?tripId&categories[]&bufferMi` | POIs in a corridor around a saved route | Redis, keyed by tripId |
| `GET /pois/:id` | Full detail card (amenities, hours, latest price, status) | Redis 5 min |
| `GET /fuel?lat&lon` | Price-ranked diesel nearby (discount-applied if card set) | Redis geo-cell 15 min |
| `GET /fuel/along-route?tripId` | Cheapest diesel along the lane | Redis by tripId |
| `POST /fuel/plan` | Route fuel-optimization plan (§8.2) | computed; result cached on TripPlan |
| `POST /fuel/report` | Crowd price submission | write-through, invalidates geo-cell |
| `GET /fuel-cards` · `POST /fuel-cards` · `POST /fuel-cards/:id/discounts` | Manage discount programs | — |
| `POST /route` | Truck-legal route for a vehicle profile (steps + geometry) | Redis by O/D+profile hash |
| `GET /traffic?bbox` · `GET /weather?bbox` · `GET /construction?bbox` | Condition layers in a bbox | Redis bbox 2–10 min |
| `GET /recommend?tripId&kind` | AI recommendations (fuel/parking/reload/profitability) | short TTL |
| `POST /voice/interpret` | NL utterance → intent + slots → action (§9) | — |
| `POST /poi/status` | Crowd status (parking full, scale open) | write-through |
| `GET /stream` (SSE) or `WS /rt` | Real-time push: price/status/alert deltas (§10) | — |

### 6.3 Caching & scale strategy

- **Geo-cell keys.** Point queries snap lat/lon to a ~0.1° grid so nearby drivers share cache entries (`pois:fuel:37.4,-122.1:hgv`). This is what lets the same query serve thousands of drivers in a metro from one computed result.
- **Two-layer cache.** Redis for hot reads (minutes-TTL), PostGIS as the durable store fed by ingestion (§7). External APIs (Overpass, EIA, ORS, NWS, WZDx) are **never** on the request path — only the ingestion workers touch them.
- **Route/plan memoization.** Routes cached by an O/D + vehicle-profile hash; fuel plans stored on the `TripPlan` and recomputed only when prices or the route change.
- **Rate & cost guards.** Reuse the existing usage-metering pattern to cap per-carrier voice/AI/route calls, protecting both cost and upstream rate limits.
- **Provider abstraction.** Each `providers/*.provider.ts` implements a narrow interface; switching a carrier from ORS to Valhalla, or open imagery to Ion, or EIA to a commercial price feed, is a config/DI change, not a rewrite. This is the plugin framework applied to data.

---

## 7. Data ingestion architecture (Deliverable 5)

The principle: **external sources are pulled into our own PostGIS/Redis by background workers; the API only ever reads our store.** This decouples user latency from third-party rate limits and outages, and is what makes the free/open sources viable at scale.

### 7.1 Workers & cadence

NestJS `@Cron` jobs (or a BullMQ queue on Redis for heavier fan-out), each an adapter behind a common `IngestionSource` interface writing an `IngestionRun` audit row:

| Worker | Source | Cadence | Writes |
|--------|--------|---------|--------|
| `overpass.ingest` | OSM Overpass, tiled by region | Weekly full + on-demand per active corridor | `Poi`, `PoiAmenity` (upsert by `source+sourceId`, stale → `active=false`) |
| `eia.ingest` | EIA regional diesel | Daily | `RegionalDieselPrice` |
| `price.enrich` | Scrape/commercial adapter | Hourly for active metros | `FuelPrice` |
| `wzdx.ingest` | Work Zone Data Exchange | 15 min | `WorkZone` (TTL prune) |
| `traffic.ingest` | State 511 / DOT | 5–15 min | `TrafficIncident` (TTL prune) |
| `nws.ingest` | NWS alerts | 15 min | `WeatherAlert` (TTL prune) |
| `crowd.rollup` | Our `PriceReport`/`PoiStatusReport` | 5 min | recomputes confidence-weighted `FuelPrice` + POI status |

### 7.2 Corridor-aware fetching

Full-planet Overpass is impractical. The ingester is **demand-driven**: when a `TripPlan` is created, its corridor (route buffer) is enqueued for a targeted Overpass/price refresh so the lane a driver is actually running is fresh, while the rest of the country refreshes on the slower weekly sweep. Popular metros stay warm via a rolling schedule.

### 7.3 Freshness, dedup, decay

- **Upsert by `(source, sourceId)`**; anything not seen in a full sweep is marked `active=false` (soft-remove, matching the app's existing load-sync pattern) rather than deleted, so a flaky Overpass response never wipes the map.
- **Price confidence decays with age**: a user report is high-confidence for hours, then decays toward the EIA regional baseline, so stale crowd data doesn't mislead the optimizer.
- **TTL layers** (traffic/weather/construction) self-prune on `expiresAt`.

### 7.4 Resilience

Every worker is idempotent, wrapped in try/catch with partial-success accounting, and degrades gracefully: if Overpass is down, the last good POIs stay live; if EIA is stale, prices show their `asOf`. Nothing user-facing hard-fails on an upstream outage.

---

## 8. AI recommendation engine (Deliverable 6)

A `RecommendModule` that combines **deterministic optimization** (the math that must be right — fuel cost, detour time, HOS-aware feasibility) with an **LLM reasoning layer** (the existing Claude brain) for natural-language explanation, ranking nuance, and voice replies. Every output is written to `Recommendation` for auditability. The engine reuses the app's knowledge base and per-carrier memory already wired into the Co-Pilot.

### 8.1 Price confidence model

Effective price for a station = the freshest, highest-confidence signal available, blended:

```
price_eff = Σ(source_i.price · w_i) / Σ(w_i)
w_i = base_confidence(source_i) · decay(age_i)
     sources: user report > commercial feed > city scrape > EIA regional
```

This yields station-level accuracy from crowd + open data without a paid feed, and falls back cleanly to the EIA regional average when nothing better exists.

### 8.2 Fuel optimization (cheapest nearby, cheapest along route, route fuel plan)

- **Cheapest nearby / along route** are PostGIS queries (KNN / corridor buffer) ranked by **discount-adjusted** `price_eff` and detour minutes, filtered to truck-legal (HGV) stations for the active vehicle.
- **Route fuel plan** is the flagship: given a route, tank capacity, current fuel level, and fuel-card discounts, solve *where and how many gallons to buy* to minimize total cost while never running dry and respecting range. Formulated as a shortest-path / greedy-with-lookahead problem over candidate stations along the corridor:

  ```
  minimize  Σ gallons_s · price_eff_discounted(s)
  subject to  fuel_level never < reserve between stops
              buy only at truck-legal stations on/near route
              tank capacity not exceeded
  ```

  A greedy "buy enough at the cheapest reachable station to reach the next cheaper one" heuristic gets near-optimal results fast and is explainable to the driver ("Fill 120 gal at Love's in Amarillo — it's $0.14/gal cheaper than anything for the next 180 mi"). The LLM turns the plan into that sentence and the voice reply.

- **Savings calculator** surfaces `(national_avg − price_eff_discounted) · gallons` per fill and per trip.

### 8.3 Profitability scoring

For a load/route, combine revenue (from the linked `Load`), estimated fuel cost (from the fuel plan), tolls, estimated time (truck ETA), and deadhead into a **$/mi net and a 0–100 score**, reusing the existing Trip P&L logic. Displayed as a `ProfitabilityBadge` on routes and loads; the LLM explains the drivers ("Good rate but 140 mi deadhead and a fuel-expensive lane pull this to 62/100").

### 8.4 Parking recommendations

Rank truck-parking POIs ahead on the route by: distance/time to reach vs. **HOS remaining** (if available from the app), historical/crowd fullness (`PoiStatusReport`), amenities, and safety. Proactively nudge ("You have 1:45 of drive time left; the last reliable parking before your clock runs out is Pilot at Exit 210 in 38 mi"). This is a headline Trucker Path use case and a top driver anxiety.

### 8.5 Reload intelligence

At/near delivery, suggest next loads that minimize deadhead and maximize $/mi from the destination, reading the existing load-board/opportunity feed. Scores each candidate on rate, deadhead to pickup, lane fuel cost, and fit to the truck; returns a ranked shortlist with reasons. Bridges the map module to the app's existing sourcing.

### 8.6 Engine flow

```
request → gather features (PostGIS spatial + Load/HOS/P&L context + prices)
        → deterministic solver (fuel plan / parking feasibility / profit math)
        → LLM layer (rank, explain, phrase for text + voice) with KB + carrier memory
        → persist Recommendation (audit) → return structured + spoken forms
```

Determinism owns the numbers; the LLM owns the words and the judgment calls. That split keeps recommendations trustworthy and debuggable.

---

## 9. Voice assistant integration (Deliverable 7)

Voice is the primary in-cab interface and reuses the app's existing voice stack (STT, wake word, barge-in, ElevenLabs TTS, the Claude brain) rather than reinventing it. The map module adds **map/fuel intents and actions**.

### 9.1 Pipeline

```
wake word / mic → STT (existing hook) → POST /voice/interpret
   → intent + slots (LLM classifier over the module's action schema)
   → dispatch to a typed action (route, find, plan, report, navigate, layer toggle)
   → execute (calls §6 endpoints / §8 engine)
   → TTS speaks the result + UI updates (map flyTo, sheet opens, layer on)
   → barge-in cancels TTS on new speech (existing behavior)
```

### 9.2 Intent catalog (map/fuel additions)

| Utterance example | Intent | Action |
|---|---|---|
| "Take me to 1200 Industrial Blvd, Dallas" | `navigate` | `/route` (truck profile) → start guidance |
| "Find cheap diesel near me" / "…on my route" | `find_fuel` | `/fuel` or `/fuel/along-route` → speak top 3, pin on map |
| "Where should I fuel up?" | `fuel_plan` | `/fuel/plan` → speak the fill plan |
| "Find truck parking ahead" | `find_parking` | `/recommend?kind=parking` → speak + pin |
| "Any weigh stations open ahead?" | `find_weigh` | `/pois/along-route?categories=weigh_station` + status |
| "What's the traffic / weather ahead?" | `conditions` | `/traffic` `/weather` on route → speak alerts |
| "Is this load worth it?" | `profitability` | `/recommend?kind=profitability` → speak score + why |
| "What should I haul next?" | `reload` | `/recommend?kind=reload` → speak shortlist |
| "Report this stop is full" / "diesel is $3.89 here" | `report` | `/poi/status` or `/fuel/report` |
| "Show me parking" / "hide traffic" | `layer_toggle` | flips `LayerStateProvider` |
| "Recenter" / "go 3D" | `map_control` | camera commands |

### 9.3 Design notes

- **Hands-free end-to-end.** Every headline task has a voice path that never needs the screen; replies are concise and speakable (top 3, not a table).
- **Context-aware slots.** "on my route," "ahead," "near me" resolve against the active `TripPlan` + live GPS, so the driver speaks naturally.
- **Confirmation for side effects.** Starting navigation or submitting a report gets a spoken confirm; passive queries don't.
- **Degrades to text.** Same intents work typed in the search bar when voice isn't wanted.

---

## 10. Real-time updates

- **Transport:** SSE for one-way pushes (price/status/alert deltas) with a WebSocket upgrade path for two-way (live fleet positions later). `RealtimeProvider` on the client fans events to TanStack Query cache invalidations so the map/list update without a manual refresh.
- **What's live:** crowd price/status submissions (a driver reporting a full lot updates every nearby driver within seconds), new traffic/weather/construction in the viewed bbox or active corridor, and the driver's own GPS-driven recompute (rerouting, next-turn, parking countdown).
- **Backpressure:** deltas are debounced and bbox/corridor-scoped so a client only receives events for what it's looking at or driving toward.

---

## 11. Migration plan (replaces current Nav + Fuel)

1. **Stand up the module behind a flag.** Build `src/app/map` + `TruckMapModule` alongside the existing MapLibre `/navigation` and `/fuel`, feature-flagged per carrier — nothing breaks during the build.
2. **Reuse what's proven.** The current EIA price service, Overpass helpers, geolocation hook, brand normalization, turn-by-turn maneuver phrasing, and the Claude voice stack port directly into the new modules/providers.
3. **PostGIS migration + backfill.** Add PostGIS, migrate `FuelStation`/POI data into the unified `Poi`/`FuelPrice` tables, run the first ingestion sweep.
4. **Cut over.** Point the bottom-nav Map/Fuel entries at `/map`; keep the old routes reachable for one release as a fallback, then remove Leaflet/MapLibre code paths.
5. **Provider config.** Ship on open imagery + ORS/Valhalla + EIA/crowd prices; document the one-flag flips to Ion / Trimble / commercial price feed.

No new user-facing regressions: the combined-map behavior we just built (route + fuel pins with cards + labeled POIs) is a subset of this design, so it carries forward.

---

## 12. Risks & open decisions

- **Cesium Ion licensing.** The free tier is non-commercial; a subscriber product needs open imagery (baseline) or Ion Commercial (~$1,788+/yr). Decision captured in §2.1 — ship open, flip to Ion when the visual upgrade is worth the line item. *Chris chose Ion; the abstraction lets us dev on a token and confirm the commercial license before public launch.*
- **Truck-routing accuracy.** ORS/Valhalla HGV routing is good but not PC\*Miler-certified. For hazmat/oversize legality guarantees, the Trimble/HERE adapter (paid) may be required for some fleets — designed in, not built.
- **OSM POI completeness.** Coverage varies; crowd reports + optional commercial POI adapter close the gap.
- **Traffic/construction coverage.** WZDx and 511 coverage is uneven by state; the layer degrades gracefully where feeds are thin.
- **Self-hosting Valhalla** adds ops (tile builds, updates); the hosted ORS free tier is the lower-effort start, Valhalla the scale answer.

---

## 13. Phased roadmap

| Phase | Scope | Outcome |
|-------|-------|---------|
| **P1 — Map core** | Cesium viewer (open imagery), driver + chase cam, unified `Poi` ingestion + PostGIS, layer control, POI cards | 3D truck map with all POI layers, cache-first |
| **P2 — Routing & nav** | ORS/Valhalla truck routing, turn-by-turn, vehicle profiles, along-route POIs | Truck-legal turn-by-turn navigation |
| **P3 — Fuel intelligence** | Price confidence model, cheapest nearby/route, fuel cards, route fuel plan, savings calc | Full fuel optimization with discounts |
| **P4 — AI & voice** | Recommendation engine (fuel/parking/profit/reload), voice intents, real-time crowd layer | Hands-free co-pilot; proactive nudges |
| **P5 — Conditions & polish** | Traffic/weather/construction layers, drive-mode auto-simplify, offline cache, provider flips (Ion/Trimble) | Parity-plus with Trucker Path/Truckstop |

Each phase is shippable behind the flag and independently verifiable (`npx tsc --noEmit` on both projects per the standing rule).

---

*End of specification. This is a design document — no application code has been changed. On approval, implementation proceeds phase by phase per §13, reusing the existing services called out in §11.*

