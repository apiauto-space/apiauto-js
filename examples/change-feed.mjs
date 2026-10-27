// Read the change feed of one market: new cars, cars taken off sale, price changes.
// Run: APIAUTO_KEY=... node examples/change-feed.mjs [market] [hours]
// The feed comes with Pro, Max and the demo key; each event costs one record.
import { Apiauto, PermissionDeniedError } from "apiauto";

const [market = "kr", hours = "1"] = process.argv.slice(2);
const api = new Apiauto();
const since = new Date(Date.now() - Number(hours) * 3600_000);

const counts = { added: 0, disappeared: 0, price_drop: 0, price_up: 0 };
try {
  for await (const event of api.iterChanges({ market, since, limit: 20, maxItems: 20 })) {
    counts[event.type] += 1;
    const price = event.pct ? ` ${event.old_price} -> ${event.new_price} (${event.pct}%)` : "";
    console.log(`${event.at}  ${event.type.padEnd(11)} ${event.car_id}${price}`);
  }
} catch (error) {
  if (!(error instanceof PermissionDeniedError)) throw error;
  console.error(`The change feed is not in this plan: ${error.code}`);
  process.exitCode = 1;
}
console.log(counts);
