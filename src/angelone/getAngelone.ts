import { getAngelOneClient } from "./session-manager.js";
import { toAppError } from "../core/errors.js";

export async function getProfile() {
    try {
        const smartApi = await getAngelOneClient();
        const profile = await smartApi.getProfile();
        return profile;
    } catch (error) {
        const profileError = toAppError(error);
        throw profileError;
    }
}

export async function getRMS() {
    try {
        const smartApi = await getAngelOneClient();
        const rms = await smartApi.getRMS();
        return rms;
    } catch (error) {
        throw toAppError(error);
    }
}

export async function getHolding() {
    try {
        const smartApi = await getAngelOneClient();
        const holding = await smartApi.getHolding();
        return holding;
    } catch (error) {
        throw toAppError(error);
    }
}

export async function getAllHolding() {
    try {
        const smartApi = await getAngelOneClient();
        const allHolding = await smartApi.getAllHolding();
        return allHolding;
    } catch (error) {
        const allHoldingError = toAppError(error);
        throw allHoldingError;
    }
}

export async function getPosition() {
    try {
        const smartApi = await getAngelOneClient();
        const position = await smartApi.getPosition();
        return position;
    } catch (error) {
        throw toAppError(error);
    }
}