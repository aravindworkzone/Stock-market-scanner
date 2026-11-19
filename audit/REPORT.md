# s-market-scanner — Codebase Audit & Angel One SmartAPI Reference

- **Audit date:** 2026-11-19 (Thursday). Live samples were taken at **11:12–11:16 IST, during market hours**. The market was **open**: `marketData` returned ticks with `exchFeedTime` "19-Nov-2026 11:14:27".
- **Repo state audited:** branch `main` @ `14ee612`. Source is about 4,000 lines of TypeScript under `src/`.
- **SDK audited:** `node_modules/smartapi-javascript` **v1.0.27** (`node_modules/smartapi-javascript/package.json`).
- **Sources, in priority order:** (1) the installed SDK source, (2) the SDK README, example and test mocks, (3) live redacted responses in `audit/fixtures/`, and (4) the official docs, which were **not machine-readable**. The `smartapi.angelbroking.com/docs/*` and `smartapi.angelone.in/docs/*` pages render only the title "SmartAPI", and the forum pages need a login. Forum numbers are quoted only from search-result snippets and are labeled **UNVERIFIED** wherever they appear.
- **Redaction:** all secrets and personal data are written as `[REDACTED]`. Account-specific fixtures (profile, RMS, holdings, positions, books, rules) keep only field names and value *types* (`[REDACTED:number]`). A leak scan of every fixture against the real secret values in `.env`, plus JWT/email/PAN patterns, found **0 hits**.

> **Path conventions:** `src/...` paths are relative to the project root. `SDK:` means `node_modules/smartapi-javascript/`. Line numbers refer to commit `14ee612`.

---

# PART A — CODEBASE AUDIT

## A1. Project map

### Structure
```
src/
  main.ts                 HTTP entry (Streamable HTTP MCP on /mcp)          npm start
  stdio.ts                stdio entry                                         npm run start:stdio
  server.ts               createMcpServer(): registers all tools
  config/  config.ts (zod env schema) · holidays.ts · server.config.ts (ServerInfo: tool metadata + zod input schemas)
  core/    auth.ts (bearer auth + in-memory IP rate limit) · errors.ts (AppError) · logger.ts (JSON to stderr)
  angelone/ auth.ts (login+TOTP) · session-manager.ts · getAngelone.ts (account calls) · historical-candles.ts · force-rest-session.ts · test-angelone.ts
  calculators/indicators/ sma · ema · rsi · macd · atr · volume-average · week-52-high-low · support-resistance · all-indicators · bulk-indicators-scanner · test-indicators
  candles/  candles.repository.ts (Neon daily_candles) · candles.service.ts (Angel → DB loader) · candles-update-nifty500.ts · candles-test.ts
  database/ neon.ts · index.ts · health-check.ts · db-test.ts
  indices/  index-stock.service.ts · constituent.service.ts (niftyindices CSV) · instrument-matcher.service.ts · index.service.ts (unused) · index.config.ts · index.constants.ts · test-index.ts
  instruments/ instrument-downloader.ts · instrument-updater.ts · instrument-load.ts · instrument-search.ts · run-instrument-update.ts
  types/  angelone.ts · indices.ts · instruments.ts · smartapi-javascript.d.ts (hand-written SDK typings, 7 methods only)
  util/   fromToDate.ts · tradingDay.ts · validator.ts
data/ instruments/OpenAPIScripMaster.json (14 MB, stripped) · scans/nifty-50-2026-11-18.json, nifty-500-2026-11-18.json (gitignored, `.gitignore:6`)
neon.ts, .neon         Neon project config
error.log              written by the SDK's winston logger (see Risk R1)
```

### Entry points
- **HTTP:** `src/main.ts:15-67`.
  - It runs a DB health check (`main.ts:16`), then `http.createServer`. Only `/mcp` is served (`main.ts:22`).
  - Each request passes the per-IP rate limit (`main.ts:27`) and the bearer-token check (`main.ts:34`).
  - It then builds a **new McpServer + stateless `StreamableHTTPServerTransport` per request** (`main.ts:40-47`, `sessionIdGenerator: undefined`).
- **stdio:** `src/stdio.ts:1-35` loads `.env` from a **hard-coded absolute Windows path** (`stdio.ts:5-9`), then connects `StdioServerTransport`.

### Dependencies (declared in `package.json`; installed versions verified in `node_modules/*/package.json`)
| Package | Declared | Installed | Used for |
|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.32.2 | 1.32.2 | MCP server (`server.ts:1`, `main.ts:2`, `stdio.ts:12`) |
| zod | ^4.6.7 | 4.6.7 | env schema (`config/config.ts`), tool input schemas (`config/server.config.ts`), instrument validation (`util/validator.ts`) |
| typescript | ^6.0.3 (dev) | 6.0.3 | `tsconfig.json`: ES2022, NodeNext, strict |
| tsx | ^4.23.15 (dev) | 4.23.15 | runs every script (no build step is used) |
| smartapi-javascript | ^1.0.27 | 1.0.27 | broker API |
| @neondatabase/serverless | ^1.2.0 | 1.2.0 | `src/database/neon.ts` |
| otplib | ^13.5.0 | 13.5.0 | TOTP (`angelone/auth.ts:2,49`) |
| csv-parse | ^7.0.3 | 7.0.3 | NIFTY constituent CSV |
| dotenv | ^18.0.9 | 18.0.9 | env loading |
| @supabase/supabase-js, @neon/config, @neon/env | — | — | **not imported anywhere in `src/`**; `main.ts:18` still logs "Supabase connected" |
| axios (transitive, via SDK) | — | 0.20.0 | SDK HTTP client |

Runtime: Node v24.20.0.

### Scripts (`package.json`)
`start` (HTTP), `start:stdio`, `update_instrument`, `update_candle_nifty_500`, `session-rest` (forces login and **prints the session object, including tokens, to the console**: `src/angelone/force-rest-session.ts:3-5`), `test_angelone`, `test_cal`. `test` is the npm placeholder that exits 1.

### Tool registration (ServerInfo pattern)
- `src/config/server.config.ts` default-exports an object keyed by tool id. Each entry holds `{title, description, inputSchema: {zod raw shape}, annotations}`.
- `src/server.ts` calls `server.registerTool("<name>", ServerInfo.<key>, handler)` for each tool.
- Every handler returns `{content:[{type:"text", text: JSON.stringify(result)}]}`.
- No tool defines `outputSchema` or `structuredContent`.
- Only `search_instruments` catches its own errors (`server.ts:37-43`). Every other handler lets errors propagate, and the MCP SDK converts them into an `isError: true` result with the error message (`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js:188-213`).

## A2. Tool inventory (19 tools)

All annotations are `readOnlyHint:true, destructiveHint:false, idempotentHint:true`. `openWorldHint` is `false` only for `ping` and `search_instruments`. "DB" means the Neon `daily_candles` table, read through `getDailyCandles` (`src/candles/candles.repository.ts:194-226`).

| Tool name | Registered at | ServerInfo key (server.config.ts lines) | Input schema | Output shape (JSON text) | SmartAPI calls | Data source |
|---|---|---|---|---|---|---|
| `ping` | server.ts:28 | health (3-15) | none | `"pong"` | none | — |
| `search_instruments` | server.ts:36 | search_instruments (16-40) | `query{name?,symbol?,token?}`, `exchange: NSE\|BSE`, `limit 1-100 =20` | `{totalMatches, returned, instruments:[{token,symbol,name,exch_seg}]}` | none | local instrument file |
| `get_historical_candles` | server.ts:50 | get_historical_candles (41-65) | `exchange NSE\|BSE`, `symboltoken`, `interval` (8 values: ONE_MINUTE…ONE_DAY), `fromdate`/`todate` `YYYY-MM-DD HH:mm` | raw SDK response `{status,message,errorcode,data:[[ts,o,h,l,c,v]]}`, or a resolved error object (see A6) | `getCandleData` | Angel One live |
| `get_index_stocks` | server.ts:67 | get_index_stocks (66-80) | `indexName: "NIFTY 50"\|"NIFTY 500"` | `{index,totalStocks,stocks:[{companyName,industry,symbol,series,isin,symboltoken}]}` | none | niftyindices.com CSV + instrument file |
| `get_calculator_indicator_sma` | server.ts:91 | calculate_sma (81-107) | exchange, symboltoken, interval, `period 1-500`, `date YYYY-MM-DD`, `direction forward\|backward` | `{indicator:'SMA',period,source,'latest sma',timestamp}` | none | DB (interval ignored) |
| `get_calculator_indicator_ema` | server.ts:105 | calculate_ema (108-130) | exchange, symboltoken, interval, `period 1-200` | `{indicator:'EMA',period,source,'latest ema'}` | none | DB |
| `calculate_rsi` | server.ts:117 | calculate_rsi (171-193) | exchange, symboltoken, interval, `period 2-100` | `{indicator:'RSI',period,source,value}` | none | DB |
| `calculate_macd` | server.ts:129 | calculate_macd (195-221) | exchange, symboltoken, interval, fast=12, slow=26, signal=9 | `{indicator,fastPeriod,slowPeriod,signalPeriod,source,'macd line','signal line',histogram,timestamp}` | none | DB |
| `calculate_atr` | server.ts:143 | calculate_atr (223-245) | exchange, symboltoken, interval, period=14 | `{indicator:'ATR',period,source,value,timestamp}` | none | DB |
| `calculate_volume_average` | server.ts:155 | calculate_volume_average (295-317) | exchange, symboltoken, interval, period=20 | `{indicator,period,source,'latest volume','average volume','relative volume',timestamp}` | none | DB |
| `calculate_support_resistance` | server.ts:167 | calculate_support_resistance (247-275) | exchange, symboltoken, interval=ONE_DAY, lookbackCandles 20-1000 =250, leftBars=5, rightBars=5, tolerancePercent=1 | `{indicator,source,latestClose,tolerancePercent,swingSettings,nearestSupport,nearestResistance,supportLevels[],resistanceLevels[],timestamp}`; each level is `{price,touches,lastTouched}` | none | DB |
| `get_52_week_high_low` | server.ts:182 | get_52_week_high_low (277-293) | exchange, symboltoken | `{indicator,source,'52 week high','52 week low','latest close','distance from high (%)','distance from low (%)',timestamp}` | none | DB (364 calendar days) |
| `calculate_all_indicators` | server.ts:197 | calculate_all_indicators (319-341) | exchange, symboltoken, interval=ONE_DAY, period 2-100 =14 | `{symboltoken,exchange,interval,period,SMA{10,20,50,200},EMA{10,20,50,200},RSI,MACD,ATR,VolumeAverage,Week52HighLow,SupportResistance}` | none | DB |
| `bulk_indicators_scanner` | server.ts:208 | bulk_indicators_scanner (343-363) | index="NIFTY 500", period=14, offset≥0, limit 1-100 =50 | `{index,scannedAt,totalStocks,successCount,failedCount,offset,returned,nextOffset,stocks:[StockIndicatorSummary],failedStocks}` | none | DB + CSV + instrument file |
| `get_profile` | server.ts:240 | get_profile (131-137) | none | raw SDK response (contains **PII**) | `getProfile` | live |
| `get_funds_and_margin` | server.ts:248 | get_funds_and_margin (139-145) | none | raw SDK response | `getRMS` | live |
| `get_holdings` | server.ts:256 | get_holdings (147-153) | none | raw SDK response | `getHolding` | live |
| `get_all_holdings` | server.ts:264 | get_all_holdings (155-161) | none | raw SDK response | `getAllHolding` | live |
| `get_positions` | server.ts:272 | get_positions (163-169) | none | raw SDK response | `getPosition` | live |

