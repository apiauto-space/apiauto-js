# apiauto — JavaScript & TypeScript client for the Encar, Che168, Copart and IAAI API

`apiauto` is the official JavaScript/TypeScript client of [apiauto.space](https://apiauto.space/en/docs/), a REST API with the used-car catalogs of South Korea (Encar), China (Che168) and US auctions (Copart and IAAI) in one JSON record format. apiauto.space is an independent, unofficial data service: it is not affiliated with Encar, Che168/Autohome, Copart or IAAI.

[![npm version](https://img.shields.io/npm/v/apiauto)](https://www.npmjs.com/package/apiauto)
[![license](https://img.shields.io/npm/l/apiauto)](https://github.com/apiauto-space/apiauto-js/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/apiauto)](https://www.npmjs.com/package/apiauto)
[![CI](https://github.com/apiauto-space/apiauto-js/actions/workflows/ci.yml/badge.svg)](https://github.com/apiauto-space/apiauto-js/actions/workflows/ci.yml)

- One client for three markets: `kr` — Encar, `cn` — Che168, `us` — Copart and IAAI upcoming auction lots.
- Typed records: the same keys in every market, `null` where the source has no value, source-only fields in `raw`.
- Cursor pagination with `for await`, the change feed, references, quota headers, typed errors and retries.
- Zero dependencies, ESM, global `fetch`: Node 20.19+, Bun, Deno, edge functions.

## Install

```bash
npm install apiauto
# or
pnpm add apiauto
yarn add apiauto
bun add apiauto
```

## Get a key

1. Open the Telegram bot [@apiautospace_bot](https://t.me/apiautospace_bot?start=demo) and take a free demo key: one day, 100 requests, up to 20 cars per request, all three markets and the change feed.
2. Save it in the `APIAUTO_KEY` environment variable — the client reads it by default. The key is shown once.
3. Call the API **from your server only**. The API does not allow browser requests (CORS is off), and a key in page code is visible to every visitor. Use this package in Node, Bun, Deno, serverless and edge functions, and serve your own pages to clients.

## Quick start

```ts
import { Apiauto } from "apiauto";

const api = new Apiauto(); // reads process.env.APIAUTO_KEY

const page = await api.cars({ market: "kr", brand: "Kia", limit: 20 });
for (const car of page.items) {
  console.log(car.id, car.title, car.price.amount, car.price.currency, car.price_usd);
}
console.log("quota left:", api.lastResponse?.quotaRemaining);
```

Options: `new Apiauto({ apiKey, baseUrl, timeout, maxRetries, fetch })` — `timeout` is per attempt in ms (30000 by default), `maxRetries` is 2 by default, `fetch` replaces the global one.

CommonJS works too on Node 20.19+ and 22.12+, where `require()` loads ES modules: `const { Apiauto } = require("apiauto");`. On older runtimes use `await import("apiauto")`.

## Encar API: search Korean used cars

```ts
const kr = await api.cars({
  market: "kr",
  brand: "Hyundai",
  model: "Grandeur",
  year_min: 2021,
  mileage_max: 60_000,
  price_usd_max: 25_000,
  sort: "mileage",
  limit: 50,
});
console.log(kr.count, "cars match"); // null above 10,000
for (const car of kr.items) console.log(car.generation, car.trim, car.mileage_km, car.price_usd);
```

Korea fills `generation` with Encar's model name (`The New Grandeur IG`, `E-Class W213`); Encar's original Korean spellings are in `car.raw.source_values`.

## Che168 API: Chinese used cars

```ts
const cn = await api.cars({ market: "cn", brand: "BYD", fuel: "electric", has_photos: true, limit: 20 });
for (const car of cn.items) console.log(car.title, car.price.amount, "CNY", car.location.city);
```

Prices are in the market's currency (`KRW`, `CNY`, `USD`) as decimal strings, and `price_usd` is the same price at the ECB daily rate. Filter in either: `price_min`/`price_max` or `price_usd_min`/`price_usd_max`.

## Copart and IAAI API: US auction lots

```ts
const us = await api.cars({ market: "us", brand: "Toyota", model: "Camry", year_min: 2020, limit: 20 });
for (const car of us.items) console.log(car.source, car.vin, car.raw.sale_date, car.raw.damage_main);

// Pro and Max plans: live search at the auction data provider, for lots not in the copy.
const live = await api.usLive({ make: "Toyota", model: "Camry", year_min: 2020 });
```

## Iterate over pages

Pagination is cursor-only. `iterCars` and `iterChanges` follow `next_cursor` for you; `maxItems` stops early, and the last request asks for no more than is left — the quota counts returned cars, not requests.

```ts
for await (const car of api.iterCars({ market: "kr", brand: "Kia", limit: 100, maxItems: 1000 })) {
  await save(car);
}
```

By hand: pass `page.next_cursor` as `cursor` until it is `null`.

## A car by id

```ts
const car = await api.car("encar:43020893"); // also che168:…, copart:…, iaai:…
console.log(car.is_active, car.disappeared_at);
```

Ids are stable for good. A car taken off sale stays available for 14 days with `is_active: false`.

## Change feed: keep a copy in sync

Import a market once with `iterCars`, then poll the feed: new cars, cars taken off sale, price drops and rises. The copy is refreshed about hourly, so polling more often makes no sense. Pro, Max and the demo; each event costs one record.

```ts
let since = new Date(Date.now() - 3600_000);

async function poll() {
  const startedAt = new Date();
  for await (const event of api.iterChanges({ market: "kr", since, limit: 100 })) {
    if (event.type === "added") await save(await api.car(event.car_id));
    else if (event.type === "disappeared") await markSold(event.car_id);
    else await updatePrice(event.car_id, event.new_price, event.pct); // price_drop, price_up
  }
  since = startedAt;
}

setInterval(poll, 3600_000);
```

Filter with `type: "price_drop"` or `type: ["price_drop", "price_up"]` and `min_pct: 5`. Details: [keeping a catalog in sync](https://apiauto.space/en/docs/sync/).

## References

Free, no quota: how makes and models are spelled, which values fields take, how fresh each market is.

```ts
const brands = await api.brands("cn"); // [{ name: "Volkswagen", count: … }, …]
const models = await api.models("kr", "Hyundai");
const dictionaries = await api.dictionaries(); // { fuel: { diesel: ["diesel", "디젤", "柴油", …] }, … }
const markets = await api.markets(); // [{ market: "kr", stale: false, data_age_seconds: …, active_cars: … }, …]
const usage = await api.usage(); // plan, quota_limit, quota_used, reset_at, by_market
```

## Quota and rate headers

Every response updates `api.lastResponse`:

```ts
await api.cars({ market: "us", limit: 10 });
const { quotaLimit, quotaRemaining, quotaReset, rateLimit, rateRemaining, dataAgeSeconds } = api.lastResponse!;
```

They come from `X-Quota-Limit`, `X-Quota-Remaining`, `X-Quota-Reset`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-Data-Age-Seconds`; a missing header is `null`. Plans and limits: [quota and limits](https://apiauto.space/en/docs/limits/).

## Errors and retries

Every failure is an `ApiautoError` with `status`, `code`, `detail`, `body`, `retryAfter` and `resetAt`:

| HTTP | `code` | Class | Retried |
| --- | --- | --- | --- |
| 400 | `bad_request` | `BadRequestError` | no |
| 401 | `unauthorized` | `AuthenticationError` | no |
| 402 | `quota_exhausted` | `QuotaExceededError` | no — wait for `resetAt` |
| 403 | `market_not_in_plan`, `feature_not_in_plan` | `PermissionDeniedError` (`markets`) | no |
| 404 | `not_found` | `NotFoundError` | no |
| 429 | `rate_limited` | `RateLimitError` | yes, after `Retry-After` |
| 500, 502 | `internal_error`, … | `ServerError` | yes, with backoff |
| 503 | `upstream_unavailable`, … | `ServiceUnavailableError` | yes, after `Retry-After` |
| — | — | `APIConnectionError` (network, timeout) | yes, with backoff |

Retries: up to `maxRetries` (2 by default), honoring `Retry-After` (capped at 60 s), otherwise exponential backoff with jitter. `maxRetries: 0` turns them off.

```ts
import { Apiauto, ApiautoError, PermissionDeniedError, QuotaExceededError } from "apiauto";

try {
  await api.cars({ market: "us", limit: 100 });
} catch (error) {
  if (error instanceof QuotaExceededError) console.log("quota renews at", error.resetAt);
  else if (error instanceof PermissionDeniedError) console.log("markets in the plan:", error.markets);
  else if (error instanceof ApiautoError) console.log(error.status, error.code, error.detail);
  else throw error;
}
```

The key never appears in errors, `console.log(api)` or `JSON.stringify(api)`: it is masked as `****` plus its last four characters.

## Server-side examples

Next.js route handler (`app/api/cars/route.ts`):

```ts
import { Apiauto } from "apiauto";

export async function GET(request: Request) {
  const api = new Apiauto(); // APIAUTO_KEY from the server environment
  const brand = new URL(request.url).searchParams.get("brand") ?? undefined;
  const page = await api.cars({ market: "kr", brand, limit: 20 });
  return Response.json(page.items.map(({ id, title, price_usd, photos }) => ({ id, title, price_usd, photo: photos[0] ?? null })));
}
```

Express:

```js
import express from "express";
import { Apiauto, ApiautoError } from "apiauto";

const api = new Apiauto();
const app = express();

app.get("/cars/:id", async (req, res) => {
  try {
    res.json(await api.car(req.params.id));
  } catch (error) {
    if (error instanceof ApiautoError && error.status === 404) return res.sendStatus(404);
    res.sendStatus(502);
  }
});

app.listen(3000);
```

Deno, through the `npm:` specifier:

```ts
// deno run --allow-net=api.apiauto.space --allow-env=APIAUTO_KEY main.ts
import { Apiauto } from "npm:apiauto";

const api = new Apiauto();
console.log(await api.brands("kr"));
```

Bun runs the Node examples as they are.

Runnable scripts: [encar-search.mjs](https://github.com/apiauto-space/apiauto-js/blob/main/examples/encar-search.mjs), [change-feed.mjs](https://github.com/apiauto-space/apiauto-js/blob/main/examples/change-feed.mjs), [us-lots.mjs](https://github.com/apiauto-space/apiauto-js/blob/main/examples/us-lots.mjs).

## Photos

`car.photos` are signed links on `api.apiauto.space` that work for about a day. Store the car id, not the links, and fetch a fresh record when you need photos again. Photo requests are free; follow redirects when downloading them.

## The car record

Every market has the same keys (shortened: two photo links and a few raw fields):

```json
{
  "id": "encar:43020893",
  "market": "kr",
  "source": "encar",
  "source_id": "43020893",
  "title": "2020 Kia Mohave The Master 3.0 4WD 7-seater Masters",
  "brand": "Kia",
  "model": "Mohave",
  "generation": "Mohave The Master",
  "trim": "3.0 4WD 7-seater Masters",
  "year": 2020,
  "mileage_km": 93724,
  "fuel": "diesel",
  "transmission": null,
  "engine_cc": null,
  "body_type": null,
  "color": null,
  "vin": null,
  "price": { "amount": "23900000.00", "currency": "KRW" },
  "price_usd": "18033.96",
  "location": { "country": "KR", "region": "Gyeonggi", "city": null },
  "photos": [
    "https://api.apiauto.space/img/encar:43020893/1.jpg?exp=…&sig=…",
    "https://api.apiauto.space/img/encar:43020893/2.jpg?exp=…&sig=…"
  ],
  "photo_count": 4,
  "listing_url": "https://fem.encar.com/cars/detail/43020893",
  "is_active": true,
  "first_seen_at": "2026-10-26T04:37:32.553458Z",
  "last_seen_at": "2026-10-26T04:37:32.553458Z",
  "disappeared_at": null,
  "updated_at": "2026-10-26T04:37:32.553458Z",
  "source_mode": "replica",
  "raw": { "badge": "디젤 3.0 4WD 7인승", "sell_type": "normal", "has_accident": false }
}
```

Field by field: [the car record](https://apiauto.space/en/docs/record/). Per-source fields: [Encar](https://apiauto.space/en/encar-api/), [Che168](https://apiauto.space/en/che168-api/), [Copart](https://apiauto.space/en/copart-api/), [IAAI](https://apiauto.space/en/iaai-api/).

## Methods

| Method | Endpoint | Returns | Quota |
| --- | --- | --- | --- |
| `cars(params)` | `GET /v1/cars` | `CarsPage` `{ items, next_cursor, count }` | per car |
| `iterCars(params)` | `GET /v1/cars`, every page | `AsyncGenerator<Car>` | per car |
| `car(id)` | `GET /v1/cars/{id}` | `Car` | 1 record |
| `changes(params)` | `GET /v1/changes` | `ChangesPage` `{ items, next_cursor }` | per event |
| `iterChanges(params)` | `GET /v1/changes`, every page | `AsyncGenerator<Change>` | per event |
| `usLive(params)` | `GET /v1/us/live` | `Car[]` | live US counter |
| `brands(market)` | `GET /v1/references/brands` | `ReferenceItem[]` | free |
| `models(market, brand)` | `GET /v1/references/models` | `ReferenceItem[]` | free |
| `dictionaries()` | `GET /v1/references/dictionaries` | `Dictionaries` | free |
| `markets()` | `GET /v1/references/markets` | `MarketStatus[]` | free |
| `usage()` | `GET /v1/usage` | `Usage` | free |

On the demo key the quota counts data requests instead of cars. All types are exported: `Car`, `CarsParams`, `Change`, `ChangeType`, `Market`, `Usage`, `ResponseInfo` and the rest. API reference: [docs](https://apiauto.space/en/docs/), [OpenAPI schema](https://api.apiauto.space/openapi.json).

## Other languages

| Language | Package | Repository |
| --- | --- | --- |
| JavaScript / TypeScript | npm [`apiauto`](https://www.npmjs.com/package/apiauto) | [apiauto-space/apiauto-js](https://github.com/apiauto-space/apiauto-js) |
| Python | PyPI [`apiauto-space`](https://pypi.org/project/apiauto-space/) | [apiauto-space/apiauto-python](https://github.com/apiauto-space/apiauto-python) |
| HTTP examples | — | [apiauto-space/encar-api-examples](https://github.com/apiauto-space/encar-api-examples) |

## По-русски

`apiauto` — клиент на JavaScript и TypeScript для API [apiauto.space](https://apiauto.space/docs/): автомобили с Encar (Корея), Che168 (Китай), Copart и IAAI (США) в одном формате JSON. Тестовый ключ на сутки выдаёт Telegram-бот [@apiautospace_bot](https://t.me/apiautospace_bot?start=demo). Ключ кладите в переменную окружения `APIAUTO_KEY` и вызывайте API только со своего сервера: запросы из браузера закрыты (CORS выключен). Страницы перебираются курсором через `for await`, ошибки приходят классами вроде `QuotaExceededError`, а остаток квоты виден в `api.lastResponse`.

```bash
npm install apiauto
```

```ts
import { Apiauto } from "apiauto";

const api = new Apiauto(); // ключ из APIAUTO_KEY
const page = await api.cars({ market: "kr", brand: "Kia", limit: 20 });
for (const car of page.items) console.log(car.title, car.price_usd);
```

## License

[MIT](https://github.com/apiauto-space/apiauto-js/blob/main/LICENSE) © 2026 apiauto.space

## Disclaimer

apiauto.space and this package are not affiliated with, endorsed by or sponsored by Encar, Che168, Autohome, Copart or IAAI. These names are trademarks of their owners and are used here only to describe where the listings come from. The API serves data collected from public listings; check that your use of it complies with the laws and rules that apply to you.
