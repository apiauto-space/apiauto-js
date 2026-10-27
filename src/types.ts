/**
 * A market of the API:
 * - `kr` — South Korea, Encar
 * - `cn` — China, Che168
 * - `us` — USA, Copart and IAAI (upcoming auction lots)
 */
export type Market = "kr" | "cn" | "us";

/** The site a record comes from. */
export type Source = "encar" | "che168" | "copart" | "iaai";

/**
 * A decimal number sent as a string to keep its precision, e.g. `"23900000.00"`.
 * Convert with `Number(value)` when floating point is good enough.
 */
export type Decimal = string;

/** A price in the market's currency. */
export interface Price {
  /**
   * The amount in `currency`. US lots: the buy-now price or the final bid of a sold lot,
   * `null` when there is none (the running bid is in `raw.bid`).
   */
  amount: Decimal | null;
  /** `KRW`, `CNY` or `USD`. */
  currency: string;
}

/** Where the car is. */
export interface Location {
  /** ISO 3166 code: `KR`, `CN`, `US`. */
  country: string;
  /** Province or US state. */
  region: string | null;
  city: string | null;
}

/**
 * One car in the common record format, the same keys in every market.
 * What the source does not provide is `null`; source-only fields are in `raw`.
 *
 * @see https://apiauto.space/en/docs/record/
 */
export interface Car {
  /** `source:source_id`, stable for good, e.g. `encar:43020893`. */
  id: string;
  market: Market;
  source: Source;
  /** The listing or lot number at the source. */
  source_id: string;
  /** Year, make, model and trim in one line. */
  title: string;
  /** Make in Latin script, spelled the same in every market. */
  brand: string | null;
  /** Model family in Latin script (Grandeur, E-Class, 3 Series). */
  model: string | null;
  /** Korea only: Encar's model name with generation and facelift; `null` elsewhere. */
  generation: string | null;
  /** The version: Encar's badge, Che168's full name, the US variant. */
  trim: string | null;
  /** Model year. */
  year: number | null;
  /** Mileage in kilometres (US miles are converted). */
  mileage_km: number | null;
  /** Canonical value, see {@link Apiauto.dictionaries}. */
  fuel: string | null;
  /** Canonical value; `null` for Korea. */
  transmission: string | null;
  /** Engine size, cm³. */
  engine_cc: number | null;
  /** Canonical value, see {@link Apiauto.dictionaries}. */
  body_type: string | null;
  color: string | null;
  vin: string | null;
  price: Price;
  /** The price in US dollars at the ECB daily rate (`raw.fx`). */
  price_usd: Decimal | null;
  location: Location;
  /** Signed photo links on api.apiauto.space, valid about a day: store the car id, not the links. */
  photos: string[];
  photo_count: number;
  /** The listing at the source; `null` for US lots. */
  listing_url: string | null;
  /** `false` when taken off sale; such cars stay available for 14 days. */
  is_active: boolean;
  /** ISO 8601, UTC. */
  first_seen_at: string;
  /** ISO 8601, UTC. */
  last_seen_at: string;
  /** ISO 8601, UTC; `null` while the car is on sale. */
  disappeared_at: string | null;
  /** ISO 8601, UTC. */
  updated_at: string;
  /** Where the record came from: `replica` (the API's copy) or `live` (from {@link Apiauto.usLive}). */
  source_mode?: string;
  /** Source fields as they are, including the original spellings in `raw.source_values`. */
  raw: Record<string, unknown>;
}

/** Sort orders of {@link Apiauto.cars}; `-` means descending. */
export type CarsSort =
  | "-first_seen"
  | "first_seen"
  | "price"
  | "-price"
  | "year"
  | "-year"
  | "mileage"
  | "-mileage";

/**
 * Filters of `GET /v1/cars`.
 *
 * @see https://apiauto.space/en/docs/endpoints/cars/
 */
