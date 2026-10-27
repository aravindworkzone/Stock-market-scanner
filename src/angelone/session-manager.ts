import { SmartAPI } from "smartapi-javascript";
import { createAngelOneSession } from "./auth.js";

let session: SmartAPI | null = null;

export default async function getAngelOneClient(): Promise<SmartAPI> {
  if (session === null) {
    session = await createAngelOneSession();
  }

  return session;
}