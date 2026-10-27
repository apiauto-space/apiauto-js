// Unit tests against the compiled package (run `npm run build` first). fetch is mocked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import {
  APIConnectionError,
  Apiauto,
  ApiautoError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
  VERSION,
} from "../dist/index.js";

const KEY = "test-key-0123456789abcdef";

/** A fetch that answers from a queue: `{ status, body, headers }` or an Error to throw. */
function mockFetch(queue) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, headers = {} } = next;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  fetch.calls = calls;
  return fetch;
}

/** A client with mocked fetch and a sleep that records delays instead of waiting. */
function setup(queue, options = {}) {
  const fetch = mockFetch(queue);
  const api = new Apiauto({ apiKey: KEY, fetch, ...options });
  const delays = [];
  api.sleep = async (ms) => {
    delays.push(ms);
  };
  return { api, calls: fetch.calls, delays };
}

const car = (id) => ({ id, market: "kr", title: `car ${id}` });
const page = (ids, next_cursor = null) => ({ items: ids.map(car), next_cursor, count: null });

describe("requests", () => {
  it("sends the key, Accept and User-Agent to the default base URL", async () => {
    const { api, calls } = setup([{ body: page([]) }]);
    await api.cars({ market: "kr" });
    const { url, init } = calls[0];
    assert.equal(url.origin + url.pathname, "https://api.apiauto.space/v1/cars");
    assert.equal(init.method, "GET");
    assert.equal(init.headers["X-API-Key"], KEY);
    assert.equal(init.headers.Accept, "application/json");
    assert.equal(init.headers["User-Agent"], `apiauto-js/${VERSION}`);
    assert.ok(init.signal instanceof AbortSignal);
  });

  it("serializes params: booleans, numbers, drops null and undefined", async () => {
    const { api, calls } = setup([{ body: page([]) }]);
    await api.cars({
      market: "cn",
      brand: "BYD",
      model: undefined,
      trim: null,
      year_min: 2020,
      price_usd_max: "25000.50",
      has_photos: true,
      is_active: false,
      sort: "-price",
      limit: 50,
    });
    assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
      market: "cn",
      brand: "BYD",
      year_min: "2020",
      price_usd_max: "25000.50",
      has_photos: "true",
      is_active: "false",
      sort: "-price",
      limit: "50",
    });
  });

  it("serializes Date as ISO and repeats array params", async () => {
    const { api, calls } = setup([{ body: { items: [], next_cursor: null } }, { body: { items: [], next_cursor: null } }]);
    await api.changes({
      market: "kr",
      since: new Date("2026-10-27T00:00:00Z"),
      type: ["price_drop", "price_up"],
      min_pct: 5,
    });
    const params = calls[0].url.searchParams;
    assert.equal(params.get("since"), "2026-10-27T00:00:00.000Z");
    assert.deepEqual(params.getAll("type"), ["price_drop", "price_up"]);
    assert.equal(params.get("min_pct"), "5");

    await api.changes({ market: "us", since: "2026-10-26T12:00:00+03:00", type: "added" });
    assert.equal(calls[1].url.searchParams.get("since"), "2026-10-26T12:00:00+03:00");
    assert.deepEqual(calls[1].url.searchParams.getAll("type"), ["added"]);
  });

  it("puts the car id in the path, keeping the colon", async () => {
    const { api, calls } = setup([{ body: car("encar:43020893") }, { body: car("x") }]);
    const result = await api.car("encar:43020893");
    assert.equal(result.id, "encar:43020893");
    assert.equal(calls[0].url.pathname, "/v1/cars/encar:43020893");
    await api.car("a/b?c");
    assert.equal(calls[1].url.pathname, "/v1/cars/a%2Fb%3Fc");
  });

  it("rejects an empty car id without a request", async () => {
    const { api, calls } = setup([]);
    await assert.rejects(api.car(""), TypeError);
    assert.equal(calls.length, 0);
  });

  it("uses a custom base URL without a trailing slash", async () => {
    const { api, calls } = setup([{ body: [] }], { baseUrl: "http://localhost:8000/v1/" });
    await api.usLive({ make: "Toyota", page: 2 });
    assert.equal(calls[0].url.href, "http://localhost:8000/v1/us/live?make=Toyota&page=2");
  });

  it("calls the reference, usage and live endpoints", async () => {
    const markets = [{ market: "kr", source: "encar", stale: false }];
    const { api, calls } = setup([
      { body: [{ name: "Kia", count: 10 }] },
      { body: [{ name: "K5", count: 3 }] },
      { body: { fuel: { diesel: ["디젤"] } } },
      { body: { items: markets } },
      { body: { plan: "demo", quota_used: 1 } },
      { body: [car("copart:1")] },
    ]);
    assert.deepEqual(await api.brands("kr"), [{ name: "Kia", count: 10 }]);
    assert.deepEqual(await api.models("kr", "Kia"), [{ name: "K5", count: 3 }]);
    assert.deepEqual(await api.dictionaries(), { fuel: { diesel: ["디젤"] } });
    assert.deepEqual(await api.markets(), markets);
    assert.equal((await api.usage()).plan, "demo");
    assert.equal((await api.usLive()).length, 1);
    assert.deepEqual(
      calls.map(({ url }) => url.pathname + url.search),
      [
        "/v1/references/brands?market=kr",
        "/v1/references/models?market=kr&brand=Kia",
        "/v1/references/dictionaries",
        "/v1/references/markets",
        "/v1/usage",
        "/v1/us/live",
      ],
    );
  });
});

