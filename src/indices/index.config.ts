export const INDEX_CONFIG = {
  NSE: {
    baseUrl: "https://www.nseindia.com",

    endpoints: {
      indexNames: "/api/index-names",
    },

    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.nseindia.com/",
    },
  },
} as const;

export const CONSTITUENT_CONFIG = {
  NSE: {
    baseUrl: "https://www.niftyindices.com",

    endpoints: {
      constituents: "/IndexConstituent",
    },

    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/csv",
    },

    indexFiles: {
      "NIFTY 50": "ind_nifty50list.csv",
      "NIFTY 500": "ind_nifty500list.csv",
    },
  },
} as const;