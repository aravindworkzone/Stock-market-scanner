export type AngelOneCandle = [
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
];

export interface AngelOneApiResponse<T> {
  status: boolean;
  message?: string;
  errorcode?: string;
  data?: T | null;
}