**Notes on the inventory:**
- Tool names and ServerInfo keys don't match for SMA and EMA (`get_calculator_indicator_sma` uses `ServerInfo.calculate_sma`).
- The `interval` enum is copy-pasted into 8 tool schemas.
- The `StockIndicatorSummary` fields are defined in `src/calculators/indicators/bulk-indicators-scanner.ts:42-67`.

## A3. Reusable helpers (every export)

"Pure" here means no I/O and deterministic for the same input. Validation functions may throw `AppError`.

| Function | File:line | Signature | Pure? |
|---|---|---|---|
| `getSMA` | calculators/indicators/sma.ts:85 | `(Candle: AngelOneCandle[], period: number) → {indicator,period,source,'latest sma',timestamp}` | **Pure** |
| `SMA` | sma.ts:8 | `async (exchange, symboltoken, interval, period, date, direction: 'forward'\|'backward')` | DB read |
| `getEMA` | ema.ts:56 | `(Candle, period) → {indicator,period,source,'latest ema'}` (no timestamp) | **Pure** |
| `EMA` | ema.ts:6 | `async (exchange, symboltoken, interval, period)` | DB read |
| `getRSI` | rsi.ts:80 | `(Candle, period) → {indicator,period,source,value}` (Wilder) | **Pure** |
| `RSI` (default) | rsi.ts:7 | `async (exchange, symboltoken, interval, period)` | DB read |
| `getMACD` | macd.ts:101 | `(Candle, fast=12, slow=26, signal=9)` | **Pure** |
| `MACD` (default) | macd.ts:7 | `async (exchange, symboltoken, interval, fast, slow, signal)` | DB read |
| `getATR` | atr.ts:79 | `(Candle, period=14) → {indicator,period,source,value,timestamp}` (Wilder) | **Pure** |
| `ATR` (default) | atr.ts:6 | `async (exchange, symboltoken, interval, period=14)` | DB read |
| `getVolumeAverage` | volume-average.ts:79 | `(Candle, period=20)` | **Pure** |
| `VolumeAverage` (default) | volume-average.ts:6 | `async (exchange, symboltoken, interval, period=20)` | DB read |
| `getWeek52HighLow` | week-52-high-low.ts:61 | `(Candle)`: high/low over **whatever candles are passed in** | **Pure** |
| `Week52HighLow` (default) | week-52-high-low.ts:6 | `async (exchange, symboltoken)` | DB read |
| `getSupportResistance` | support-resistance.ts:98 | `(Candle, leftBars=5, rightBars=5, tolerancePercent=1)` | **Pure** |
| `SupportResistance` (default) | support-resistance.ts:6 | `async (exchange, symboltoken, interval='ONE_DAY', lookback=250, left=5, right=5, tol=1)` | DB read |
| `AllIndicators` (default) | all-indicators.ts:15 | `async (exchange, symboltoken, interval, period)` | DB read |
| `bulkIndicatorScanner` | bulk-indicators-scanner.ts:72 | `async (index: 'NIFTY 50'\|'NIFTY 500', {exchange='NSE',interval='ONE_DAY',period=14,concurrency=10})` | I/O |
| `cachedBulkIndicatorScanner` | bulk-indicators-scanner.ts:166 | same arguments; 15-minute in-memory promise cache | I/O + module state |
| `summarizeStock` | bulk-indicators-scanner.ts:185 | `(StockIndicatorResult) → StockIndicatorSummary` | **Pure** |
| `fromToDate` (default) | util/fromToDate.ts:5 | `(date 'YYYY-MM-DD', direction, period) → {fromdate:'YYYY-MM-DD 00:00', todate:'YYYY-MM-DD 15:30'}` | **Pure** (depends on `config/holidays.ts`) |
| `tradingDay` (default) | util/tradingDay.ts:4 | `(date, direction, nod) → string[]`. **Includes the anchor date** if it is a trading day (verified: `tradingDay('2026-11-19','backward',3)` returns `['2026-11-19','2026-11-18','2026-11-17']`) | **Pure** |
| `toAngelOneCandles` | candles/candles.repository.ts:173 | `(rows) → [ 'YYYY-MM-DDT00:00:00+05:30', o,h,l,c,v ][]` | **Pure** |
| `getDailyCandles` | candles.repository.ts:194 | `async (exchange, symbolToken, fromdate, todate) → {status:true,message,data:rows}` | DB read |
| `saveDailyCandles` | candles.repository.ts:20 | `async (exchange, symbolToken, symbol, candles) → savedCount` (upsert in batches of 500) | DB write |
| `uploadCandleData`, `uploadNifty500HistoricalData` | candles/candles.service.ts:10, :40 | Angel → DB loaders | API + DB write |
| `getHistoricalCandles` (default) | angelone/historical-candles.ts:6 | `async (exchange, symboltoken, interval, fromdate, todate)` | API |
| `getProfile/getRMS/getHolding/getAllHolding/getPosition` | angelone/getAngelone.ts:4-54 | `async () → raw SDK response` | API |
| `createAngelOneSession` | angelone/auth.ts:41 | `async () → SmartAPI` (login + `getProfile`) | API |
| `getAngelOneClient / forcelogin / clearAngelOneClient / handleSession` | angelone/session-manager.ts:6/13/19/23 | singleton session helpers | module state |
| `searchInstruments` (default) | instruments/instrument-search.ts:15 | `async ({token?,symbol?,name?}, exch_seg) → InstrumentRecord[]` (linear scan of 170,064 rows) | file read (cached) |
| `loadInstrumentMaster / reloadInstrumentMaster` | instrument-load.ts:12/35 | in-memory cache of the file | file read |
| `updateInstrumentMaster` / `downloadInstrumentMaster` | instrument-updater.ts:16 / instrument-downloader.ts:5 | download, validate, atomically write | network + file write |
| `indexStock` (default) | indices/index-stock.service.ts:11 | `async (indexName) → MatchedConstituent[]` | network + file |
| `fetchIndexConstituents` | indices/constituent.service.ts:12 | `async (csvUrl)` | network |
| `matchIndexConstituents` | indices/instrument-matcher.service.ts:15 | `(constituents, instruments) → {matched, unmatched}` | **Pure** |
| `getAvailableIndices` | indices/index.service.ts:6 | NSE `/api/index-names` (**not used**) | network |
| `isAuthorized`, `rateLimit` | core/auth.ts:7, :17 | bearer compare; fixed-window per-key counter | state |
| `AppError`, `toAppError` | core/errors.ts:3, :14 | error normalisation | **Pure** |
| `logger` | core/logger.ts:33 | JSON lines to **stderr** (safe for stdio) | I/O |
| `checkDatabaseConnection` | database/health-check.ts:4 | `SELECT 1` | DB |
| `config` | config/config.ts:40 | parsed env; calls `process.exit(1)` if invalid (`:32-38`) | — |

Every pure `get*` function validates its input candles (shape, positive OHLC, ascending timestamps). That validation block is **duplicated about 8 times** (for example sma.ts:101-135, rsi.ts:96-130, atr.ts:98-148, support-resistance.ts:139-191).

## A4. `calculate_all_indicators` and `bulk_indicators_scanner`

### `AllIndicators` (`src/calculators/indicators/all-indicators.ts`)
1. Validate the arguments (`:22-24`).
2. Take today's date in IST (`:26-28`).
3. Build the window `fromToDate(today,'backward', max(period*5, 365))`. That is **365 trading days ≈ 17 months**. Verified: it yields `2025-06-10 00:00 → 2026-11-19 15:30` (`:30-34`).
4. Make one DB query, `getDailyCandles` (`:36-41`). **`interval` is not used for fetching.**
5. If `interval !== 'ONE_DAY'`, run the **same daily query again** for the "52-week" block (`:55-74`). The other indicators are still computed on daily data, but the output is labeled with the requested interval (`:78-80`).
6. Compute SMA and EMA 10/20/50/200, RSI(period), MACD(12,26,9), ATR(period), VolumeAverage(period), Week52HighLow (over the **whole ~17-month window**, `:104`), and S/R(5,5,1%) (`:82-112`).
7. **API calls: 0 SmartAPI calls; 1 DB query** (2 if interval ≠ ONE_DAY).

