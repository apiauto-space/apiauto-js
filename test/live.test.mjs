// Smoke test against the real API. Skipped unless APIAUTO_KEY is set.
// Spends at most 9 records: kr 2 + car 1 + cn 1 + us 1 + changes 2 + iterCars 2.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Apiauto, NotFoundError, PermissionDeniedError } from "../dist/index.js";

const enabled = Boolean(process.env.APIAUTO_KEY);
const api = enabled ? new Apiauto({ baseUrl: process.env.APIAUTO_BASE_URL }) : null;

/** Runs `fn`, skipping the test when the key's plan lacks the market or feature. */
async function inPlan(t, fn) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof PermissionDeniedError) return t.skip(`not in plan: ${error.code}`);
    throw error;
  }
}

describe("live API", { skip: !enabled && "APIAUTO_KEY is not set" }, () => {
  it("usage", async () => {
    const usage = await api.usage();
    assert.equal(typeof usage.plan, "string");
    assert.ok(Array.isArray(usage.by_market));
  });

  it("references", async () => {
    const markets = await api.markets();
    assert.deepEqual(markets.map((m) => m.market).sort(), ["cn", "kr", "us"]);
    const brands = await api.brands("kr");
    assert.ok(brands.length > 0 && typeof brands[0].name === "string" && typeof brands[0].count === "number");
    const models = await api.models("kr", brands[0].name);
    assert.ok(models.length > 0);
    const dictionaries = await api.dictionaries();
    assert.equal(typeof dictionaries, "object");
    assert.ok(Object.keys(dictionaries).includes("fuel"));
  });

  it("Encar: a page, quota headers and a car by id", (t) =>
    inPlan(t, async () => {
      const page = await api.cars({ market: "kr", limit: 2 });
      assert.equal(page.items.length, 2);
      assert.equal(typeof page.next_cursor, "string");
      assert.equal(api.lastResponse.status, 200);
      assert.equal(typeof api.lastResponse.quotaRemaining, "number");
      const [first] = page.items;
      assert.match(first.id, /^encar:/);
      assert.equal(first.price.currency, "KRW");
      const car = await api.car(first.id);
      assert.equal(car.id, first.id);
    }));

  it("Che168 and US pages", (t) =>
    inPlan(t, async () => {
      const cn = await api.cars({ market: "cn", limit: 1, has_photos: true });
      assert.match(cn.items[0].id, /^che168:/);
      const us = await api.cars({ market: "us", limit: 1, sort: "-year" });
      assert.match(us.items[0].id, /^(copart|iaai):/);
    }));

  it("iterCars follows the cursor", (t) =>
    inPlan(t, async () => {
      const ids = [];
      for await (const car of api.iterCars({ market: "kr", limit: 1, maxItems: 2 })) ids.push(car.id);
      assert.equal(ids.length, 2);
      assert.notEqual(ids[0], ids[1]);
    }));

  it("change feed", (t) =>
    inPlan(t, async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const page = await api.changes({ market: "kr", since, limit: 2 });
      assert.ok(Array.isArray(page.items) && page.items.length <= 2);
    }));

  it("unknown car is NotFoundError", async () => {
    await assert.rejects(api.car("encar:0"), NotFoundError);
  });
});
