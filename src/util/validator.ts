import { z } from 'zod';

export const InstrumentRecordSchema = z.object({
    token: z.string(),
    symbol: z.string(),
    name: z.string(),
    exch_seg: z.string(),
});

export const InstrumentMasterSchema = z.array(
    InstrumentRecordSchema,
);

export type InstrumentRecord = z.infer<
    typeof InstrumentRecordSchema
>;