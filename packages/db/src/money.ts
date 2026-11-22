export type ServiceSplit = {
  platformFeeMinor: bigint;
  creatorRoyaltyMinor: bigint;
  reviewFeeMinor: bigint;
};

/**
 * Split a tax-exclusive service amount.
 * The review fee is taken first. Platform fee is the truncated basis-point
 * share of what remains. The remainder stays with the creator.
 * This rounding rule is a proposal until the founder accepts it.
 */
export function splitServiceAmount(
  serviceAmountMinor: bigint,
  reviewFeeMinor: bigint,
  platformFeeBps: number,
): ServiceSplit {
  if (serviceAmountMinor <= 0n) {
    throw new Error("service amount must be positive");
  }
  if (reviewFeeMinor < 0n || reviewFeeMinor > serviceAmountMinor) {
    throw new Error("review fee must be within the service amount");
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error("platform fee basis points must be an integer from 0 to 10000");
  }
  const remaining = serviceAmountMinor - reviewFeeMinor;
  const platformFeeMinor = (remaining * BigInt(platformFeeBps)) / 10000n;
  return {
    platformFeeMinor,
    creatorRoyaltyMinor: remaining - platformFeeMinor,
    reviewFeeMinor,
  };
}

/** Parse a decimal string into ISO minor units. Rejects floats and extra places. */
export function parseAmountToMinor(raw: string, exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) {
    throw new Error("invalid exponent");
  }
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error("invalid amount");
  }
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > exponent) {
    throw new Error("too many decimal places");
  }
  const padded = fraction.padEnd(exponent, "0");
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return BigInt(digits === "" ? "0" : digits);
}
