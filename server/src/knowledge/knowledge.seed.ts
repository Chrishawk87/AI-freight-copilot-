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
];
