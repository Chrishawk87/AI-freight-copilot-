# AI Freight Co-Pilot — Button-by-Button Screen Map

A code-level reference of every interactive control in the app and what each one actually does. Traced from the frontend source (`src/app/**`, `src/components/**`, `src/lib/api.ts`). Endpoints shown are the concrete backend calls each control makes.

Legend: **→ route** = navigates · **api.x() → METHOD /path** = backend call · **state** = local UI state only · **⚠** = broken / stubbed / no-op.

---

## Global chrome (renders on every authenticated screen)

### Sidebar (desktop, ≥ lg)
Logo and every row are `Link`s. Order: Command Center → `/` · Opportunity Center → `/loads` · Profitability Engine → `/profit` · AI Dispatcher → `/dispatcher` · Deadhead Prevention → `/reloads` · Fuel Intelligence → `/fuel` · Truck Map → `/map` · Documents (BOL/POD) → `/documents` · Co-Pilot Memory → `/memory` · Plugin Engine → `/integrations` · Company Profile → `/profile`. Bottom "Hey Co-Pilot" button → `/dispatcher`.

### BottomNav (mobile)
Home → `/` · Loads → `/loads` · Map → `/map` · AI → `/dispatcher` · Fuel → `/fuel`. **More** button toggles a slide-up sheet (state). Inside the sheet: backdrop and X close it; Profit/Reloads/Documents/Memory/Plugins/Profile are links that also close the sheet.

### CoPilotWidget (floating, all screens except `/dispatcher`)
Bot FAB opens the panel (state). Panel header: Hands-free button toggles wake-word listening (`toggleHandsFree()`, shown only if browser supports speech-to-text); Volume button toggles spoken output (`toggleVoiceOut()`); X closes the panel. Body hosts the Co-Pilot conversation.

### CoPilotConversation (used in the widget and on `/dispatcher`)
Follow-up suggestion pills resend that text (`send(f)`). Text input updates state. Send submits the message → `api.copilotLlm()` → **POST /copilot/llm** (plus `api.ask()` → **POST /dispatcher/ask** for load suggestions). Can trigger map open/close/fullscreen via a UI event.

### LoadCard (used on `/`, `/loads`, `/reloads`)
**Book load** → `api.book(id)` → **POST /loads/{id}/book**, then disables and calls the parent's reload. **Place bid** opens the Bid modal. Bid modal: amount input (pre-filled rate × 1.08), message textarea, **Submit bid** → `api.bid(id, amount, message)` → **POST /loads/{id}/bid**; backdrop / X / post-success Close dismiss it.

### LiveMap
No own buttons — the pins it draws (fuel prices, rest areas, parking, weigh stations, services) are clickable and call back into the host screen to open a detail card.

---

## `/login`
Email + password inputs (state). **Sign in** → `api.login()` → **POST /auth/login**, stores JWT and redirects to `/`. **Create an account** → `/register`.

## `/register`
Name, company, email, password inputs + role select (state). **Create account** → `api.register()` → **POST /auth/register**, stores JWT → `/`. **Sign in** → `/login`.

---

## `/` — Command Center
- **Hey Co-Pilot** (header) → `/dispatcher`.
- **Today's Profit Plan** card:
  - Empty state: **Connect a load board** → `/integrations`.
  - With a plan: **Book this load** → `api.book(id)` → **POST /loads/{id}/book** (then shows "Booked"); **Navigate** → `/navigation`; **Ask Co-Pilot** → `/dispatcher`.
- **Find cheaper diesel** (savings card) → `/fuel`.
- Spend chart: display-only.
- **Share / Copy** (referral card): uses the native share sheet if available, else copies the referral code to clipboard.
- Quick links: Ask the Dispatcher → `/dispatcher` · Find Reloads → `/reloads` · Cheapest Diesel → `/fuel` · Best Loads Now → `/loads`.
- Booked loads (if any): trash icon → two-step confirm; **Remove** → `api.removeBooking(id)` → **DELETE /bookings/{id}**; **Cancel** reverts.
- Top opportunities: **View all** → `/loads`; each card is a LoadCard.

## `/loads` — Opportunity Center
- Equipment filter chips (All + one per type): set the client-side equipment filter (state).
- Sort buttons: **Best Overall / Net Profit / Rate/Mile / Least Deadhead** re-rank the list (state).
- Grid of LoadCards; booking reloads via `api.loads()` → **GET /loads**.

