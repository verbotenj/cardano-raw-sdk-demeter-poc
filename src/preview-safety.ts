import { Address } from "@emurgo/cardano-serialization-lib-nodejs";

/** A healthy HTTP process is not proof that it serves a recent Preview tip. */
export const assertPreviewReadiness = (params: {
  networkMagic: number;
  tipTime: number;
  addresses: string[];
  nowSeconds?: number;
  maxTipAgeSeconds?: number;
}): void => {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = params.maxTipAgeSeconds ?? 300;
  if (params.networkMagic !== 2)
    throw new Error("Provider must report Preview network magic 2");
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 3600) {
    throw new Error(
      "MAX_TIP_AGE_SECONDS must be an integer between 1 and 3600",
    );
  }
  if (
    !Number.isSafeInteger(params.tipTime) ||
    params.tipTime < 0 ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    params.tipTime > now + 30 ||
    now - params.tipTime > maxAge
  ) {
    throw new Error("Provider tip is stale or has an invalid/future timestamp");
  }
  if (
    params.addresses.length !== 2 ||
    params.addresses[0] === params.addresses[1]
  ) {
    throw new Error("Two distinct payment addresses are required");
  }
  for (const encoded of params.addresses) {
    const address = Address.from_bech32(encoded);
    try {
      // Byron/reward addresses are not payment destinations for this Shelley POC.
      if (address.network_id() !== 0 || !encoded.startsWith("addr_test1")) {
        throw new Error(
          "Both payment addresses must be Shelley testnet addresses",
        );
      }
    } finally {
      address.free();
    }
  }
};
