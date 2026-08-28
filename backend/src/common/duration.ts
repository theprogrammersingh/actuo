/**
 * Parses the `15m` / `30d` style TTL strings used in `.env` into milliseconds.
 *
 * `jsonwebtoken` already understands this format for `expiresIn`, but the
 * `refresh_tokens` table needs the same TTL as an absolute `expires_at`
 * timestamp, and there is no way to ask the JWT library for that number. Both
 * values must come from the same string, or the stored row and the token
 * itself would expire at different moments.
 */
const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function durationToMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  // A bare number means seconds, matching jsonwebtoken's own convention.
  const unit = match[2] ?? 's';
  return amount * UNITS[unit];
}
