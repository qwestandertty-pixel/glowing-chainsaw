type AmadeusResponse = any;

export type NormalizedOffer = {
  id: string;
  carriers: string[];
  price: { total: number; currency: string };
  itineraries: Array<{
    duration: string;
    segments: Array<{
      departure: { iataCode: string; at: string };
      arrival: { iataCode: string; at: string };
      carrierCode: string;
      numberOfStops?: number;
    }>;
  }>;
  metrics: {
    totalMinutes: number;
    totalStops: number;
    stopIatas: string[];
  };
  meta: {
    rankIndex: number;
    dealsCount?: number;
  };
};

function parseISODurationToMinutes(dur: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(dur || "");
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  return h * 60 + mm;
}

export function normalizeOffers(api: AmadeusResponse): { offers: NormalizedOffer[]; meta: any } {
  const dictCarriers: Record<string, string> = api?.dictionaries?.carriers || {};
  const offersRaw: any[] = Array.isArray(api?.data) ? api.data : [];
  const currency = offersRaw?.[0]?.price?.currency || "USD";

  const offers: NormalizedOffer[] = offersRaw.map((o, idx) => {
    const itins = (o.itineraries || []).map((it: any) => {
      const segs = (it.segments || []).map((s: any) => ({
        departure: { iataCode: s.departure?.iataCode, at: s.departure?.at },
        arrival: { iataCode: s.arrival?.iataCode, at: s.arrival?.at },
        carrierCode: s.carrierCode,
        numberOfStops: s.numberOfStops,
      }));
      return { duration: it.duration, segments: segs };
    });

    const carrierCodes = new Set<string>();
    itins.forEach(it => it.segments.forEach(s => carrierCodes.add(s.carrierCode)));
    const carriers = Array.from(carrierCodes).map(c => dictCarriers[c] ? String(dictCarriers[c]) : c);

    let totalStops = 0;
    const stopIatas: string[] = [];
    itins.forEach(it => {
      const stops = Math.max(0, (it.segments?.length || 0) - 1);
      totalStops += stops;
      for (let i = 0; i < it.segments.length - 1; i++) {
        const stop = it.segments[i]?.arrival?.iataCode;
        if (stop) stopIatas.push(stop);
      }
    });

    const totalMinutes = itins.reduce((acc, it) => acc + parseISODurationToMinutes(it.duration), 0);
    const total = Number(o?.price?.total || 0);

    return {
      id: String(o.id || `${idx}`),
      carriers: carriers.length ? carriers : ["Airline"],
      price: { total, currency: String(o?.price?.currency || currency) },
      itineraries: itins,
      metrics: { totalMinutes, totalStops, stopIatas },
      meta: { rankIndex: idx },
    };
  });

  return { offers, meta: { count: offers.length, warnings: api?.warnings || [], source: "amadeus" } };
}
