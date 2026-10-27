/** The JSON body of an API error: `{"error": "quota_exhausted", "reset_at": "..."}`. */
export interface ErrorBody {
  error: string;
  detail?: string | null;
  reset_at?: string | null;
  retry_after?: number | null;
  markets?: string[] | null;
  data_age_seconds?: number | null;
}

interface ErrorInit {
  status: number | null;
  body?: unknown;
  retryAfter?: number | null;
  cause?: unknown;
}

/**
 * The base class of every error this library throws for a failed request.
 *
 * @see https://apiauto.space/en/docs/errors/
 */
export class ApiautoError extends Error {
  /** HTTP status; `null` when no response came ({@link APIConnectionError}). */
  readonly status: number | null;
  /** The API's error code, e.g. `quota_exhausted`; `null` when the body was not API JSON. */
  readonly code: string | null;
  /** The human-readable explanation from the API, if any. */
  readonly detail: string | null;
  /** The parsed JSON body, or the raw text when it was not JSON. */
  readonly body: unknown;
  /** Seconds to wait before retrying (429 and some 503), from the body or the `Retry-After` header. */
  readonly retryAfter: number | null;
  /** When the quota renews (402), ISO 8601 UTC. */
  readonly resetAt: string | null;

  constructor(message: string, init: ErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    const body = asErrorBody(init.body);
    this.status = init.status;
    this.code = body?.error ?? null;
    this.detail = body?.detail ?? null;
    this.body = init.body ?? null;
    this.retryAfter = body?.retry_after ?? init.retryAfter ?? null;
    this.resetAt = body?.reset_at ?? null;
  }
}

/** 400 `bad_request`: a bad parameter, `limit` above the plan, or `offset` given. */
export class BadRequestError extends ApiautoError {}

/** 401 `unauthorized`: no key, a wrong or revoked key, or the subscription has ended. */
export class AuthenticationError extends ApiautoError {}

/** 402 `quota_exhausted`: the period quota is spent; {@link ApiautoError.resetAt} says when it renews. */
export class QuotaExceededError extends ApiautoError {}

/** 403 `market_not_in_plan` or `feature_not_in_plan`. */
export class PermissionDeniedError extends ApiautoError {
  /** For `market_not_in_plan`: the markets the plan includes. */
  readonly markets: string[] | null;

  constructor(message: string, init: ErrorInit) {
    super(message, init);
    this.markets = asErrorBody(init.body)?.markets ?? null;
  }
}

/** 404 `not_found`: no such car or path. */
export class NotFoundError extends ApiautoError {}

/** 429 `rate_limited`: more requests per second than the plan allows. */
export class RateLimitError extends ApiautoError {}

/** 5xx: the server failed. */
export class ServerError extends ApiautoError {}

/** 503 `upstream_unavailable` and similar: live US search's provider is down; retry after {@link ApiautoError.retryAfter}. */
export class ServiceUnavailableError extends ServerError {}

/** No response: a network failure or a timeout. `status` is `null`. */
export class APIConnectionError extends ApiautoError {
  constructor(message: string, cause?: unknown) {
    super(message, { status: null, cause });
  }
}

/** Builds the error matching an HTTP status. */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfter: number | null,
): ApiautoError {
  const parsed = asErrorBody(body);
  const message = parsed
    ? `${status} ${parsed.error}${parsed.detail ? `: ${parsed.detail}` : ""}`
    : `${status} ${typeof body === "string" && body ? truncate(body, 200) : "HTTP error"}`;
  const init: ErrorInit = { status, body, retryAfter };
  switch (status) {
    case 400:
      return new BadRequestError(message, init);
    case 401:
      return new AuthenticationError(message, init);
    case 402:
      return new QuotaExceededError(message, init);
    case 403:
      return new PermissionDeniedError(message, init);
    case 404:
      return new NotFoundError(message, init);
    case 429:
      return new RateLimitError(message, init);
    case 503:
      return new ServiceUnavailableError(message, init);
    default:
      return status >= 500 ? new ServerError(message, init) : new ApiautoError(message, init);
  }
}

function asErrorBody(body: unknown): ErrorBody | null {
  return typeof body === "object" && body !== null && typeof (body as ErrorBody).error === "string"
    ? (body as ErrorBody)
    : null;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
