import type { SmartAPI, SmartApiEnvelope } from "smartapi-javascript";
import { sessionManager } from "./session-manager.js";
import { brokerBackoff, brokerRateLimiter } from "./broker-rate-limiter.js";
import { computeBackoffDelayMilliseconds, type BackoffSettings } from "./rate-limiter.js";
import { toAppError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import {
  brokerFailureToAppError,
  classifyBrokerResponse,
  reportUnrecognizedBrokerErrorCode,
} from "./broker-response.js";

export {
  AUTHENTICATION_ERROR_CODES,
  classifyBrokerResponse,
  type BrokerFailure,
  type BrokerResponseClassification,
} from "./broker-response.js";

export type BrokerRequest = (client: SmartAPI) => Promise<unknown>;

export interface SessionProvider {
  getClient(): Promise<SmartAPI>;
  recoverFromAuthenticationFailure(failedClient: SmartAPI): Promise<SmartAPI>;
}

export interface CallRateLimiter {
  acquire(operationName: string): Promise<void>;
  penalize(operationName: string, delayMilliseconds: number): void;
}

export interface BrokerCallerDependencies {
  sessions: SessionProvider;
  rateLimiter: CallRateLimiter;
  backoff: BackoffSettings;
  writeWarning: (message: string) => void;
}

export type BrokerCaller = <TData = unknown>(
  operationName: string,
  request: BrokerRequest,
) => Promise<SmartApiEnvelope<TData>>;

/**
 * Builds call(): runs one read-only SmartAPI request and returns its success envelope.
 * Any non-success outcome (including the SDK's resolved `{status:403}`, `{}` and `[]`)
 * is thrown as an AppError whose message starts with `[CODE]`.
 * Every attempt first takes a token from the per-operation rate limiter.
 * On RATE_LIMIT_ERROR the operation is blocked for an exponentially growing delay and
 * retried, up to `backoff.maxRetries` times.
 * On AUTHENTICATION_ERROR the session is re-created once and the request retried once.
 */
export function createBrokerCaller(dependencies: BrokerCallerDependencies): BrokerCaller {
  return async function brokerCall<TData = unknown>(
    operationName: string,
    request: BrokerRequest,
  ): Promise<SmartApiEnvelope<TData>> {
    let client = await dependencies.sessions.getClient();
    let hasReloggedIn = false;
    let rateLimitRetries = 0;

    for (;;) {
      await dependencies.rateLimiter.acquire(operationName);

      let brokerResponse: unknown;
      try {
        brokerResponse = await request(client);
      } catch (error: unknown) {
        throw toAppError(error);
      }

      const classification = classifyBrokerResponse<TData>(brokerResponse);
      if (classification.outcome === "success") {
        return classification.envelope;
      }

      reportUnrecognizedBrokerErrorCode(operationName, classification, dependencies.writeWarning);

      if (classification.errorCode === "RATE_LIMIT_ERROR" && rateLimitRetries < dependencies.backoff.maxRetries) {
        const delayMilliseconds = computeBackoffDelayMilliseconds(rateLimitRetries, dependencies.backoff);
        rateLimitRetries++;
        dependencies.writeWarning(
          `[broker] ${operationName} rate limited; retry ${rateLimitRetries}/${dependencies.backoff.maxRetries} in ${delayMilliseconds} ms.`,
        );
        dependencies.rateLimiter.penalize(operationName, delayMilliseconds);
        continue;
      }

      if (classification.errorCode === "AUTHENTICATION_ERROR" && !hasReloggedIn) {
        hasReloggedIn = true;
        client = await dependencies.sessions.recoverFromAuthenticationFailure(client);
        continue;
      }

      throw brokerFailureToAppError(operationName, classification);
    }
  };
}

/** `operationName` is the SDK method name. */
export const call: BrokerCaller = createBrokerCaller({
  sessions: sessionManager,
  rateLimiter: brokerRateLimiter,
  backoff: brokerBackoff,
  writeWarning: logger.warn,
});

export function getProfile(): Promise<SmartApiEnvelope> {
  return call("getProfile", (client) => client.getProfile());
}

export function getRMS(): Promise<SmartApiEnvelope> {
  return call("getRMS", (client) => client.getRMS());
}

export function getHolding(): Promise<SmartApiEnvelope> {
  return call("getHolding", (client) => client.getHolding());
}

export function getAllHolding(): Promise<SmartApiEnvelope> {
  return call("getAllHolding", (client) => client.getAllHolding());
}

export function getPosition(): Promise<SmartApiEnvelope> {
  return call("getPosition", (client) => client.getPosition());
}