### `bulkIndicatorScanner` (`src/calculators/indicators/bulk-indicators-scanner.ts:72-164`)
1. `indexStock(index)` downloads the niftyindices CSV **on every scan** (no cache) and loads the instrument master. It matches on `${symbol}-${series}` and **silently drops unmatched constituents** (`indices/instrument-matcher.service.ts:31-36`).
2. A worker pool of `concurrency=10` (`:80`, `:105-140`) calls `AllIndicators` once per stock. Per-stock failures are collected in `failedStocks` (`:124-134`).
3. Results are sorted by symbol (`:142`).
4. Caching: `cachedBulkIndicatorScanner` keeps the scan **promise** in memory for 15 minutes, keyed by `[index, exchange, interval, period]` (`:69-70`, `:166-183`). The cache is evicted on rejection.
5. The tool paginates the cached result with `offset/limit` and maps rows through `summarizeStock` (`server.ts:211-227`).

**Run cost:**
- **SmartAPI calls per run: 0.**
- External calls per run: 1 CSV fetch from niftyindices.com (10 s timeout, `constituent.service.ts:19`).
- DB queries per run: N (50 or 500).
- Rate-limit handling: **none needed** for SmartAPI. There is no throttling for Neon or for niftyindices.

**Output size** (measured from `data/scans/nifty-500-2026-11-18.json`):
- Full internal result: ≈1.6 MB compact JSON for NIFTY 500 (≈3.3 KB per stock, about 16 S/R levels per stock on average).
- On-disk pretty-printed files: 3.0 MB (NIFTY 500) and 292 KB (NIFTY 50).
- Tool page: ≈463 bytes per summarized row, so the **default 50-row page ≈ 23 KB** and the max 100-row page ≈ 46 KB. `failedStocks` is appended to every page.

**Success rate (snapshot 2026-11-18):** NIFTY 50 50/50. NIFTY 500 491/500. The 9 failures were "Insufficient candles. Required: 200" (recent listings) or "No historical candles available".

**Runtime:** **UNKNOWN (not measured)**. My timing run was blocked by this session's permission policy. Estimate from the code: CSV fetch, plus first-time parse of the 14 MB instrument file, plus ⌈N/10⌉ rounds of one Neon HTTP query each. That is **5 rounds for NIFTY 50 and 50 rounds for NIFTY 500**. Neon round-trip latency is UNKNOWN. At an assumed 0.1–0.3 s per query, that comes to about 1–3 s for NIFTY 50 and 5–15 s for NIFTY 500, plus CPU time. Later pages within 15 minutes are served from the cache.

**Signals and filters supported:** **none**. The scanner returns raw indicator values only. There is no screening (e.g. RSI<30, price>SMA200, MACD cross, near 52-week high, volume spike), no ranking, no sort options other than symbol, and no sector filter (`industry` is returned but not filterable).

## A5. Candle data

- **`get_historical_candles`** (`src/angelone/historical-candles.ts`):
  - It passes straight through to `smartApi.getCandleData`, wrapped in `handleSession` (`:21-33`).
  - Schema intervals: `ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY` (`config/server.config.ts:50-53`). The SDK does not enumerate intervals itself. It only shows ONE_MINUTE (SDK:README.md) and ONE_HOUR (SDK:test/api_config.js:98).
  - It does **not** validate `fromdate ≤ todate`, enforce per-interval range limits, chunk requests, cache, or throttle. The tool description tells the model to "split long ranges" itself (`server.config.ts:43`).
- **Max history per interval:** **UNKNOWN (official docs unreachable)**.
  - UNVERIFIED forum quotes cite a documented table with ONE_MINUTE = 30 days and ONE_DAY = 2000 days, and an Angel One staff statement of a **500-record cap per request**.
  - Project evidence: the loader requests **2 years of ONE_DAY in one call** (`candles/candles.service.ts:44-53`). About 495 trading days came back for most stocks, which is consistent with *either* limit.
- **Caching / persistence:**
  - Daily candles only, stored in Neon `daily_candles`.
  - Columns used: `id, exchange, symbol_token, symbol, candle_date DATE, open, high, low, close, volume, updated_at`, with a unique key on `(exchange, symbol_token, candle_date)` (`candles.repository.ts:88-137`).
  - The repo contains **no migration or DDL**, so types beyond these and any indexes are UNKNOWN.
  - Loader: `npm run update_candle_nifty_500`. It processes 500 stocks **sequentially with a 1 s delay** (`candles.service.ts:61-88`), so ≥500 s per run. It **re-downloads 2 years every time** (no incremental mode) and has no scheduler.
  - There is **no intraday candle storage or cache**.
- **IST handling:**
  - The indicator tools compute "today" in `Asia/Kolkata` (e.g. `all-indicators.ts:26-28`).
  - `toAngelOneCandles` formats DB dates as `YYYY-MM-DDT00:00:00+05:30` (`candles.repository.ts:173-192`).
  - The loader instead uses **machine-local** `getFullYear()/getMonth()` (`candles.service.ts:44-52`).
  - `tradingDay` does UTC date arithmetic on plain dates, which is fine.
- **Market hours:**
  - There is no notion of market open or close. `fromToDate` hard-codes `00:00`/`15:30` (`util/fromToDate.ts:18-24`), and `Week52HighLow` uses `09:15`/`15:30` (`week-52-high-low.ts:25-26`).
  - If the loader runs during market hours, today's partial daily candle is stored. A later run overwrites it through the upsert.
  - Holidays exist only for **2026** (`config/holidays.ts:1-18`), plus one special session `2026-11-08` (`:20-22`).

## A6. Auth / session

**Login** (`src/angelone/auth.ts:41-72`):
- It gets epoch time from the HTTP `Date` header of margincalculator.angelone.in, cloudflare.com or google.com, falling back to the local clock (`:7-39`). This works around TOTP clock drift. Historical `error.log` shows **14 "Invalid totp and client combination"** login failures.
- It then runs `generate({secret, epoch})` and `generateSession(clientcode, PIN, totp)`, followed by an extra `getProfile()` call (`:67`).

**Session cache** (`session-manager.ts:4-12`):
- One module-level `SmartAPI` instance, created lazily.
- There is no in-flight promise, so **concurrent first calls each trigger a login** (race).

**Token lifetime:** decoding only the `iat`/`exp` claims of JWTs from `error.log` shows **`exp` is always 00:00 IST following the issue time** (e.g. iat 18/11 15:51 → exp 19/11 00:00). Login response keys (live): `jwtToken, refreshToken, feedToken, state` (`audit/fixtures/generateSession.json`).

**Refresh:** **none**.
- `generateToken` is never called.
- `setSessionExpiryHook` is never set (grep of `src/` returns no matches).
- `handleSession` (`session-manager.ts:23-34`) re-logs in only if a call **throws** an object with `status === 403`. **The SDK never throws.** Its axios error interceptor returns `{status, message}` as a *resolved* value (SDK:lib/smartapi-connect.js:114-132), so this retry path is **dead code**.
- Even if it did run, HTTP 403 from Angel One is the **rate-limit** response ("Access denied because of exceeding access rate", observed live today), not an auth failure. A working version would cause re-login storms during throttling.

**Failure modes that can stop broker tools mid-session:**
1. **Midnight expiry.** A server process started on day D keeps a token that dies at 00:00 IST on D+1. All broker tools (`get_historical_candles`, `get_profile`, `get_funds_and_margin`, holdings, positions) then fail until the process restarts. DB-backed indicator tools keep working.
2. **Silent error objects.** HTTP errors resolve as `{status: 403|400|..., message: ""}`. A status of `403` is truthy, so `res.status` checks pass. The account tools return the error object to the model as if it were data (`getAngelone.ts:4-54`, `server.ts:240-277`). Network errors and timeouts (SDK timeout 7000 ms, SDK:config/api.js:5) resolve as **`{}`** (SDK:lib/smartapi-connect.js:123-131).
3. **Process crash risk.** `new SmartAPI()` fires an un-awaited `publicIp.v4()` (SDK:lib/smartapi-connect.js:47-49). `public-ip` v4.0.4 throws "Couldn't find your IP" on failure (`node_modules/public-ip/index.js:129,172`). There is no `unhandledRejection` handler in `src/`, and Node 24's default turns an unhandled rejection into a crash, so every login is exposed to this. It happens at login time, which can be mid-day after a re-login.
4. **Rate-limit lockout of historical data.** `getCandleData` returned 403 "exceeding access rate" on the **first** call today and again after a 60 s cool-down. `error.log` holds about 300 historical rate-limit rejections from earlier bulk loads.
5. `config.ts` exits the process on any missing env var (`config/config.ts:32-38`). That includes Neon vars even for broker-only use.

## A7. Instrument master

- **Source:** `https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json` (`instruments/instrument-downloader.ts:3`). Updated manually with `npm run update_instrument`. There is no scheduled or automatic refresh.
- **Validation strips fields.** `InstrumentRecordSchema` keeps only `token, symbol, name, exch_seg` (`util/validator.ts:3-8`), and zod strips everything else.
  - The real master today has **11 fields**: `token, symbol, name, expiry, strike, lotsize, instrumenttype, exch_seg, tick_size, freeze_qty, is_cas_enabled`. It has 172,689 rows (checked by downloading the public file to a temp dir).
  - The stored file has 170,064 rows: NSE 10,156 · BSE 13,015 · NFO 44,126 · BFO 45,823 · MCX 17,098 · CDS 11,451 · NCO 26,319 · NCDEX 2,076.
  - **So `expiry`, `strike`, `lotsize`, `instrumenttype`, `tick_size` and `freeze_qty` are lost**, and that blocks any F&O, option-chain or position-sizing-by-lot work.
  - Observed in the real file: `strike` is ×100 (e.g. `"2005000.000000"` for strike 20050), and `tick_size` appears to be in paise (`"5.000000"` for a ₹0.05 tick). Both are inferences from samples; official units are UNKNOWN.
- **Paths are inconsistent.** The writer uses `process.cwd()/data/instruments` (`instrument-updater.ts:10`), but the reader uses a **hard-coded absolute path** (`instrument-load.ts:7-9`).
- **Search:** case- and space-insensitive substring match on name/symbol, exact match on token, filtered by exchange (`instrument-search.ts:11-35`). It linearly scans 170k rows per query, which is fine at this scale. The schema exposes only NSE and BSE (`server.config.ts:29`).