describe("pagination", () => {
  it("iterCars follows next_cursor to the last page", async () => {
    const { api, calls } = setup([{ body: page(["a", "b"], "c1") }, { body: page(["c"], "c2") }, { body: page([]) }]);
    const ids = [];
    for await (const item of api.iterCars({ market: "kr", limit: 2 })) ids.push(item.id);
    assert.deepEqual(ids, ["a", "b", "c"]);
    assert.deepEqual(
      calls.map(({ url }) => url.searchParams.get("cursor")),
      [null, "c1", "c2"],
    );
    assert.ok(calls.every(({ url }) => url.searchParams.get("limit") === "2"));
  });

  it("iterCars stops at maxItems and does not ask for more than is left", async () => {
    const { api, calls } = setup([{ body: page(["a", "b"], "c1") }, { body: page(["c"], "c2") }]);
    const ids = [];
    for await (const item of api.iterCars({ market: "kr", limit: 2, maxItems: 3 })) ids.push(item.id);
    assert.deepEqual(ids, ["a", "b", "c"]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.searchParams.get("limit"), "1");
    assert.equal(calls[1].url.searchParams.get("cursor"), "c1");
    assert.equal(calls[0].url.searchParams.has("maxItems"), false);
  });

  it("iterCars with maxItems and no limit caps the page at the default 20", async () => {
    const { api, calls } = setup([{ body: page(["a"]) }]);
    for await (const _ of api.iterCars({ market: "us", maxItems: 50 }));
    assert.equal(calls[0].url.searchParams.get("limit"), "20");
  });

  it("maxItems: 0 makes no request", async () => {
    const { api, calls } = setup([]);
    for await (const _ of api.iterCars({ market: "kr", maxItems: 0 }));
    assert.equal(calls.length, 0);
  });

  it("iterChanges pages through the feed", async () => {
    const event = (id) => ({ id, car_id: `encar:${id}`, market: "kr", type: "added" });
    const { api, calls } = setup([
      { body: { items: [event(1)], next_cursor: "n" } },
      { body: { items: [event(2)], next_cursor: null } },
    ]);
    const ids = [];
    for await (const change of api.iterChanges({ market: "kr", since: "2026-10-27T00:00:00Z" })) ids.push(change.id);
    assert.deepEqual(ids, [1, 2]);
    assert.equal(calls[1].url.searchParams.get("cursor"), "n");
    assert.equal(calls[1].url.searchParams.get("since"), "2026-10-27T00:00:00Z");
  });
});