## `/reloads` — Deadhead Prevention
- Radius chips **25 / 50 / 100 / 150 / 200 mi**: client-side filter on deadhead miles (state). The fetch is always `api.reloads(200)` → **GET /loads/reloads?radius=200**.
- Grid of LoadCards.

## `/navigation` — Profit Navigation
- Address input + **Go** starts a route to the typed address (state; LiveMap computes it). **Clear** resets it.
- Load queue **select** switches which booked load is active (state).
- Map: fullscreen toggle; clicking fuel/POI pins opens a place card.
- Turn-by-turn banner: **Voice on / Muted** toggles spoken turn instructions.
- Place card (fuel or POI): **Go here** routes to that point; X closes.
- Arrival bar: **Exit** stops the route.
- Engine chips: **Live Map (OSM)** always available; **Trimble / Google / HERE** are enabled only if a key is connected in Plugin Engine (otherwise the click is a no-op).
- **Use my location** requests a GPS fix. **Accept / Release / Start route / Stop route** manage the trip (state).
- "Show nearby" toggles: Fuel / Rest areas / Truck parking / Weigh stations / Service areas show/hide those pins.
- Route settings toggles: Low bridge / Weight / Hazmat / Weather-aware.

**⚠ Issues**
- Low bridge, Weight, and Weather-aware toggles are visual only — they are never sent to any routing API. Only **Hazmat** is wired, and only for the Trimble engine; the default OSM/OSRM route ignores all four.
- Locked engine chips (Trimble/Google/HERE without a key) do nothing on click.
- `/navigation` is **not in the nav menu** (`nav.ts`). It's only reachable from the home "Navigate" button or a fuel station's "Go".

## `/map` — Truck Map
- Vehicle profile chip opens the "Your trucks" panel. **Following / Free** toggles camera-follow. GPS chip requests a fix.
- **Map / Fuel** tab switch.
- Map tab: start + destination address autocomplete (Photon); picking a destination or pressing **Go** routes via `api.route()` → **POST /truckmap/route**. Layer chips (Fuel / Parking / Rest Area / Weigh Station / Repair / Services) toggle markers.
- POI card: **Navigate** routes to it (`api.route()`); X closes. Turn banner **End route** clears it.
- Fuel panel: **Near me** → `api.fuelNearby()` → **GET /truckmap/fuel**; **Along route** (disabled without a route) → `api.fuelAlongRoute()` → **POST /truckmap/fuel/along-route**; Truck-friendly filter. Per station: **Report price** → input + **Submit** → `api.reportFuelPrice()` → **POST /truckmap/fuel/report**; **Go** routes to it. Fuel-plan builder: tank/current/mpg/reserve inputs + **Build fuel plan** → `api.fuelPlan()` → **POST /truckmap/fuel/plan**.
- Trucks panel: select a truck (active profile); pencil edits; trash → `api.removeTruck()` → **DELETE /truckmap/vehicles/{id}**; **Add a truck** opens the editor; **Save** → `api.addTruck()` (**POST**) or `api.updateTruck()` (**PATCH /truckmap/vehicles/{id}**).

## `/fuel` — Find Fuel
- GPS chip / **Enable GPS** requests a fix.
- Tabs **Nearby / Explore / Recent** re-sort the list (state). **Show favorites only** filters to starred stations.
- Per station: clicking the row highlights it on the map; **Star** toggles favorite (localStorage); **Go** → `/navigation?to=…&start=1` with the route auto-started.
- Savings slider (50–250 gal) recalculates estimated fill savings (state).

## `/dispatcher` — AI Co-Pilot
- **Brain live / Basic mode** opens a health popover (`api.copilotHealth()` → **GET /copilot/health**); **Re-check** refetches.
- **Hands-free** toggles wake-word listening; **Volume** toggles spoken output.
- Personality button opens a picker grid; choosing one switches Co-Pilot personality (state).
- Full-screen Co-Pilot conversation (see global chrome).

## `/documents` — Documents
- Doc-type chips: Rate Con / BOL / POD / Lumper / Fuel / Other (state).
- **Take a photo** / **Stored image or document** open the camera / file picker; selecting a file → `api.scanDocument()` → **POST /documents/scan**.
- "Link to booked load" select sets the booking to attach.
- History toggle **By job / All documents**.
- Job card: title row expands; **Email** opens the composer; **Package PDF / Download** → `api.jobPackage()` → **GET /documents/jobs/{jobId}/package** (browser download). Composer: doc checkboxes, To + message, **Send** → `api.emailJobPackage()` → **POST /documents/jobs/{jobId}/email**. Select all / Clear all toggle the selection.
- Review panel (BOL/POD): editable fields (state); **Save corrections** → `api.updateDocument()` → **PATCH /documents/{id}**; **Stage invoice** → `api.stageInvoice()` → **POST /documents/{id}/invoice**.
- Rate Con panel: editable fields; **Save corrections** → **PATCH /documents/{id}**; **Confirm & create load** → `api.confirmRateConLoad()` → **POST /documents/{id}/confirm-load**.