## A8. Config

- **Env variable names** (`src/config/config.ts:4-28`; `.env.example` lists only the first 6):
  `NODE_ENV, LOG_LEVEL, MCP_AUTH_TOKEN (min 32), PORT, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, ANGELONE_API_KEY, ANGELONE_CLIENT_CODE, ANGELONE_PIN, ANGELONE_TOTP_SECRET, DATABASE_URL_UNPOOLED, NEON_BRANCH, NEON_BRANCH_ID, NEON_FUNCTION_HOST_SUFFIX, DATABASE_URL`.
- **Holidays:** `src/config/holidays.ts` lists 16 NSE holidays for 2026 plus `specialTradingDays = ['2026-11-08']`. **2025 and 2027 are missing.** Lookback windows that cross into 2025 count 2025 holidays as trading days.
- **Constants:**
  - Bulk cache TTL 15 min, concurrency 10 (`bulk-indicators-scanner.ts:69,80`).
  - DB batch size 500 (`candles.repository.ts:18`).
  - Loader delay 1000 ms (`candles.service.ts:87`).
  - Index CSV files (`indices/index.config.ts:31-34`) and excluded index IDs (`indices/index.constants.ts`).
  - SDK base URL `https://apiconnect.angelone.in`, timeout 7000 ms (SDK:config/api.js:2,5).

## A9. Quality

- **Error handling:** an `AppError` taxonomy exists (`core/errors.ts`). However:
  - `toAppError` treats *any* `TypeError`, including programming bugs, as `NETWORK_ERROR` (`:19-25`).
  - The HTTP-status mapping (`:30-56`) never fires for SDK calls because the SDK never throws.
  - The account tools have no `status === true` check.
- **Validation:** good zod input schemas for tools, and strict candle validation in the pure functions. The gaps are `get_historical_candles` date ranges and SDK response shapes.
- **Logging:** structured JSON to stderr (`core/logger.ts`). However, **the SDK's own winston logger writes `error.log` into the process cwd** (SDK:lib/winston_log.js:1-34). It records **full request headers (Bearer JWT, `X-PrivateKey` API key, MAC and local IP) and request bodies, including the login body (client code, PIN, TOTP)**. The project-root `error.log` is 614 KB with 331 entries. It is gitignored (`.gitignore:5`) but grows unbounded and is a plaintext secret store. See R1.
- **Tests:** **none**. `npm test` exits 1. The `*-test.ts` files are ad-hoc runners, so coverage is **0%**.
- **Duplicated code:** the candle validation block (about 8 copies), the fetch-then-compute wrappers for each indicator, the interval enum (8 copies), and the EMA logic (`ema.ts:99-107` vs the inner `calculateEMA` at `macd.ts:174-192`).
- **TODO/FIXME:** none found (grep of `src/`).
- **Bugs and discrepancies:**

| # | Issue | Evidence |
|---|---|---|
| B1 | "52-week" high/low in `calculate_all_indicators` and `bulk_indicators_scanner` is computed over **365 trading days (~17 months)**, not 52 weeks | all-indicators.ts:30-34,104; fromToDate output verified |
| B2 | All indicator tools accept intraday intervals but **always read daily DB candles**; results are labeled with the requested interval | every `get*` wrapper calls `getDailyCandles`; all-indicators.ts:78-80 |
| B3 | `calculate_rsi` fetches only `period+1` trading days, but its description promises a `period×5` warm-up. Its value therefore **differs from the RSI in `calculate_all_indicators`** | rsi.ts:28 vs server.config.ts:174 |
| B4 | SMA description says "the given date itself excluded", but `tradingDay` includes it | server.config.ts:84 vs tradingDay.ts:36-54 |
| B5 | `handleSession` 403 retry is dead code, and 403 means rate-limit, not auth | session-manager.ts:23-34; SDK smartapi-connect.js:114-132; live fixture `getCandleData.json` |
| B6 | Account and candle tools return SDK error objects (`{status:403}`, `{}`) as success | getAngelone.ts; historical-candles.ts |
| B7 | Concurrent-login race in `getAngelOneClient` | session-manager.ts:6-12 |
| B8 | Instrument master strips F&O fields | validator.ts:3-8 |
| B9 | Hard-coded absolute paths (`.env`, instrument file) vs cwd-relative writer | stdio.ts:5-9; instrument-load.ts:7-9; instrument-updater.ts:10 |
| B10 | Unmatched index constituents silently dropped (scan totals exclude them) | instrument-matcher.service.ts:33-36 |
| B11 | Loader uses machine-local dates, not IST | candles.service.ts:44-52 |
| B12 | `ema.ts` doesn't check `status` before using data (minor) | ema.ts:40 |
| B13 | Startup log says "Supabase connected" while using Neon; supabase dependency unused | main.ts:18 |
| B14 | `force-rest-session.ts` prints tokens to the console | force-rest-session.ts:3-5 |

## A10. Gap analysis

| Capability | Status | Evidence / note |
|---|---|---|
| Live quote (LTP/OHLC/FULL) | **MISSING** | no `marketData` usage in `src/`; SDK supports it, and it was verified live |
| gainersLosers | **MISSING** | SDK `gainersLosers` (F&O futures only, see Part B) |
| putCallRatio | **MISSING** | SDK `putCallRatio` |
| oIBuildup | **MISSING** | SDK `oIBuildup` |
| getOIData | **MISSING** | SDK `getOIData`, verified live |
| optionGreek | **MISSING** | SDK `optionGreek`, verified live |
| estimateCharges | **MISSING** | SDK `estimateCharges`, verified live |
| marginApi | **MISSING** | SDK `marginApi`, verified live (needs `orderType`) |
| getOrderBook / getTradeBook | **MISSING** | not wrapped |
| Holdings / positions / funds | **DONE** (raw passthrough, no error checks) | server.ts:240-277 |
| Trade journal | **MISSING** | the only DB table is `daily_candles` |
| Risk limits (daily loss, max exposure) | **MISSING** | only raw `getRMS` exists |
| Position sizing | **PARTIAL** (building blocks only) | `getATR` exists; no lot size (B8), no capital or risk logic |
| Backtesting | **PARTIAL** (building blocks only) | pure indicator functions + ~2 years of daily DB history; no series outputs, no engine |
| Screening / signals | **MISSING** | scanner returns raw values only (A4) |
| Intraday candles | **PARTIAL** | single-symbol passthrough only, no cache |
| WebSocket streaming | **MISSING** | SDK `WebSocketV2` supports LTP=1, Quote=2, SnapQuote=3, Depth=4 (Depth only on nse_cm) (SDK:config/constant.js; lib/websocket2.0.js:127-160) |

## A11. Feasibility

**(a) 5-minute intraday scans: NOT supported as built.**
- Indicators can't consume intraday data (B2), and there is no intraday store.
- A NIFTY 500 scan would need about 500 `getCandleData` calls per cycle. Official limits are UNKNOWN. Under UNVERIFIED forum figures (3/s, 180/min, 5000/h), one cycle takes ≥2.8 min. Twelve cycles per hour means 6,000 calls/h, which **exceeds the reported hourly cap**.
- **What breaks first:** `getCandleData` rate-limit 403s. These have already been observed today at ~1 call/min. The code then returns `{status:403}` silently (B5/B6).
- NIFTY 50 (50 calls per cycle) is borderline but plausible.
- The feasible path is: daily indicators from the DB, plus a live overlay from `marketData` batches (max tokens per call is UNKNOWN) and/or WebSocketV2 ticks to build 5-minute bars locally.

**(b) Daily swing scans: YES (works today).**
- Zero broker calls per scan. NIFTY 500 succeeded 491/500.
- **What breaks first:** data freshness. The loader is manual, non-incremental, and takes ≥8.5 min of sequential API calls that are prone to rate limits. B1 skews the 52-week metrics, and the niftyindices CSV fetch on every scan is a single point of failure.

**(c) Weekly positional scans: PARTIAL.**
- Weekly bars can be aggregated from `daily_candles`, but no aggregation exists.
- ~2 years of daily data gives only about 100 weekly bars, which is too few for SMA200-week style metrics.
- The 52-week metric is wrong in the bulk path (B1). The standalone `get_52_week_high_low` tool is correct (364 calendar days).

## A12. Recommended insertion points

1. **Broker wrapper layer:** `src/angelone/getAngelone.ts`.
   - Add a single `call<T>(fn)` helper that requires `res.status === true`. It should map `{status:<number>}` and `{}` to `AppError` (403 → `RATE_LIMIT_ERROR`, AG8001/401 → `AUTHENTICATION_ERROR`).
   - Add wrappers for marketData, getOIData, optionGreek, gainersLosers, putCallRatio, oIBuildup, estimateCharges, marginApi, getOrderBook, getTradeBook, ruleList and ruleDetails.
   - Extend the typings in `src/types/smartapi-javascript.d.ts` using the field names in Part B.
2. **Session:** `src/angelone/session-manager.ts`.
   - Memoize the in-flight login promise.
   - Track the JWT `exp` claim and refresh proactively, via `generateToken` or re-login, before 00:00 IST.
   - Fix the 403 semantics, and install `process.on('unhandledRejection')` in `main.ts` and `stdio.ts`.
3. **Rate limiter:** a new `src/angelone/rate-limiter.ts` with a per-endpoint token bucket and a queue, used by `call()` and by `candles.service.ts`.
4. **Tools:** new keys in `src/config/server.config.ts` plus `registerTool` blocks in `src/server.ts`, as new sections: "Live market", "Derivatives analytics", "Orders (read-only)", "Risk".
5. **Modules:**
   - `src/market/` for quotes, gainers/losers, PCR, OI buildup and greeks.
   - `src/risk/` for position sizing from `getATR` + `getRMS` + `marginApi` + `estimateCharges` + lot size. This needs B8 fixed in `util/validator.ts`.
   - `src/journal/` for a new Neon table fed by `getTradeBook`.
   - `src/backtest/`, reusing the pure `get*` functions. Add series-returning variants next to each `get*` in `src/calculators/indicators/`.
