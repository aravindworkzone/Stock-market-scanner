export interface MarketIndex {
  id: string;
  name: string;
}

export interface NSEIndexResponse {
  stn: [string, string][];
  nts: [string, string][];
}

export interface IndexConstituent {
  companyName: string;
  industry: string;
  symbol: string;
  series: string;
  isin: string;
}