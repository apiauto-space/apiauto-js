# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-27

### Added

- `Apiauto` client for the apiauto.space API v1: `cars`, `car`, `changes`, `usLive`, `brands`,
  `models`, `dictionaries`, `markets`, `usage`.
- `iterCars` and `iterChanges` async iterators over cursor pages, with `maxItems`.
- TypeScript types of the car record, the change feed, references and usage.
- Typed errors (`BadRequestError`, `AuthenticationError`, `QuotaExceededError`,
  `PermissionDeniedError`, `NotFoundError`, `RateLimitError`, `ServerError`,
  `ServiceUnavailableError`, `APIConnectionError`).
- Retries of 429, 500, 502, 503 and network errors with `Retry-After` and exponential backoff.
- `lastResponse` with the quota, rate and data-age headers.

[0.1.0]: https://github.com/apiauto-space/apiauto-js/releases/tag/v0.1.0
