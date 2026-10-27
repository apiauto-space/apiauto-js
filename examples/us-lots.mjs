// Upcoming Copart and IAAI auction lots in the USA.
// Run: APIAUTO_KEY=... node examples/us-lots.mjs [make] [model]
import { Apiauto } from "apiauto";

const [make = "Toyota", model = "Camry"] = process.argv.slice(2);
const api = new Apiauto();

for await (const car of api.iterCars({ market: "us", brand: make, model, year_min: 2020, limit: 5, maxItems: 5 })) {
  const { sale_date, damage_main, title_doc } = car.raw;
  console.log(`${car.source.padEnd(7)} ${(car.vin ?? "no VIN").padEnd(17)}  ${car.title}`);
  console.log(`        sale ${sale_date ?? "?"}, damage ${damage_main ?? "?"}, title ${title_doc ?? "?"}, ${car.mileage_km ?? "?"} km`);
}