## `/profit` — Profitability Engine
- Left column: click a load row to load its detail (state). Detail panel is display-only.

**⚠ Issue:** no Book or Navigate action anywhere on this screen — it's read-only, with no way to act on the load you're analyzing.

## `/memory` — Co-Pilot Memory
- Tabs **What it knows about you / Freight knowledge base**.
- Memory tab: per entry, pin → `api.updateMemory()` → **PATCH /memory/{id}**; trash → `api.deleteMemory()` → **DELETE /memory/{id}** (no confirm). Add form → `api.addMemory()` → **POST /memory**.
- Knowledge tab: search input drives `api.knowledge()` → **GET /memory/knowledge**; **Add entry** → `api.addKnowledge()` → **POST /memory/knowledge**; category chips filter; carrier-added entries' trash → `api.deleteKnowledge()` → **DELETE /memory/knowledge/{id}** (no confirm).

**⚠ Issue:** memory and knowledge deletes fire immediately with no confirmation dialog.

## `/integrations` — Plugin Engine
- Search filters the plugin grid (state).
- Per plugin: toggle switch on → `api.connectPlugin()` → **POST /connections/{provider}/connect**; off → `api.disconnectPlugin()` → **POST /connections/{provider}/disconnect** (both fire-and-forget, persisted to localStorage). "How to set up" expands a guide; "Visit & sign up" is an external link.
- Plugins needing a key show an API-key field + **Save** (localStorage + connect). Plugins with an extra field (e.g. ElevenLabs Voice ID) work the same way.
- ElevenLabs card: **Test voice** calls the ElevenLabs API directly from the browser (not through the backend).

**⚠ Issue:** roughly half the ~60 plugins are marked "Coming soon"/"beta" with no real backend integration and (for many load boards) no public API. Their toggles still store a server-side connection record, but enabling them syncs no data. The UI labels this honestly, but the persisted record can mislead later debugging.

## `/profile` — Company Profile
- **Save changes** → `api.updateCarrier()` → **PUT /carrier**. **Sign out** clears the JWT and returns to `/login`.
- Company card: name / DOT / MC inputs; **Look up my DOT** → `api.lookupCarrier()` → **GET /carrier/lookup** (pre-fills from FMCSA; still needs Save).
- Email card: **Connect Gmail / Connect Outlook** → `api.startEmailOauth()` → **GET /carrier/email/oauth/{provider}/start** (redirects to consent). When connected, **Disconnect** → `api.disconnectEmailOauth()` → **POST /carrier/email/oauth/disconnect**. "Advanced" reveals SMTP/app-password fields + **Save email** → **PUT /carrier**.
- Compliance: insurance provider select (+ "Other" free text), expiry, W-9 on-file toggle (saved via Save changes).
- Equipment: per row trash → `api.removeEquipment()` → **DELETE /carrier/equipment/{id}**; **Add equipment** → `api.addEquipment()` → **POST /carrier/equipment**.
- Drivers: status chip cycles status → `api.updateDriver()` → **PATCH /carrier/drivers/{id}**; trash → `api.removeDriver()` → **DELETE /carrier/drivers/{id}**; **Add driver** → `api.addDriver()` → **POST /carrier/drivers**.
- Operating economics: Fleet MPG, fixed cost/mile, service areas (saved via Save changes).
- Usage card: read-only meters (`api.usage()` → **GET /usage**).

---

## Cross-app issues worth a fix pass
1. **Dead route-preference toggles** on `/navigation` (bridge/weight/weather) — either wire them into the OSM routing request or hide them so drivers don't trust a setting that does nothing.
2. **`/navigation` is unreachable from the menu** — add it to `nav.ts` or keep it intentionally hidden and document why.
3. **`/profit` has no action** — add a Book / Navigate button so the analysis screen can convert.
4. **Toggles that persist a connection for non-integrated plugins** — consider gating the connect call to plugins with a real backend so `/connections` records stay meaningful.
5. **Destructive actions with no confirm** — memory delete and knowledge delete delete instantly; consider matching the two-step confirm used on booked loads.