export interface CarsParams {
  /** Required: `kr`, `cn` or `us`. */
  market: Market;
  /** A make as {@link Apiauto.brands} spells it; case, spaces and hyphens are ignored. */
  brand?: string;
  /** The model family, as {@link Apiauto.models} spells it. */
  model?: string;
  /** Korea only: the generation as in the `generation` field. */
  generation?: string;
  /** The trim, an exact match. */
  trim?: string;
  year_min?: number;
  year_max?: number;
  /** In the market's currency (KRW, CNY, USD). */
  price_min?: number | Decimal;
  /** In the market's currency (KRW, CNY, USD). */
  price_max?: number | Decimal;
  /** In US dollars at the ECB rate. */
  price_usd_min?: number | Decimal;
  /** In US dollars at the ECB rate. */
  price_usd_max?: number | Decimal;
  /** Kilometres. */
  mileage_max?: number;
  /** A canonical value from {@link Apiauto.dictionaries}. */
  fuel?: string;
  /** A canonical value from {@link Apiauto.dictionaries}. */
  transmission?: string;
  /** A canonical value from {@link Apiauto.dictionaries}. */
  body_type?: string;
  /** `true` — only with photos, `false` — only without. */
  has_photos?: boolean;
  /** `true` by default; `false` — cars taken off sale within 14 days. */
  is_active?: boolean;
  /** Up to 6 words of the title: year, make, model, trim. */
  q?: string;
  /** `-first_seen` by default: newest in the catalog first. */
  sort?: CarsSort;
  /** Cars per page, 1–100, 20 by default (up to 20 on the demo key). */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

/** Options of {@link Apiauto.iterCars} and {@link Apiauto.iterChanges}. */
export interface IterOptions {
  /**
   * Stop after this many items. The last request asks for no more than is left,
   * so the quota is not spent on items you would throw away.
   */
  maxItems?: number;
}

/** A page of `GET /v1/cars`. */
export interface CarsPage {
  items: Car[];
  /** Pass as `cursor` for the next page; `null` on the last one. */
  next_cursor: string | null;
  /** Cars matching the filters when there are at most 10,000; `null` above that. */
  count: number | null;
}

/** An event type of the change feed. */
export type ChangeType = "added" | "disappeared" | "price_drop" | "price_up";

/** One event of the change feed. */
export interface Change {
  id: number;
  /** The car's id, as in {@link Apiauto.car}. */
  car_id: string;
  market: Market;
  type: ChangeType;
  /** When it happened, ISO 8601 UTC. */
  at: string;
  /** The price before, in the market's currency; price events only. */
  old_price: Decimal | null;
  /** The price after, in the market's currency; price events only. */
  new_price: Decimal | null;
  /** The size of the price change in percent, always positive: the direction is in `type`. */
  pct: Decimal | null;
}

/**
 * Filters of `GET /v1/changes`.
 *
 * @see https://apiauto.space/en/docs/endpoints/changes/
 */
export interface ChangesParams {
  /** Required: `kr`, `cn` or `us`. */
  market: Market;
  /** Required: events after this moment. A `Date` or an ISO 8601 string with a time zone. */
  since: Date | string;
  /** One type or several; all types when omitted. */
  type?: ChangeType | ChangeType[];
  /** The smallest price change in percent, 0–1000; `0.5` by default. */
  min_pct?: number | Decimal;
  /** Events per page, 1–100, 20 by default. */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

/** A page of `GET /v1/changes`. */
export interface ChangesPage {
  items: Change[];
  /** Pass as `cursor` for the next page; `null` on the last one. */
  next_cursor: string | null;
}

/** A make or a model with the number of active cars. */
export interface ReferenceItem {
  /** The catalog's spelling, which the `brand` and `model` filters match. */
  name: string;
  /** Active cars. */
  count: number;
}

/** Canonical values of a field and their synonyms: `{ fuel: { diesel: ["디젤", ...] } }`. */
export type Dictionaries = Record<string, Record<string, string[]>>;

/** Freshness and plan access of one market, from `GET /v1/references/markets`. */
export interface MarketStatus {
  market: Market;
  /** `encar`, `che168` or `copart+iaai`. */
  source: string;
  /** Whether the key's plan includes this market. */
  available_in_plan: boolean;
  status: string;
  /** When the market copy was last refreshed, ISO 8601 UTC. */
  data_updated_at: string | null;
  data_age_seconds: number | null;
  /** The age after which the copy counts as stale. */
  stale_after_seconds: number | null;
  /** `true` when `data_age_seconds` is past `stale_after_seconds`. */
  stale: boolean;
  /** Cars on sale in the copy. */
  active_cars: number | null;
}

/** Usage of one market in the current period. */
export interface UsageMarket {
  market: Market;
  records: number;
  requests: number;
  live_us_requests: number;
}

/**
 * The key's plan and quota, from `GET /v1/usage`.
 *
 * @see https://apiauto.space/en/docs/endpoints/usage/
 */
export interface Usage {
  plan: string;
  /** `grace` — up to 3 days after the paid term ended. */
  status: "demo" | "active" | "grace";
  /** ISO 8601 UTC. */
  expires_at: string;
  /** `YYYY-MM`, or `demo` for the whole demo term. */
  period: string;
  /** When the quota renews, ISO 8601 UTC. */
  reset_at: string;
  /** Paid plans count returned records; the demo counts data requests. */
  quota_unit: "records" | "requests";
  quota_limit: number;
  quota_used: number;
  records_limit: number;
  records_used: number;
  live_us_limit: number;
  live_us_used: number;
  by_market: UsageMarket[];
}

/**
 * Filters of `GET /v1/us/live` — Copart and IAAI lots straight from the auction data provider.
 *
 * @see https://apiauto.space/en/docs/endpoints/live/
 */
export interface UsLiveParams {
  make?: string;
  model?: string;
  year_min?: number;
  year_max?: number;
  /** US dollars. */
  price_max?: number;
  /** 1–100, 1 by default. */
  page?: number;
}

/** Quota and rate headers of the last response. Missing headers are `null`. */
export interface ResponseInfo {
  /** HTTP status. */
  status: number;
  /** `X-Quota-Limit`: cars a month, or requests a day on the demo. */
  quotaLimit: number | null;
  /** `X-Quota-Remaining`. */
  quotaRemaining: number | null;
  /** `X-Quota-Reset`: when the quota renews, ISO 8601 UTC. */
  quotaReset: string | null;
  /** `X-RateLimit-Limit`: requests per second on the plan. */
  rateLimit: number | null;
  /** `X-RateLimit-Remaining`: requests left in the current second. */
  rateRemaining: number | null;
  /** `X-Data-Age-Seconds`: the age of the market copy. */
  dataAgeSeconds: number | null;
}

/** Options of the {@link Apiauto} constructor. */
export interface ApiautoOptions {
  /** The API key. Defaults to the `APIAUTO_KEY` environment variable. */
  apiKey?: string;
  /** `https://api.apiauto.space/v1` by default. */
  baseUrl?: string;
  /** Timeout of one attempt in milliseconds, 30000 by default. */
  timeout?: number;
  /** Retries of 429, 5xx and network errors, 2 by default; 0 turns them off. */
  maxRetries?: number;
  /** A `fetch` implementation, the global one by default. */
  fetch?: typeof fetch;
}
