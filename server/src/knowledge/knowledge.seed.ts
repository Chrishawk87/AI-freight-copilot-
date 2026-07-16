// ─────────────────────────────────────────────────────────────────────────────
// The Co-Pilot's shared freight knowledge base (the "subsurface").
//
// This is the industry knowledge every carrier rides on: trailer types, load
// types & sizes, truck classes, document types, what brokers require to onboard,
// what shippers require at the dock, roads/routes/regulations, and a bank of
// common driver questions with plain-spoken answers.
//
// It's seeded once per environment (scope="global") and read on demand with NO
// live Claude call, so the brain can answer these even in basic mode. Each row
// has a stable `seedKey` so re-seeding is idempotent (upsert, never duplicate).
// Drivers add their own entries on top over time (scope=carrierId).
//
// Content is written to be SPOKEN: short, concrete, real numbers. The persona
// layer re-voices it ("thirty-four thousand pounds", "eighty grand"). Keep facts
// accurate and general — nothing here is legal or safety advice, and rules like
// Hours of Service change, so answers point the driver at the official source
// (FMCSA / their ELD) for the binding version.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedEntry {
  seedKey: string;
  category:
    | 'trailers'
    | 'load-types'
    | 'trucks'
    | 'documents'
    | 'brokers'
    | 'shippers'
    | 'truck-stops'
    | 'routes'
    | 'regulations'
    | 'qa';
  subcategory?: string;
  topic: string;
  content: string;
  keywords: string; // comma-separated, lowercased for matching
}

