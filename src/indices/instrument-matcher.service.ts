import type { IndexConstituent } from "../types/indices.js";
import type { InstrumentRecord } from "../types/instruments.js";

export interface MatchedConstituent extends IndexConstituent {
  symboltoken: string;
}

export interface UnmatchedConstituent extends IndexConstituent {}

export interface InstrumentMatchResult {
  matched: MatchedConstituent[];
  unmatched: UnmatchedConstituent[];
}

export function matchIndexConstituents(
  constituents: IndexConstituent[],
  instruments: InstrumentRecord[]
): InstrumentMatchResult {
  const instrumentMap = new Map<string, InstrumentRecord>();

  for (const instrument of instruments) {
    if (instrument.exch_seg === "NSE") {
      instrumentMap.set(instrument.symbol, instrument);
    }
  }

  const matched: MatchedConstituent[] = [];
  const unmatched: UnmatchedConstituent[] = [];

  for (const stock of constituents) {
    const instrument = instrumentMap.get(`${stock.symbol}-${stock.series}`);

    if (!instrument) {
      unmatched.push(stock);
      continue;
    }

    matched.push({
      ...stock,
      symboltoken: instrument.token,
    });
  }

  return { matched, unmatched };
}