import { INDEX_CONFIG } from "./index.config.js";
import { AppError } from "../errors.js";
import { NSEIndexResponse, MarketIndex } from '../types/indices.js';
import { EXCLUDED_INDEX_IDS } from "./index.constants.js";

export default async function getAvailableIndices() {
  const config = INDEX_CONFIG.NSE;

  const url = `${config.baseUrl}${config.endpoints.indexNames}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: config.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new AppError('NETWORK_ERROR',`NSE request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as NSEIndexResponse;

    const index = data.nts.map(([name, id]): MarketIndex => ({
      id,
      name,
    })).filter(index => !(EXCLUDED_INDEX_IDS).includes(index.id as (typeof EXCLUDED_INDEX_IDS)[number]));

    return index;
  } catch (error) {
    if (error instanceof AppError) {
        throw error;
    }

    throw new AppError("NETWORK_ERROR", "Failed to fetch NSE index list", { cause: error });
  }
}