describe("errors", () => {
  const cases = [
    [400, "bad_request", BadRequestError],
    [401, "unauthorized", AuthenticationError],
    [402, "quota_exhausted", QuotaExceededError],
    [403, "market_not_in_plan", PermissionDeniedError],
    [404, "not_found", NotFoundError],
    [429, "rate_limited", RateLimitError],
    [500, "internal_error", ServerError],
    [502, "image_upstream_unavailable", ServerError],
    [503, "upstream_unavailable", ServiceUnavailableError],
  ];
  for (const [status, code, ErrorClass] of cases) {
    it(`${status} ${code} -> ${ErrorClass.name}`, async () => {
      const { api } = setup([{ status, body: { error: code, detail: "why" } }], { maxRetries: 0 });
      const error = await api.cars({ market: "kr" }).catch((e) => e);
      assert.ok(error instanceof ErrorClass);
      assert.ok(error instanceof ApiautoError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, ErrorClass.name);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.detail, "why");
      assert.equal(error.message, `${status} ${code}: why`);
    });
  }

  it("ServiceUnavailableError is a ServerError", () => {
    assert.ok(new ServiceUnavailableError("x", { status: 503 }) instanceof ServerError);
  });

  it("402 carries reset_at, 403 carries markets", async () => {
    const { api } = setup([
      { status: 402, body: { error: "quota_exhausted", reset_at: "2026-11-01T00:00:00Z" } },
      { status: 403, body: { error: "market_not_in_plan", markets: ["kr"] } },
    ]);
    const quota = await api.cars({ market: "kr" }).catch((e) => e);
    assert.equal(quota.resetAt, "2026-11-01T00:00:00Z");
    const denied = await api.cars({ market: "us" }).catch((e) => e);
    assert.deepEqual(denied.markets, ["kr"]);
    assert.deepEqual(denied.body, { error: "market_not_in_plan", markets: ["kr"] });
  });

  it("handles a non-JSON error body", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const { api } = setup([{ status: 502, body: html, headers: { "content-type": "text/html" } }], { maxRetries: 0 });
    const error = await api.usage().catch((e) => e);
    assert.ok(error instanceof ServerError);
    assert.equal(error.code, null);
    assert.equal(error.body, html);
    assert.match(error.message, /^502 /);
  });

  it("a 200 that is not JSON is an ApiautoError and is not retried", async () => {
    const { api, calls } = setup([{ status: 200, body: "oops", headers: { "content-type": "text/plain" } }]);
    const error = await api.usage().catch((e) => e);
    assert.ok(error instanceof ApiautoError);
    assert.equal(error.status, 200);
    assert.equal(calls.length, 1);
  });
});

describe("retries", () => {
  it("retries 429 after retry_after, then succeeds", async () => {
    const { api, calls, delays } = setup([
      { status: 429, body: { error: "rate_limited", retry_after: 2 }, headers: { "Retry-After": "2" } },
      { body: page(["a"]) },
    ]);
    const result = await api.cars({ market: "kr" });
    assert.equal(result.items.length, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [2000]);
    assert.equal(api.lastResponse.status, 200);
  });

  it("takes Retry-After from the header and caps it at 60 s", async () => {
    const { api, delays } = setup([
      { status: 503, body: { error: "upstream_unavailable" }, headers: { "Retry-After": "300" } },
      { body: [] },
    ]);
    await api.usLive({ make: "Toyota" });
    assert.deepEqual(delays, [60_000]);
  });

  it("backs off exponentially on 500 and gives up after maxRetries", async () => {
    const err = { status: 500, body: { error: "internal_error" } };
    const { api, calls, delays } = setup([err, err, err]);
    await assert.rejects(api.usage(), ServerError);
    assert.equal(calls.length, 3);
    assert.equal(delays.length, 2);
    assert.ok(delays[0] >= 375 && delays[0] <= 500, `first delay ${delays[0]}`);
    assert.ok(delays[1] >= 750 && delays[1] <= 1000, `second delay ${delays[1]}`);
  });

  for (const [status, error] of [
    [400, "bad_request"],
    [401, "unauthorized"],
    [402, "quota_exhausted"],
    [403, "feature_not_in_plan"],
    [404, "not_found"],
  ]) {
    it(`does not retry ${status}`, async () => {
      const { api, calls, delays } = setup([{ status, body: { error } }, { body: {} }]);
      await assert.rejects(api.usage(), ApiautoError);
      assert.equal(calls.length, 1);
      assert.deepEqual(delays, []);
    });
  }

  it("maxRetries: 0 turns retries off", async () => {
    const { api, calls } = setup([{ status: 429, body: { error: "rate_limited", retry_after: 1 } }], { maxRetries: 0 });
    await assert.rejects(api.usage(), RateLimitError);
    assert.equal(calls.length, 1);
  });

  it("wraps network errors in APIConnectionError and retries them", async () => {
    const { api, calls } = setup([new TypeError("fetch failed"), { body: { plan: "pro" } }]);
    assert.equal((await api.usage()).plan, "pro");
    assert.equal(calls.length, 2);

    const failing = setup([new TypeError("fetch failed")], { maxRetries: 0 });
    const error = await failing.api.usage().catch((e) => e);
    assert.ok(error instanceof APIConnectionError);
    assert.ok(error instanceof ApiautoError);
    assert.equal(error.status, null);
    assert.match(error.message, /fetch failed/);
    assert.ok(error.cause instanceof TypeError);
  });

  it("times out with APIConnectionError", async () => {
    const hang = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    const api = new Apiauto({ apiKey: KEY, fetch: hang, timeout: 20, maxRetries: 0 });
    // AbortSignal.timeout's timer is unref'd; a real socket would keep the event loop alive.
    const keepAlive = setTimeout(() => {}, 5_000);
    const error = await api.usage().catch((e) => e);
    clearTimeout(keepAlive);
    assert.ok(error instanceof APIConnectionError);
    assert.equal(error.message, "Request timed out after 20 ms");
  });
});

