/**
 * Hand-written typings for smartapi-javascript 1.0.27 (pinned).
 *
 * The SDK never rejects: HTTP errors resolve as `{ status: <httpCode>, message }`,
 * network errors as `{}`, interceptor exceptions as `[]` (see audit/REPORT.md B0).
 * Every method therefore returns `Promise<unknown>`; pass results through
 * classifyBrokerResponse() (src/angelone/broker-response.ts) to get a typed
 * SmartApiEnvelope.
 *
 * Only read-only / session methods are declared on purpose: this server must
 * never place, modify or cancel orders, manage GTT rules, convert positions,
 * use eDIS or log out.
 */
declare module "smartapi-javascript" {
  /** Successful SmartAPI response body (`status === true`). */
  export interface SmartApiEnvelope<TData = unknown> {
    status: true;
    message?: string;
    errorcode?: string;
    data?: TData | null;
  }

  export interface SmartApiOptions {
    api_key: string;
    access_token?: string;
    refresh_token?: string;
    root?: string;
    timeout?: number;
    debug?: boolean;
  }

  export interface CandleDataRequest {
    exchange: string;
    symboltoken: string;
    interval: string;
    fromdate: string;
    todate: string;
  }

  export class SmartAPI {
    constructor(options: SmartApiOptions);

    setAccessToken(accessToken: string): void;
    setPublicToken(refreshToken: string): void;
    setSessionExpiryHook(callback: () => void): void;

    generateSession(clientCode: string, password: string, totp: string): Promise<unknown>;
    generateToken(refreshToken: string): Promise<unknown>;

    getProfile(): Promise<unknown>;
    getRMS(): Promise<unknown>;
    getHolding(): Promise<unknown>;
    getAllHolding(): Promise<unknown>;
    getPosition(): Promise<unknown>;
    getCandleData(request: CandleDataRequest): Promise<unknown>;
  }
}
