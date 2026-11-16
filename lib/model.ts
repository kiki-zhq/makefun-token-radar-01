// The token radar's model: one sealed snapshot in, one ranked board out.
//
// Every board row is a protocol that records no token AND is not a wrapped, staked or
// bridged product of a token that already trades (the watchlist's exclusion rule, applied
// to the whole board, not just the watchlist). Protocols whose token already trades are
// kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures — never a name:
//
//   multiple   = clamp(0.60 x (tvl_usd / 1e6) ^ -0.15, 0.10, 0.60)
//                A token's value grows with TVL, but with diminishing returns: a
//                $5M protocol's token trades at a far higher TVL multiple than a $2B
//                one's, so the multiple decays as TVL grows (a power law, not a list).
//   growth     = clamp(change_7d, -70, 200) per cent; unknown change counts as 0.
//   growthMult = 1 + (growth / 100) x 0.6
//   age_days   = days from listed_at to the snapshot's as_of; unknown counts as 365.
//   maturity   = 0.55 + 0.45 x min(age_days, 1460) / 1460
//                A protocol that has run for years with no token has survived longer
//                without one, so its launch — if it comes — prices off a longer record.
//   breadth    = 1 + 0.04 x min(chains - 1, 4)
//                Each extra chain the protocol runs on adds reach, capped at five chains.
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x breadth))
//
// The same function scores every row. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_base: number;
  multiple_exponent: number;
  multiple_min: number;
  multiple_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  multiple_base: 0.6,
  multiple_exponent: -0.15,
  multiple_min: 0.1,
  multiple_max: 0.6,
  growth_weight: 0.6,
  growth_floor: -70,
  growth_cap: 200,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's "Already trading" table carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories the board never ranks: wrapped, staked or bridged products of a token that trades. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a board protocol's name must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A version marker at the end of a name: a space followed by V2, v2, 2.0 or the like. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in a name, in any case. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** A protocol records no token when DefiLlama carries no market cap, no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * True when the protocol is a wrapped, staked or bridged product of a token that already
 * trades, and so is not a protocol still waiting on a launch of its own.
 */
export function isWrappedOrStaked(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_MARKER.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

/** Days from `listed_at` (YYYY-MM-DD) to the snapshot's `as_of` date; null when unlisted. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** The TVL multiple: a power law in TVL, clamped to the model's floor and ceiling. */
export function tvlMultiple(tvlUsd: number): number {
  const raw = MODEL.multiple_base * Math.pow(Math.max(tvlUsd, 1) / 1_000_000, MODEL.multiple_exponent);
  return Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, raw));
}

/** The growth multiplier from the seven-day TVL change, clamped so one wild week cannot dominate. */
export function growthMultiplier(change7d: number | null): { pct: number; mult: number } {
  const pct = change7d === null ? 0 : Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, change7d));
  return { pct, mult: 1 + (pct / 100) * MODEL.growth_weight };
}

/** The maturity multiplier from how long the protocol has run with no token. */
export function maturityMultiplier(age: number | null): { age: number; mult: number } {
  const days = age === null ? MODEL.unknown_age_days : age;
  return {
    age: days,
    mult: MODEL.maturity_floor + MODEL.maturity_range * (Math.min(days, MODEL.maturity_days) / MODEL.maturity_days),
  };
}

/** The breadth multiplier from how many chains the protocol runs on. */
export function breadthMultiplier(chains: string[]): number {
  return 1 + MODEL.breadth_per_chain * Math.min(Math.max(chains.length - 1, 0), MODEL.breadth_max_chains);
}

/** One row's model breakdown, so the dashboard can show every factor behind the value. */
export interface ModelBreakdown {
  multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number;
  base_usd: number;
}

