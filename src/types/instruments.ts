import z from 'zod';
import {InstrumentRecordSchema} from '../util/validator.js';

export type InstrumentRecord = z.infer<
    typeof InstrumentRecordSchema
>;