6. **Screening:** add filter and sort parameters to `bulk_indicators_scanner` (`server.config.ts:343-363`). Apply them to `summarizeStock` rows in `server.ts:211-227`.
7. **Data:** an incremental daily updater in `src/candles/candles.service.ts` (fetch only after the last stored `candle_date`), and an `intraday_candles` table plus repository next to `candles.repository.ts`.

---

# PART B — ANGEL ONE SMARTAPI FUNCTION REFERENCE (smartapi-javascript 1.0.27)

## B0. Behavior common to every REST method (SDK:lib/smartapi-connect.js)

- **Transport:**
  - axios, `baseURL https://apiconnect.angelone.in`, timeout 7000 ms (SDK:config/api.js:2,5).
  - Headers: `X-PrivateKey: <api_key>`, `Authorization: Bearer <jwt>` once logged in, `X-UserType: USER`, `X-SourceID: WEB`, `X-ClientLocalIP`, `X-ClientPublicIP`, `X-MACAddress` (`:51-58`, `:618-636`).
  - The IP and MAC headers are captured at `axios.create` time, before the async lookups finish, so `X-ClientPublicIP` is sent as `null`. This is visible in `error.log`.
  - GET requests also send a JSON body, because `method !== 'GET' || method !== 'DELETE'` is always true (`:614`).
- **Return contract. The SDK never rejects:**
  - HTTP 200 with `data.status` or `data.success` truthy → resolves with the **body** (`{status:true,message:"SUCCESS",errorcode:"",data}` in every live sample) (`:87-89`).
  - HTTP 200 with a false status → resolves with the body (`{status:false,message,errorcode,data:null}`) and writes `error.log` (`:91-103`). Observed: `marginApi` without `orderType` → `{"message":"Order type is required","errorcode":"AB4033","status":false,"data":null}`.
  - HTTP non-2xx → resolves `{status:<httpCode>, message:<statusText>}`. **The response body is discarded**, and the server text appears only in `error.log` (`:114-122`). Observed: `getCandleData` → `{status:403,message:""}`; the body was "Access denied because of exceeding access rate".
  - Network error or timeout → resolves **`{}`** (`:123-125,131`).
  - Exception inside the interceptor → resolves `[]` (`:109-112,133-135`).
- **Session-expiry hook:** called only when HTTP is 200 **and** `response.data.errorCode === 'AG8001'` (camelCase, `:92-97`). Every live response used lowercase **`errorcode`**, so whether the hook ever fires is **UNKNOWN (likely never)**.
- **Logging:** every error is written to `./error.log` in the cwd, with headers (JWT and API key) and bodies (SDK:lib/winston_log.js).
- **Rate limits:** the **official per-endpoint table is UNKNOWN** (docs not machine-readable). The UNVERIFIED forum figure for `getCandleData` is 3/s, 180/min, 5000/h. Observed: HTTP 403 "Access denied because of exceeding access rate", and earlier `{"message":"Too many requests","errorcode":"AB…","status":false}` (from project `error.log`).
- **Usefulness ratings** are for an intraday/swing/positional trading *assistant*, as High, Medium or Low.

Side-effect classes: **READ-ONLY**, **CALCULATION-ONLY**, **STATE-CHANGING**. Pure local setters are marked **LOCAL** (no network call, no broker-side effect).

---

### Session & client

#### setAccessToken(access_token)
- **Purpose:** set the JWT used in the `Authorization` header. Local only, no HTTP (`:145-147`).
- **Params:** `access_token: string`, required.
- **Response:** none.
- **Limits / errors:** n/a.
- **Used in codebase:** no (called internally by `generateSession`).
- **Usefulness:** **Medium**. Lets you restore a session without re-login.
- **Class:** LOCAL.

#### setPublicToken(refresh_token)
- **Purpose:** store the refresh token. Local only (`:154-156`).
- **Params:** `refresh_token: string`, required.
- **Response:** none.
- **Used in codebase:** no.
- **Usefulness:** **Medium**, as an input to `generateToken`.
- **Class:** LOCAL.

#### setClientCode(client_code)
- **Purpose:** set the client code. It is only used in error-log metadata (`:158-160`).
- **Params:** `client_code: string`.
- **Response:** none.
- **Used in codebase:** no (set internally on login).
- **Usefulness:** **Low**.
- **Class:** LOCAL.

#### setSessionExpiryHook(cb)
- **Purpose:** register a callback for an expired token (`:167-169`).
- **Params:** `cb: () => void`.
- **Behavior:** fires only on HTTP 200 + `errorCode === 'AG8001'` (camelCase), but live responses use `errorcode`, so it may never fire (B0).
- **Used in codebase:** **no**.
- **Usefulness:** **Medium**. It would be High if it fired reliably; don't rely on it alone.
- **Class:** LOCAL.

#### generateSession(clientcode, password, totp)
- **Endpoint:** `POST /rest/auth/angelbroking/user/v1/loginByPassword` (SDK:config/api.js:7; `:178-206`).
- **Params:** `clientcode: string` (req), `password: string` (req; the trading **PIN** in this project, `auth.ts:56`), `totp: string` 6-digit (req).
- **Response (live, `fixtures/generateSession.json`):** `{status:true,message:"SUCCESS",errorcode:"",data:{jwtToken,refreshToken,feedToken,state}}`. All values are `[REDACTED]`. JWT `exp` is 00:00 IST following login (A6).
- **Side effects inside the SDK:** sets the access and refresh tokens.
- **Errors:** "Invalid totp and client combination" (`status:false`, seen 14× in `error.log`).
- **Rate limit:** UNKNOWN.
- **Used in codebase:** **yes**, `src/angelone/auth.ts:54`. It was called **twice in this audit** (sampler + one retry run).
- **Usefulness:** **High** (required).
- **Class:** STATE-CHANGING (creates a session).

#### getLoginURL()
- **Purpose:** returns `https://smartapi.angelone.in/publisher-login?api_key=<key>`. Local string, no HTTP (`:212-214`; SDK:config/api.js:3).
- **Used in codebase:** no.
- **Usefulness:** **Low**. Publisher/OAuth-style flow, not used for a TOTP bot.
- **Class:** LOCAL.

#### generateToken(refresh_token)
- **Endpoint:** `POST /rest/auth/angelbroking/jwt/v1/generateTokens` (api.js:8; `:221-234`).
- **Params:** body `{refreshToken: string}` (req).
- **Response (SDK mock, test/api_config.js:599-607):** `{status,message,errorcode,data:{jwtToken,refreshToken}}`. The SDK sets both tokens on success.
- **Edge case:** the `.then` has no `.catch`.
- **Expiry rules:** UNKNOWN. **Not called in this audit** (forbidden).
- **Used in codebase:** no.
- **Usefulness:** **High**. This is the missing session-refresh mechanism (A6).
- **Class:** STATE-CHANGING (session).

#### logout(client_code)
- **Endpoint:** `POST /rest/secure/angelbroking/user/v1/logout` (api.js:10; `:240-248`).
- **Params:** body `{clientcode}`.
- **Edge case:** if `client_code` is null it returns a **plain object** `{status:500,message:'Client Code is required.'}` (not a Promise).
- **Response (mock):** `{status:true,...,data:null}`. **Not called** (forbidden).
- **Used in codebase:** no.
- **Usefulness:** **Low**.
- **Class:** STATE-CHANGING.

#### getProfile()
- **Endpoint:** `GET /rest/secure/angelbroking/user/v1/getProfile` (api.js:9; `:254-256`).
- **Params:** none.
- **Response (live, 8 data keys):** `clientcode, name, email, mobileno` (all PII, `[REDACTED]`), `exchanges: string[]` (e.g. `"nse_cm"`, 2 entries), `products: string[]` (e.g. `"MARGIN"`, 5 entries), `lastlogintime: string`, `broker: string`.
- **Limits:** UNKNOWN.
- **Used in codebase:** **yes**, `auth.ts:67` and `getAngelone.ts:4-13` (`get_profile`).
- **Usefulness:** **Low**. Only for confirming the connected account and enabled segments.
- **Class:** READ-ONLY.

### Orders

#### placeOrder(params)
- **Endpoint:** `POST /rest/secure/angelbroking/order/v1/placeOrder` (api.js:12; `:273-275`).
- **Params (SDK JSDoc `:258-272` + README):**

  | Param | Allowed values / example |
  |---|---|
  | `variety` | `NORMAL` \| `STOPLOSS`. Other values: UNKNOWN |
  | `tradingsymbol` | e.g. `SBIN-EQ` |
  | `symboltoken` | e.g. `"3045"` |
  | `transactiontype` | `BUY` \| `SELL` |
  | `exchange` | `NSE` \| `BSE` per JSDoc |
  | `ordertype` | `MARKET` \| `LIMIT` \| `STOPLOSS_MARKET` \| `STOPLOSS_LIMIT` |
  | `producttype` | `DELIVERY` \| `MARGIN` \| `INTRADAY` \| `AMO_DELIVERY` \| `AMO_INTRADAY` |
  | `duration` | `DAY` \| `IOC` |
  | `price`, `quantity`, `squareoff`, `stoploss`, `disclosedquantity` | strings in the examples |

- **Response (mock):** `data.orderId` (test/api_config.js:151-156). The casing differs from other mocks, which use `orderid`. Real shape: UNKNOWN.
- **Not called** (forbidden). Market hours, AMO and limits: UNKNOWN.
- **Used in codebase:** no.
- **Usefulness:** **High** for an execution system. Keep it out of an assistant without explicit confirmation gates.
- **Class:** **STATE-CHANGING**.

#### modifyOrder(params)
- **Endpoint:** `POST .../order/v1/modifyOrder` (api.js:15; `:293-295`).
- **Params:** `orderid` + the same fields as placeOrder (mock request test/api_config.js:21-32).
- **Response (mock):** `{data:{orderid}}`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** **STATE-CHANGING**.

