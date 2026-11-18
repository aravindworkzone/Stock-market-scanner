import { Neon } from "./index.js";
import { AppError } from "../core/errors.js";

export default async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await Neon`
      SELECT 1 AS id
    `;

    return true;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    const dbError = error as {
      message?: string;
      code?: string;
      detail?: string;
      hint?: string;
    };

    throw new AppError(
      "DATABASE_ERROR",
      `Neon health check failed: ${dbError.message ?? "Unknown error"} | 
      Code: ${dbError.code ?? "N/A"} | 
      Details: ${dbError.detail ?? "N/A"} | 
      Hint: ${dbError.hint ?? "N/A"}`
    );
  }
}