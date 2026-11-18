import { neon } from "@neondatabase/serverless";
import { config } from "../config/config.js";
import { AppError } from "../core/errors.js";

function initializeNeon() {
  try {
    if (!config.DATABASE_URL) {
      throw new AppError(
        "DATABASE_ERROR",
        "DATABASE_URL is not configured"
      );
    }

    return neon(config.DATABASE_URL);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Unknown error";

    throw new AppError(
      "DATABASE_ERROR",
      `Neon initialization failed: ${message}`
    );
  }
}

export const Neon = initializeNeon();