#### cancelOrder(params)
- **Endpoint:** `POST .../order/v1/cancelOrder` (api.js:16; `:302-304`).
- **Params:** `{variety, orderid}`.
- **Response (mock):** `{data:{orderid}}`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** **STATE-CHANGING**.

#### getOrderBook()
- **Endpoint:** `GET .../order/v1/getOrderBook` (api.js:14; `:310-312`).
- **Params:** none.
- **Response:**
  - **Live:** `{status:true,message:"SUCCESS",errorcode:"",data:null}`. **`data` is `null`, not `[]`, when there are no orders today.**
  - **Row fields (SDK mock, test/api_config.js:177-211; not live-verified):** `variety, ordertype, producttype, duration, price, triggerprice, quantity, disclosedquantity, squareoff, stoploss, trailingstoploss, tradingsymbol, transactiontype, exchange, symboltoken, instrumenttype, strikeprice, optiontype, expirydate, lotsize, cancelsize, averageprice, filledshares, unfilledshares, orderid, text, status, orderstatus, updatetime, exchtime, exchorderupdatetime, fillid, filltime, parentorderid`.
  - Mock types: mostly strings. Times look like `"20-Oct-2020 13:10:59"`; the timezone is UNKNOWN (presumably IST).
- **Used in codebase:** no.
- **Usefulness:** **High**. Order status for journaling and the assistant.
- **Class:** READ-ONLY.

#### getTradeBook()
- **Endpoint:** `GET .../order/v1/getTradeBook` (api.js:18; `:318-320`).
- **Response:**
  - **Live:** `data:null` (no trades today).
  - **Mock row (test/api_config.js:218-236):** `exchange, producttype, tradingsymbol, instrumenttype, symbolgroup, strikeprice, optiontype, expirydate, marketlot, precision, multiplier, tradevalue, transactiontype, fillprice, fillsize, orderid, fillid, filltime ("13:27:53", time only)`.
  - Whether it covers the current day only: UNKNOWN.
- **Used in codebase:** no.
- **Usefulness:** **High**. This is the trade-journal feed.
- **Class:** READ-ONLY.

