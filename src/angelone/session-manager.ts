import { SmartAPI } from "smartapi-javascript";
import { createAngelOneSession } from "./auth.js";

let session: SmartAPI | null = null;

export async function getAngelOneClient(): Promise<SmartAPI> {
  if (session === null) {
    session = await createAngelOneSession();
  }

  return session;
}
export async function forcelogin(): Promise<SmartAPI> {
  session = await createAngelOneSession();

  return session;
}

export function clearAngelOneClient(): void {
  session = null;
}

export async function handleSession<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 403) {
      await forcelogin();
      return await request();
    }
    
    throw error;
  }
}