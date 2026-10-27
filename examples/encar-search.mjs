// Search Korean used cars on Encar through apiauto.space.
// Run: APIAUTO_KEY=... node examples/encar-search.mjs [brand] [model]
import { Apiauto } from "apiauto";

const [brand = "Hyundai", model = "Grandeur"] = process.argv.slice(2);
const api = new Apiauto();

const page = await api.cars({ market: "kr", brand, model, year_min: 2020, limit: 10 });

console.log(`${brand} ${model} in Korea: ${page.count ?? "over 10,000"} cars, the 10 newest listings:`);
for (const car of page.items) {
  const usd = car.price_usd ? `$${Math.round(Number(car.price_usd)).toLocaleString("en-US")}` : "no price";
  console.log(`${car.id.padEnd(16)} ${String(car.year).padEnd(5)} ${String(car.mileage_km ?? "?").padStart(7)} km  ${usd.padStart(9)}  ${car.title}`);
}
console.log("quota left:", api.lastResponse?.quotaRemaining ?? "n/a");
