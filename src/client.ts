import { APIConnectionError, ApiautoError, errorFromResponse } from "./errors.js";
import type {
  ApiautoOptions,
  Car,
  CarsPage,
  CarsParams,
  ChangesPage,
  ChangesParams,
  Change,
  Dictionaries,
  IterOptions,
  Market,
  MarketStatus,
  ReferenceItem,
  ResponseInfo,
  Usage,
  UsLiveParams,
} from "./types.js";
import { VERSION } from "./version.js";

const DEFAULT_BASE_URL = "https://api.apiauto.space/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
/** The API's default page size; used to cap the last page of an iterator. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_RETRY_AFTER_SECONDS = 60;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * The apiauto.space API client: used cars of Encar (Korea), Che168 (China),
 * Copart and IAAI (USA) in one JSON format.
 *
 * Server-side only (Node, Bun, Deno, edge functions): the API does not allow
 * browser requests, and a key in page code is visible to every visitor.
 *
 * @example
 * ```ts
 * import { Apiauto } from "apiauto";
 *
 * const api = new Apiauto(); // reads APIAUTO_KEY
 * const page = await api.cars({ market: "kr", brand: "Kia", limit: 20 });
 * for (const car of page.items) console.log(car.id, car.title, car.price_usd);
 * ```
 */
export class Apiauto {
  /** The API root, `https://api.apiauto.space/v1` by default. */
  readonly baseUrl: string;
  /** Timeout of one attempt, ms. */
  readonly timeout: number;
  /** How many times a failed request is retried. */
  readonly maxRetries: number;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  #lastResponse: ResponseInfo | null = null;

