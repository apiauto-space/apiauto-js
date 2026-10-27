/**
 * apiauto — the client of the apiauto.space used-car API:
 * Encar (South Korea), Che168 (China), Copart and IAAI (USA) in one JSON format.
 *
 * @see https://apiauto.space/en/docs/
 * @packageDocumentation
 */
export { Apiauto } from "./client.js";
export {
  APIConnectionError,
  ApiautoError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
} from "./errors.js";
export type { ErrorBody } from "./errors.js";
export type {
  ApiautoOptions,
  Car,
  CarsPage,
  CarsParams,
  CarsSort,
  Change,
  ChangesPage,
  ChangesParams,
  ChangeType,
  Decimal,
  Dictionaries,
  IterOptions,
  Location,
  Market,
  MarketStatus,
  Price,
  ReferenceItem,
  ResponseInfo,
  Source,
  Usage,
  UsageMarket,
  UsLiveParams,
} from "./types.js";
export { VERSION } from "./version.js";
