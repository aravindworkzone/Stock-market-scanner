declare module "smartapi-javascript" {
  export class SmartAPI {
    constructor(options: { api_key: string });

    generateSession(
      clientCode: string,
      password: string,
      totp: string,
    ): Promise<{
      status: boolean;
      message?: string;
      data?: {
        jwtToken?: string;
        refreshToken?: string;
        [key: string]: unknown;
      };
    }>;

    getCandleData(params: {
      exchange: string;
      symboltoken: string;
      interval: string;
      fromdate: string;
      todate: string;
    }): Promise<{
      status: boolean | number;
      message?: string;
      errorcode?: string;
      data?: import("../types/angelone.js").AngelOneCandle[] | null;
    }>;

    getProfile(): Promise<{
      status: boolean;
      message?: string;
      data?: unknown;
    }>;

    getRMS(): Promise<{
      status: boolean;
      message?: string;
      data?: unknown;
    }>;

    getHolding(): Promise<{
      status: boolean;
      message?: string;
      data?: unknown;
    }>;

    getAllHolding(): Promise<{
      status: boolean;
      message?: string;
      data?: unknown;
    }>;

    getPosition(): Promise<{
      status: boolean;
      message?: string;
      data?: unknown;
    }>;
  }
}
