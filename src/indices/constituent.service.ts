import { parse } from "csv-parse/sync";
import type { IndexConstituent } from "../types/indices.js";

interface NSEConstituentCSV {
  "Company Name": string;
  Industry: string;
  Symbol: string;
  Series: string;
  "ISIN Code": string;
}

export default async function fetchIndexConstituents(
  csvUrl: string
): Promise<IndexConstituent[]> {
  const response = await fetch(csvUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `NSE CSV request failed: ${response.status} ${response.statusText}`
    );
  }

  const csv = await response.text();

  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as NSEConstituentCSV[];

  return records.map((record) => ({
    companyName: record["Company Name"],
    industry: record.Industry,
    symbol: record.Symbol,
    series: record.Series,
    isin: record["ISIN Code"],
  })).filter((stock) => !stock.symbol.startsWith("DUMMY"));
}