/** The implied value of one protocol, with its breakdown. */
export function impliedValue(p: SnapshotProtocol, asOf: string): { value: number; model: ModelBreakdown } {
  const multiple = tvlMultiple(p.tvl_usd);
  const growth = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(ageDays(p, asOf));
  const breadth = breadthMultiplier(p.chains);
  const base = p.tvl_usd * multiple;
  const value = Math.max(1, Math.round(base * growth.mult * maturity.mult * breadth));
  return {
    value,
    model: {
      multiple,
      growth_pct: growth.pct,
      growth_multiplier: growth.mult,
      maturity_multiplier: maturity.mult,
      breadth_multiplier: breadth,
      age_days: maturity.age,
      base_usd: Math.round(base),
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** Typical gas for one transaction on a chain, as the farm steps quote it. */
function gasNote(chain: string): string {
  const cheapL2 = new Set([
    'Arbitrum', 'Optimism', 'Base', 'zkSync Era', 'Scroll', 'Linea', 'Blast', 'Mode',
    'Ink', 'Unichain', 'Katana', 'Polygon', 'Binance', 'Avalanche', 'Sonic', 'Berachain',
    'Sei', 'Sui', 'Aptos', 'Starknet', 'Abstract', 'Corn', 'Fluent', 'Tempo', 'Stable',
    'Plasma', 'BOB', 'Citrea', 'Mezo', 'Flare', 'Stellar', 'Arc', 'Monad', 'Hyperliquid L1',
  ]);
  if (chain === 'Ethereum') return '$2–$8';
  if (chain === 'Solana') return 'about $0.01';
  if (chain === 'Tron') return '$1–$3';
  if (chain === 'Bitcoin') return '$1–$5';
  if (cheapL2.has(chain)) return '$0.10–$1';
  return '$0.50–$3';
}

/** Fill a step template with the protocol's name, its main chain and that chain's gas note. */
function step(template: string, name: string, chain: string): string {
  return template.replaceAll('{name}', name).replaceAll('{chain}', chain).replaceAll('{gas}', gasNote(chain));
}

/** Farm steps by category: five concrete steps each, with amounts, costs and time. */
const STEP_TEMPLATES: Record<string, string[]> = {
  Dexs: [
    'Swap $200–$1,000 of a major asset (ETH, SOL or a stablecoin) for another asset on {name} on {chain} — gas about {gas}, about 5 minutes, and keep the trade receipt.',
    'Add $300–$1,500 of liquidity to one of {name}\u2019s busiest pools on {chain} and hold the LP position — gas about {gas}, about 10 minutes to set up.',
    'Trade on {name} at least once a week for four weeks, $50–$200 per trade, so the activity spans a full month — about 5 minutes per trade.',
    'If {name} offers a concentrated-liquidity or limit-order feature on {chain}, place one range order around the current price with $200–$500 — gas about {gas}, about 10 minutes.',
    'Leave the LP position and trading history untouched for at least 30 days, then check {name}\u2019s points or rewards page for any farming tally — 5 minutes to check.',
  ],
  Lending: [
    'Deposit $500–$2,000 of ETH, SOL or a stablecoin as collateral into {name} on {chain} — gas about {gas}, about 10 minutes, and keep the loan-to-value below 50%.',
    'Borrow $100–$500 of a stablecoin against that collateral on {name} and hold it for at least two weeks — gas about {gas}, about 5 minutes.',
    'Repay half the loan after two weeks and borrow a smaller amount again, keeping the position active across two separate months — about 10 minutes per action.',
    'Supply a second asset to {name} on {chain}, $200–$1,000, so the account shows more than one market used — gas about {gas}, about 10 minutes.',
    'Check the position\u2019s health factor on {name} once a week and top up collateral if it falls under 1.5 — 5 minutes per check, no cost unless you top up.',
  ],
  Yield: [
    'Deposit $500–$2,000 into {name}\u2019s main vault or strategy on {chain} and hold the receipt token — gas about {gas}, about 10 minutes to complete.',
    'Add a second deposit of $200–$1,000 to the same vault two weeks later, so the position shows repeat activity — gas about {gas}, about 5 minutes.',
    'Hold the vault position for at least 60 days without withdrawing, letting the yield compound in the vault — no action needed, just time.',
    'If {name} runs more than one vault on {chain}, deposit $100–$500 into a second one to show breadth — gas about {gas}, about 10 minutes.',
    'Do one small test withdrawal of $50–$100 after 30 days to prove the position exits cleanly, then re-deposit it — gas about {gas}, about 10 minutes.',
  ],
  CDP: [
    'Lock $500–$2,000 of ETH or another accepted collateral in {name} on {chain} and mint $100–$500 of its stablecoin — gas about {gas}, about 10 minutes, keeping the ratio above 200%.',
    'Use the minted stablecoin in a {chain} DeFi pool for two weeks, then buy it back — about 10 minutes per move plus pool gas.',
    'Repay half the minted stablecoin after a month and mint a fresh, smaller amount to keep the vault active — gas about {gas}, about 10 minutes.',
    'Top up the collateral by $100–$300 if the collateral ratio falls under 180% — gas about {gas}, about 5 minutes.',
    'Keep the vault open for at least 60 days and check its ratio weekly — 5 minutes per check.',
  ],
  RWA: [
    'Buy $300–$1,500 of {name}\u2019s tokenized asset on {chain} and hold it in the same wallet — gas about {gas}, about 10 minutes, plus any purchase fee the asset charges.',
    'Hold the position for at least 90 days and collect the yield it pays out, reinvesting each payout back into the same asset — about 10 minutes per reinvestment.',
    'If {name} offers a secondary market or redemption on {chain}, test a $50–$100 redemption after 30 days to confirm the exit works — gas about {gas}, about 10 minutes.',
    'Add $200–$500 more to the position in a second month so the activity spans two months — gas about {gas}, about 10 minutes.',
    'Read {name}\u2019s monthly asset report and keep a record of each holding — 10 minutes a month, no on-chain cost.',
  ],
  Derivatives: [
    'Open a $200–$1,000 position on {name} on {chain} with no more than 2x leverage — gas about {gas}, about 10 minutes, and set a stop-loss before you open it.',
    'Hold the position for at least one week, then close half of it and keep the rest open — gas about {gas}, about 5 minutes per action.',
    'Open a second, opposite-direction position of $100–$300 the following week to show two-way activity — gas about {gas}, about 10 minutes.',
    'If {name} pays funding or yield on positions, claim it once a month rather than letting it sit — gas about {gas}, about 5 minutes.',
    'Keep total exposure under $2,000 and never trade on more than 3x leverage — risk control, no cost, review weekly for 5 minutes.',
  ],
  Chain: [
    'Bridge $200–$1,000 from Ethereum or another major chain into {name}\u2019s chain using its official bridge — bridge fee about $2–$15, about 15 minutes including confirmation.',
    'Use $100–$500 of the bridged funds in one of {name}\u2019s native apps and hold the rest as the chain\u2019s gas token — gas about {gas}, about 10 minutes.',
    'Make at least one transaction a week on {name} for four weeks — a swap, a transfer or an app interaction, about 5 minutes each.',
    'If {name} supports staking its native token, stake $100–$500 for at least 30 days — gas about {gas}, about 10 minutes to stake.',
    'Keep a small balance on the chain for at least 60 days so the address stays active across two months — no cost beyond the transactions above.',
  ],
};

/** The generic plan, for categories with no template of their own. */
const GENERIC_STEPS = [
  'Use {name} on {chain} with $300–$1,500 in a first transaction and keep the position open — gas about {gas}, about 10 minutes.',
  'Repeat the same action with $100–$500 two weeks later so the wallet shows activity in two separate weeks — gas about {gas}, about 10 minutes.',
  'Interact with a second feature of {name} on {chain} — a different pool, market or function — with $100–$300 — gas about {gas}, about 10 minutes.',
  'Hold every position for at least 30 days before touching it again — no action needed, just time.',
  'Check {name} once a week for points, quests or rewards pages and complete any free task it lists — 5 to 10 minutes per check.',
];

/** Categories that share the vault plan: deposit, hold, repeat, breadth, test exit. */
const VAULT_CATEGORIES = new Set([
  'Yield Aggregator',
  'Risk Curators',
  'Onchain Capital Allocator',
  'Liquidity Manager',
  'Restaking',
  'Staking Pool',
  'Collateral Markets',
]);

/** Categories that share the derivatives plan: open, hold, hedge, claim, cap risk. */
const DERIVATIVES_CATEGORIES = new Set(['Basis Trading', 'Leveraged Farming', 'Insurance', 'CeDeFi']);

/** Five concrete farm steps for one protocol, from its category and its main chain. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  let templates: string[];
  if (p.category !== null && STEP_TEMPLATES[p.category] !== undefined) {
    templates = STEP_TEMPLATES[p.category]!;
  } else if (p.category !== null && VAULT_CATEGORIES.has(p.category)) {
    templates = STEP_TEMPLATES['Yield']!;
  } else if (p.category !== null && DERIVATIVES_CATEGORIES.has(p.category)) {
    templates = STEP_TEMPLATES['Derivatives']!;
  } else {
    templates = GENERIC_STEPS;
  }
  return templates.map((t) => step(t, p.name, chain));
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** One live-token protocol, shown apart from the ranked board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  symbol: string | null;
}

/** The radar: the ranked board, the live-token table and the counts behind them. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  protocols_scanned: number;
  pre_token_count: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Parse and lightly validate the snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

/**
 * Build the radar from the snapshot: every pre-token protocol that is not a wrapped,
 * staked or bridged product, scored by the model and ranked by implied value (ties
 * broken by slug, so the order is deterministic), plus the live-token table.
 */
export function buildRadar(snapshot: Snapshot): Radar {
  const candidates = snapshot.protocols.filter((p) => isPreToken(p) && !isWrappedOrStaked(p));
  const scored = candidates.map((p) => {
    const { value, model } = impliedValue(p, snapshot.as_of);
    return { p, value, model };
  });
  scored.sort((a, b) => (b.value - a.value) || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: ageDays(s.p, snapshot.as_of),
    implied_value_usd: s.value,
    model: s.model,
    farm_steps: farmSteps(s.p),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd as number,
      symbol: p.symbol,
    }));
  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    protocols_scanned: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(isPreToken).length,
    watchlist: snapshot.watchlist.slice(),
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    rows,
    live,
  };
}

/** The board's rows, in rank order, as board.json holds them. */
export function boardRows(radar: Radar): BoardRow[] {
  return radar.rows;
}

/** The first problem with a board, or null when the gate's shape holds. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100 to 4000`;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.rank !== i + 1) return `row ${i} has rank ${row.rank}, expected ${i + 1}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (i > 0 && rows[i - 1]!.implied_value_usd < row.implied_value_usd) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has an implied value outside the gate`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'every implied value is the same';
  return null;
}

/** The dashboard's data file: the radar as a script the page reads, no network involved. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