export const KNOWLEDGE_SEED: SeedEntry[] = [
  // ── TRAILER TYPES ──────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-dry-van',
    category: 'trailers',
    subcategory: 'van',
    topic: 'Dry van',
    content:
      "The workhorse trailer — an enclosed box for freight that doesn't need temperature control. Standard is 53 feet long, about 8 feet 6 inches wide, roughly 9 feet of interior height, and holds around 45,000 pounds of payload. Loads through rear swing doors, usually onto a dock. Most common trailer on the road.",
    keywords: 'dry van, van, box trailer, 53 foot, enclosed, general freight',
  },
  {
    seedKey: 'trailer-reefer',
    category: 'trailers',
    subcategory: 'reefer',
    topic: 'Reefer (refrigerated)',
    content:
      "A dry van with a refrigeration unit up front that holds a set temperature — for produce, meat, dairy, frozen goods, and some pharma. Same 53-foot size but a bit less payload because the reefer unit and insulation add weight. Drivers watch the setpoint, run continuous vs cycle-sentry, and keep the reefer fueled. Pays more than dry van because of the extra hassle and the perishable risk.",
    keywords: 'reefer, refrigerated, temp control, produce, frozen, cold chain, setpoint',
  },
  {
    seedKey: 'trailer-flatbed',
    category: 'trailers',
    subcategory: 'flatbed',
    topic: 'Flatbed',
    content:
      'An open deck with no walls or roof — for freight that loads from the side or top by forklift or crane: lumber, steel, pipe, machinery, building materials. Standard deck is 48 or 53 feet. The driver secures and tarps the load themselves, so it takes more skill and gear (straps, chains, tarps). Pays well for that reason.',
    keywords: 'flatbed, flat, open deck, steel, lumber, tarps, straps, securement',
  },
  {
    seedKey: 'trailer-step-deck',
    category: 'trailers',
    subcategory: 'flatbed',
    topic: 'Step deck (drop deck)',
    content:
      'A flatbed with two levels — a short upper deck over the kingpin and a longer lower deck. The drop lets you haul taller freight and still stay under the legal 13 feet 6 inch height. Good for equipment and machinery that would be too tall on a straight flatbed.',
    keywords: 'step deck, drop deck, lowboy alternative, tall freight, machinery, two level',
  },
  {
    seedKey: 'trailer-lowboy-rgn',
    category: 'trailers',
    subcategory: 'flatbed',
    topic: 'Lowboy / RGN',
    content:
      'A very low deck for tall and heavy equipment — excavators, dozers, cranes. An RGN (removable gooseneck) detaches the front so the machine can drive right up onto the deck. This is heavy-haul territory; loads are often oversize or overweight and need permits.',
    keywords: 'lowboy, rgn, removable gooseneck, heavy haul, oversize, equipment, excavator',
  },
  {
    seedKey: 'trailer-conestoga',
    category: 'trailers',
    subcategory: 'flatbed',
    topic: 'Conestoga',
    content:
      'A flatbed with a rolling tarp system on a frame — it slides back like a curtain so you get flatbed side-loading without hand-tarping every load. Protects freight from weather with a lot less labor.',
    keywords: 'conestoga, rolling tarp, curtain side, flatbed, weather protection',
  },
  {
    seedKey: 'trailer-tanker',
    category: 'trailers',
    subcategory: 'tanker',
    topic: 'Tanker',
    content:
      'A tank for liquids or gases — fuel, chemicals, food-grade liquids, milk. Requires a tanker endorsement, and hazmat too if the product is hazardous. Liquid surge (the load sloshing) changes how the truck handles, especially braking and turns.',
    keywords: 'tanker, tank, liquid, fuel, chemical, surge, endorsement, hazmat',
  },
  {
    seedKey: 'trailer-hopper',
    category: 'trailers',
    subcategory: 'bulk',
    topic: 'Hopper bottom / pneumatic',
    content:
      'For dry bulk — grain, sand, cement, plastic pellets. A hopper bottom dumps through gates underneath by gravity; a pneumatic (dry bulk tanker) blows the product out with air pressure. Common in ag and construction lanes.',
    keywords: 'hopper, pneumatic, dry bulk, grain, cement, sand, pellets, ag',
  },
  {
    seedKey: 'trailer-power-only',
    category: 'trailers',
    subcategory: 'other',
    topic: 'Power only',
    content:
      "You bring just the tractor and pull someone else's loaded trailer — the shipper, broker, or a drop yard provides it. Popular with drop-and-hook freight and with carriers who don't want to own trailers.",
    keywords: 'power only, drop and hook, no trailer, tractor only',
  },
  {
    seedKey: 'trailer-car-hauler',
    category: 'trailers',
    subcategory: 'specialized',
    topic: 'Car hauler',
    content:
      'An open or enclosed multi-level trailer for moving vehicles. Loading and strapping each car takes time and skill; enclosed haulers pay more for high-value or classic cars.',
    keywords: 'car hauler, auto transport, vehicles, enclosed carrier',
  },

  // ── LOAD TYPES & SIZES ───────────────────────────────────────────────────────
  {
    seedKey: 'load-ftl',
    category: 'load-types',
    subcategory: 'size',
    topic: 'Full truckload (FTL)',
    content:
      'One shipper fills the whole trailer and it goes straight to the destination — no stops to combine freight. Simpler, faster, and what most of this app is built around. Priced per load or per mile.',
    keywords: 'ftl, full truckload, truckload, one shipper, direct',
  },
  {
    seedKey: 'load-ltl',
    category: 'load-types',
    subcategory: 'size',
    topic: 'Less-than-truckload (LTL)',
    content:
      "Freight too small to fill a trailer, so a carrier combines several shippers' pallets and routes them through terminals. Priced by weight, class, and space. More handling, more stops.",
    keywords: 'ltl, less than truckload, partial, pallets, freight class, terminal',
  },
  {
    seedKey: 'load-partial',
    category: 'load-types',
    subcategory: 'size',
    topic: 'Partial / volume load',
    content:
      "Bigger than LTL but not a full trailer — you might share the deck with one or two other loads. Good way to fill empty space and stack revenue on a lane you're already running.",
    keywords: 'partial, volume load, shared trailer, fill deck',
  },
  {
    seedKey: 'load-weight-limits',
    category: 'load-types',
    subcategory: 'weight',
    topic: 'Legal weight limits',
    content:
      'The federal gross vehicle weight limit is 80,000 pounds without special permits. That splits roughly into 12,000 pounds on the steer axle, 34,000 on the drive tandems, and 34,000 on the trailer tandems. A typical loaded van maxes payload around 44,000 to 45,000 pounds once you subtract the tractor and trailer. Anything over 80,000 needs an overweight permit.',
    keywords: 'weight, gvw, 80000, 80k, axle weight, overweight, permit, payload, scale',
  },
  {
    seedKey: 'load-dims',
    category: 'load-types',
    subcategory: 'size',
    topic: 'Legal size limits',
    content:
      'Standard legal maximums without a permit: about 8 feet 6 inches wide, 13 feet 6 inches tall, and a 53-foot trailer. Go past any of those and you are into oversize territory, which means permits, sometimes escort vehicles, and daytime-only travel in many states.',
    keywords: 'dimensions, width, height, 13 6, oversize, over dimensional, permit, escort',
  },
  {
    seedKey: 'load-hazmat',
    category: 'load-types',
    subcategory: 'special',
    topic: 'Hazmat loads',
    content:
      'Hazardous materials — flammables, corrosives, explosives, gases. Requires a hazmat endorsement on your CDL, proper placards, shipping papers, and emergency info in the cab. Pays a premium, and routing can be restricted (tunnels, bridges, cities).',
    keywords: 'hazmat, hazardous, placards, endorsement, dangerous goods, un number',
  },
  {
    seedKey: 'load-reefer-freight',
    category: 'load-types',
    subcategory: 'special',
    topic: 'Temperature-controlled freight',
    content:
      "Produce, meat, dairy, frozen, and some pharma. The rate con lists a required setpoint and whether it's continuous or cycle. Get the temp wrong or lose the reefer and the whole load can be rejected, so it's higher risk and higher pay.",
    keywords: 'reefer freight, temperature, setpoint, produce, frozen, perishable, cold chain',
  },

  // ── TRUCK / TRACTOR TYPES ────────────────────────────────────────────────────
  {
    seedKey: 'truck-sleeper',
    category: 'trucks',
    subcategory: 'tractor',
    topic: 'Sleeper cab',
    content:
      'A Class 8 tractor with a sleeping berth behind the seats — for over-the-road drivers who are out for days or weeks. Bigger, heavier, and where most long-haul freight runs.',
    keywords: 'sleeper, cab, class 8, over the road, otr, long haul, tractor',
  },
  {
    seedKey: 'truck-day-cab',
    category: 'trucks',
    subcategory: 'tractor',
    topic: 'Day cab',
    content:
      'A Class 8 tractor with no sleeper — for regional and local work where the driver goes home at night. Lighter than a sleeper, so a touch more payload.',
    keywords: 'day cab, regional, local, no sleeper, home daily',
  },
  {
    seedKey: 'truck-straight',
    category: 'trucks',
    subcategory: 'straight',
    topic: 'Straight truck / box truck',
    content:
      'The cab and cargo box are one unit on the same frame — no separate trailer. Common for local delivery, expedited, and smaller loads. Some need a CDL depending on weight; many box trucks under 26,000 pounds do not.',
    keywords: 'straight truck, box truck, cube, local delivery, expedite, non cdl',
  },
  {
    seedKey: 'truck-classes',
    category: 'trucks',
    subcategory: 'classification',
    topic: 'Truck weight classes',
    content:
      'Trucks are rated by gross vehicle weight rating. Class 8 is the heaviest — over 33,000 pounds — and covers the semis that pull 53-foot trailers. Classes 3 through 7 are medium-duty (box trucks, larger delivery trucks). The freight in this app is mostly Class 8 over-the-road.',
    keywords: 'truck class, class 8, gvwr, medium duty, heavy duty, semi',
  },

  // ── DOCUMENT TYPES ────────────────────────────────────────────────────────────
  {
    seedKey: 'doc-bol',
    category: 'documents',
    subcategory: 'proof',
    topic: 'Bill of Lading (BOL)',
    content:
      "The master shipping document — it's the contract of carriage, the receipt for the freight, and the description of what's on the trailer. Lists shipper, consignee, pieces, weight, and description. Signed at pickup. You don't get paid without a clean BOL, so guard it.",
    keywords: 'bol, bill of lading, shipping document, receipt, pieces, weight, pickup',
  },
  {
    seedKey: 'doc-pod',
    category: 'documents',
    subcategory: 'proof',
    topic: 'Proof of Delivery (POD)',
    content:
      "Usually the signed BOL after delivery — the receiver's signature proving the freight arrived and in what condition. This is the document that unlocks your invoice. Note any damage or shortage on it before you leave the dock.",
    keywords: 'pod, proof of delivery, signed, receiver, delivered, invoice unlock',
  },
  {
    seedKey: 'doc-rate-con',
    category: 'documents',
    subcategory: 'agreement',
    topic: 'Rate Confirmation (Rate Con)',
    content:
      'The broker\'s binding offer for a specific load — the agreed rate, pickup and delivery details, accessorials, and reference numbers. Once you sign it, it\'s the contract for that haul. In this app, scanning a rate con can stage a load and, once you confirm, spin up a real booking.',
    keywords: 'rate con, rate confirmation, broker offer, agreed rate, accessorials, booking',
  },
  {
    seedKey: 'doc-lumper',
    category: 'documents',
    subcategory: 'receipt',
    topic: 'Lumper receipt',
    content:
      "Proof you paid a lumper — a third-party crew that loads or unloads the trailer, common at grocery and food warehouses. The receipt lets you get reimbursed by the broker or shipper, so don't lose it.",
    keywords: 'lumper, receipt, unloading fee, grocery, warehouse, reimburse',
  },
  {
    seedKey: 'doc-scale-ticket',
    category: 'documents',
    subcategory: 'receipt',
    topic: 'Scale / weight ticket',
    content:
      "Your certified weight from a CAT scale or a shipper's scale. Proves you're legal before you hit a weigh station, and settles disputes over overweight loads. Reweigh after axle adjustments.",
    keywords: 'scale ticket, weight ticket, cat scale, certified weight, weigh station',
  },
  {
    seedKey: 'doc-packing-list',
    category: 'documents',
    subcategory: 'proof',
    topic: 'Packing list / manifest',
    content:
      "An itemized list of exactly what's in the shipment — SKUs, counts, sometimes values. The receiver checks freight against it. Useful when there's a shortage or overage claim.",
    keywords: 'packing list, manifest, itemized, sku, count, shortage, overage',
  },
  {
    seedKey: 'doc-invoice',
    category: 'documents',
    subcategory: 'billing',
    topic: 'Invoice / freight bill',
    content:
      'Your bill to the broker or shipper for the completed haul. Usually goes out with the signed POD and rate con attached. Factoring companies buy these invoices for quick cash instead of waiting 30 to 60 days.',
    keywords: 'invoice, freight bill, billing, factoring, get paid, net 30',
  },

  // ── WHAT BROKERS REQUIRE ──────────────────────────────────────────────────────
  {
    seedKey: 'broker-onboarding',
    category: 'brokers',
    subcategory: 'onboarding',
    topic: 'What a broker needs to set you up',
    content:
      'To onboard your carrier, most brokers want your MC and DOT numbers, active operating authority, a certificate of insurance naming them, a signed W-9, and a signed carrier packet or broker-carrier agreement. If you factor, they\'ll also need a notice of assignment so they pay the factor. Have a clean PDF of each ready and setup takes minutes.',
    keywords: 'broker setup, onboarding, mc number, dot number, authority, insurance, w9, carrier packet, notice of assignment',
  },
  {
    seedKey: 'broker-insurance',
    category: 'brokers',
    subcategory: 'requirements',
    topic: 'Insurance brokers expect',
    content:
      'Typical minimums are one million dollars in auto liability and around one hundred thousand dollars in cargo coverage, though high-value freight can ask for more. The broker usually wants to be listed as a certificate holder. Keep your COI current — an expired one stops you from booking.',
    keywords: 'insurance, auto liability, cargo, coi, certificate, one million, coverage',
  },
  {
    seedKey: 'broker-authority',
    category: 'brokers',
    subcategory: 'requirements',
    topic: 'Operating authority & safety rating',
    content:
      "Brokers check your authority is active and not revoked, and they look at your safety scores and how long you've been running. New authorities (under six months to a year) get more scrutiny and sometimes worse rates until you build a track record.",
    keywords: 'authority, mc active, safety rating, csa, new authority, track record',
  },
  {
    seedKey: 'broker-negotiation',
    category: 'brokers',
    subcategory: 'rates',
    topic: 'Negotiating with a broker',
    content:
      "Know the lane's going rate and your own cost per mile before you call. Ask what the load pays before you name a number, factor in deadhead to the pickup, and don't be afraid to counter. A fair, reliable carrier who communicates gets first call on the next load — the relationship is worth more than squeezing one rate.",
    keywords: 'negotiate, rate, counter, cost per mile, deadhead, relationship, book',
  },

  // ── WHAT SHIPPERS REQUIRE ─────────────────────────────────────────────────────
  {
    seedKey: 'shipper-appointment',
    category: 'shippers',
    subcategory: 'dock',
    topic: 'Appointments & check-in',
    content:
      "Most shippers and receivers run by appointment — a scheduled window to load or unload. Show up inside it. Late can mean a rescheduled day or a fee. At check-in you give the BOL or PO number, sometimes a pickup number, and follow the guard's dock instructions.",
    keywords: 'appointment, check in, window, dock, on time, pickup number, guard shack',
  },
  {
    seedKey: 'shipper-detention',
    category: 'shippers',
    subcategory: 'time',
    topic: 'Detention',
    content:
      "Shippers and receivers usually get about two hours free to load or unload. Past that, you're owed detention pay — but only if you documented your arrival and departure times and the broker approved it. Get in-and-out times signed or time-stamped, or you won't collect.",
    keywords: 'detention, free time, two hours, waiting, in out time, get paid waiting',
  },
  {
    seedKey: 'shipper-ppe',
    category: 'shippers',
    subcategory: 'dock',
    topic: 'PPE and dock rules',
    content:
      'Many facilities require personal protective equipment on the dock — a hi-vis safety vest, steel-toe boots, sometimes safety glasses and a hard hat. Some make you stay in a driver lounge while they load. Keep your PPE in the cab so a load never gets held up over a missing vest.',
    keywords: 'ppe, safety vest, steel toe, hard hat, dock rules, driver lounge',
  },
  {
    seedKey: 'shipper-seal',
    category: 'shippers',
    subcategory: 'security',
    topic: 'Trailer seals',
    content:
      "A numbered seal locks the trailer after loading; the seal number goes on the BOL. The receiver checks it's intact and matches before breaking it — proof the freight wasn't touched in transit. Never break a seal yourself unless instructed in writing.",
    keywords: 'seal, seal number, security, intact, tamper, bol seal',
  },
  {
    seedKey: 'shipper-touch',
    category: 'shippers',
    subcategory: 'dock',
    topic: 'Driver assist vs no-touch',
    content:
      "No-touch freight means the shipper's crew or a lumper loads and unloads — you just back in. Driver-assist or driver-unload means you help or do it yourself. Know which before you book, because it changes your time and effort, and driver-unload sometimes pays extra.",
    keywords: 'no touch, driver assist, driver unload, lumper, load unload, touch freight',
  },

  // ── TRUCK STOPS ────────────────────────────────────────────────────────────────
  {
    seedKey: 'stops-major-chains',
    category: 'truck-stops',
    subcategory: 'chains',
    topic: 'Major truck stop chains',
    content:
      "The big national chains are Pilot and Flying J (same company), Love's, and TA and Petro (TravelCenters of America). Regional favorites include Sapp Bros, Kwik Trip in the upper Midwest, and Buc-ee's in the South, though Buc-ee's has limited big-rig parking. All the majors have diesel, DEF, showers, food, and parking.",
    keywords: 'truck stop, pilot, flying j, loves, ta, petro, travelcenters, sapp bros, kwik trip',
  },
  {
    seedKey: 'stops-amenities',
    category: 'truck-stops',
    subcategory: 'amenities',
    topic: 'What truck stops offer',
    content:
      'Beyond fuel, expect showers (free with a fuel fill on most chains), CAT scales to weigh, DEF at the pump, overnight parking, laundry, restaurants or fast food, and driver lounges. Loyalty apps (myRewards at Pilot, myLove\'s) bank points and show real-time parking and shower availability.',
    keywords: 'amenities, shower, cat scale, def, parking, laundry, loyalty, rewards app',
  },
  {
    seedKey: 'stops-parking',
    category: 'truck-stops',
    subcategory: 'parking',
    topic: 'Finding parking',
    content:
      "Parking gets tight after about 6 or 7 pm — lots fill up early. Apps like Trucker Path, and the chains' own apps, show open spots and let you reserve paid parking at some locations. Plan your last hour of drive time around a spot, not the other way around.",
    keywords: 'parking, spots, full, reserve, trucker path, overnight, fills up',
  },
  {
    seedKey: 'stops-fuel-strategy',
    category: 'truck-stops',
    subcategory: 'fuel',
    topic: 'Fueling smart',
    content:
      "Diesel price swings a lot by state because of fuel taxes, so it pays to fuel where it's cheap and buy just enough to reach the next cheap state. Fuel cards (like the chains' loyalty or a fleet card) knock cents off the pump price. This app's Fuel Intelligence screen finds the cheapest diesel on your route.",
    keywords: 'fuel, diesel, cheapest, fuel card, state tax, price, save money, fuel stop',
  },

  // ── ROADS / ROUTES ───────────────────────────────────────────────────────────
  {
    seedKey: 'routes-interstate',
    category: 'routes',
    subcategory: 'system',
    topic: 'Reading the interstate system',
    content:
      'Even-numbered interstates run east-west (I-10, I-40, I-80, I-90); odd numbers run north-south (I-5, I-35, I-95). Lower numbers are south and west, higher are north and east. Three-digit interstates are spurs or loops around cities. Knowing this lets you sanity-check a route at a glance.',
    keywords: 'interstate, i-10, i-40, i-80, i-95, even odd, east west, north south, route',
  },
  {
    seedKey: 'routes-truck-routes',
    category: 'routes',
    subcategory: 'restrictions',
    topic: 'Truck routes & restrictions',
    content:
      "Not every road is legal for a big rig. Low bridges, weight-limited roads, parkways, and some city streets are off-limits — that's why a truck-specific GPS matters, not a car app. Watch posted clearance signs; a 13-foot-6 trailer will not fit under a 13-foot bridge, and hitting one is on you.",
    keywords: 'truck route, low bridge, clearance, restricted, no trucks, parkway, truck gps',
  },
  {
    seedKey: 'routes-weigh-stations',
    category: 'routes',
    subcategory: 'enforcement',
    topic: 'Weigh stations & bypass',
    content:
      "Weigh stations check your weight and can pull you in for a safety inspection. Transponder services like PrePass and Drivewyze can give you a green light to bypass when your carrier's scores are good and you're legal, saving time. Open station and no bypass means you pull in.",
    keywords: 'weigh station, scales, prepass, drivewyze, bypass, inspection, transponder',
  },
  {
    seedKey: 'routes-oversize',
    category: 'routes',
    subcategory: 'permits',
    topic: 'Oversize / overweight routing',
    content:
      'Over legal size or weight, you need state permits — and each state you cross has its own rules, approved routes, travel hours (often daylight only), and sometimes escort or pilot-car requirements. Permits are load- and route-specific, so plan the whole trip before you roll.',
    keywords: 'oversize, overweight, permit, escort, pilot car, heavy haul, over dimensional route',
  },

  // ── REGULATIONS ────────────────────────────────────────────────────────────────
  {
    seedKey: 'reg-hos',
    category: 'regulations',
    subcategory: 'hours',
    topic: 'Hours of Service (HOS)',
    content:
      "The federal driving limits for property carriers: up to 11 hours of driving inside a 14-hour on-duty window, after 10 hours off. You need a 30-minute break by your 8th hour of driving, and you cap at 60 hours in 7 days or 70 in 8, resettable with a 34-hour restart. Your ELD tracks it. These rules change, so your ELD and FMCSA are the binding word — this is just the shape of it.",
    keywords: 'hos, hours of service, 11 hour, 14 hour, 30 minute break, 70 hour, 34 restart, eld, log',
  },
  {
    seedKey: 'reg-eld',
    category: 'regulations',
    subcategory: 'equipment',
    topic: 'ELD (electronic logging device)',
    content:
      "The device that automatically records your drive time and duty status, replacing paper logs for most carriers. It syncs to the engine so hours can't be fudged. Know how to log on-duty-not-driving, sleeper, and personal conveyance correctly — misusing them is a violation.",
    keywords: 'eld, electronic log, duty status, personal conveyance, sleeper, on duty',
  },
  {
    seedKey: 'reg-cdl-endorsements',
    category: 'regulations',
    subcategory: 'license',
    topic: 'CDL classes & endorsements',
    content:
      'A Class A CDL covers combination vehicles — a tractor pulling a trailer, which is most freight. Endorsements add privileges: H for hazmat, N for tank, T for doubles/triples, X combines hazmat and tank. Each endorsement means an extra test, and hazmat adds a background check.',
    keywords: 'cdl, class a, endorsement, hazmat, tanker, doubles triples, license, x endorsement',
  },
  {
    seedKey: 'reg-dot-inspection',
    category: 'regulations',
    subcategory: 'safety',
    topic: 'DOT inspections & pre-trip',
    content:
      "A pre-trip inspection is required before you drive — brakes, tires, lights, coupling, load securement. DOT roadside inspections grade against the same points; clean inspections help your CSA scores, and defects can put you out of service on the spot. A solid pre-trip is your best defense.",
    keywords: 'dot inspection, pre trip, csa, out of service, brakes, tires, securement, roadside',
  },
  {
    seedKey: 'reg-ifta',
    category: 'regulations',
    subcategory: 'tax',
    topic: 'IFTA fuel tax',
    content:
      "The International Fuel Tax Agreement makes you report the miles you run and the fuel you buy in each state or province, then squares up the fuel tax quarterly. That's why keeping fuel receipts and accurate mileage matters — it's not just cost, it's a filing.",
    keywords: 'ifta, fuel tax, quarterly, miles per state, receipts, reporting',
  },

  // ── Q&A BANK: how the Co-Pilot answers common phrasings ───────────────────────
  {
    seedKey: 'qa-best-load',
    category: 'qa',
    subcategory: 'loads',
    topic: "What's the best load right now? / find me a good load / what should I book?",
    content:
      "Pull the top-scored load from the Opportunity Center and say it plainly: the lane, the rate, and the revenue per mile after deadhead — for example, 'Dallas to Memphis, twenty-four hundred bucks, about two-forty a mile all in.' If they want to see the board, take them there. Lead with the number that decides it: all-in revenue per mile.",
    keywords: 'best load, good load, what should i book, find load, top load, best paying, opportunity',
  },
  {
    seedKey: 'qa-reload',
    category: 'qa',
    subcategory: 'loads',
    topic: 'Find me a reload / backhaul / I need a load out of here / avoid deadhead',
    content:
      "This is a Deadhead Prevention question. Look at reloads near their delivery city and give the best one — lane, rate, and how little deadhead it takes to grab it. The whole point is not driving empty, so frame it as 'here's how you stay loaded.'",
    keywords: 'reload, backhaul, load out, deadhead, empty, next load, dont run empty',
  },
  {
    seedKey: 'qa-earnings',
    category: 'qa',
    subcategory: 'money',
    topic: 'How am I doing? / how much did I make / what are my numbers / show my earnings',
    content:
      "Give a tight spoken rundown from their real numbers: revenue, net profit and the margin, miles run, loads booked, and the standout load. Say it like a person — 'You're at about twelve grand revenue this week, netting around thirty-eight hundred, that's a thirty-two percent margin over forty-two hundred miles.' Offer to open the Profitability Engine if they want the full picture.",
    keywords: 'how am i doing, earnings, revenue, profit, margin, my numbers, how much, made this week',
  },
  {
    seedKey: 'qa-fuel',
    category: 'qa',
    subcategory: 'fuel',
    topic: 'Where\'s cheap diesel? / cheapest fuel / where should I fuel',
    content:
      "Give the cheapest diesel on their route with the price and how far off the path it is — 'Cheapest on your route is a Love\\'s about forty miles up I-40, three-eighty-nine a gallon.' If they want the map, open Fuel Intelligence. Remind them, when it fits, to buy just enough to reach the next cheap state.",
    keywords: 'cheap diesel, cheapest fuel, where fuel, fuel price, gas, diesel price, fuel stop',
  },
  {
    seedKey: 'qa-navigate',
    category: 'qa',
    subcategory: 'app',
    topic: 'Start navigation / take me there / start my route / start GPS',
    content:
      "Confirm the destination in one short line and start the route — 'Starting your route to the Memphis receiver now.' Then hand off to Profit Navigation. Don't over-explain; the driver wants to roll.",
    keywords: 'navigate, start route, gps, take me, directions, start driving, go there',
  },
  {
    seedKey: 'qa-scan-doc',
    category: 'qa',
    subcategory: 'app',
    topic: 'Scan my BOL / upload a document / read this rate con / paperwork',
    content:
      "Send them to Documents to snap or upload it, and tell them what happens next: the brain reads it, checks it's signed and complete, and for a rate con it can stage the load to confirm. Keep it reassuring — 'Snap it and I'll pull the numbers off it for you.'",
    keywords: 'scan, upload, document, bol, pod, rate con, paperwork, read document, snap',
  },
  {
    seedKey: 'qa-detention',
    category: 'qa',
    subcategory: 'money',
    topic: "I've been sitting here forever / am I owed detention / stuck at the dock",
    content:
      "Explain detention plainly: usually about two hours free, then it's owed — but only if the times are documented and the broker approved it. Nudge them to get their arrival and departure signed or time-stamped so they can actually collect. Sympathize first; sitting at a dock is miserable.",
    keywords: 'detention, sitting, stuck, waiting, dock forever, owed, free time',
  },
  {
    seedKey: 'qa-weight',
    category: 'qa',
    subcategory: 'loads',
    topic: 'Am I too heavy? / how much can I haul / weight limit / will I be legal',
    content:
      "Ground it in the 80,000-pound gross limit and the 34,000 per tandem. Typical payload tops out around forty-four to forty-five thousand pounds. If they're near the edge, tell them to hit a CAT scale before a weigh station rather than risk a fine.",
    keywords: 'too heavy, weight, how much haul, legal weight, overweight, payload, scale me',
  },
  {
    seedKey: 'qa-hos',
    category: 'qa',
    subcategory: 'regs',
    topic: 'How many hours do I have left? / can I keep driving / am I out of hours',
    content:
      "You can't read their ELD, so be honest and useful: their logging device is the binding clock. Remind them of the shape — 11 hours driving in a 14-hour window, 10 off to reset — and tell them to check the ELD for the exact minutes. Never guess a number that could put them in violation.",
    keywords: 'hours left, hos, can i drive, out of hours, drive time, log, eld clock',
  },
  {
    seedKey: 'qa-negotiate',
    category: 'qa',
    subcategory: 'money',
    topic: 'Is this rate any good? / should I take this load / haggle the rate',
    content:
      "Compare the offered rate against their cost per mile and the lane, factoring deadhead to pickup. If it clears their costs with real margin, say so; if it's thin, say that too and suggest a counter. Give them the number to decide on, not a lecture — 'That's two-ten a mile after deadhead; your floor's about one-eighty, so there's room, but I'd counter at two and a quarter.'",
    keywords: 'good rate, should i take, worth it, haggle, counter, rate per mile, negotiate load',
  },
  {
    seedKey: 'qa-what-can-you-do',
    category: 'qa',
    subcategory: 'app',
    topic: 'What can you do? / how do you help / what are you / help me',
    content:
      "Own it with a little charm: you're their AI co-pilot. You find loads and reloads, hunt cheap diesel, read their paperwork, track their money, run navigation, and you can drive the app for them hands-free. Keep it to a sentence or two — offer to show, don't recite a manual.",
    keywords: 'what can you do, help, what are you, how do you work, capabilities, who are you',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT TRAINING MANUAL — sub-categories + Q&A for the seven core freight
  // documents. Written so the brain answers like a seasoned dispatcher, always
  // leaning toward legal compliance and getting it in writing.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1. BILL OF LADING (BOL) ──────────────────────────────────────────────────
  {
    seedKey: 'doc-bol-types',
    category: 'documents',
    subcategory: 'bol',
    topic: 'Types of Bill of Lading',
    content:
      "The BOL is the king of freight docs — it's three things at once: the contract of carriage, the receipt for the goods, and the title. A straight (non-negotiable) BOL delivers to one named consignee with no transfer of ownership. An order (negotiable) BOL is used with letters of credit and can be endorsed to transfer ownership. An eBOL is the digital version with electronic signature capture. An inland BOL covers the truck leg after cargo arrives by ship or rail. And a BOL is 'clean' when no damage is noted, or 'claused' when damage or shortage is written on it.",
    keywords:
      'bol, bill of lading, straight, order, negotiable, ebol, inland, clean, claused, title, contract of carriage, receipt',
  },
  {
    seedKey: 'qa-bol-lost',
    category: 'qa',
    subcategory: 'bol',
    topic: 'What happens if I lose the BOL before delivery?',
    content:
      "You can't legally deliver the freight without it. Call the shipper right away for a re-print or a letter of indemnity. That's the fix, but it delays both the delivery and your payment — so guard the BOL.",
    keywords: 'lost bol, lose bill of lading, missing bol, no bol, letter of indemnity, reprint',
  },
  {
    seedKey: 'qa-bol-damage-inspection',
    category: 'qa',
    subcategory: 'bol',
    topic: "Receiver says freight is damaged but I don't see it — what do I write on the BOL?",
    content:
      "Write 'Subject to inspection' on the BOL before you sign. That protects you — it lets the receiver inspect later without you admitting any liability for damage you can't see.",
    keywords: 'damage, subject to inspection, receiver claims damage, dont see damage, sign bol',
  },
  {
    seedKey: 'qa-bol-nmfc',
    category: 'qa',
    subcategory: 'bol',
    topic: 'Why is the NMFC number important on a BOL?',
    content:
      "The NMFC — National Motor Freight Classification — sets the freight class. If it's wrong, the load can get re-classed after delivery, which means a lower payout to you or a back-charge to the shipper. Make sure it matches.",
    keywords: 'nmfc, freight class, national motor freight classification, re-class, reclass, class',
  },
  {
    seedKey: 'qa-bol-alter',
    category: 'qa',
    subcategory: 'bol',
    topic: 'Can I alter a BOL after the shipper signed it?',
    content:
      "No. Any change after signing voids the document and can be treated as fraud. If something's wrong, ask the shipper for a corrected re-issue — never scratch it out yourself.",
    keywords: 'alter bol, change bol, edit after signing, fraud, corrected reissue, cross out',
  },

  // ── 2. INVOICE / FREIGHT BILL ────────────────────────────────────────────────
  {
    seedKey: 'doc-invoice-types',
    category: 'documents',
    subcategory: 'invoice',
    topic: 'Types of invoice / freight bill',
    content:
      "The invoice is your demand for payment. A standard invoice goes straight to the shipper or broker on Net 30 or Net 60 terms. A factored invoice is assigned to a factoring company that buys it at a discount — say three percent — and fronts you cash within a day. Recourse factoring means you buy the invoice back if the broker doesn't pay a dispute; non-recourse means the factor eats the loss if the broker goes bankrupt (recourse is cheaper). An accessorial invoice is a separate line for detention, layover, pallet jack, or inside delivery.",
    keywords:
      'invoice, freight bill, factored, factoring, recourse, non-recourse, accessorial, net 30, net 60, standard invoice, discount',
  },
  {
    seedKey: 'qa-invoice-tma',
    category: 'qa',
    subcategory: 'invoice',
    topic: 'Factoring company rejected my invoice for a name mismatch — what is that?',
    content:
      "It means the legal carrier name on your invoice doesn't exactly match the name on the rate con and the BOL. The factor won't buy a mismatched invoice — you have to file a correction so all three names line up, and that delays payment.",
    keywords: 'tma, name mismatch, factoring rejected, carrier name, invoice rejected, mismatch',
  },
  {
    seedKey: 'qa-invoice-recourse',
    category: 'qa',
    subcategory: 'invoice',
    topic: 'What is recourse factoring?',
    content:
      "Recourse factoring means if the broker fails to pay because of a dispute — not bankruptcy — you have to buy the invoice back from the factor. It's cheaper than non-recourse for exactly that reason: you're carrying more of the risk.",
    keywords: 'recourse, factoring, buy back invoice, cheaper factoring, dispute, cash now',
  },
  {
    seedKey: 'qa-invoice-attachments',
    category: 'qa',
    subcategory: 'invoice',
    topic: 'What must go with the invoice for quick payment?',
    content:
      "Always attach the signed POD, the signed rate con, and the scale ticket if the rate depended on weight. A complete packet is what gets you paid fast — a missing POD is the number one reason payment stalls.",
    keywords: 'invoice attachments, get paid, signed pod, signed rate con, scale ticket, packet',
  },
  {
    seedKey: 'qa-invoice-interest',
    category: 'qa',
    subcategory: 'invoice',
    topic: 'Can I charge interest on late payments?',
    content:
      "Only if your rate con or invoice already spells out an interest rate — like one and a half percent a month. You can't add it after the fact; it has to be stated up front to be enforceable.",
    keywords: 'interest, late payment, late fee, charge interest, past due, one and a half percent',
  },

  // ── 3. LUMPER RECEIPT ────────────────────────────────────────────────────────
  {
    seedKey: 'doc-lumper-types',
    category: 'documents',
    subcategory: 'lumper',
    topic: 'Types of lumper receipt',
    content:
      "A lumper receipt is your proof of the fee you paid a third-party crew to load or unload, so you can get reimbursed. A company-check receipt includes the check number. A cash receipt needs a witness signature and carries more fraud risk. A COD receipt is paid out of pocket at the receiver — scan it immediately. App-based digital receipts come from platforms like MyLumper. And some distribution centers bundle a scale-house receipt with the lumper fee.",
    keywords:
      'lumper, receipt, company check, cash, cod, cash on delivery, digital, mylumper, scale house, unloading fee, reimburse',
  },
  {
    seedKey: 'qa-lumper-over-cap',
    category: 'qa',
    subcategory: 'lumper',
    topic: 'Lumper charged more than the broker will reimburse — what do I do?',
    content:
      "Get the receipt to state the standard rate and pair it with the rate con showing the accessorial cap. If the charge is over the cap, you need the broker's pre-approval before the unload — otherwise you eat the difference. Call the broker before you pay, not after.",
    keywords: 'lumper over cap, more than reimburse, exceeds limit, pre-approval, accessorial cap, broker approve',
  },
  {
    seedKey: 'qa-lumper-lost',
    category: 'qa',
    subcategory: 'lumper',
    topic: 'I lost the lumper receipt — can I still get reimbursed?',
    content:
      "It's tough. The broker needs proof to bill the shipper, so call the lumper service and ask for a duplicate — they'll usually re-issue for a twenty-five to fifty dollar admin fee. Without proof, reimbursement is rare.",
    keywords: 'lost lumper receipt, missing lumper, duplicate, reissue, reimbursed, admin fee',
  },
  {
    seedKey: 'qa-lumper-valid',
    category: 'qa',
    subcategory: 'lumper',
    topic: 'What must a valid lumper receipt contain?',
    content:
      "Carrier name, the trailer or pro number, date and time, total pieces unloaded, the lumper company stamp, and the signature of the receiver's manager. Missing any of those and the broker can kick it back.",
    keywords: 'valid lumper receipt, what on lumper receipt, required info, stamp, pro number, manager signature',
  },
  {
    seedKey: 'qa-lumper-refused',
    category: 'qa',
    subcategory: 'lumper',
    topic: 'The lumper refused to give me a receipt — why?',
    content:
      "Usually because the warehouse pays them, not you. If the shipper pre-pays lumpers, you don't get a receipt because you're not owed a reimbursement. No out-of-pocket, no receipt.",
    keywords: 'lumper refused receipt, no receipt, warehouse pays lumper, prepaid lumper, shipper pays',
  },

  // ── 4. PACKING LIST / MANIFEST ───────────────────────────────────────────────
  {
    seedKey: 'doc-packing-types',
    category: 'documents',
    subcategory: 'packing',
    topic: 'Types of packing list / manifest',
    content:
      "The packing list is the inventory map of what's in the trailer — SKUs, serial numbers, units. The plain packing list is usually sealed in a door pouch or handed over at pickup. A master manifest sums all pallets and total cube for dock scheduling. A serial-number manifest matters for high-value electronics or military freight and needs each barcode scanned. A hazmat manifest adds UN numbers, hazard class, and emergency contacts.",
    keywords:
      'packing list, manifest, master manifest, serial number, hazmat manifest, un number, sku, inventory, cube, barcode',
  },
  {
    seedKey: 'qa-packing-short',
    category: 'qa',
    subcategory: 'packing',
    topic: "Receiver says I'm short 2 pallets but the count matches — what's the process?",
    content:
      "Check your BOL count. If the BOL matches the packing list and your trailer seals were intact, the discrepancy is between shipper and receiver, not you. Note the receiver's claim on the POD, deliver what you have, and you're covered — that's concealed shortage, not your liability.",
    keywords: 'short pallets, count matches, shortage, seals intact, concealed shortage, missing pallets, not liable',
  },
  {
    seedKey: 'qa-packing-blind',
    category: 'qa',
    subcategory: 'packing',
    topic: 'What is a blind shipment and how does it affect the packing list?',
    content:
      "A blind shipment hides the shipper's identity from the receiver, or the other way around. The packing list shows a generic name instead of the real manufacturer. Show the receiver only the blind version — never the original packing list, or you break the blind.",
    keywords: 'blind shipment, double blind, hide shipper, generic name, blind bol, packing list blind',
  },
  {
    seedKey: 'qa-packing-weight',
    category: 'qa',
    subcategory: 'packing',
    topic: 'Packing list weight differs from my scale ticket — which one matters?',
    content:
      "For legal weight, the scale ticket rules — that's what DOT enforces. The packing list is for billing. If the packing list says forty thousand but you scale at forty-four, the packing list is wrong and you rework the load, because the scale is the law.",
    keywords: 'packing list weight, scale ticket weight, which weight, billing weight, legal weight, discrepancy',
  },
  {
    seedKey: 'qa-packing-barcode',
    category: 'qa',
    subcategory: 'packing',
    topic: 'Why do receivers scan barcodes on the manifest?',
    content:
      "To update their inventory system. If a scan fails, they'll reject the pallet even when the physical count is right, and that causes a putaway delay. It's their ERP talking, not a knock on your load.",
    keywords: 'barcode scan, manifest scan, erp, putaway, scan fails, reject pallet, inventory system',
  },

  // ── 5. PROOF OF DELIVERY (POD) ───────────────────────────────────────────────
  {
    seedKey: 'doc-pod-types',
    category: 'documents',
    subcategory: 'pod',
    topic: 'Types of Proof of Delivery',
    content:
      "The POD is the unlock key for your invoice — it confirms the freight arrived, when, and in what shape. A signed POD is a physical signature from the receiver's clerk. A digital POD or ePOD is captured on a tablet or ELD through something like Transflo. A stamped POD uses the warehouse stamp as legal acceptance when no signature's available. An exception POD notes damage, shortage, or a late delivery. And a dated POD states the exact unload time — vital for proving you were on time.",
    keywords:
      'pod, proof of delivery, signed, digital, epod, stamped, exception, dated, transflo, unlock invoice, receiver signature',
  },
  {
    seedKey: 'qa-pod-refuse-sign',
    category: 'qa',
    subcategory: 'pod',
    topic: "Receiver refuses to sign because I'm late — how do I get a POD?",
    content:
      "On the BOL write 'Tendered for delivery at' the time, and 'Refused to sign,' with the reason. Snap a photo of the freight at the dock. That creates a legal record that you made a bona fide delivery attempt, which is what you need.",
    keywords: 'refuse to sign, receiver wont sign, late delivery, tendered for delivery, refused, bona fide attempt',
  },
  {
    seedKey: 'qa-pod-damage-noticed',
    category: 'qa',
    subcategory: 'pod',
    topic: 'I noticed damage after unloading — should I sign the POD clean?',
    content:
      "No. Write 'Damage noted to outer packaging — subject to inspection.' Sign it clean and you give up the right to dispute a claim later. Always note what you see before you sign.",
    keywords: 'damage after unload, sign clean, subject to inspection, pod damage, dispute claim, noted damage',
  },
  {
    seedKey: 'qa-pod-digital-binding',
    category: 'qa',
    subcategory: 'pod',
    topic: 'Is a digital signature on a tablet legally binding?',
    content:
      "Yes — under the ESIGN Act, as long as the device records the time, date, and GPS location of the signature. A proper ePOD holds up just like ink on paper.",
    keywords: 'digital signature, tablet, legally binding, esign act, epod, gps, electronic signature',
  },
  {
    seedKey: 'qa-pod-broker-lost',
    category: 'qa',
    subcategory: 'pod',
    topic: "Broker claims they didn't get the POD I emailed — now what?",
    content:
      "Always send the POD with a read-receipt request and keep a copy in a cloud folder you can share by link. If you've got a sent confirmation, a bounced or 'missing' email isn't your problem — resend the link and move on.",
    keywords: 'broker didnt get pod, email pod, read receipt, cloud copy, resend pod, missing email, proof sent',
  },

  // ── 6. RATE CONFIRMATION (RATE CON) ──────────────────────────────────────────
  {
    seedKey: 'doc-ratecon-types',
    category: 'documents',
    subcategory: 'ratecon',
    topic: 'Types of Rate Confirmation',
    content:
      "The rate con is the binding contract between you and the broker. A spot rate con is a one-time deal for a single load. A contract rate con is a longer agreement — thirty to ninety days — with fixed lanes and rates. An accessorial rate con spells out the extras: detention at fifty an hour, layover at two-fifty a day. And a fuel-surcharge rate con separates the base rate from the diesel surcharge, often tied to the DOE national average.",
    keywords:
      'rate con, rate confirmation, spot, contract, accessorial, fuel surcharge, fsc, doe average, binding contract, detention, layover',
  },
  {
    seedKey: 'qa-ratecon-reroute',
    category: 'qa',
    subcategory: 'ratecon',
    topic: 'Broker offers $100 more to change my route — do I need a new Rate Con?',
    content:
      "Every time. Verbal agreements don't hold up in freight. Get an amended rate con by email before you change anything — no paper, and the broker can deny the extra money later.",
    keywords: 'reroute, new rate con, verbal agreement, amended rate con, extra pay, change route, get it in writing',
  },
  {
    seedKey: 'qa-ratecon-service-time',
    category: 'qa',
    subcategory: 'ratecon',
    topic: 'What is the Service Time section on a Rate Con?',
    content:
      "It's the pickup and delivery windows — your appointment times. Miss them and the broker can dock your rate anywhere from fifty to two-fifty. Treat those windows as part of the pay.",
    keywords: 'service time, appointment window, pickup delivery time, rate reduction, miss appointment, late penalty',
  },
  {
    seedKey: 'qa-ratecon-no-accessorials',
    category: 'qa',
    subcategory: 'ratecon',
    topic: "Rate Con says 'NO ACCESSORIALS' but I sat 4 hours loading — am I out of luck?",
    content:
      "If you signed a rate con that says no accessorials, yes — you waived detention pay. The move is to catch that line before you sign and negotiate it out. Once it's signed, it's binding.",
    keywords: 'no accessorials, waived detention, sat loading, detention pay, negotiate rate con, signed away',
  },
  {
    seedKey: 'qa-ratecon-stage',
    category: 'qa',
    subcategory: 'ratecon',
    topic: 'How do I stage a load using a Rate Con in the app?',
    content:
      "Scan the rate con — the app pulls the numbers, dates, and reference info and creates a staged placeholder. When you confirm, it spins up a live booking. Head to Documents to snap it and I'll pull the details off it for you.",
    keywords: 'stage load, scan rate con, booking, confirm load, placeholder, app rate con, parse',
  },

  // ── 7. SCALE / WEIGHT TICKET ─────────────────────────────────────────────────
  {
    seedKey: 'doc-scale-types',
    category: 'documents',
    subcategory: 'scale',
    topic: 'Types of scale / weight ticket',
    content:
      "The scale ticket is your legal proof of gross, axle, and tare weight — how you stay DOT-compliant. A CAT scale ticket is the gold standard, accepted nationwide with a weigh-my-truck app. A shipper's scale ticket is for billing, not DOT. An axle scale ticket breaks out steer, drive, and trailer to keep you under bridge law. A re-weigh ticket is what you get after sliding your tandems or fifth wheel. And an empty or tare ticket is the truck with no cargo, used to figure net weight.",
    keywords:
      'scale ticket, weight ticket, cat scale, shipper scale, axle, re-weigh, reweigh, tare, empty weight, gross, bridge law',
  },
  {
    seedKey: 'qa-scale-over-drives',
    category: 'qa',
    subcategory: 'scale',
    topic: "I'm 34,500 on my drives but the limit's 34,000 — what do I do?",
    content:
      "Slide your trailer tandems to shift weight off the drives, then get a re-weigh ticket right away. You can't legally run over thirty-four thousand on the drives in most states, so fix it before the next scale house.",
    keywords: 'overweight drives, 34000, slide tandems, re-weigh, axle overweight, redistribute weight, drive axle',
  },
  {
    seedKey: 'qa-scale-shipper-vs-cat',
    category: 'qa',
    subcategory: 'scale',
    topic: "Shipper's scale says legal, CAT scale says overweight — who do I believe?",
    content:
      "The CAT scale. If DOT stops you, they weigh on a certified scale, and the shipper's scale is only for billing. Adjust the load or get a re-weigh until the certified number is legal.",
    keywords: 'shipper scale vs cat, which scale, certified scale, dot enforcement, overweight, believe scale',
  },
  {
    seedKey: 'qa-scale-why-need',
    category: 'qa',
    subcategory: 'scale',
    topic: 'Why do I need a scale ticket if the BOL already has a weight?',
    content:
      "To protect against a fraudulent weight or shortage claim. If the receiver says you delivered less than the BOL shows, your scale ticket proving what you picked up is your defense. The BOL is a claim; the scale ticket is proof.",
    keywords: 'why scale ticket, bol weight, shortage claim, protect, proof of weight, fraudulent claim',
  },
  {
    seedKey: 'qa-scale-steer',
    category: 'qa',
    subcategory: 'scale',
    topic: 'Why does steer axle weight matter?',
    content:
      "You generally can't exceed twelve thousand pounds on the steer axle. If it's heavy, slide the fifth wheel back and get a re-weigh to prove you fixed it. Too much on the steers hurts handling and it's a violation.",
    keywords: 'steer axle, 12000, fifth wheel, slide 5th wheel, front axle weight, re-weigh, steer heavy',
  },

  // ── GOLDEN RULE ──────────────────────────────────────────────────────────────
  {
    seedKey: 'doc-golden-rule',
    category: 'documents',
    subcategory: 'principles',
    topic: 'The golden rule of freight paperwork',
    content:
      "If it isn't written down and signed, it didn't happen. Always take photos of every document in the app and store them in the cloud. Never hand over the original BOL unless the receiver signs and dates it first. When in doubt, protect yourself in writing and note anything unusual before you sign.",
    keywords:
      'golden rule, paperwork, in writing, take photos, cloud, protect yourself, sign date, best practice, document rule',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRAILER TRAINING MANUAL — deep-dive sub-categories + Q&A for the 10 core
  // trailer types. The brain answers like a driver who's pulled every one of
  // these, always leaning toward safety, securement, and legal compliance.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1. CAR HAULER ────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-carhauler-types',
    category: 'trailers',
    subcategory: 'car-hauler',
    topic: 'Car hauler sub-types',
    content:
      "A car hauler moves passenger vehicles, trucks, and vans on a multi-level deck. An open hauler is the standard eight-to-ten car wedge or stinger-steered trailer — cheap but exposes cars to weather and debris. An enclosed hauler is fully boxed in for classics, exotics, and high-value cars. Stinger-steered means the gooseneck extends forward for a tighter turning radius. A hydraulic or power-ramp deck raises and lowers to load low-clearance sports cars. Multi-level triples are rare because of height laws and mostly do OEM factory runs.",
    keywords: 'car hauler, auto transport, open, enclosed, stinger, hydraulic ramp, power ramp, multi level, exotic, classic car',
  },
  {
    seedKey: 'qa-carhauler-loading',
    category: 'qa',
    subcategory: 'car-hauler',
    topic: 'Why does loading a car hauler take so much longer than backing into a dock?',
    content:
      "Because it's a puzzle. Every car goes on in a set sequence to balance axle weights, and straps cross at about forty-five degrees over the tires. Low-profile cars need special over-wheel straps so you don't scratch the paint. It's slow, careful work, not a dock-and-go.",
    keywords: 'car hauler loading, load sequence, axle balance, over wheel strap, strap cars, takes long, puzzle',
  },
  {
    seedKey: 'qa-carhauler-enclosed-risk',
    category: 'qa',
    subcategory: 'car-hauler',
    topic: 'Biggest risk hauling an enclosed classic car?',
    content:
      "Temperature and humidity swings inside the box cause condensation and rust. Protect yourself with a signed condition report and photos of the odometer and every body panel before the car rolls onto the ramp — that's your defense against a damage claim.",
    keywords: 'enclosed classic car, condensation, rust, condition report, damage claim, humidity, photos before load',
  },
  {
    seedKey: 'qa-carhauler-antitheft',
    category: 'qa',
    subcategory: 'car-hauler',
    topic: 'A car has an anti-theft system that locks the wheels — how do I load it?',
    content:
      "Get the transport-mode key or have the shipper disable the system. Drag it and you'll burn out the drivetrain. Note it on the BOL as an exception before you touch it.",
    keywords: 'anti theft, wheel lock, transport mode, locked wheels, drag car, drivetrain, exception bol',
  },
  {
    seedKey: 'qa-carhauler-enclosed-pay',
    category: 'qa',
    subcategory: 'car-hauler',
    topic: 'Why do enclosed haulers pay significantly more?',
    content:
      "Liability — vehicles often top a hundred grand — plus the specialized strap-down gear, worse fuel economy from a heavy, boxy trailer, and lots of empty miles since enclosed backhauls are scarce. You're paid for the risk and the deadhead.",
    keywords: 'enclosed hauler pay, pays more, liability, high value, fuel economy, empty miles, backhaul',
  },

  // ── 2. CONESTOGA ─────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-conestoga-types',
    category: 'trailers',
    subcategory: 'conestoga',
    topic: 'Conestoga sub-types',
    content:
      "A Conestoga is a flatbed with a rolling, retractable tarp on a steel frame — a flatbed with a sliding fabric roof and sides. A manual Conestoga is pushed along the track by hand-crank or pull-cord. A hydraulic or pneumatic one slides automatically on air or hydraulics. A drop-deck Conestoga pairs the rolling tarp with a step-deck for taller freight. A full-side curtain slides completely open so you can load overhead by crane.",
    keywords: 'conestoga, rolling tarp, retractable, manual, hydraulic, pneumatic, drop deck, curtain, crane load, sliding roof',
  },
  {
    seedKey: 'qa-conestoga-bent-track',
    category: 'qa',
    subcategory: 'conestoga',
    topic: "The tarp track is bent and won't slide smoothly — can I still run the load?",
    content:
      "No. If the curtain won't slide, you can't secure the freight properly. Report it to the shop right away. Your only workarounds are rejecting the load or hand-tarping it like a regular flatbed — which kills the whole point and adds hours.",
    keywords: 'bent track, tarp stuck, wont slide, conestoga damage, report shop, hand tarp, reject load',
  },
  {
    seedKey: 'qa-conestoga-steel-coil',
    category: 'qa',
    subcategory: 'conestoga',
    topic: 'Broker offers coiled steel on a Conestoga — is that safe?',
    content:
      "Depends on weight. The Conestoga frame adds fifteen hundred to two thousand pounds over a plain flatbed, so your payload drops. Coils go eye-to-the-sky, chained, and the side rails can fight standard coil racking — verify the deck width, usually eight-six, fits the coil stands before you commit.",
    keywords: 'conestoga coil, coiled steel, payload, frame weight, eye to the sky, coil rack, deck width, suicide coil',
  },
  {
    seedKey: 'qa-conestoga-weather-proof',
    category: 'qa',
    subcategory: 'conestoga',
    topic: 'How do I prove the freight stayed weather-protected in transit?',
    content:
      "Timestamped photo of the tarp fully closed over the load at the shipper, and another still closed at the receiver. If it's open on arrival, the receiver can reject it for possible water damage. Photos are your proof.",
    keywords: 'weather protected, tarp closed photo, timestamp, water damage, prove covered, conestoga proof',
  },

  // ── 3. DRY VAN ───────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-dryvan-types',
    category: 'trailers',
    subcategory: 'dry-van',
    topic: 'Dry van sub-types',
    content:
      "The dry van is the workhorse — an enclosed, non-temp-controlled box for palletized freight. Standard is 53 by 102 (fifty-three feet long, eight and a half wide, about nine feet interior). A pup is a 28-foot trailer for LTL doubles. A high-cube adds six to twelve inches of height for light, bulky freight. Swing doors are standard for docks; roll-up doors suit ground-level urban loading. An air-ride van uses air suspension to protect fragile electronics or glass.",
    keywords: 'dry van, box, 53 foot, pup trailer, high cube, swing door, roll up door, air ride, palletized, workhorse',
  },
  {
    seedKey: 'qa-dryvan-payload',
    category: 'qa',
    subcategory: 'dry-van',
    topic: 'My van is 53 feet — why can I only load about 45,000 lbs, not 48,000?',
    content:
      "Because the tractor-trailer weighs roughly thirty-five thousand empty, and the legal gross is eighty thousand — that leaves you about forty-five thousand of payload. Heavier trailers with liftgates or thick floors leave even less.",
    keywords: 'dry van payload, 45000, why not more, empty weight, gross weight, capacity, liftgate weight',
  },
  {
    seedKey: 'qa-dryvan-dock-height',
    category: 'qa',
    subcategory: 'dry-van',
    topic: 'Warehouse has dock-high freight but my air-ride trailer is dumped — what do I do?',
    content:
      "Set the air suspension to dock height, or inflate the bags with the leveling valve. If the trailer sits too low the forklift can't get in. Dump the air only after the forklift's inside to lock it — never before you're aligned with the dock.",
    keywords: 'dock height, air ride, dumped, inflate bags, leveling valve, forklift, dock high, suspension',
  },
  {
    seedKey: 'qa-dryvan-floor-load',
    category: 'qa',
    subcategory: 'dry-van',
    topic: 'I have a floor-load with no pallets — how does that affect unload time?',
    content:
      "Big difference — thirty minutes with a forklift becomes three or four hours hand-stacking, which triggers detention. Note 'floor loaded, hand unload required' on your rate con so the accessorial is justified.",
    keywords: 'floor load, no pallets, hand unload, hand stack, unload time, detention, accessorial, floor loaded',
  },

  // ── 4. FLATBED ───────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-flatbed-types',
    category: 'trailers',
    subcategory: 'flatbed',
    topic: 'Flatbed sub-types',
    content:
      "A flatbed is an open deck, no walls or roof, for oversized or irregular freight loaded by crane, forklift, or from the end. A 48-foot deck is common for steel and lumber; 53 feet handles lighter, longer material like PVC pipe. A spread-axle flatbed spaces the axles farther apart to carry more legal weight under bridge laws. A curtainside has removable side curtains but no rolling roof. An extendable stretches on pins to carry sixty-to-eighty-foot loads like beams or wind blades.",
    keywords: 'flatbed, open deck, 48 foot, 53 foot, spread axle, curtainside, extendable, stretch, steel, lumber, bridge law',
  },
  {
    seedKey: 'qa-flatbed-tiedowns',
    category: 'qa',
    subcategory: 'flatbed',
    topic: 'Load of sheet steel — how many chains and straps do I legally need?',
    content:
      "FMCSA minimum is two tiedowns for anything under five feet, then one more for every additional ten feet of length. But by weight you also need enough working load limit to cover half the cargo weight — a forty-thousand-pound coil takes four chains rated around fifty-four hundred pounds each, crossed in an X.",
    keywords: 'tiedowns, chains, straps, securement, fmcsa, working load limit, wll, steel coil, how many chains, cross pattern',
  },
  {
    seedKey: 'qa-flatbed-tarp-charge',
    category: 'qa',
    subcategory: 'flatbed',
    topic: 'What is a tarp charge and who pays it?',
    content:
      "It's an accessorial — usually fifty to a hundred fifty dollars paid to you for covering the freight with heavy vinyl against rain. It's per tarp and negotiated on the rate con. You're not required to tarp unless the rate con says so.",
    keywords: 'tarp charge, tarp fee, accessorial, who pays tarp, vinyl tarp, per tarp, rate con tarp',
  },
  {
    seedKey: 'qa-flatbed-rain-lumber',
    category: 'qa',
    subcategory: 'flatbed',
    topic: 'It starts raining while I strap down lumber — what do I do?',
    content:
      "Stop strapping and tarp it now. Strap wet lumber under a sealed tarp and it rots or molds by delivery, and that claim's on you. Lumber gets strapped, tarped, and ventilated — never sealed airtight.",
    keywords: 'rain lumber, wet lumber, tarp immediately, mold, rot, ventilate, dont seal, lumber claim',
  },

  // ── 5. HOPPER BOTTOM / PNEUMATIC ─────────────────────────────────────────────
  {
    seedKey: 'trailer-hopper-types',
    category: 'trailers',
    subcategory: 'hopper',
    topic: 'Hopper bottom & pneumatic sub-types',
    content:
      "These haul dry, flowable bulk. A gravity hopper (bottom dump) opens gates underneath to drop grain, sand, or gravel into a pit. A pneumatic dry-bulk tanker pressurizes an aluminum or steel tank and blows product like cement, pellets, or flour through a hose. Aluminum is lighter for food and ag; steel is heavier but tougher for abrasive sand and rock. A compartmented tanker splits into separate hoppers to carry several products at once.",
    keywords: 'hopper bottom, pneumatic, gravity, bottom dump, dry bulk, aluminum, steel, compartment, grain, cement, pellets, blower',
  },
  {
    seedKey: 'qa-hopper-washout',
    category: 'qa',
    subcategory: 'hopper',
    topic: 'Hauling cement in a pneumatic — why does the receiver want a washout certificate?',
    content:
      "Because cement reacts with water and hardens inside the tank, and any leftover residue from a prior product contaminates their batch. The washout certificate proves the tank was professionally cleaned and dried before you loaded.",
    keywords: 'washout certificate, cement, pneumatic, contamination, residue, clean tank, batch, dried',
  },
  {
    seedKey: 'qa-hopper-bridged',
    category: 'qa',
    subcategory: 'hopper',
    topic: "The hopper won't dump — the grain is 'bridged' and stuck. What do I do?",
    content:
      "Bang the side of the hopper with a rubber mallet to break the bridge. Never put a steel rod inside with the gate open — it can shoot out like a bullet. Bridging usually means moisture, so note on the BOL that the product came in wet to keep the liability off you.",
    keywords: 'bridged, hopper stuck, wont dump, rubber mallet, break bridge, grain stuck, moisture, wet product',
  },
  {
    seedKey: 'qa-hopper-endorsement',
    category: 'qa',
    subcategory: 'hopper',
    topic: 'Do I need a special endorsement for a pneumatic tanker?',
    content:
      "The tanker (N) endorsement is for tanks carrying liquid or gas. A dry-bulk pneumatic hauls a solid, so technically you don't need the N — but you still need to understand air brakes and weight shift, so learn the tank before you pull it.",
    keywords: 'pneumatic endorsement, tanker endorsement, n endorsement, dry bulk, cdl, air brake, weight shift',
  },

  // ── 6. LOWBOY / RGN ──────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-lowboy-types',
    category: 'trailers',
    subcategory: 'lowboy',
    topic: 'Lowboy / RGN sub-types',
    content:
      "A lowboy is a very low deck for tall, heavy equipment, often oversize or overweight. A fixed-gooseneck lowboy has a permanent neck and loads up steel ramps. An RGN — removable gooseneck — detaches and lowers to the ground so equipment drives straight on at a zero-degree angle, essential for low-clearance dozers. A double-drop steps down over the axles and again in the middle. A detachable tail pivots into a ramp for very long machines like pavement millers.",
    keywords: 'lowboy, rgn, removable gooseneck, fixed gooseneck, double drop, detachable tail, heavy haul, dozer, ramp, oversize',
  },
  {
    seedKey: 'qa-lowboy-hydraulic-fail',
    category: 'qa',
    subcategory: 'lowboy',
    topic: "My RGN hydraulic pump won't drop the neck — can I improvise?",
    content:
      "Absolutely not. The neck weighs several tons and is held by pins; bypass the hydraulic interlock and it can slam down and kill you. Call a mobile hydraulic repair service — this is not a roadside fix.",
    keywords: 'rgn hydraulic, wont drop neck, pump failure, dont improvise, gooseneck, mobile repair, interlock, dangerous',
  },
  {
    seedKey: 'qa-lowboy-oversize',
    category: 'qa',
    subcategory: 'lowboy',
    topic: 'The excavator is 12 feet wide — what do I need?',
    content:
      "Oversize permits for each state you cross, escort or pilot cars with flags and roof signs, and WIDE LOAD banners front and rear. In most states you can only run dawn to dusk. Plan the whole trip before you roll.",
    keywords: 'oversize, 12 feet wide, wide load, permits, escort, pilot car, daylight only, excavator, banners',
  },
  {
    seedKey: 'qa-lowboy-secure-excavator',
    category: 'qa',
    subcategory: 'lowboy',
    topic: 'How do I secure a rubber-tracked excavator to an RGN?',
    content:
      "Chains and binders on the designated tie-down points, not the tracks. Add boomers — tamper locks — on the binders, and chain the bucket down separately so it can't swing during hard braking.",
    keywords: 'secure excavator, chains, binders, tie down points, boomers, chain bucket, rgn securement, tracks',
  },

  // ── 7. POWER ONLY ────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-poweronly-types',
    category: 'trailers',
    subcategory: 'power-only',
    topic: 'Power only sub-types',
    content:
      "Power only means you bring just the tractor and pull someone else's trailer. Drop-and-hook: the shipper pre-loads a trailer, you hook, haul, drop, and grab a pre-loaded backhaul. Live unload: you pull the shipper's trailer and wait at the dock, then leave empty. Intermodal chassis pulling powers a 20, 40, or 53-foot marine container from the rail yard. Stored-trailer relocation moves an empty trailer yard-to-yard — non-revenue but needed.",
    keywords: 'power only, drop and hook, live unload, intermodal, chassis, container, relocation, tractor only, backhaul',
  },
  {
    seedKey: 'qa-poweronly-flat-tire',
    category: 'qa',
    subcategory: 'power-only',
    topic: "The shipper's trailer has a flat — am I responsible for fixing it?",
    content:
      "No. In power only you're responsible for the tractor; the trailer owner owns the equipment. Call the broker or shipper, photograph it, and note the defect on the trailer inspection form before you hook. Move it and you accept the liability.",
    keywords: 'power only flat tire, trailer defect, not responsible, trailer owner, inspection form, photo, liability',
  },
  {
    seedKey: 'qa-poweronly-paid',
    category: 'qa',
    subcategory: 'power-only',
    topic: 'How do I get paid on drop-and-hook when there are no signed BOLs?',
    content:
      "Through the trailer interchange agreement. The receiver signs the POD for the trailer number being dropped, not the freight, and the yard manager's electronic signature confirming the trailer is empty and repositioned triggers payment.",
    keywords: 'drop and hook pay, no bol, trailer interchange, get paid, yard manager, trailer number, pod trailer',
  },
  {
    seedKey: 'qa-poweronly-gladhands',
    category: 'qa',
    subcategory: 'power-only',
    topic: "Trailer brake lines don't match my tractor's gladhands — now what?",
    content:
      "Use an adapter. Always carry a gladhand adapter kit — standard, coil, and flat types. An old wedge-brake trailer may need the lines rerouted. If you can't connect safely, you reject the load with no penalty on you.",
    keywords: 'gladhand, brake lines, adapter, dont match, gladhand kit, wedge brake, connect trailer, reject',
  },

  // ── 8. REEFER ────────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-reefer-types',
    category: 'trailers',
    subcategory: 'reefer',
    topic: 'Reefer sub-types',
    content:
      "A reefer is a temp-controlled van with a refrigeration unit on the front bulkhead for produce, meat, dairy, and pharma. Single-temp holds one temperature end to end, from about minus ten to eighty. Multi-temp uses insulated bulkheads to split the box into zones — frozen up front, fresh in back. Continuous runs the compressor nonstop; cycle-sentry cycles the engine to save fuel but risks temp swings. Cryogenic uses liquid nitrogen or CO2 instead of a diesel engine — silent, for sensitive pharma.",
    keywords: 'reefer, refrigerated, single temp, multi temp, continuous, cycle sentry, cryogenic, setpoint, bulkhead, produce, pharma',
  },
  {
    seedKey: 'qa-reefer-froze',
    category: 'qa',
    subcategory: 'reefer',
    topic: "Reefer set to 34°F but the produce froze — what happened?",
    content:
      "Cold air drops, so the floor runs colder than the ceiling, and the discharge air is colder than your setpoint. Set the return-air temperature to thirty-four, not the discharge air. Rule of thumb: setpoint minus return air is your delta — read the return sensor near the floor.",
    keywords: 'reefer froze, produce frozen, setpoint, return air, discharge air, delta, cold air drops, sensor',
  },
  {
    seedKey: 'qa-reefer-rejection',
    category: 'qa',
    subcategory: 'reefer',
    topic: 'Receiver says the meat is 2°F too warm and is rejecting it — what do I do?',
    content:
      "Don't let them reject on the spot. Ask for a calibration check of their probe against a certified thermometer — if their probe's off, the product's fine. If your reefer actually failed, call dispatch for emergency repair; if it truly spoiled, the cargo claim can be fifty grand or more, so document everything.",
    keywords: 'reefer rejection, meat too warm, calibration check, probe, certified thermometer, cargo claim, spoiled, reject load',
  },
  {
    seedKey: 'qa-reefer-pretrip',
    category: 'qa',
    subcategory: 'reefer',
    topic: 'Why is a pretrip different for a reefer vs a dry van?',
    content:
      "You also check the reefer's diesel, coolant, belts, and error codes, and you pre-cool the box to the setpoint an hour or two before loading. Pick up with a hot trailer and you'll never pull the freight down to temp in time.",
    keywords: 'reefer pretrip, pull down, precool, diesel level, coolant, belts, error codes, hot trailer, setpoint before load',
  },

  // ── 9. STEP DECK (DROP DECK) ──────────────────────────────────────────────────
  {
    seedKey: 'trailer-stepdeck-types',
    category: 'trailers',
    subcategory: 'step-deck',
    topic: 'Step deck (drop deck) sub-types',
    content:
      "A step deck is a flatbed with two heights — a short upper deck over the tractor and a longer, lower deck — so freight can beat the flatbed height limit. A straight step deck has a fixed four-to-five-foot upper and a ten-to-twelve-foot lower. A sliding-axle step deck moves the rear axles to shift weight for different cargo lengths. Single-drop steps down once; double-drop steps down twice and sits even lower. Some come with detachable ramps for loading machinery onto the lower deck.",
    keywords: 'step deck, drop deck, straight, sliding axle, single drop, double drop, ramps, lower deck, upper deck, height',
  },
  {
    seedKey: 'qa-stepdeck-vs-flatbed',
    category: 'qa',
    subcategory: 'step-deck',
    topic: 'Why choose a step deck over a flatbed for the same load?',
    content:
      "Legal height — thirteen-six. A flatbed deck sits about five feet off the ground; a step deck's lower deck sits around three and a half. That extra foot and a half of clearance lets you haul tall cargo without an oversize permit.",
    keywords: 'step deck vs flatbed, why step deck, height clearance, 13 6, lower deck, tall cargo, avoid permit',
  },
  {
    seedKey: 'qa-stepdeck-weight-placement',
    category: 'qa',
    subcategory: 'step-deck',
    topic: "I'm loading a large tank on a step deck — where does the weight go?",
    content:
      "Put the heaviest part over the upper deck or over the trailer axles, never in the middle of the lower deck where there's less structural support. Run a weight-distribution check so your kingpin weight isn't too light.",
    keywords: 'step deck weight, weight placement, upper deck, over axles, kingpin weight, distribution, structural support',
  },
  {
    seedKey: 'qa-stepdeck-backing',
    category: 'qa',
    subcategory: 'step-deck',
    topic: 'Trick to backing a step deck into a tight bay?',
    content:
      "You can't see the lower deck over your mirrors, so use a spotter. Alone, get out and look, repeatedly. The longer wheelbase tracks wide, so you need a lot more room to swing than a van.",
    keywords: 'backing step deck, spotter, goal, get out and look, blind, wheelbase, tracks wide, tight bay',
  },

  // ── 10. TANKER ───────────────────────────────────────────────────────────────
  {
    seedKey: 'trailer-tanker-types',
    category: 'trailers',
    subcategory: 'tanker',
    topic: 'Tanker sub-types',
    content:
      "A tanker hauls liquids, gases, or food-grade fluids and needs careful handling for liquid surge. A compartmented tanker splits into two to five compartments for multiple liquids at once — gas, diesel, ethanol. A food-grade sanitary tanker is polished stainless for milk, juice, oil, or wine, and demands strict washout certs. A hazmat tanker carries flammable, corrosive, or explosive liquids and needs the hazmat (H) endorsement. An asphalt or molten tanker is insulated with heating coils. A gas or pressure tanker holds liquefied gas like propane or anhydrous ammonia under high PSI.",
    keywords: 'tanker, compartmented, food grade, sanitary, hazmat, asphalt, molten, pressure, propane, ammonia, liquid surge, baffle',
  },
  {
    seedKey: 'qa-tanker-surge',
    category: 'qa',
    subcategory: 'tanker',
    topic: 'What is liquid surge and why is it dangerous?',
    content:
      "When you brake, the liquid sloshes forward against the front bulkhead then rebounds, surging the truck forward and stretching your stopping distance by up to thirty percent. Brake gradually, no sudden lane changes, and know that a partially filled tank is more dangerous in a turn than a full one.",
    keywords: 'liquid surge, sloshing, stopping distance, brake gradually, bulkhead, partial load, tanker danger, surge',
  },
  {
    seedKey: 'qa-tanker-baffles',
    category: 'qa',
    subcategory: 'tanker',
    topic: 'Why do I need baffles, and are they always good?',
    content:
      "Baffles are internal walls with holes that cut surge and smooth your braking. The trade-off: they make cleaning hard, so food-grade tanks often skip them. A non-baffled smooth-bore tank surges harder, so you drive even slower.",
    keywords: 'baffles, smooth bore, surge reduction, food grade no baffle, cleaning, slower, tanker walls',
  },
  {
    seedKey: 'qa-tanker-overload',
    category: 'qa',
    subcategory: 'tanker',
    topic: 'The shipper overloaded my tanker — how do I know without a scale?',
    content:
      "Check the load line or dip stick. Every tank has a max fill for the product's specific gravity. Heavy products like sulfuric acid only fill to about eighty percent capacity or you're over weight. You fill by weight, not by volume.",
    keywords: 'tanker overload, load line, dip stick, specific gravity, fill by weight, sulfuric acid, 80 percent, overweight',
  },
  {
    seedKey: 'qa-tanker-vapor-cutoff',
    category: 'qa',
    subcategory: 'tanker',
    topic: 'The hazmat pump at the terminal keeps cutting off — why?',
    content:
      "It's the vapor recovery system sensing back-pressure. Make sure your vapor hose is on the terminal's recovery line and your pressure-relief valves work. Repeated cutoffs mean static is building — an explosion risk — so stop and ground the trailer immediately.",
    keywords: 'vapor recovery, pump cutoff, back pressure, hazmat terminal, static, ground trailer, pressure relief, explosion risk',
  },

  // ── Freight / Cargo Types & Legal Limits manual ──────────────────────

  {
    seedKey: 'ftl-manual',
    category: 'load-types',
    subcategory: 'ftl',
    topic: 'Full Truckload (FTL) and its sub-types',
    content:
      "Full truckload means one shipper's freight fills the whole trailer and runs direct from point A to point B — no terminals, no sorting. The main flavors: expedited FTL is time-critical, dedicated tractor, often a team running non-stop; drop-trailer FTL means you drop the loaded trailer and grab a pre-loaded backhaul so the tractor never waits; live load or unload means you stay with the trailer while they work it, which starts detention pay after the free time, usually two hours; spot-market FTL is a one-off load off a board or broker priced by the day's supply and demand; and dedicated contract FTL is a six to twelve month deal running the same lane over and over for a fixed rate.",
    keywords: 'FTL, full truckload, expedited, drop trailer, live load, live unload, detention, spot market, dedicated contract, lane, direct',
  },
  {
    seedKey: 'qa-ftl-simpler',
    category: 'qa',
    subcategory: 'ftl',
    topic: 'Why is a full truckload simpler for the driver than LTL?',
    content:
      "Because you've got one bill of lading, one pickup, one delivery, and one set of paperwork. You're not sorting pallets, juggling appointments in different cities, or sitting at terminals waiting for a re-sort. It keeps your on-duty yard time to a minimum.",
    keywords: 'FTL simpler, one BOL, single pickup, single delivery, no sorting, yard time, versus LTL',
  },
  {
    seedKey: 'qa-ftl-pricing',
    category: 'qa',
    subcategory: 'ftl',
    topic: 'Is a full truckload priced per mile or per load?',
    content:
      "Depends on the lane. Per mile is standard on long hauls of five hundred miles or more where fuel and distance are the big costs. Per load is used on short regional runs where the time spent loading and the empty deadhead miles matter more than the actual distance.",
    keywords: 'FTL pricing, per mile, per load, long haul, short haul, regional, deadhead, lane rate',
  },
  {
    seedKey: 'qa-ftl-light',
    category: 'qa',
    subcategory: 'ftl',
    topic: 'The shipper only has twelve pallets but a 53-foot trailer — is it still FTL?',
    content:
      "Yes, it's still full truckload if you're taking it direct. It's just a light FTL, and the rate gets negotiated as a minimum charge because you're tying up the whole trailer even though the weight and cube aren't maxed out.",
    keywords: 'light FTL, twelve pallets, minimum charge, whole trailer, direct, not maxed out, cube weight',
  },
  {
    seedKey: 'qa-ftl-split-stop',
    category: 'qa',
    subcategory: 'ftl',
    topic: 'A broker wants to add a split stop to my FTL load mid-trip — what do I do?',
    content:
      "Demand a new rate con and an added stop charge, usually a hundred fifty to three hundred dollars per extra stop. Your original rate was for a direct run — an extra stop means more fuel, more time, and more liability, so it has to be paid for and in writing before you agree.",
    keywords: 'split stop, extra stop charge, new rate con, 150 to 300, direct route, accessorial, mid-trip, in writing',
  },
  {
    seedKey: 'hazmat-manual',
    category: 'load-types',
    subcategory: 'hazmat',
    topic: 'Hazmat loads and their hazard classes',
    content:
      "Hazmat is any shipment that's flammable, corrosive, toxic, explosive, or radioactive — it needs special handling, paperwork, and a driver with the endorsement. The classes you'll see: Class three flammable and combustible liquids like gas, diesel, ethanol, and paint; Class eight corrosives like sulfuric acid and battery fluid; Class two gases like propane, chlorine, and anhydrous ammonia, usually in pressure tankers; Class one explosives like fireworks and ammunition, heavily restricted; Class seven radioactive like medical isotopes needing radiation monitoring; and inhalation-hazard loads like anhydrous ammonia and chlorine gas that carry route restrictions and extra training.",
    keywords: 'hazmat, hazardous materials, class 3 flammable, class 8 corrosive, class 2 gas, class 1 explosive, class 7 radioactive, inhalation hazard, endorsement, placards',
  },
  {
    seedKey: 'qa-hazmat-docs',
    category: 'qa',
    subcategory: 'hazmat',
    topic: 'What documents do I need in the cab for a hazmat load?',
    content:
      "You carry the hazmat shipping papers showing the UN number, proper shipping name, hazard class, packing group, and quantity. Keep the Emergency Response Guidebook within reach. Display the right placards — one on each side and each end of the trailer. And have a route plan that avoids restricted tunnels and bridges.",
    keywords: 'hazmat documents, shipping papers, UN number, proper shipping name, hazard class, packing group, ERG, emergency response guidebook, placards, route plan',
  },
  {
    seedKey: 'qa-hazmat-limited-qty',
    category: 'qa',
    subcategory: 'hazmat',
    topic: 'The load is a limited quantity of hazmat — do I still need to placard?',
    content:
      "No. Limited-quantity and excepted-quantity shipments are exempt from placarding and most of the paperwork as long as each package stays under the weight threshold, usually under sixty-six pounds. But you still need the hazmat endorsement on your license just to haul it.",
    keywords: 'limited quantity, excepted quantity, no placard, exempt, 66 pounds, endorsement required, small hazmat',
  },
  {
    seedKey: 'qa-hazmat-tunnel',
    category: 'qa',
    subcategory: 'hazmat',
    topic: "I'm coming up on a tunnel marked No Hazmat — what do I do?",
    content:
      "Take the posted alternate route. This is exactly why you plan the route before dispatch. Cross that tunnel anyway and you're looking at fines up to ten thousand dollars and possible arrest. You detour, even if it adds a hundred miles.",
    keywords: 'no hazmat tunnel, alternate route, route restriction, ten thousand fine, arrest, detour, plan route, bridge restriction',
  },
  {
    seedKey: 'qa-hazmat-packing-group',
    category: 'qa',
    subcategory: 'hazmat',
    topic: 'What does the packing group — one, two, or three — mean on a hazmat BOL?',
    content:
      "It's the degree of danger. Packing group one is great danger, like a highly volatile gas. Group two is medium danger. Group three is minor. It drives how strong the packaging has to be, the placarding level, and the rules for keeping different classes apart on the same trailer.",
    keywords: 'packing group, PG I, PG II, PG III, degree of danger, packaging strength, segregation, hazmat BOL, mixing classes',
  },
  {
    seedKey: 'sizelimit-manual',
    category: 'regulations',
    subcategory: 'size-limits',
    topic: 'Legal size limits — width, height, length, and overhang',
    content:
      "These are the max dimensions you can run without an oversize permit. Width is eight feet six inches, that's a hundred and two inches. Height is thirteen feet six inches from the ground to the highest point of the load — that's the national standard, though a few states allow fourteen feet on certain highways. Length is fifty-three feet for a semi-trailer on the national network, with some states allowing fifty-seven to sixty feet off the interstate. Rear overhang can't stick out more than four feet past the rear axle without a permit. Go over any of these and you're into the oversize permit process.",
    keywords: 'legal size limits, width 8 foot 6, 102 inches, height 13 foot 6, length 53 foot, overhang 4 feet, oversize permit, national network, dimensions',
  },
  {
    seedKey: 'qa-size-one-inch',
    category: 'qa',
    subcategory: 'size-limits',
    topic: "My flatbed load is eight foot seven — just one inch over. Do I really need a permit?",
    content:
      "Yes. There's no grace inch. One inch over eight foot six and you're legally an oversize load needing a permit. Officers use laser measurers at the scales, fines for an inch over run five hundred to a thousand dollars, and they'll make you unload right there on the shoulder.",
    keywords: 'one inch over, no grace inch, 8 foot 7, oversize permit, laser measure, fine 500 1000, unload on shoulder, width',
  },
  {
    seedKey: 'qa-size-air-down',
    category: 'qa',
    subcategory: 'size-limits',
    topic: 'My load is thirteen foot eight tall — can I air down the suspension to lower it?',
    content:
      "You can dump the air bags for a second to clear one low bridge, but you can't run highway speeds like that — it wrecks the suspension. For the whole trip you have to be under thirteen foot six at normal ride height. If you're over, you need a height permit, and that usually locks you onto specific low-clearance routes.",
    keywords: 'air down suspension, dump air bags, low bridge, 13 foot 8, ride height, height permit, low clearance route, cannot run highway',
  },
  {
    seedKey: 'qa-size-measure-height',
    category: 'qa',
    subcategory: 'size-limits',
    topic: 'How do I measure my load height to be sure I comply?',
    content:
      "Use a height stick — a telescoping pole with a tape — standing on level ground. Measure from the pavement to the highest fixed point on the load, including straps, dunnage, or any antenna. Never guess. Always measure before you pull off the shipper's lot.",
    keywords: 'measure height, height stick, telescoping pole, level ground, highest point, straps dunnage, measure before leaving, compliance',
  },
  {
    seedKey: 'qa-size-57-foot',
    category: 'qa',
    subcategory: 'size-limits',
    topic: 'Can I run a fifty-seven-foot trailer on any road?',
    content:
      "No. Fifty-seven footers are only legal on the designated national network — the interstates and certain highways. Take one onto a state or county road and you're violating the length law and can get cited.",
    keywords: '57 foot trailer, national network, interstate only, state road, county road, length law, citation',
  },
  {
    seedKey: 'weightlimit-manual',
    category: 'regulations',
    subcategory: 'weight-limits',
    topic: 'Legal weight limits — gross, axle, and the bridge formula',
    content:
      "These are the max weights you can carry without an overweight permit, and the scales enforce them hard. Gross vehicle weight — truck, trailer, and cargo together — tops out at eighty thousand pounds federal. The steer axle maxes at twelve thousand, though some states allow thirteen or fourteen with heavy-duty tires. The drive tandems max at thirty-four thousand across two axles spaced at least four feet apart, and the trailer tandems also max at thirty-four thousand. On top of that the federal bridge formula limits weight based on how many axles you have and how far apart the first and last are — it keeps concentrated weight from crushing bridges.",
    keywords: 'legal weight limits, gross vehicle weight, 80000 pounds, steer axle 12000, drive tandem 34000, trailer tandem 34000, bridge formula, overweight permit, axle spacing',
  },
  {
    seedKey: 'qa-weight-slide-tandems',
    category: 'qa',
    subcategory: 'weight-limits',
    topic: 'My CAT ticket shows seventy-nine five gross but drives at thirty-four five — can I run?',
    content:
      "No. You're overweight on the drives. Slide your trailer tandems forward to pull weight off the drives and onto the trailer axles, then get a re-weigh ticket proving you're under thirty-four thousand on the drives before you touch the road.",
    keywords: 'CAT scale, overweight drives, 34500, slide tandems forward, shift weight, re-weigh, under 34000, gross under 80000',
  },
  {
    seedKey: 'qa-weight-bridge-formula',
    category: 'qa',
    subcategory: 'weight-limits',
    topic: 'What is the bridge formula and how does it affect me?',
    content:
      "The bridge formula says the weight on any group of axles can't be more than five hundred pounds times the distance in feet between the outermost axles of that group, capped at eighty thousand overall. In plain terms, if you're heavy you can't bunch your axles too close together — too short a spread and you're overweight for the bridge even when you're under eighty thousand gross.",
    keywords: 'bridge formula, 500 pounds per foot, axle spread, outermost axles, concentrated weight, overweight bridge, under 80000 gross',
  },
  {
    seedKey: 'qa-weight-steer-tire',
    category: 'qa',
    subcategory: 'weight-limits',
    topic: "My steer is eleven five, under twelve thousand — why did the officer still write me?",
    content:
      "Because the tire's load rating counts too. If each steer tire is rated for six thousand pounds, eleven five is fine. But if you're on super singles rated for five thousand each — ten thousand total — you're over the tire limit even though you're under the axle limit. Always check the tire rating and the PSI.",
    keywords: 'steer axle, 11500, tire load rating, super single, tire limit versus axle limit, PSI, 6000 per tire, ticket',
  },
  {
    seedKey: 'qa-weight-tare',
    category: 'qa',
    subcategory: 'weight-limits',
    topic: "Shipper says they loaded forty-five thousand of cargo but I'm over gross — how?",
    content:
      "Because you forgot the tractor, the trailer, and the fuel. A sleeper tractor runs eighteen to twenty thousand pounds, a dry van trailer fourteen to fifteen thousand, and a hundred fifty gallons of diesel about a thousand. That's around thirty-five thousand empty. So forty-five thousand of cargo already puts you at eighty thousand — one more pound of freight and you're over.",
    keywords: 'tare weight, tractor weight, trailer weight, fuel weight, 35000 empty, 45000 cargo, 80000 gross, overweight math',
  },
  {
    seedKey: 'ltl-manual',
    category: 'load-types',
    subcategory: 'ltl',
    topic: 'Less-than-Truckload (LTL) and its sub-types',
    content:
      "LTL means freight from several shippers rides one trailer, moves through regional terminals, and gets split back out to different consignees. The types: standard LTL is pallets from a hundred up to ten thousand pounds moving through a hub-and-spoke network; expedited LTL is faster transit for a higher rate; residential LTL needs a liftgate and a two-person delivery, so it costs more; trade-show or exhibit LTL is time-critical and often needs last-mile delivery to a convention center; and the freight class, the NMFC, drives the price by density and stowability — class fifty is low density and cheap, class five hundred is high density and expensive.",
    keywords: 'LTL, less than truckload, hub and spoke, terminals, consignees, standard, expedited, residential, liftgate, trade show, freight class, NMFC, density',
  },
  {
    seedKey: 'qa-ltl-slower',
    category: 'qa',
    subcategory: 'ltl',
    topic: 'Why does an LTL load take two or three days longer than FTL over the same distance?',
    content:
      "Because your pallet isn't going direct. It runs shipper to local terminal, gets sorted, linehauls to a hub, gets sorted again, goes to the destination terminal, sorts once more, then local delivery. It can be loaded and unloaded three or four times and waits at every terminal for its scheduled departure.",
    keywords: 'LTL slower, not direct, terminal sort, linehaul, hub, multiple handling, departure window, transit time versus FTL',
  },
  {
    seedKey: 'qa-ltl-consolidation',
    category: 'qa',
    subcategory: 'ltl',
    topic: 'The dock has twenty BOLs for twenty shippers going to five destinations — what do I do?',
    content:
      "That's a consolidation load. Sort them by destination using the route sheet or stop sequence the app gives you. Don't mix them up — a pallet delivered to the wrong city triggers a big claim. And each BOL gets signed separately at its own stop.",
    keywords: 'consolidation load, twenty BOLs, multiple shippers, sort by destination, route sheet, stop sequence, sign separately, wrong city claim',
  },
  {
    seedKey: 'qa-ltl-density',
    category: 'qa',
    subcategory: 'ltl',
    topic: 'What is the density rule in LTL pricing?',
    content:
      "If a pallet eats a lot of space but weighs little — like toilet paper — it's priced by volume, by cubic feet. If it's small but heavy — like machine parts — it's priced by weight. Carriers work out density in pounds per cubic foot to set the freight class. The lower the density, the higher the class and the higher the rate.",
    keywords: 'density rule, LTL pricing, cubic feet, volume, weight, pounds per cubic foot, freight class, low density high class, rate',
  },
  {
    seedKey: 'qa-ltl-refuse-damaged',
    category: 'qa',
    subcategory: 'ltl',
    topic: 'Can I refuse an LTL pallet that is crushed or leaning at pickup?',
    content:
      "Yes, and you should. Accept damaged packaging at pickup and the receiver blames you for it at delivery. Write on the BOL that the packaging was damaged at pickup and refused by the driver, take photos, and call dispatch. Don't load a compromised pallet.",
    keywords: 'refuse damaged pallet, crushed, leaning, packaging damaged at pickup, note on BOL, photos, call dispatch, protect against claim',
  },
  {
    seedKey: 'partial-manual',
    category: 'load-types',
    subcategory: 'partial',
    topic: 'Partial / Volume loads and their sub-types',
    content:
      "A partial sits between LTL and FTL — the trailer is shared with one to three other shippers, but the freight moves on a single dedicated route with no big sorting terminals. The flavors: exclusive-use partial has the broker reserve the whole trailer for a few shippers on a dedicated route; volume LTL is where one shipper takes six to twelve linear feet, say eight pallets, priced by the linear foot instead of freight class; transload partial combines with FTL freight at a cross-dock; and hot-shot partial is smaller freight on a pickup with a gooseneck, common in oilfield and expedited work.",
    keywords: 'partial load, volume load, shared trailer, dedicated route, exclusive use, volume LTL, linear foot, transload, cross dock, hot shot, gooseneck',
  },
  {
    seedKey: 'qa-partial-vs-ltl',
    category: 'qa',
    subcategory: 'partial',
    topic: 'How is a partial different from an LTL load?',
    content:
      "LTL runs through a hub-and-spoke network with multiple terminals. A partial goes direct from A to B with just one to three pickups and one to three deliveries, skipping the sorting terminals. That makes a partial faster and lowers damage risk because the freight gets handled less.",
    keywords: 'partial versus LTL, direct, no terminals, fewer stops, less handling, faster, lower damage risk, hub and spoke',
  },
  {
    seedKey: 'qa-partial-per-mile',
    category: 'qa',
    subcategory: 'partial',
    topic: 'I have eight pallets, the broker calls it a partial but the rate is per mile — is that right?',
    content:
      "Yes. Partials are often priced per mile like FTL because the truck makes a dedicated run. Since you're sharing the trailer, the per-mile rate is lower than a full truckload but still higher than LTL, which is priced per hundred pounds.",
    keywords: 'partial per mile, eight pallets, dedicated run, lower than FTL, higher than LTL, per hundredweight, CWT, shared trailer',
  },
  {
    seedKey: 'qa-partial-off-route',
    category: 'qa',
    subcategory: 'partial',
    topic: 'The second pickup on my partial is forty miles off route — how do I get paid for it?',
    content:
      "Charge an accessorial for the off-route mileage, usually two to three dollars a mile for the deviation, or take the minimum charge the broker offers for the partial. Never run off-route until the extra rate is approved and written into the rate con.",
    keywords: 'off route mileage, accessorial, 2 to 3 dollars per mile, deviation, minimum charge, approved in writing, rate con, second pickup',
  },
  {
    seedKey: 'qa-partial-weight-dist',
    category: 'qa',
    subcategory: 'partial',
    topic: 'First shipper loads twenty thousand, second adds five thousand — can I legally take it?',
    content:
      "Yes, as long as the total stays under eighty thousand gross. But check how it's spread across the axles. If the first shipper loaded heavy up front, the second shipper's lighter load in the rear can push your kingpin weight too high, and you'll have to re-position freight or slide the fifth wheel.",
    keywords: 'partial weight distribution, 20000 plus 5000, under 80000 gross, axle spread, kingpin weight, heavy front, slide fifth wheel, reposition',
  },
  {
    seedKey: 'tempcontrol-manual',
    category: 'load-types',
    subcategory: 'temp-controlled',
    topic: 'Temperature-controlled freight and its sub-types',
    content:
      "Temp-controlled freight needs an active reefer, heater, or cryo unit holding a set range the whole trip so it doesn't spoil. The ranges: chilled produce runs thirty-two to fifty-five degrees and needs humidity and airflow to keep ethylene gas from over-ripening it; frozen goods run negative ten to zero and need continuous cooling — even a two-hour stop can start thawing the edges; dairy runs thirty-four to forty and hates temperature swings; pharma often runs two to eight Celsius, that's thirty-six to forty-six Fahrenheit, with a tight tolerance, data loggers, and sometimes a backup unit; confectionery runs fifty-five to sixty-five so chocolate doesn't melt or bloom; and heated freight like asphalt or glue rides warm using the reefer in heat mode or a heated tanker.",
    keywords: 'temperature controlled, reefer, produce, frozen, dairy, pharma, data logger, confectionery, chocolate bloom, heated freight, setpoint, ethylene',
  },
  {
    seedKey: 'qa-temp-probe-vs-air',
    category: 'qa',
    subcategory: 'temp-controlled',
    topic: "Rate con setpoint is thirty-four but the receiver reads thirty-six — am I in trouble?",
    content:
      "Maybe not. First find out if they're using a probe stuck into the product or an air thermometer reading the box air. The FDA usually cares about product temperature, not air. If your reefer's data logger shows the air held thirty-four but the product never got below thirty-eight because the shipper didn't pre-cool it, that's on the shipper — note load not pre-cooled on the BOL.",
    keywords: 'setpoint 34, receiver reads 36, probe thermometer, air thermometer, product temperature, FDA, data logger, not pre-cooled, note on BOL, shipper fault',
  },
  {
    seedKey: 'qa-temp-continuous-cyclesentry',
    category: 'qa',
    subcategory: 'temp-controlled',
    topic: "What's the difference between continuous run and cycle-sentry on a reefer?",
    content:
      "Continuous run keeps the unit going twenty-four seven — steadiest temperature but burns more fuel. Cycle-sentry cycles the unit on and off to hold the setpoint and saves diesel. Use continuous for frozen at zero degrees; for produce around thirty-four, cycle-sentry is usually fine as long as you set the tolerance to about two degrees of swing.",
    keywords: 'continuous run, cycle sentry, reefer mode, steady temperature, fuel savings, frozen zero degrees, produce 34, tolerance 2 degrees',
  },
  {
    seedKey: 'qa-temp-airflow',
    category: 'qa',
    subcategory: 'temp-controlled',
    topic: 'The reefer is full and pallets are jammed against the front wall — what is the risk?',
    content:
      "You create a dead-air spot. The reefer blows cold along the ceiling, but if the pallets are flush to the front bulkhead the air can't circulate down the back and along the floor. That leaves hot spots in the middle where produce rots. Leave a six-inch air gap front and rear — that's the air-chute or T-shape loading.",
    keywords: 'airflow, dead air spot, front bulkhead, cold air ceiling, hot spot, produce rots, six inch air gap, air chute, T-shape loading',
  },
  {
    seedKey: 'qa-temp-out-of-fuel',
    category: 'qa',
    subcategory: 'temp-controlled',
    topic: 'What happens if my reefer runs out of fuel and the load spoils?',
    content:
      "You're on the hook for the whole cargo claim — often fifty to a hundred thousand dollars. That's why the number one reefer rule is never let the reefer tank drop below a quarter. Fuel the reefer separately from the tractor and set a low-fuel alarm if you've got one.",
    keywords: 'reefer out of fuel, load spoils, cargo claim, 50000 to 100000, liability, quarter tank rule, fuel reefer separately, low fuel alarm',
  },

  // ── Trucks manual (tractor & straight-truck types) ───────────────────

  {
    seedKey: 'daycab-manual',
    category: 'trucks',
    subcategory: 'day-cab',
    topic: 'Day cab tractor and its sub-types',
    content:
      "A day cab is a Class eight tractor with no sleeper berth, built for regional, local, or dedicated runs where you get home or back to the yard at end of shift. It trades living space for maneuverability and payload. The flavors: standard day cab with a short wheelbase for port drayage, regional LTL, and foodservice; heavy-haul day cab with a beefed-up frame, bigger radiator, and five hundred plus horsepower for overweight construction and mining loads; slip-seat day cab shared by drivers across shifts on around-the-clock operations; and CNG or LNG day cabs running on natural gas for port yards and strict-emissions cities like California.",
    keywords: 'day cab, no sleeper, Class 8, regional, local, drayage, short wheelbase, heavy haul, slip seat, CNG, LNG, payload, maneuverability',
  },
  {
    seedKey: 'qa-daycab-vs-sleeper-400',
    category: 'qa',
    subcategory: 'day-cab',
    topic: 'Why pick a day cab over a sleeper for a four-hundred-mile run?',
    content:
      "Weight and turning. A day cab is roughly fifteen hundred to two thousand pounds lighter, so you can carry an extra pallet — about forty-five thousand five hundred payload versus forty-four thousand with a sleeper. The shorter wheelbase also makes it far easier to back into tight urban docks and work city streets.",
    keywords: 'day cab versus sleeper, 400 mile run, lighter 1500 2000, extra pallet, payload, short wheelbase, urban dock, city streets',
  },
  {
    seedKey: 'qa-daycab-loading-delay',
    category: 'qa',
    subcategory: 'day-cab',
    topic: "I'm in a day cab and the shipper says three-hour loading delay — what are my options?",
    content:
      "You've got no bunk to rest in, so that delay burns straight into your fourteen-hour on-duty clock. Tell dispatch right away and charge detention. If the delay pushes you past the fourteen-hour limit you have to demand a layover or reschedule the delivery — you can't just drive over the clock.",
    keywords: 'day cab loading delay, no bunk, 14 hour clock, detention, layover, reschedule, over hours, HOS',
  },
  {
    seedKey: 'qa-daycab-overnight',
    category: 'qa',
    subcategory: 'day-cab',
    topic: 'Can I do an overnight run in a day cab legally?',
    content:
      "Yes, but you still owe the ten-hour off-duty break. With no sleeper berth you have to get a hotel or go home for those ten hours. Sleeping in the driver's seat does not count as off-duty time — only a sleeper berth counts for that.",
    keywords: 'day cab overnight, 10 hour off duty, no sleeper berth, hotel, driver seat not off duty, HOS compliance',
  },
  {
    seedKey: 'qa-daycab-drayage',
    category: 'qa',
    subcategory: 'day-cab',
    topic: 'Why are day cabs so common in port drayage?',
    content:
      "Ports have tight stacking yards and narrow lanes, and the day cab's short wheelbase gives you a sharper turning radius to work them. On top of that, drayage drivers usually run local eight-to-ten-hour shifts and don't need a place to sleep, so there's no reason to carry the extra weight of a bunk.",
    keywords: 'day cab drayage, port, tight yard, narrow lane, short wheelbase, turning radius, local shift, no sleeper needed',
  },
  {
    seedKey: 'sleeper-manual',
    category: 'trucks',
    subcategory: 'sleeper-cab',
    topic: 'Sleeper cab tractor and its sub-types',
    content:
      "A sleeper cab is a Class eight tractor with a bunk behind the seats, built for over-the-road drivers away from home for days or weeks — the standard for long haul. The types: mid-roof sleeper with a shorter bunk, thirty-six to forty-eight inches, lighter and better on fuel; raised-roof or high-rise sleeper, sixty to eighty inches, tall enough to stand up in; studio or flat-floor sleeper with the engine tunnel flattened for cabinets, a fridge, and a microwave; team sleeper with upper and lower bunks so two drivers can run the truck around the clock; and ultra-light sleeper that strips out amenities to save weight and max payload on heavy lanes.",
    keywords: 'sleeper cab, bunk, over the road, OTR, long haul, mid roof, raised roof, high rise, studio, flat floor, team sleeper, dual bunk, ultra light',
  },
  {
    seedKey: 'qa-sleeper-offduty',
    category: 'qa',
    subcategory: 'sleeper-cab',
    topic: 'Does sleeper berth time count as off-duty even if I am not asleep?',
    content:
      "Yes. Under FMCSA rules any time in the sleeper berth counts as off-duty as long as you're resting and not working — not doing paperwork or taking dispatch calls. And you can split the ten-hour break into two pieces, an eight-and-two or seven-and-three, if you're running the sleeper-berth exception.",
    keywords: 'sleeper berth off duty, FMCSA, resting not working, split break, 8 2, 7 3, sleeper berth exception, HOS',
  },
  {
    seedKey: 'qa-sleeper-steer-weight',
    category: 'qa',
    subcategory: 'sleeper-cab',
    topic: "I'm heavy at forty-four thousand and my steer is over — how does the sleeper factor in?",
    content:
      "The sleeper adds weight behind the cab, which pushes more load onto your steer axle. Slide your fifth wheel backward to shift weight off the steers. And remember that a sleeper generally costs you a thousand to two thousand pounds of payload versus a day cab at the same gross.",
    keywords: 'sleeper steer axle overweight, 44000, weight behind cab, slide fifth wheel back, payload penalty, 1000 2000 pounds',
  },
  {
    seedKey: 'qa-sleeper-team-single-bunk',
    category: 'qa',
    subcategory: 'sleeper-cab',
    topic: 'Can I run team driving in a single-bunk sleeper?',
    content:
      "No. Team driving needs a dual-bunk sleeper. A single bunk only rests one driver at a time, so if you've got two drivers and one bunk somebody is always on duty — which kills the whole point of running as a team.",
    keywords: 'team driving, single bunk, dual bunk required, two drivers, one always on duty, sleeper',
  },
  {
    seedKey: 'qa-sleeper-split',
    category: 'qa',
    subcategory: 'sleeper-cab',
    topic: 'What is the ten-hour sleeper-berth split rule?',
    content:
      "Instead of ten straight hours off, you split it: one stretch of at least eight consecutive hours in the sleeper, and another of at least two consecutive hours off-duty, in the sleeper or out. That pauses your fourteen-hour clock. The catch — the eight-hour piece has to be in the sleeper berth; you can't take it in a hotel and call it a split.",
    keywords: 'sleeper berth split, 10 hour, 8 consecutive sleeper, 2 consecutive off, pause 14 hour clock, cannot use hotel, HOS',
  },
  {
    seedKey: 'boxtruck-manual',
    category: 'trucks',
    subcategory: 'box-truck',
    topic: 'Straight truck / box truck and its sub-types',
    content:
      "A straight truck has the cab and cargo box on one chassis — no fifth wheel, no separate trailer. It's built for local delivery, expedited freight, and smaller loads. The types: Class three through six box trucks under twenty-six thousand pounds, which need no CDL in most states, used for furniture, parcel carriers, and hot-shot work; Class seven box trucks from twenty-six to thirty-three thousand needing a Class B CDL with air brakes, for beverage and bigger palletized loads; refrigerated box trucks with a reefer unit for local produce and catering; liftgate-equipped trucks with a hydraulic tailgate for dockless delivery; and the rare box truck with a small sleeper for expedited team runs.",
    keywords: 'straight truck, box truck, single chassis, no fifth wheel, local delivery, Class 3 to 6, Class 7, no CDL under 26000, Class B, reefer box, liftgate, sleeper',
  },
  {
    seedKey: 'qa-box-cdl-26k',
    category: 'qa',
    subcategory: 'box-truck',
    topic: 'Do I need a CDL to drive a twenty-six-thousand-pound box truck?',
    content:
      "No, as long as the truck's gross vehicle weight rating is twenty-six thousand or under and you're not hauling hazmat or pulling a trailer — a standard Class D license covers it. But the moment the combination of truck plus trailer goes over twenty-six thousand, you need a Class A.",
    keywords: 'box truck CDL, 26000 GVWR, no CDL, Class D, no hazmat, no trailer, combination over 26000 needs Class A',
  },
  {
    seedKey: 'qa-box-overweight-28k',
    category: 'qa',
    subcategory: 'box-truck',
    topic: 'A broker offers a twenty-eight-thousand-pound load for my twenty-six-thousand box truck — can I take it?',
    content:
      "No. You can't legally haul cargo that puts you over the truck's gross rating. Twenty-six thousand includes the truck itself plus fuel plus cargo. Know your empty tare weight to figure your real payload — on a twenty-six-thousand truck that's usually only twelve to fourteen thousand pounds of freight.",
    keywords: 'box truck overweight, 28000 load, 26000 GVWR, includes truck fuel cargo, tare weight, payload 12000 14000',
  },
  {
    seedKey: 'qa-box-lastmile',
    category: 'qa',
    subcategory: 'box-truck',
    topic: 'Why are box trucks preferred for last-mile delivery?',
    content:
      "They're short, agile, and can work residential streets, narrow alleys, and tight lots a fifty-three-foot trailer can't touch. Their lower load height also lets one driver with a hand truck or pallet jack deliver into stores that don't have a dock.",
    keywords: 'box truck last mile, short agile, residential, alley, tight lot, low load height, hand truck, pallet jack, no dock',
  },
  {
    seedKey: 'qa-box-airbrakes-cdl',
    category: 'qa',
    subcategory: 'box-truck',
    topic: 'My box truck has air brakes — does that require a CDL?',
    content:
      "Not by itself. The CDL trigger is gross weight rating, not brake type. Under twenty-six thousand you don't need a CDL even with air brakes. That said, some states still want an air-brake endorsement on your non-CDL license to run air-brake systems, so check your state.",
    keywords: 'box truck air brakes, CDL, based on GVWR not brakes, under 26000 no CDL, air brake endorsement, state rules',
  },
  {
    seedKey: 'weightclass-manual',
    category: 'trucks',
    subcategory: 'weight-classes',
    topic: 'Truck weight classes (FHWA GVWR system)',
    content:
      "The Federal Highway Administration sorts trucks by gross vehicle weight rating, and that drives licensing, road access, and registration cost. Class one and two, light duty up to ten thousand pounds — pickups and cargo vans. Class three through six, medium duty from ten to twenty-six thousand — box trucks, delivery trucks, stake beds, dump trucks. Class seven, heavy medium duty from twenty-six to thirty-three thousand, needing a Class B CDL — refuse trucks, big box trucks, city buses. Class eight, over thirty-three thousand — the semis, where sleepers, day cabs, and heavy-haul tractors live pulling fifty-three-foot vans, lowboys, and tankers, usually up to eighty thousand gross, more with permits.",
    keywords: 'truck weight classes, FHWA, GVWR, Class 1 2 light duty, Class 3 to 6 medium, Class 7 Class B, Class 8 semi, 80000 gross, licensing',
  },
  {
    seedKey: 'qa-class8-focus',
    category: 'qa',
    subcategory: 'weight-classes',
    topic: 'Why is Class 8 the main focus of freight work?',
    content:
      "Because Class eight moves the vast majority of over-the-road freight — full truckload, LTL, reefer, flatbed. It's got the payload, up to forty-five thousand pounds, and the cube of a fifty-three-foot trailer to haul freight cost-effectively. Medium-duty Class three through six trucks are mostly local and regional with much smaller volumes.",
    keywords: 'Class 8 focus, over the road freight, FTL LTL reefer flatbed, payload 45000, 53 foot cube, medium duty local',
  },
  {
    seedKey: 'qa-class-gvwr-vs-actual',
    category: 'qa',
    subcategory: 'weight-classes',
    topic: "My truck is rated thirty thousand GVWR — what's the difference between GVWR and actual weight?",
    content:
      "GVWR is the manufacturer's maximum for the fully loaded truck — chassis, body, fuel, driver, and cargo. Actual weight is what you really scale on the CAT. You never exceed the GVWR, and your payload capacity is simply the GVWR minus the truck's empty tare weight.",
    keywords: 'GVWR versus actual weight, 30000 rating, manufacturer maximum, scale weight, never exceed, payload equals GVWR minus tare',
  },
  {
    seedKey: 'qa-class8-any-trailer',
    category: 'qa',
    subcategory: 'weight-classes',
    topic: 'If I have a Class 8 truck, can I legally pull any trailer?',
    content:
      "No. You have to match the tractor to the trailer's weight and hitch. You can't pull a pneumatic tanker on a standard van fifth wheel — tankers need a specific adapter and different air-line hookups. And your gross combined weight rating has to be higher than the truck, trailer, and cargo added together.",
    keywords: 'Class 8 any trailer, match tractor to trailer, pneumatic tanker adapter, air lines, GCWR, gross combined weight rating',
  },
  {
    seedKey: 'qa-class8-heavyhaul',
    category: 'qa',
    subcategory: 'weight-classes',
    topic: 'What is a Class 8 heavy-haul truck and how is it different?',
    content:
      "A heavy-haul Class eight has a stronger frame, a bigger cooling system, more horsepower — five to six hundred — and a heavier front axle rated up to twenty thousand pounds. It's built to pull RGNs and lowboys carrying excavators, dozers, and transformers weighing sixty to a hundred twenty thousand pounds, which need overweight permits.",
    keywords: 'Class 8 heavy haul, strong frame, big cooling, 500 600 horsepower, front axle 20000, RGN lowboy, excavator, overweight permit',
  },
  {
    seedKey: 'qa-class6-weighstation',
    category: 'qa',
    subcategory: 'weight-classes',
    topic: 'I drive a Class 6 box truck at twenty-five thousand — why do I still get pulled into scales?',
    content:
      "Because most states make any commercial vehicle over ten thousand pounds stop at the scales, no matter the class. The twenty-six-thousand line only decides whether you need a CDL — it has nothing to do with the weigh-station rule. Commercial and over ten thousand means you stop.",
    keywords: 'Class 6 weigh station, over 10000 pounds must stop, 26000 only affects CDL, commercial vehicle scale rule',
  },

  // ── Transport vehicles manual (support & specialized equipment) ──────

  {
    seedKey: 'yarddog-manual',
    category: 'trucks',
    subcategory: 'yard-dog',
    topic: 'Yard dog / yard jockey / spotter truck and its sub-types',
    content:
      "A yard dog is a short, nimble tractor used only inside freight yards and distribution centers to shuttle trailers between docks and staging spots — it almost never leaves the property. The types: a traditional yard dog with a fifth wheel, short wheelbase, single seat, and raised roof for visibility; an automatic spotter built for constant stop-and-go; an electric yard truck for zero-emission ports and warehouses; a remote-control yard dog run from the ground in tight high-precision yards; and a yard tractor with a lifting fifth wheel that hydraulically raises the trailer so you skip cranking the landing gear.",
    keywords: 'yard dog, yard jockey, spotter truck, freight yard, distribution center, short wheelbase, raised roof, automatic, electric, remote control, lifting fifth wheel',
  },
  {
    seedKey: 'qa-yarddog-public-road',
    category: 'qa',
    subcategory: 'yard-dog',
    topic: 'Can a yard dog be driven on public roads?',
    content:
      "Generally no. Yard dogs aren't DOT-compliant — they're missing the required lighting, mud flaps, speedometers, and highway-rated brakes. They're strictly for private property and aren't registered for public road use.",
    keywords: 'yard dog public road, not DOT compliant, no lighting mud flaps speedometer, private property, not registered',
  },
  {
    seedKey: 'qa-yarddog-visibility',
    category: 'qa',
    subcategory: 'yard-dog',
    topic: 'Why do yard dogs have a raised roof and extra windows?',
    content:
      "Visibility. A yard dog is constantly backing into tight dock doors and threading between parked trailers, so the raised roof and extra glass give you full three-sixty sightlines to kill blind spots and avoid clipping other trailers.",
    keywords: 'yard dog raised roof, extra windows, visibility, backing tight docks, parked trailers, blind spots, 360 view',
  },
  {
    seedKey: 'qa-yarddog-nolandinggear',
    category: 'qa',
    subcategory: 'yard-dog',
    topic: 'How does a yard dog move a trailer without cranking the landing gear?',
    content:
      "Its fifth wheel has a hydraulic lift. It raises the trailer a little so you can pull out from under the landing gear, set the trailer down, and position the next one — all without ever touching the crank handle.",
    keywords: 'yard dog hydraulic fifth wheel, lift trailer, no cranking landing gear, drop and position, spotter',
  },
  {
    seedKey: 'qa-yarddog-detention',
    category: 'qa',
    subcategory: 'yard-dog',
    topic: 'The yard dog took four hours to spot my trailer — is the shipper responsible for detention?',
    content:
      "Yes. The shipper has to provide a yard jockey to move your trailer to the dock in a reasonable time, usually one to two hours. If they're understaffed and you're stuck waiting in the queue, charge detention and note waiting for yard spotter on your BOL.",
    keywords: 'yard dog detention, shipper responsible, yard jockey, one to two hours, understaffed, charge detention, note on BOL',
  },
  {
    seedKey: 'hotshot-manual',
    category: 'trucks',
    subcategory: 'hot-shot',
    topic: 'Hot shot truck and its sub-types',
    content:
      "A hot shot is a medium-duty truck — often a one-ton pickup or Class three-to-five straight truck — pulling a small gooseneck or bumper-pull trailer for urgent, time-sensitive, or LTL freight, big in oilfield, automotive, and emergency work. The types: a hot-shot pickup like an F-450 or Ram 5500 pulling a thirty-to-forty-foot gooseneck, no CDL needed under twenty-six thousand combined; a hot-shot straight truck for expedited LTL of one to five pallets; a hot shot with a small reefer gooseneck for produce or pharma like transplant organs; hot-shot towing that hauls a disabled truck; and expedited hot shot that guarantees a tight window, sometimes four to six hours, at premium rates of five to ten dollars a mile.",
    keywords: 'hot shot, one ton pickup, gooseneck, bumper pull, expedited, LTL, oilfield, F-450, Ram 5500, no CDL under 26000, reefer gooseneck, premium rate',
  },
  {
    seedKey: 'qa-hotshot-cdl',
    category: 'qa',
    subcategory: 'hot-shot',
    topic: 'Do I need a CDL to drive a hot shot rig?',
    content:
      "It comes down to the gross combined weight rating. If the truck, trailer, and cargo together are twenty-six thousand or under, a standard Class D license works. Over twenty-six thousand you need at least a Class B for a straight truck, or a Class A for a tractor-trailer combination.",
    keywords: 'hot shot CDL, GCWR, 26000 or under Class D, over 26000 Class B or Class A, gross combined weight',
  },
  {
    seedKey: 'qa-hotshot-rates',
    category: 'qa',
    subcategory: 'hot-shot',
    topic: 'Why do hot shot drivers charge such high rates per mile?',
    content:
      "Because hot shot sells speed and urgency, not capacity. You might only carry five thousand pounds, but you deliver it in four hours when a full truckload would take three days. The customer is paying for a dedicated truck, an expedited route, and a driver willing to run straight through, often as a team.",
    keywords: 'hot shot high rates, speed urgency not capacity, 5000 pounds, four hours versus three days, dedicated asset, expedited, team',
  },
  {
    seedKey: 'qa-hotshot-53van',
    category: 'qa',
    subcategory: 'hot-shot',
    topic: 'Can I pull a fifty-three-foot dry van with a hot shot pickup?',
    content:
      "Absolutely not. A fifty-three-foot van needs a Class eight tractor with air brakes and a heavy-duty fifth wheel. A hot-shot pickup runs a gooseneck or bumper-pull hitch and tops out around twenty to forty feet — the weight and braking just aren't there for a full-size van.",
    keywords: 'hot shot pickup 53 foot van, no, needs Class 8, air brakes, heavy fifth wheel, gooseneck limit 20 to 40 feet, braking capacity',
  },
  {
    seedKey: 'qa-hotshot-vs-expedited',
    category: 'qa',
    subcategory: 'hot-shot',
    topic: 'What is the difference between hot shot and expedited LTL?',
    content:
      "Hot shot usually means a single piece of equipment sent out right away for urgent freight, often a pickup. Expedited LTL is broader — it includes straight trucks and vans running a fast transit schedule, like two-day instead of four-day. All hot shot is expedited, but not all expedited is hot shot.",
    keywords: 'hot shot versus expedited LTL, single equipment dispatched now, pickup, expedited broader, fast transit, two day versus four day',
  },
  {
    seedKey: 'sprinter-manual',
    category: 'trucks',
    subcategory: 'sprinter-van',
    topic: 'Sprinter van / cargo van and its sub-types',
    content:
      "A sprinter or cargo van is a small enclosed Class one-to-two vehicle for last-mile delivery, courier work, and small-package freight — the workhorse of the final leg from warehouse to store, home, or business. The types: a standard cargo van like a Mercedes Sprinter, Ford Transit, or Ram Promaster, around ten thousand pounds gross holding three to four thousand pounds of cargo; a refrigerated sprinter with a small electric reefer for catering, flowers, and local pharma; a high-roof van tall enough to stand in, up to seven feet; an extended-wheelbase van with fifteen to eighteen feet of floor; and a rare liftgate-equipped sprinter for heavy residential drops like appliances.",
    keywords: 'sprinter van, cargo van, Class 1 2, last mile, courier, small package, Mercedes Sprinter, Ford Transit, Ram Promaster, 10000 GVWR, refrigerated, high roof, extended wheelbase, liftgate',
  },
  {
    seedKey: 'qa-sprinter-cmv',
    category: 'qa',
    subcategory: 'sprinter-van',
    topic: 'Is a sprinter van a commercial motor vehicle?',
    content:
      "Yes, it's commercial when used for business, but most sprinters are under ten thousand pounds gross, so they're exempt from most DOT rules — no ELD, no hours of service — and need no CDL. Even so, some states still make you stop at the scales if you're running commercial freight.",
    keywords: 'sprinter CMV, commercial for business, under 10000 GVWR, exempt DOT, no ELD, no HOS, no CDL, may stop at scales',
  },
  {
    seedKey: 'qa-sprinter-freight',
    category: 'qa',
    subcategory: 'sprinter-van',
    topic: 'What kind of freight moves in a sprinter van?',
    content:
      "Small, time-critical stuff: auto parts, medical supplies, legal documents, pharma, flowers, catering, e-commerce parcels, and high-value electronics. It's not made for palletized freight unless the driver has a ramp and a pallet jack.",
    keywords: 'sprinter freight, auto parts, medical, legal documents, pharma, flowers, catering, e-commerce, electronics, not palletized without ramp',
  },
  {
    seedKey: 'qa-sprinter-4skids',
    category: 'qa',
    subcategory: 'sprinter-van',
    topic: 'The broker offers four skids for my sprinter — can I take it?',
    content:
      "Depends on the skid size. Standard pallets are forty-eight by forty inches. A sprinter floor is about forty-eight inches wide and fifteen feet long, so you can fit exactly four standard pallets — two across and two deep, single-high. But check the weight: four pallets of heavy parts can blow past the van's thirty-five-hundred-pound payload.",
    keywords: 'sprinter four skids, pallet 48 by 40, floor 48 wide 15 feet, four pallets two across two deep, payload 3500 pounds, check weight',
  },
  {
    seedKey: 'qa-sprinter-multistop',
    category: 'qa',
    subcategory: 'sprinter-van',
    topic: 'Why do sprinter vans make so many stops?',
    content:
      "Because they run multi-stop routes, often fifteen to thirty stops in a day, each just a package or a few boxes. That's the last mile — freight broken down from pallets into individual parcels and delivered to the end customer or the retail store.",
    keywords: 'sprinter multi stop, 15 to 30 stops, package, last mile, broken from pallets to parcels, end customer, retail',
  },
  {
    seedKey: 'chassis-manual',
    category: 'trucks',
    subcategory: 'chassis',
    topic: 'Intermodal / container chassis and its sub-types',
    content:
      "A chassis is a specialized frame on wheels built to carry intermodal shipping containers — twenty, forty, forty-five, or fifty-three foot — that cranes lift on and off at ports and rail yards. The tractor pulls the chassis, not the container directly. The types: a twenty-foot chassis, lightweight for international boxes; a forty or forty-five-foot chassis, the standard, with extensions to reach fifty-three; a gooseneck chassis with a raised front to lower the container deck for clearance; a tri-axle chassis with three rear axles for containers over fifty thousand pounds; and a refrigerated chassis carrying a genset to power a reefer container for perishable imports.",
    keywords: 'chassis, intermodal, container, 20 40 45 53 foot, crane, port, rail yard, gooseneck chassis, tri axle chassis, refrigerated genset, leasing pool',
  },
  {
    seedKey: 'qa-chassis-owner',
    category: 'qa',
    subcategory: 'chassis',
    topic: "I'm hauling an intermodal container — who owns the chassis?",
    content:
      "Usually not you. In most cases the chassis belongs to a marine terminal, a railroad, or a leasing pool like DCLI or TRAC. You check the chassis out from the port or rail yard, inspect it before you hook up, and you're responsible for its condition until you return it.",
    keywords: 'chassis owner, marine terminal, railroad, leasing pool, DCLI, TRAC, check out, inspect, responsible until returned',
  },
  {
    seedKey: 'qa-chassis-drop',
    category: 'qa',
    subcategory: 'chassis',
    topic: 'What is the difference between dropping a container and dropping a trailer?',
    content:
      "You can't drop a container on landing gear like a dry van — the chassis has no landing gear, just a support frame that rests on the ground. When you disconnect, the container stays on the chassis and the chassis sits on its own suspension. You're dropping the chassis, not the container.",
    keywords: 'drop container versus trailer, no landing gear, chassis support frame, container stays on chassis, drop the chassis',
  },
  {
    seedKey: 'qa-chassis-tires',
    category: 'qa',
    subcategory: 'chassis',
    topic: 'Why check the chassis tires so carefully before dispatch?',
    content:
      "Because chassis get abused and poorly maintained — they're often one-way assets and the last driver may have ignored a flat. Hook to a bad tire and blow it on the road and the repair is on you. Do a thorough pre-trip and reject any chassis with cracked tires, a rusted frame, or bad brake chambers.",
    keywords: 'chassis tires, abused poorly maintained, one way asset, ignored flat, blow tire your cost, pre-trip, reject cracked tire rusted frame bad brakes',
  },
  {
    seedKey: 'qa-chassis-length-mismatch',
    category: 'qa',
    subcategory: 'chassis',
    topic: 'My container is fifty-three feet but the chassis is rated for forty — can I still pull it?',
    content:
      "No. The container would overhang the chassis, which is illegal and dangerous. Match the chassis length to the container. Some chassis have extendable rear frames for forty-five to fifty-three-foot boxes, but they have to be locked in the extended position before you load the container.",
    keywords: 'chassis length mismatch, 53 container 40 chassis, overhang illegal dangerous, match length, extendable rear frame, lock extended before loading',
  },
  {
    seedKey: 'bobtail-manual',
    category: 'trucks',
    subcategory: 'bobtail',
    topic: 'Tractor only (bobtail) and its sub-types',
    content:
      "Bobtailing is running a Class eight tractor with no trailer attached — deadheading to a pickup, heading back to the yard, or repositioning for a wash or repair. The situations: an empty bobtail with no trailer at all; a bobtail with an empty trailer, which drivers loosely call bobtail but technically isn't; bobtailing for repairs to a shop; bobtail fueling to the island without the trailer; and a bobtail pickup, driving to a shipper's yard to grab a pre-loaded trailer.",
    keywords: 'bobtail, tractor only, no trailer, deadhead, reposition, empty bobtail, bobtail with empty trailer, repairs, fueling, pickup',
  },
  {
    seedKey: 'qa-bobtail-legal',
    category: 'qa',
    subcategory: 'bobtail',
    topic: 'Is bobtailing legal on all roads?',
    content:
      "Yes — you can bobtail anywhere a tractor-trailer is allowed. Just know some states apply bridge laws to a tractor alone, your braking distance jumps way up without a trailer, and your rear axles give you very little traction in rain or snow.",
    keywords: 'bobtail legal, anywhere tractor-trailer allowed, bridge laws, longer braking distance, poor rear traction, rain snow',
  },
  {
    seedKey: 'qa-bobtail-danger',
    category: 'qa',
    subcategory: 'bobtail',
    topic: 'Why is bobtailing more dangerous than hauling a trailer?',
    content:
      "With no trailer there's almost no weight on your drive axles, so you lose traction, especially in the wet. And your brakes are tuned for an eighty-thousand-pound combination — without that weight they can lock up and throw you into a jackknife. Brake gently and leave extra following distance.",
    keywords: 'bobtail danger, no weight on drives, lose traction, wet, brakes tuned for 80000, lock up, jackknife, brake gently, following distance',
  },
  {
    seedKey: 'qa-bobtail-pay',
    category: 'qa',
    subcategory: 'bobtail',
    topic: 'Do I get paid for bobtail miles?',
    content:
      "Sometimes. Bobtailing to a pickup usually pays less than loaded miles, often fifty to seventy percent of the loaded rate. Some brokers add a deadhead fuel surcharge, but bobtail miles are generally the carrier's cost of doing business unless you negotiate them in.",
    keywords: 'bobtail pay, less than loaded, 50 to 70 percent, deadhead fuel surcharge, carrier cost, negotiate',
  },
  {
    seedKey: 'qa-bobtail-weighstation',
    category: 'qa',
    subcategory: 'bobtail',
    topic: 'Do I stop at a weigh station when bobtailing?',
    content:
      "No. Scales are for loaded commercial vehicles, so a true bobtail with no trailer doesn't have to enter — take the bypass lane. But if you're pulling an empty trailer, you do have to stop.",
    keywords: 'bobtail weigh station, no trailer skip scale, bypass lane, empty trailer must stop',
  },
  {
    seedKey: 'triaxle-manual',
    category: 'trucks',
    subcategory: 'tri-axle',
    topic: 'Tri-axle / quad-axle truck and its sub-types',
    content:
      "A tri- or quad-axle truck adds a third or fourth axle to raise legal payload and satisfy bridge-weight laws, common in construction, mining, and heavy haul. The types: a tri-axle straight truck like a dump or mixer, gross up to fifty-four thousand in some states; a tri-axle tractor with three rear drives for overweight loads on permits; a lift-axle setup with an extra axle you raise when empty to save fuel and tires, lower when loaded; a quad-axle dump — one steer, three drive — over sixty thousand gross for gravel and asphalt; and a super dump, a tri-axle with a trailing axle you drop for extra capacity.",
    keywords: 'tri axle, quad axle, extra axle, payload, bridge law, construction, mining, dump, mixer, 54000, lift axle, super dump, trailing axle',
  },
  {
    seedKey: 'qa-triaxle-why',
    category: 'qa',
    subcategory: 'tri-axle',
    topic: 'Why use a tri-axle tractor instead of a standard tandem?',
    content:
      "To carry more weight legally. Under the bridge formula a tri-axle can haul about twenty thousand pounds more than a tandem because the extra axle spreads the load over a longer distance — letting you move eighty to a hundred thousand pounds without an overweight permit.",
    keywords: 'tri axle why, carry more legally, bridge formula, 20000 more than tandem, spread load, 80000 to 100000 no permit',
  },
  {
    seedKey: 'qa-triaxle-maneuver',
    category: 'qa',
    subcategory: 'tri-axle',
    topic: 'Are tri-axle trucks harder to maneuver?',
    content:
      "Yes. The longer wheelbase and extra axles cut your turning radius, so backing into tight docks is tougher and you have to make wide turns to keep from clipping curbs. Those extra axles also cause tire scrub — friction — on sharp turns.",
    keywords: 'tri axle maneuver, longer wheelbase, reduced turning radius, tight dock backing, wide turns, curb, tire scrub',
  },
  {
    seedKey: 'qa-triaxle-liftaxle',
    category: 'qa',
    subcategory: 'tri-axle',
    topic: 'What is a lift axle and how does it work?',
    content:
      "A lift axle is an auxiliary axle you raise off the ground when the truck is empty — that cuts tire wear, helps fuel economy, and tightens your turns. When you load up, you drop it with a switch in the cab to put more tires on the ground, spread the weight, and stay legal under bridge laws.",
    keywords: 'lift axle, auxiliary axle, raise when empty, tire wear, fuel economy, tighter turn, lower when loaded, cab switch, bridge law',
  },
  {
    seedKey: 'qa-triaxle-permits',
    category: 'qa',
    subcategory: 'tri-axle',
    topic: 'Do tri-axle trucks need special permits for every load?',
    content:
      "Not always. In a lot of states a tri-axle is legal without a permit up to a set gross, like fifty-four thousand in some eastern states. But once your combined weight tops the state's statutory limit, you need an overweight permit for that trip.",
    keywords: 'tri axle permits, not always, legal up to set gross, 54000 eastern states, over statutory limit needs overweight permit per trip',
  },
  {
    seedKey: 'dumptruck-manual',
    category: 'trucks',
    subcategory: 'dump-truck',
    topic: 'Dump truck and its sub-types',
    content:
      "A dump truck is a heavy Class seven or eight straight truck with an open box that hydraulically lifts to dump gravel, sand, asphalt, or demolition debris. The types: a standard dump with a fixed box raised from the front; a transfer dump with a separate trailer that shoves material into the main box for big aggregate volumes; an end dump that tips backward and needs level ground; a side dump that tips sideways for narrow sites; and a belly or gravity dump with bottom gates that drop material onto a conveyor or into a trench, like a hopper bottom.",
    keywords: 'dump truck, open box, hydraulic lift, gravel sand asphalt debris, standard, transfer, end dump, side dump, belly dump, gravity dump, hopper bottom',
  },
  {
    seedKey: 'qa-dump-lights',
    category: 'qa',
    subcategory: 'dump-truck',
    topic: 'Why do dump trucks have so many warning lights and beepers?',
    content:
      "Because the bed lifts high in the air and turns into a real overhead hazard around power lines and bridges. The beepers warn workers the bed is moving, and the lights tell you when it's fully raised or when the hydraulics are still under pressure.",
    keywords: 'dump truck warning lights beepers, bed raises high, overhead hazard, power lines, bridges, warn workers, hydraulic pressure',
  },
  {
    seedKey: 'qa-dump-cdl',
    category: 'qa',
    subcategory: 'dump-truck',
    topic: 'Can I drive a dump truck without a CDL?',
    content:
      "Usually no. Most dump trucks are over twenty-six thousand pounds gross, so you need at least a Class B. And if it's pulling a trailer, like a pup, you need a Class A.",
    keywords: 'dump truck CDL, usually no, over 26000, Class B, pulling pup trailer Class A',
  },
  {
    seedKey: 'qa-dump-jackknife',
    category: 'qa',
    subcategory: 'dump-truck',
    topic: 'Can a dump truck jackknife?',
    content:
      "Not the way a semi does — a dump truck is a straight truck. But an end dump can flip over if the load's too heavy and the ground is uneven. Never dump on soft or sloped ground: as the bed lifts, the whole truck can tip.",
    keywords: 'dump truck jackknife, straight truck, end dump tip over, heavy load uneven ground, never dump on soft or sloped ground, flip',
  },
  {
    seedKey: 'qa-dump-tarp',
    category: 'qa',
    subcategory: 'dump-truck',
    topic: 'Why is tarping required on a dump truck?',
    content:
      "Most states require a tarp or hard cover so dust and debris don't fly out onto the highway. It's usually an automatic electric tarp. Leave a load uncovered and you're risking a five-hundred to a thousand-dollar fine.",
    keywords: 'dump truck tarp, cover load, dust debris, automatic electric tarp, uncovered fine 500 to 1000',
  },
  {
    seedKey: 'wrecker-manual',
    category: 'trucks',
    subcategory: 'tow-wrecker',
    topic: 'Tow truck / wrecker (heavy-duty) and its sub-types',
    content:
      "A commercial wrecker recovers and hauls disabled trucks, trailers, and heavy equipment after breakdowns and accidents. The types: a light-duty wrecker for cars and small box trucks under ten thousand pounds; a medium-duty wrecker for straight trucks and small semis, ten to twenty-six thousand; a heavy-duty rotator with a rotating boom that can lift and flip an overturned semi; a wheel-lift wrecker that cradles the drive wheels off the ground; and a flatbed or rollback that tilts and winches a vehicle onto the deck.",
    keywords: 'tow truck, wrecker, recovery, disabled truck, breakdown, accident, light duty, medium duty, heavy duty rotator, wheel lift, flatbed rollback',
  },
  {
    seedKey: 'qa-wrecker-whopays',
    category: 'qa',
    subcategory: 'tow-wrecker',
    topic: 'If my Class 8 tractor breaks down, who pays for the tow?',
    content:
      "Depends on why. A mechanical failure — engine, transmission, coolant — is on you, the carrier. If it's an accident that wasn't your fault, the at-fault driver's insurance may cover the tow. And some companies carry roadside-assistance packages that include towing in the maintenance plan.",
    keywords: 'wrecker who pays, mechanical failure carrier pays, accident at-fault insurance, roadside assistance package, towing cost',
  },
  {
    seedKey: 'qa-wrecker-loaded-trailer',
    category: 'qa',
    subcategory: 'tow-wrecker',
    topic: 'Can a heavy-duty wrecker tow a fully loaded fifty-three-foot trailer?',
    content:
      "No. A loaded trailer is past what most wreckers can handle, which caps around forty to sixty thousand pounds. Typically the heavy wrecker recovers the tractor, and a separate recovery crew transloads the freight to a fresh trailer before the empty one gets towed.",
    keywords: 'wrecker loaded trailer, no, exceeds capacity, 40000 to 60000, recover tractor, separate transload freight, tow empty trailer',
  },
  {
    seedKey: 'qa-wrecker-rotator',
    category: 'qa',
    subcategory: 'tow-wrecker',
    topic: 'What is a rotator wrecker and why is it used?',
    content:
      "A rotator has a boom that swings a full three hundred sixty degrees, so it can lift an overturned semi from any angle without repositioning the truck — huge on a crowded highway with no room to work. It runs about a thousand to two thousand dollars an hour to deploy.",
    keywords: 'rotator wrecker, 360 degree boom, lift overturned semi any angle, no reposition, busy highway, 1000 to 2000 per hour',
  },
  {
    seedKey: 'qa-wrecker-cdl',
    category: 'qa',
    subcategory: 'tow-wrecker',
    topic: 'Is a CDL required to operate a heavy-duty wrecker?',
    content:
      "Yes. Most heavy wreckers are over twenty-six thousand pounds, so you need a Class B — and a Class A if it's towing a trailer or a full tractor-trailer combination.",
    keywords: 'heavy wrecker CDL, over 26000, Class B, Class A if towing combination',
  },
  {
    seedKey: 'wellcar-manual',
    category: 'trucks',
    subcategory: 'well-car',
    topic: 'Intermodal well car (rail) and its sub-types',
    content:
      "A well car is a railroad car built to carry intermodal containers — twenty, forty, or fifty-three foot — on double-stack trains. It's not a truck, it's rail equipment, but it's a key link moving containers between ports and inland rail yards. The types: a single-stack well car carrying one layer; a double-stack well car carrying two layers, the long-haul standard; an articulated well car with several well sections sharing axles to hold two to five containers; and a bulkhead flatcar with fixed end walls for specialized containers.",
    keywords: 'well car, rail, intermodal container, double stack, 20 40 53 foot, single stack, articulated, bulkhead flatcar, port, rail yard',
  },
  {
    seedKey: 'qa-wellcar-highway',
    category: 'qa',
    subcategory: 'well-car',
    topic: 'Can I drive a well car on the highway?',
    content:
      "No. Well cars are strictly rail equipment — they run on tracks pulled by locomotives and aren't road-legal.",
    keywords: 'well car highway, no, rail only, tracks, locomotive, not road legal',
  },
  {
    seedKey: 'qa-wellcar-doublestack-height',
    category: 'qa',
    subcategory: 'well-car',
    topic: 'How does a double-stack container train stay within height limits?',
    content:
      "Rail clearances are higher than highways, often up to twenty feet, and the containers ride in lowered wells so the bottom box sits below the car's main deck. That drop lets two nine-foot-six containers stack and still stay under twenty feet.",
    keywords: 'double stack height, rail clearance 20 feet, lowered well, bottom container below deck, two 9 foot 6 containers under 20 feet',
  },
  {
    seedKey: 'qa-wellcar-pickup',
    category: 'qa',
    subcategory: 'well-car',
    topic: 'How do I pick up an intermodal container from a rail yard?',
    content:
      "You drive your tractor in with a chassis, and the yard's overhead gantry crane lifts the container off the well car onto your chassis. You lock the twist-locks and drive out. The yard does the lifting — you just spot the chassis under the crane.",
    keywords: 'rail yard container pickup, tractor with chassis, gantry crane, lift off well car onto chassis, twist locks, position chassis under crane',
  },
  {
    seedKey: 'expediter-manual',
    category: 'trucks',
    subcategory: 'expediter',
    topic: 'Straight truck with sleeper (expediter truck) and its sub-types',
    content:
      "An expediter is a Class five-to-seven straight truck — box or flatbed — fitted with a small sleeper behind the cab, for expedited team-driven freight that needs overnight delivery without a full tractor-trailer. The types: a Class five expediter at nineteen thousand five hundred gross, no CDL, small sleeper for overnight runs; a Class seven expediter at thirty-three thousand needing a Class B, bigger sleeper and heavier payload; a refrigerated expediter with a reefer box and sleeper for overnight pharma and produce; and a liftgate expediter with a sleeper and liftgate for residential and dockless drops.",
    keywords: 'expediter, straight truck with sleeper, Class 5 to 7, box, flatbed, small sleeper, overnight, team, no CDL Class 5, Class B Class 7, reefer, liftgate',
  },
  {
    seedKey: 'qa-expediter-why',
    category: 'qa',
    subcategory: 'expediter',
    topic: 'Why use a straight truck with a sleeper instead of a tractor-trailer?',
    content:
      "For maneuverability and access. A straight truck fits tight urban areas, narrow alleys, and residential streets a fifty-three-foot trailer can't. The sleeper lets the driver rest legally without a hotel, so you can run expedited freight around the clock.",
    keywords: 'expediter why, maneuverability access, tight urban, narrow alley, residential, sleeper rest without hotel, 24/7 expedited',
  },
  {
    seedKey: 'qa-expediter-eld',
    category: 'qa',
    subcategory: 'expediter',
    topic: 'Is a straight truck with a sleeper subject to ELD and HOS rules?',
    content:
      "Yes, if it's over ten thousand pounds gross and running interstate. The sleeper lets the driver use the split-sleeper exception to stretch the duty day, but every hour still has to be logged on an ELD.",
    keywords: 'expediter ELD HOS, over 10000 interstate, split sleeper exception, stretch duty day, log all hours ELD',
  },
  {
    seedKey: 'qa-expediter-team',
    category: 'qa',
    subcategory: 'expediter',
    topic: 'Can a straight truck with a sleeper do team driving?',
    content:
      "Yes, if it has a dual sleeper berth with upper and lower bunks. One driver rests while the other drives, so the truck runs non-stop — common for expedited freight moving coast to coast.",
    keywords: 'expediter team driving, dual sleeper berth, upper lower bunk, one rests one drives, non stop, coast to coast',
  },
  {
    seedKey: 'qa-expediter-payload',
    category: 'qa',
    subcategory: 'expediter',
    topic: 'What is the payload capacity of a Class 7 expediter truck?',
    content:
      "A Class seven at thirty-three thousand gross usually weighs fifteen to eighteen thousand empty, leaving roughly fifteen to eighteen thousand pounds of payload. That's a lot less than a fifty-three-foot trailer's forty-five thousand, but it's faster and far more agile for smaller, time-critical loads.",
    keywords: 'expediter payload, Class 7 33000 gross, empty 15000 18000, payload 15000 18000, less than 53 foot 45000, faster agile time critical',
  },
];