#### indOrderDetails(qParams)
- **Endpoint:** `GET .../order/v1/details/{qParams}` (api.js:35; `:502-504`, `:647-680`).
- **Params:** `qParams: string` (the order's unique id; the mock calls it "GuiOrderID").
- **Response (mock, test/api_config.js:686-727):** an order-book row plus `ordertag, uniqueorderid`. `price` is a number in this mock but a string in the order-book mock.
- **Not sampled** (not allowlisted; needs an order id).
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** READ-ONLY.

### Portfolio & funds

#### getRMS()
- **Endpoint:** `GET .../user/v1/getRMS` (api.js:19; `:326-328`).
- **Response (live, 14 keys, values are strings or null):** `net, availablecash, availableintradaypayin, availablelimitmargin, collateral, m2munrealized, m2mrealized, utiliseddebits, utilisedspan, utilisedoptionpremium, utilisedholdingsales, utilisedexposure, utilisedturnover, utilisedpayout`. Some are `null` live: `utilisedspan, utilisedoptionpremium, utilisedholdingsales, utilisedexposure, utilisedturnover`.
- **Units:** decimal strings (the mock shows `'0.0000'`), presumably rupees. Not stated officially: **UNKNOWN**.
- **Used in codebase:** **yes**, `getAngelone.ts:15-23` (`get_funds_and_margin`).
- **Usefulness:** **High** (capital available for sizing and risk).
- **Class:** READ-ONLY.

#### getHolding()
- **Endpoint:** `GET .../portfolio/v1/getHolding` (api.js:20; `:334-336`).
- **Response (live: `data` array of 6 holdings, 17 keys each):** `tradingsymbol, exchange, isin, t1quantity, realisedquantity, quantity, authorisedquantity, product, collateralquantity, collateraltype, haircut, averageprice, ltp, symboltoken, close, profitandloss, pnlpercentage`. Quantities and prices are **numbers**; `symboltoken` is a string. Prices look like rupees (the mock `ltp 130.15`).
- **Used in codebase:** **yes**, `getAngelone.ts:25-33` (`get_holdings`).
- **Usefulness:** **High** for positional work.
- **Class:** READ-ONLY.

#### getAllHolding()
- **Endpoint:** `GET .../portfolio/v1/getAllHolding` (api.js:34; `:493-495`).
- **Response (live):** `data.holdings[]` (same 17 keys) + `data.totalholding{totalholdingvalue, totalinvvalue, totalprofitandloss, totalpnlpercentage}`, all numbers.
- **Used in codebase:** **yes**, `getAngelone.ts:35-44` (`get_all_holdings`).
- **Usefulness:** **High**.
- **Class:** READ-ONLY.

#### getPosition()
- **Endpoint:** `GET .../order/v1/getPosition` (api.js:21; `:342-344`).
- **Response:**
  - **Live:** `data:null` (no positions).
  - **Mock row (test/api_config.js:262-302):** `exchange, symboltoken, producttype, tradingsymbol, symbolname, instrumenttype, priceden, pricenum, genden, gennum, precision, multiplier, boardlotsize, buyqty, sellqty, buyamount, sellamount, symbolgroup, strikeprice, optiontype, expirydate, lotsize, cfbuyqty, cfsellqty, cfbuyamount, cfsellamount, buyavgprice, sellavgprice, avgnetprice, netvalue, netqty, totalbuyvalue, totalsellvalue, cfbuyavgprice, cfsellavgprice, totalbuyavgprice, totalsellavgprice, netprice`. All strings; the mock even has `"netvalue":"- 2235.80"`.
- **Used in codebase:** **yes**, `getAngelone.ts:46-54` (`get_positions`).
- **Usefulness:** **High** for intraday.
- **Class:** READ-ONLY.

#### convertPosition(params)
- **Endpoint:** `POST .../order/v1/convertPosition` (api.js:22; `:372-374`).
- **Params:** **inconsistent across SDK sources.** The JSDoc lists `exchange, symboltoken, producttype, newproducttype, tradingsymbol, symbolname, instrumenttype, priceden, ...` (`:346-371`). The README and test use `{exchange, oldproducttype, newproducttype, tradingsymbol, transactiontype, quantity, type:"DAY"}`. The correct set is UNKNOWN.
- **Response (mock):** `data:null`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Low**.
- **Class:** **STATE-CHANGING**.

### GTT rules

#### createRule(params)
- **Endpoint:** `POST .../gtt/v1/createRule` (api.js:24; `:391-393`).
- **Params:** `tradingsymbol, symboltoken, exchange, producttype, transactiontype` (JSDoc says `side`, the README says `transactiontype`), `price, qty, disclosedqty, triggerprice, timeperiod` (days, e.g. 365 in the README).
- **Response (mock):** `data.id`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Medium** (positional stop-loss and target automation).
- **Class:** **STATE-CHANGING**.

#### modifyRule(params)
- **Endpoint:** `POST .../gtt/v1/modifyRule`.
- **Params:** `id, symboltoken, exchange, qty`, plus optional `price, triggerprice, disclosedqty, timeperiod` (test mock).
- **Response:** `data.id`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** **STATE-CHANGING**.

#### cancelRule(params)
- **Endpoint:** `POST .../gtt/v1/cancelRule`.
- **Params:** `{id, symboltoken, exchange}`.
- **Response:** `data.id`. **Not called.**
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** **STATE-CHANGING**.

#### ruleDetails(params)
- **Endpoint:** `POST .../gtt/v1/ruleDetails` (api.js:27; `:426-428`).
- **Params:** `{id}`.
- **Response (mock):** `{status, createddate, updateddate, expirydate, clientid, tradingsymbol, symboltoken, exchange, transactiontype, producttype, price, qty, triggerprice, disclosedqty}`. Dates are ISO `...Z` (UTC) in the mock.
- **Not sampled** (needs a rule id).
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** READ-ONLY.

#### ruleList(params)
- **Endpoint:** `POST .../gtt/v1/ruleList` (api.js:28; `:438-447`).
- **Params:** `status: string[]` (**required to be an array**, otherwise the SDK returns a plain non-Promise `{status:500, message:'Invalid status...'}`). Values used in the SDK test: `NEW, CANCELLED, ACTIVE, SENTTOEXCHANGE, FORALL`. Also `page: number`, `count: number`.
- **Response:** **live** `data: []` (no rules). Note the SDK mock shows `data` as an *object*, so the mock is wrong about the type.
- **Used in codebase:** no.
- **Usefulness:** **Medium**.
- **Class:** READ-ONLY.

### Market data & instruments

#### marketData(params) ★
- **Endpoint:** `POST /rest/secure/angelbroking/market/v1/quote` (api.js:32; `:456-458`).
- **Params:**
  - `mode`: `"LTP"` \| `"OHLC"` \| `"FULL"`. These are inferred from the SDK mock response keys `full`/`OHLC`/`LTP` (test/api_config.js:398-524) and the example `mode:"FULL"` (example/api_test.js). An official enum is UNKNOWN.
  - `exchangeTokens`: `{ "<EXCH>": ["token", ...] }`. The live call used `{NSE:["3045","2885"], NFO:["61471"]}`; mixed exchanges work in one call.
- **Response (live FULL, `fixtures/marketData.json`):** `data.fetched[]`, `data.unfetched[]`. Fields per item:

  | Field | Type / format / meaning |
  |---|---|
  | `exchange, tradingSymbol, symbolToken` | string |
  | `ltp, open, high, low, close` | number, **rupees**. `close` = **previous day's close**: NIFTY fut `netChange 85.6 = ltp 25324.9 − close 25239.3` |
  | `lastTradeQty` | number |
  | `exchFeedTime, exchTradeTime` | `"DD-Mon-YYYY HH:mm:ss"`; matched IST wall clock (sampled at 11:14 IST, value 11:14:27) |
  | `netChange` | number, rupees |
  | `percentChange` | number, % |
  | `avgPrice` | number |
  | `tradeVolume` | number, shares/units |
  | `opnInterest` | number. **Non-zero even for the cash stock RELIANCE-EQ (430619000); meaning UNKNOWN** |
  | `lowerCircuit, upperCircuit` | number |
  | `totBuyQuan, totSellQuan` | number |
  | `referenceLimitPrice` | number. **Live only, not in the SDK mock** |
  | `52WeekLow, 52WeekHigh` | number. **`0` for the futures contract** |
  | `depth.buy[5]`, `depth.sell[5]` | `{price, quantity, orders}` |

  The OHLC mode returns `ltp, open, high, low, close` plus identifiers; LTP mode returns `ltp` plus identifiers (SDK mock).
- **Max tokens per call:** **UNKNOWN** (official). UNVERIFIED forum reports mention 50.
- **Rate limit:** UNKNOWN.
- **Outside market hours:** behavior UNKNOWN; the market was open during the sample.
- **Used in codebase:** **no**.
- **Usefulness:** **High**. Live overlay for every horizon and the cheapest way to scan many symbols intraday.
- **Class:** READ-ONLY.

#### searchScrip(params)
- **Endpoint:** `POST .../order/v1/searchScrip` (api.js:33; `:467-487`).
- **Params:** `{exchange: string, searchscrip: string}`, e.g. `{exchange:"NSE", searchscrip:"SBIN"}`.
- **Response:**
  - **The SDK unwraps it.** On success it returns the **bare array** `[{exchange, tradingsymbol, symboltoken}]` (live: 16 results for SBIN, including SBIN-EQ 3045 plus other series like -BE, -BL, -AF, -IQ).
  - It also **`console.log`s a summary to stdout**, which **would corrupt an MCP stdio transport**.
  - With no matches it returns `[]` (and logs). On failure it returns the envelope, or the error.
- **Used in codebase:** no (the project searches its local file instead).
- **Usefulness:** **Low**. The local master is richer if B8 is fixed.
- **Class:** READ-ONLY.

#### getCandleData(params) ★
- **Endpoint:** `POST /rest/secure/angelbroking/historical/v1/getCandleData` (api.js:30; `:526-528`).
- **Params:**
  - `exchange` (e.g. `NSE`; others UNKNOWN from the SDK).
  - `symboltoken: string`.
  - `interval`: the SDK shows only `ONE_MINUTE` and `ONE_HOUR`. The project assumes `ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY` (src/config/server.config.ts:50-53). Officially: UNKNOWN. The project has used ONE_DAY successfully.
  - `fromdate`, `todate`: `"YYYY-MM-DD HH:mm"`. Error.log shows other formats such as `DD-Mon-YYYY` and `DD/MM/YYYY` were rejected or rate-limited earlier; their validity is UNKNOWN.
- **Response (SDK mock, test/api_config.js:526-540; project type `src/types/angelone.ts:1-8`):** `data: [[ "2023-09-06T11:15:00+05:30", open, high, low, close, volume ], ...]`. ISO timestamps with **+05:30 (IST)**, prices in rupees, volume a number (`0` for the index in the mock).
- **Live sample:** **failed twice** with HTTP 403 "Access denied because of exceeding access rate". The SDK resolved `{status:403,message:""}` (`fixtures/getCandleData.json`), even though these were the first calls of the session and 60 s apart.
- **Max days per interval:** **UNKNOWN**. UNVERIFIED forum reports: 30 days for ONE_MINUTE, 2000 for ONE_DAY, and a 500-record cap per request.
- **Rate limit:** UNKNOWN. UNVERIFIED forum figures: 3/s, 180/min, 5000/h.
- **Used in codebase:** **yes**, `src/angelone/historical-candles.ts:24` and `src/candles/candles.service.ts:27`.
- **Usefulness:** **High**.
- **Class:** READ-ONLY.

#### getOIData(params) ★
- **Endpoint:** `POST /rest/secure/angelbroking/historical/v1/getOIData` (api.js:31; `:530-532`).
- **Params:** the same as getCandleData. Live call: `{exchange:"NFO", symboltoken:"61471" (NIFTY23NOV26FUT), interval:"FIVE_MINUTE", fromdate:"2026-11-19 09:15", todate:"2026-11-19 11:12"}`.
- **Response (live):** `data: [{time:"2026-11-19T09:15:00+05:30", oi: 10650120}, ...]`. That is **24 rows** of 5-minute open-interest values for one contract. `time` is ISO IST; `oi` is a number (contracts vs. units: **UNKNOWN**).
- **Limits:** UNKNOWN. Behavior for cash-segment tokens is UNKNOWN.
- **Used in codebase:** no.
- **Usefulness:** **High** for F&O intraday (OI trend with price).
- **Class:** READ-ONLY.

### Margin, charges, eDIS

#### marginApi(params) ★
- **Endpoint:** `POST rest/secure/angelbroking/margin/v1/batch` (api.js:36; `:512-514`).
- **Params:** `{positions: [{exchange, qty: number, price: number (0 for market), productType, orderType, token, tradeType: "BUY"|"SELL"}]}`.
  - **`orderType` is required.** It is missing from the SDK example; the live response without it was `AB4033 "Order type is required"`. `"MARKET"` worked; other values are UNKNOWN.
  - `productType` values seen: `DELIVERY` (live), `INTRADAY` and `CARRYFORWARD` (SDK test and example).
- **Response (live, 1 SBIN delivery BUY):** `data:{totalMarginRequired: 1148.87 (rupees, float artifact 1148.8700000000001), marginComponents:{netPremium, spanMargin, marginBenefit, deliveryMargin, nonNFOMargin, totOptionsPremium}}`.
  - The SDK mock (test/api_config.js:541-575) additionally shows `marginBreakup[{exchange, productType, totalMarginRequired}]` and `optionsBuy{totOptionsPremium, optionDetails[{exchange, productType, token, lotMultiplier, optionPremium}]}` for an NFO basket. Those keys were absent in the live equity response.
- **Max positions per call:** UNKNOWN.
- **Used in codebase:** no.
- **Usefulness:** **High** (pre-trade margin for sizing, especially F&O baskets).
- **Class:** CALCULATION-ONLY. The sample was made after the first attempt failed and was disclosed as a retry.

#### estimateCharges(params) ★
- **Endpoint:** `POST rest/secure/angelbroking/brokerage/v1/estimateCharges` (api.js:37; `:534-536`).
- **Params:** `{orders:[{product_type, transaction_type, quantity: string, price: string, exchange, symbol_name, token}]}` (SDK example). Live: `DELIVERY / BUY / "10" / "800" / NSE / "SBIN" / "3045"`.
- **Response (live):**
  - `data.summary{total_charges: 18.9392, trade_value: 8000, breakup:[{name, amount, msg, breakup:[...]|null}]}`.
  - `data.charges[]`: one object per order, same shape, where empty nested breakups are `[]` instead of `null`.
  - Amounts are **rupees** (trade_value = 10 × 800).
  - The breakup `name` labels were **over-redacted by my fixture filter**, so the actual labels are **UNKNOWN from the fixture**. The amounts were 8, 1.4536 (sub-items 0.2456 / 1.2 / 0 / 0.008), and 9.4856 (8 + 1.4856).
- **Max orders:** UNKNOWN.
- **Used in codebase:** no.
- **Usefulness:** **High** (net-of-cost P&L, intraday viability).
- **Class:** CALCULATION-ONLY.

#### verifyDis(params)
- **Endpoint:** `POST rest/secure/angelbroking/edis/v1/verifyDis` (api.js:38; `:538-540`).
- **Params:** `{isin, quantity}` (example).
- **Response:** UNKNOWN. **Not called** (forbidden).
- **Used in codebase:** no.
- **Usefulness:** **Low**.
- **Class:** **STATE-CHANGING** (initiates an eDIS authorisation).

#### generateTPIN(params)
- **Endpoint:** `POST rest/secure/angelbroking/edis/v1/generateTPIN` (api.js:39; `:542-544`).
- **Params:** `{dpId, ReqId, boid, pan}` (example; values `[REDACTED]`, as the SDK example contains PII-shaped data).
- **Response:** UNKNOWN. **Not called** (forbidden).
- **Used in codebase:** no.
- **Usefulness:** **Low**.
- **Class:** **STATE-CHANGING** (sends a TPIN to the user).

#### getTranStatus(params)
- **Endpoint:** `POST rest/secure/angelbroking/edis/v1/getTranStatus` (api.js:40; `:546-548`).
- **Params:** `{ReqId}`.
- **Response:** UNKNOWN. Not sampled (not allowlisted).
- **Used in codebase:** no.
- **Usefulness:** **Low**.
- **Class:** READ-ONLY.

### Derivatives analytics (all F&O-oriented)

#### optionGreek(params) ★
- **Endpoint:** `POST rest/secure/angelbroking/marketData/v1/optionGreek` (api.js:41; `:550-552`).
- **Params:** `{name: underlying (e.g. "NIFTY", "TCS"), expirydate: "DDMMMYYYY" (e.g. "23NOV2026")}`. Both required per the example.
- **Response (live):** `data[]` with **236 rows** for NIFTY 23NOV2026. Each row: `{name, expiry, strikePrice: "25200.000000", optionType: "CE"|"PE", delta, gamma, theta, vega, impliedVolatility, tradeVolume}`.
  - **All values are strings.**
  - `impliedVolatility` is in percent (e.g. `"12.910000"`).
  - Rows are **sorted by `tradeVolume` descending** (observed).
  - `name` was redacted by my filter, but the request was "NIFTY".
  - **No LTP, OI or token** per strike.
- **Used in codebase:** no.
- **Usefulness:** **High** for options intraday, **Medium** for swing.
- **Class:** READ-ONLY.

#### gainersLosers(params) ★
- **Endpoint:** `POST rest/secure/angelbroking/marketData/v1/gainersLosers` (api.js:42; `:554-556`).
- **Params:** `datatype`: `PercOIGainers | PercOILosers | PercPriceGainers | PercPriceLosers`; `expirytype`: `NEAR | NEXT | FAR` (both from the SDK example comment, example/api_test.js).
- **Response (live, PercPriceGainers/NEAR):** `data[]` with **10 rows** of `{tradingSymbol: "VOLTAS23NOV26FUT", percentChange: number, symbolToken: number, ltp: number, netChange: number}`.
  - **The universe is F&O futures contracts, not cash equities.**
  - `symbolToken` is a **number** here but a string elsewhere.
- **Used in codebase:** no.
- **Usefulness:** **Medium**. Good intraday momentum hints, but F&O names only, and the top 10 is not filterable.
- **Class:** READ-ONLY.

#### putCallRatio() ★
- **Endpoint:** `GET rest/secure/angelbroking/marketData/v1/putCallRatio` (api.js:43; `:558-560`).
- **Params:** none.
- **Response (live):** `data[]` with **223 rows** of `{pcr: number, tradingSymbol: "<UNDERLYING><DDMMMYY>FUT"}`. That is one PCR per F&O underlying, keyed by its near futures symbol.
  - Data-quality quirk: one row has `tradingSymbol "323NOV2623NOV26FUT"`.
  - Expiry selection and calculation basis (OI vs volume): **UNKNOWN**.
- **Used in codebase:** no.
- **Usefulness:** **Medium** (sentiment filter for index and stock F&O).
- **Class:** READ-ONLY.

#### nseIntraday() ★
- **Endpoint:** `GET rest/secure/angelbroking/marketData/v1/nseIntraday` (api.js:44; `:563-565`).
- **Params:** none.
- **Response (live):** `data[]` with **1,878 rows** of `{Exchange: "NSE", SymbolName: "EICHERMOT", Multiplier: "5.0"}`. Note the capitalised keys and the string multiplier.
  - It is a **list of NSE symbols with an intraday multiplier**. It is **not** price or intraday-movement data.
  - The meaning of `Multiplier` (likely intraday leverage) is **UNKNOWN** officially, and the SDK has no docs for it.
- **Used in codebase:** no.
- **Usefulness:** **Medium**. A universe filter for intraday-eligible stocks and their leverage.
- **Class:** READ-ONLY.

#### bseIntraday() ★
- **Endpoint:** `GET rest/secure/angelbroking/marketData/v1/bseIntraday` (api.js:45; `:567-569`).
- **Params:** none.
- **Response (live):** `data[]` with **1,802 rows** of `{Exchange: "BSE", SymbolName, Multiplier}`. Observed multipliers include `"1.0"` and `"5.0"`. Same caveats as nseIntraday.
- **Used in codebase:** no.
- **Usefulness:** **Low–Medium** (this project scans NSE).
- **Class:** READ-ONLY.

#### oIBuildup(params) ★
- **Endpoint:** `POST rest/secure/angelbroking/marketData/v1/OIBuildup` (api.js:46; `:572-574`).
- **Params:** `expirytype: NEAR | NEXT | FAR`; `datatype`: only `"Long Built Up"` appears in the SDK example. **Other values: UNKNOWN** (not in the SDK; not guessed).
- **Response (live):** `data[]` with **10 rows** of `{symbolToken, ltp, netChange, percentChange, opnInterest, netChangeOpnInterest, tradingSymbol: "BLUESTARCO23NOV26FUT"}`.
  - **All values are strings.**
  - `opnInterest` is fractional (e.g. `"3220.75"`), so its unit and scaling are **UNKNOWN**.
  - The universe is F&O futures.
- **Used in codebase:** no.
- **Usefulness:** **Medium–High** for intraday F&O positioning signals.
- **Class:** READ-ONLY.

---

## Live-sample log

- **Window:** 2026-11-19, 11:12–11:16 IST, Thursday, **market open**.
- **Script location:** run from a temporary job directory outside the project, so the SDK's `error.log` was written there and not into the project.
- **Spacing:** 1.5 s between calls.
- **Calls made:** `generateSession` ×2 (sampler + one retry run), 19 allowlisted calls once each, plus **one disclosed retry each** for `getCandleData` (after 60 s, still 403) and `marginApi` (with `orderType`, success).
- **Fixtures:** every sampled function is in `audit/fixtures/<function>.json`. `_summary.json` holds per-call latency (100–615 ms) and the key lists. Its `marginApi` entry records the first, failed attempt; `marginApi.json` holds the successful retry.
- **Not called:** every forbidden function, plus `indOrderDetails`, `ruleDetails`, `getTranStatus` and `getLoginURL`.

---

# ONE-PAGE SUMMARY

**What exists**
- A working MCP server (HTTP + stdio, MCP SDK 1.32.2, zod 4) with **19 read-only tools**:
  - instrument search
  - NIFTY 50/500 constituents
  - a raw historical-candle passthrough
  - 9 indicator tools: SMA, EMA, RSI, MACD, ATR, volume average, support/resistance, 52-week high/low, and an all-in-one
  - a cached, paginated **NIFTY 500 daily scanner**
  - 5 account passthroughs: profile, RMS, holdings, all-holdings, positions
- Indicators are computed from a **Neon `daily_candles` table** (~2 years), so scans make **zero broker calls** and work well for **daily swing** use (491/500 stocks).
- Pure, reusable indicator functions (`getSMA … getSupportResistance`) are good backtest building blocks.

**What is missing**
- **No live quotes** (`marketData`) and **no intraday data path**. Indicators ignore `interval`.
- **No screening or signals** in the scanner.
- None of the derivatives analytics (OI, greeks, PCR, OI buildup, gainers/losers).
- No order or trade book, no charges or margin calculations, no journal, no risk or position sizing, no backtesting.
- The instrument master drops lot size, expiry and strike, which blocks F&O.
- No tests. No incremental or scheduled candle updates.

**Top risks**
1. **R1 — Secrets on disk.** The SDK writes `./error.log` with full request headers and bodies: Bearer JWT, API key, login PIN/TOTP payloads, MAC and IP. The project root copy is 614 KB. Rotate exposed credentials if this file has been shared, and either relocate the cwd or patch the logger.
2. **R2 — Silent failures.** The SDK never rejects. HTTP errors resolve as `{status:403}` (truthy) and network errors as `{}`. The project treats these as data, and its 403 re-login path is dead code. A 403 actually means rate-limited.
3. **R3 — Session death at midnight.** The JWT expires at 00:00 IST, with no refresh, no working expiry hook, and a concurrent-login race. Broker tools fail until restart.
4. **R4 — Historical API throttling.** `getCandleData` returned "exceeding access rate" 403s on the first call today. Intraday scanning on `getCandleData` is not viable at NIFTY 500 scale. Use DB + `marketData`/WebSocket instead.
5. **R5 — Incorrect metrics.** The "52-week" high/low in the bulk scanner covers ~17 months (B1). RSI differs between tools (B3). Intraday intervals are mislabeled as daily results (B2).
6. **R6 — Possible process crash** from the SDK's un-awaited `publicIp.v4()` rejection, with no `unhandledRejection` handler.

---

# SMARTAPI FUNCTION TABLE

| function | side-effect class | already used | value for trading system |
|---|---|---|---|
| setAccessToken | LOCAL | no (SDK-internal) | Medium: restore sessions |
| setPublicToken | LOCAL | no (SDK-internal) | Medium: refresh input |
| setClientCode | LOCAL | no (SDK-internal) | Low |
| setSessionExpiryHook | LOCAL | no | Medium: may never fire (errorCode casing) |
| generateSession | STATE-CHANGING (session) | **yes**, angelone/auth.ts:54 | High: required login |
| getLoginURL | LOCAL | no | Low |
| generateToken | STATE-CHANGING (session) | no | **High**: fixes midnight expiry |
| logout | STATE-CHANGING | no | Low |
| getProfile | READ-ONLY | **yes**, auth.ts:67, getAngelone.ts:7 | Low |
| placeOrder | **STATE-CHANGING** | no | High for execution; gate heavily |
| modifyOrder | **STATE-CHANGING** | no | Medium |
| cancelOrder | **STATE-CHANGING** | no | Medium |
| getOrderBook | READ-ONLY | no | **High**: order status |
| getTradeBook | READ-ONLY | no | **High**: journal feed |
| getRMS | READ-ONLY | **yes**, getAngelone.ts:18 | High: capital for sizing |
| getHolding | READ-ONLY | **yes**, getAngelone.ts:28 | High: positional |
| getPosition | READ-ONLY | **yes**, getAngelone.ts:49 | High: intraday |
| convertPosition | **STATE-CHANGING** | no | Low |
| createRule | **STATE-CHANGING** | no | Medium: GTT SL/target |
| modifyRule | **STATE-CHANGING** | no | Medium |
| cancelRule | **STATE-CHANGING** | no | Medium |
| ruleDetails | READ-ONLY | no | Medium |
| ruleList | READ-ONLY | no | Medium |
| marketData | READ-ONLY | no | **High**: live LTP/OHLC/depth, batch |
| searchScrip | READ-ONLY | no | Low: local master is better; stdout logging |
| getAllHolding | READ-ONLY | **yes**, getAngelone.ts:38 | High |
| indOrderDetails | READ-ONLY | no | Medium |
| marginApi | CALCULATION-ONLY | no | **High**: pre-trade margin (needs `orderType`) |
| getCandleData | READ-ONLY | **yes**, historical-candles.ts:24, candles.service.ts:27 | High, but rate-limited |
| getOIData | READ-ONLY | no | High: F&O intraday OI |
| estimateCharges | CALCULATION-ONLY | no | **High**: net-of-cost P&L |
| verifyDis | **STATE-CHANGING** | no | Low |
| generateTPIN | **STATE-CHANGING** | no | Low |
| getTranStatus | READ-ONLY | no | Low |
| optionGreek | READ-ONLY | no | High (options), Medium (swing) |
| gainersLosers | READ-ONLY | no | Medium: F&O futures only, top 10 |
| putCallRatio | READ-ONLY | no | Medium: sentiment per underlying |
| nseIntraday | READ-ONLY | no | Medium: intraday-eligible universe + multiplier |
| bseIntraday | READ-ONLY | no | Low–Medium |
| oIBuildup | READ-ONLY | no | Medium–High: F&O positioning |
