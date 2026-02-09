// vercel/shared/normalize.ts
type AnyObj = Record<string, any>;

function pickTime(at?: string): string {
  // Amadeus often returns "YYYY-MM-DDTHH:mm:ss" (no timezone)
  if (!at || typeof at !== "string") return "";
  return at.length >= 16 ? at.slice(11, 16) : at;
}

function pickDate(at?: string): string {
  if (!at || typeof at !== "string") return "";
  return at.length >= 10 ? at.slice(0, 10) : at;
}

function durationToText(d?: string): string {
  // PT7H30M -> 7h 30m
  if (!d || typeof d !== "string") return "";
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(d);
  if (!m) return d;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (min) parts.push(`${min}m`);
  return parts.join(" ") || d;
}

function asNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export type NormalizedSegment = {
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  carrierCode: string;
  number: string;
  flightNumber: string; // e.g. "BA138"
};

export type NormalizedOffer = {
  id: string;

  airlineCode: string;
  airline: string;

  from: string;
  to: string;

  departAt: string;
  arriveAt: string;
  departDate: string;
  departTime: string;
  arriveTime: string;

  duration: string;      // ISO duration e.g. PT7H30M
  durationText: string;  // e.g. 7h 30m

  stops: number;
  stopsText: string;     // e.g. Direct / 1 stop / 2 stops

  flightNumbers: string[];
  flightNumbersText: string;

  currency: string;
  price: number | null;  // numeric total
  priceText: string;     // e.g. "EUR 123.45"

  segments: NormalizedSegment[];

  raw: any; // keep original offer for debug
};

export function normalizeOffers(payload: any): NormalizedOffer[] {
  const carriers: AnyObj = payload?.dictionaries?.carriers ?? {};
  const data: any[] = Array.isArray(payload?.data) ? payload.data : [];

  return data.map((offer: any, idx: number): NormalizedOffer => {
    const itineraries: any[] = Array.isArray(offer?.itineraries) ? offer.itineraries : [];
    const it0 = itineraries[0] ?? {};
    const segments: any[] = Array.isArray(it0?.segments) ? it0.segments : [];

    const first = segments[0] ?? {};
    const last = segments.length ? segments[segments.length - 1] : {};

    const from = String(first?.departure?.iataCode ?? "").toUpperCase();
    const to = String(last?.arrival?.iataCode ?? "").toUpperCase();

    const departAt = String(first?.departure?.at ?? "");
    const arriveAt = String(last?.arrival?.at ?? "");

    const airlineCode =
      String(offer?.validatingAirlineCodes?.[0] ?? first?.carrierCode ?? "").toUpperCase();

    const airline =
      (airlineCode && typeof carriers[airlineCode] === "string" ? carriers[airlineCode] : "") ||
      airlineCode ||
      "Unknown Airline";

    const segs: NormalizedSegment[] = segments.map((s: any) => {
      const cc = String(s?.carrierCode ?? "").toUpperCase();
      const no = String(s?.number ?? "");
      const flightNumber = `${cc}${no}`.trim();
      return {
        from: String(s?.departure?.iataCode ?? "").toUpperCase(),
        to: String(s?.arrival?.iataCode ?? "").toUpperCase(),
        departAt: String(s?.departure?.at ?? ""),
        arriveAt: String(s?.arrival?.at ?? ""),
        carrierCode: cc,
        number: no,
        flightNumber,
      };
    });

    const stops = Math.max(0, segs.length - 1);
    const stopsText = stops === 0 ? "Direct" : stops === 1 ? "1 stop" : `${stops} stops`;

    const currency =
      String(offer?.price?.currency ?? payload?.dictionaries?.currencies?.[0] ?? "EUR").toUpperCase();

    // Amadeus may use total or grandTotal depending on endpoint/version
    const price =
      asNumber(offer?.price?.total) ??
      asNumber(offer?.price?.grandTotal) ??
      asNumber(offer?.price?.base);

    const priceText =
      price === null ? `${currency} —` : `${currency} ${price.toFixed(2)}`;

    const duration = String(it0?.duration ?? "");
    const durationText = durationToText(duration);

    const flightNumbers = segs.map(s => s.flightNumber).filter(Boolean);
    const flightNumbersText = flightNumbers.join(", ");

    return {
      id: String(offer?.id ?? idx),

      airlineCode,
      airline,

      from,
      to,

      departAt,
      arriveAt,
      departDate: pickDate(departAt),
      departTime: pickTime(departAt),
      arriveTime: pickTime(arriveAt),

      duration,
      durationText,

      stops,
      stopsText,

      flightNumbers,
      flightNumbersText,

      currency,
      price,
      priceText,

      segments: segs,
      raw: offer,
    };
  });
}