describe("response headers", () => {
  it("parses quota and rate headers into lastResponse", async () => {
    const { api } = setup([
      {
        body: page([]),
        headers: {
          "X-Quota-Limit": "500000",
          "X-Quota-Remaining": "499963",
          "X-Quota-Reset": "2026-11-01T00:00:00Z",
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "4",
          "X-RateLimit-Reset": "1",
          "X-Data-Age-Seconds": "1234",
        },
      },
    ]);
    assert.equal(api.lastResponse, null);
    await api.cars({ market: "kr" });
    assert.deepEqual(api.lastResponse, {
      status: 200,
      quotaLimit: 500000,
      quotaRemaining: 499963,
      quotaReset: "2026-11-01T00:00:00Z",
      rateLimit: 5,
      rateRemaining: 4,
      dataAgeSeconds: 1234,
    });
  });

  it("sets missing headers to null and updates on errors too", async () => {
    const { api } = setup([{ status: 404, body: { error: "not_found" }, headers: { "X-Quota-Remaining": "7" } }]);
    await assert.rejects(api.car("encar:1"), NotFoundError);
    assert.deepEqual(api.lastResponse, {
      status: 404,
      quotaLimit: null,
      quotaRemaining: 7,
      quotaReset: null,
      rateLimit: null,
      rateRemaining: null,
      dataAgeSeconds: null,
    });
  });
});

describe("the key", () => {
  it("falls back to APIAUTO_KEY", async () => {
    const saved = process.env.APIAUTO_KEY;
    process.env.APIAUTO_KEY = "  env-key-0123456789  ";
    try {
      const fetch = mockFetch([{ body: {} }]);
      await new Apiauto({ fetch }).usage();
      assert.equal(fetch.calls[0].init.headers["X-API-Key"], "env-key-0123456789");
    } finally {
      if (saved === undefined) delete process.env.APIAUTO_KEY;
      else process.env.APIAUTO_KEY = saved;
    }
  });

  it("throws a clear error when the key is missing", () => {
    const saved = process.env.APIAUTO_KEY;
    delete process.env.APIAUTO_KEY;
    try {
      assert.throws(() => new Apiauto(), /APIAUTO_KEY/);
      assert.throws(() => new Apiauto({ apiKey: "" }), /no API key/);
    } finally {
      if (saved !== undefined) process.env.APIAUTO_KEY = saved;
    }
  });

  it("validates options", () => {
    assert.throws(() => new Apiauto({ apiKey: KEY, timeout: 0 }), RangeError);
    assert.throws(() => new Apiauto({ apiKey: KEY, maxRetries: -1 }), RangeError);
  });

  it("is masked in inspect, toString and JSON", () => {
    const api = new Apiauto({ apiKey: KEY });
    for (const text of [inspect(api), String(api), JSON.stringify(api), `${api}`]) {
      assert.ok(!text.includes(KEY), text);
      assert.ok(text.includes("****cdef"), text);
    }
    assert.equal(Object.keys(api).includes("apiKey"), false);
  });

  it("never appears in errors", async () => {
    const { api } = setup([{ status: 401, body: { error: "unauthorized" } }, new Error("socket hang up")], {
      maxRetries: 0,
    });
    for (const call of [() => api.usage(), () => api.usage()]) {
      const error = await call().catch((e) => e);
      for (const text of [error.message, error.stack, inspect(error), JSON.stringify(error)]) {
        assert.ok(!text.includes(KEY));
      }
    }
  });
});

describe("package", () => {
  it("VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(VERSION, pkg.version);
  });
});
