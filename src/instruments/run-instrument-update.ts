import updateInstrumentMaster from './instrument-updater.js';

updateInstrumentMaster().catch(() => {
    process.exitCode = 1;
});