  /**
   * @param options - The key defaults to the `APIAUTO_KEY` environment variable.
   * @throws Error when there is no key or no `fetch`.
   */
  constructor(options: ApiautoOptions = {}) {
    const apiKey = (options.apiKey ?? readEnvKey())?.trim();
    if (!apiKey) {
      throw new Error(
        "apiauto: no API key. Pass new Apiauto({ apiKey }) or set the APIAUTO_KEY environment variable. " +
          "A free demo key: https://t.me/apiautospace_bot?start=demo",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("apiauto: global fetch is not available; use Node 20.19+ or pass options.fetch");
    }
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    if (!(timeout > 0)) throw new RangeError("apiauto: timeout must be a positive number of milliseconds");
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new RangeError("apiauto: maxRetries must be a non-negative integer");
    }

    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  /**
   * Quota and rate headers of the last response (successful or not); `null` before the first one.
   *
   * @example
   * ```ts
   * await api.cars({ market: "cn", limit: 5 });
   * console.log(api.lastResponse?.quotaRemaining);
   * ```
   */
  get lastResponse(): ResponseInfo | null {
    return this.#lastResponse;
  }

  /**
   * One page of a market's catalog: `GET /v1/cars`. The quota counts the cars returned.
   *
   * @see https://apiauto.space/en/docs/endpoints/cars/
   */
  cars(params: CarsParams): Promise<CarsPage> {
    return this.#get<CarsPage>("/cars", params);
  }

  /**
   * Every car matching the filters, page after page by `next_cursor`.
   *
   * @example
   * ```ts
   * for await (const car of api.iterCars({ market: "kr", brand: "Hyundai", limit: 100, maxItems: 500 })) {
   *   save(car);
   * }
   * ```
   */
  iterCars(params: CarsParams & IterOptions): AsyncGenerator<Car, void, undefined> {
    return this.#paginate<Car>("/cars", params);
  }

  /**
   * One car by id, e.g. `encar:43020893`, `che168:59997083`, `copart:73995316`.
   * Cars taken off sale stay available for 14 days with `is_active: false`.
   *
   * @see https://apiauto.space/en/docs/endpoints/car/
   */
  car(id: string): Promise<Car> {
    if (typeof id !== "string" || id.trim() === "") {
      return Promise.reject(new TypeError("apiauto: car id must be a non-empty string like 'encar:43020893'"));
    }
    return this.#get<Car>(`/cars/${encodeURIComponent(id).replace(/%3A/gi, ":")}`);
  }

  /**
   * One page of the change feed: new cars, cars taken off sale, price drops and rises since a moment.
   * Pro, Max and the demo; each event costs one record.
   *
   * @see https://apiauto.space/en/docs/endpoints/changes/
   */
  changes(params: ChangesParams): Promise<ChangesPage> {
    return this.#get<ChangesPage>("/changes", params);
  }

  /** Every event of the change feed since a moment, page after page by `next_cursor`. */
  iterChanges(params: ChangesParams & IterOptions): AsyncGenerator<Change, void, undefined> {
    return this.#paginate<Change>("/changes", params);
  }

  /** A market's makes with car counts, most frequent first. Free. */
  brands(market: Market): Promise<ReferenceItem[]> {
    return this.#get<ReferenceItem[]>("/references/brands", { market });
  }

  /** A make's models with car counts. Free. */
  models(market: Market, brand: string): Promise<ReferenceItem[]> {
    return this.#get<ReferenceItem[]>("/references/models", { market, brand });
  }

  /** Canonical values of fuel, transmission, body_type and other fields, with their synonyms. Free. */
  dictionaries(): Promise<Dictionaries> {
    return this.#get<Dictionaries>("/references/dictionaries");
  }

  /** Every market's freshness and whether the plan includes it. Free. */
  async markets(): Promise<MarketStatus[]> {
    const { items } = await this.#get<{ items: MarketStatus[] }>("/references/markets");
    return items;
  }

  /**
   * The key's plan, term and quota spent, in total and per market. Free.
   *
   * @see https://apiauto.space/en/docs/endpoints/usage/
   */
  usage(): Promise<Usage> {
    return this.#get<Usage>("/usage");
  }

  /**
   * Live search of Copart and IAAI lots at the auction data provider, for cars not in the copy.
   * Pro and Max plans; it spends its own monthly counter, not the car quota.
   *
   * @see https://apiauto.space/en/docs/endpoints/live/
   */
  usLive(params: UsLiveParams = {}): Promise<Car[]> {
    return this.#get<Car[]>("/us/live", params);
  }

  /**
   * Waits before a retry. Override in a subclass to change how the client waits.
   *
   * @param ms - Milliseconds to wait.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Masks the key: `Apiauto { baseUrl: '...', apiKey: '****abcd' }`. */
  toString(): string {
    return `Apiauto { baseUrl: '${this.baseUrl}', apiKey: '${maskKey(this.#apiKey)}' }`;
  }

  /** Masks the key in `JSON.stringify`. */
  toJSON(): Record<string, unknown> {
    return {
      baseUrl: this.baseUrl,
      apiKey: maskKey(this.#apiKey),
      timeout: this.timeout,
      maxRetries: this.maxRetries,
    };
  }

  /** Masks the key in `console.log` and `util.inspect`. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }

  async *#paginate<T>(
    path: string,
    params: { limit?: number; cursor?: string } & IterOptions,
  ): AsyncGenerator<T, void, undefined> {
    const { maxItems, ...query } = params;
    if (maxItems !== undefined && !(maxItems >= 0)) {
      throw new RangeError("apiauto: maxItems must be a non-negative number");
    }
    let left = maxItems ?? Number.POSITIVE_INFINITY;
    let cursor = query.cursor;
    while (left > 0) {
      // Ask for no more than is left: the quota counts every returned item.
      const limit = Number.isFinite(left) ? Math.min(query.limit ?? DEFAULT_PAGE_SIZE, left) : query.limit;
      const page = await this.#get<Page<T>>(path, { ...query, limit, cursor });
      for (const item of page.items) {
        yield item;
        if (--left <= 0) return;
      }
      if (!page.next_cursor || page.items.length === 0) return;
      cursor = page.next_cursor;
    }
  }

  async #get<T>(path: string, query?: object): Promise<T> {
    const url = buildUrl(this.baseUrl + path, query);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#attempt<T>(url);
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.maxRetries) throw error;
        await this.sleep(retryDelayMs(error, attempt));
      }
    }
  }

  async #attempt<T>(url: string): Promise<T> {
    const fetchImpl = this.#fetch;
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: this.#headers(),
        signal: AbortSignal.timeout(this.timeout),
      });
      text = await response.text();
    } catch (cause) {
      const name = (cause as { name?: unknown } | null)?.name;
      const message =
        name === "TimeoutError" || name === "AbortError"
          ? `Request timed out after ${this.timeout} ms`
          : `Connection error: ${cause instanceof Error ? cause.message : String(cause)}`;
      throw new APIConnectionError(message, cause);
    }

    this.#lastResponse = readResponseInfo(response);
    const json = parseJson(text);
    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      throw errorFromResponse(response.status, json === undefined ? text : json, retryAfter);
    }
    if (json === undefined) {
      throw new ApiautoError(`${response.status}: the response is not JSON`, { status: response.status, body: text });
    }
    return json as T;
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-API-Key": this.#apiKey,
    };
    // Browsers forbid setting User-Agent; server runtimes with Node compatibility allow it.
    if (typeof process !== "undefined" && process.versions?.node) {
      headers["User-Agent"] = `apiauto-js/${VERSION}`;
    }
    return headers;
  }
}

function readEnvKey(): string | undefined {
  try {
    return typeof process === "undefined" ? undefined : process.env?.APIAUTO_KEY;
  } catch {
    // Deno without --allow-env throws on env access.
    return undefined;
  }
}

function maskKey(key: string): string {
  return key.length >= 12 ? `****${key.slice(-4)}` : "****";
}

/** Serializes query params: drops null/undefined, repeats arrays, Date → ISO, booleans → "true"/"false". */
function buildUrl(base: string, query?: object): string {
  if (!query) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      search.append(key, item instanceof Date ? item.toISOString() : String(item));
    }
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function readResponseInfo(response: Response): ResponseInfo {
  const header = (name: string) => response.headers.get(name);
  return {
    status: response.status,
    quotaLimit: toNumber(header("x-quota-limit")),
    quotaRemaining: toNumber(header("x-quota-remaining")),
    quotaReset: header("x-quota-reset"),
    rateLimit: toNumber(header("x-ratelimit-limit")),
    rateRemaining: toNumber(header("x-ratelimit-remaining")),
    dataAgeSeconds: toNumber(header("x-data-age-seconds")),
  };
}

function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** `Retry-After` is seconds or an HTTP date; returns seconds or `null`. */
function parseRetryAfter(value: string | null): number | null {
  const seconds = toNumber(value);
  if (seconds !== null) return Math.max(0, seconds);
  const date = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 429, 500, 502, 503 and network errors are worth another attempt; the rest return the same. */
function isRetryable(error: unknown): error is ApiautoError {
  return error instanceof ApiautoError && (error.status === null || RETRYABLE_STATUSES.has(error.status));
}

/** `retry_after` from the API (capped at 60 s), otherwise exponential backoff with jitter. */
function retryDelayMs(error: ApiautoError, attempt: number): number {
  if (error.retryAfter !== null) {
    return Math.min(error.retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000;
  }
  const backoff = Math.min(500 * 2 ** attempt, 8_000);
  return Math.round(backoff * (0.75 + Math.random() * 0.25));
}
