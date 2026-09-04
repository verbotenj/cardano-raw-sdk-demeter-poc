const HASH_PATTERN = /^[0-9a-f]{64}$/i;

export interface ConfirmedReceipt {
  schemaVersion: number;
  network: string;
  mode: string;
  transaction: {
    hash: string;
    explorerUrl: string;
    transferLovelace: number;
    feeLovelace: number;
    transactionSizeBytes: number;
    witnessVerified: boolean;
    submitted: boolean;
    confirmed: boolean;
  };
  confirmation: {
    blockHash: string;
    blockNumber: number;
    slot: number;
    blockTime: string;
  };
  privacy: {
    secretsIncluded: boolean;
    addressesIncluded: boolean;
    signedCborIncluded: boolean;
  };
}

export interface OnChainTransactionSnapshot {
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  slot: number;
  blockTime: string;
  feeLovelace: number;
  transactionSizeBytes: number;
}

export interface OnChainVerification {
  verified: true;
  network: "preview";
  networkMagic: 2;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  slot: number;
  blockTime: string;
  transferLovelace: number;
  feeLovelace: number;
  transactionSizeBytes: number;
  currentSlot: number;
  confirmationDepthSlots: number;
  receiptMatchesChain: true;
}

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const record = (value: unknown, name: string): Record<string, unknown> => {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
};

const text = (value: unknown, name: string): string => {
  assert(typeof value === "string" && value.length > 0, `${name} must be text`);
  return value;
};

const integer = (value: unknown, name: string): number => {
  assert(
    Number.isSafeInteger(value) && Number(value) >= 0,
    `${name} must be a non-negative safe integer`,
  );
  return Number(value);
};

const flag = (value: unknown, name: string): boolean => {
  assert(typeof value === "boolean", `${name} must be a boolean`);
  return value;
};

export const parseConfirmedReceipt = (value: unknown): ConfirmedReceipt => {
  const root = record(value, "receipt");
  const transaction = record(root.transaction, "receipt.transaction");
  const confirmation = record(root.confirmation, "receipt.confirmation");
  const privacy = record(root.privacy, "receipt.privacy");

  const parsed: ConfirmedReceipt = {
    schemaVersion: integer(root.schemaVersion, "receipt.schemaVersion"),
    network: text(root.network, "receipt.network"),
    mode: text(root.mode, "receipt.mode"),
    transaction: {
      hash: text(transaction.hash, "receipt.transaction.hash"),
      explorerUrl: text(
        transaction.explorerUrl,
        "receipt.transaction.explorerUrl",
      ),
      transferLovelace: integer(
        transaction.transferLovelace,
        "receipt.transaction.transferLovelace",
      ),
      feeLovelace: integer(
        transaction.feeLovelace,
        "receipt.transaction.feeLovelace",
      ),
      transactionSizeBytes: integer(
        transaction.transactionSizeBytes,
        "receipt.transaction.transactionSizeBytes",
      ),
      witnessVerified: flag(
        transaction.witnessVerified,
        "receipt.transaction.witnessVerified",
      ),
      submitted: flag(
        transaction.submitted,
        "receipt.transaction.submitted",
      ),
      confirmed: flag(
        transaction.confirmed,
        "receipt.transaction.confirmed",
      ),
    },
    confirmation: {
      blockHash: text(confirmation.blockHash, "receipt.confirmation.blockHash"),
      blockNumber: integer(
        confirmation.blockNumber,
        "receipt.confirmation.blockNumber",
      ),
      slot: integer(confirmation.slot, "receipt.confirmation.slot"),
      blockTime: text(confirmation.blockTime, "receipt.confirmation.blockTime"),
    },
    privacy: {
      secretsIncluded: flag(
        privacy.secretsIncluded,
        "receipt.privacy.secretsIncluded",
      ),
      addressesIncluded: flag(
        privacy.addressesIncluded,
        "receipt.privacy.addressesIncluded",
      ),
      signedCborIncluded: flag(
        privacy.signedCborIncluded,
        "receipt.privacy.signedCborIncluded",
      ),
    },
  };

  assert(parsed.schemaVersion === 1, "Unsupported receipt schema version");
  assert(parsed.network.toLowerCase() === "preview", "Receipt is not for Preview");
  assert(parsed.mode === "local", "Receipt is not from the local on-chain flow");
  assert(HASH_PATTERN.test(parsed.transaction.hash), "Receipt transaction hash is invalid");
  assert(HASH_PATTERN.test(parsed.confirmation.blockHash), "Receipt block hash is invalid");
  assert(parsed.transaction.transferLovelace > 0, "Receipt transfer must be positive");
  assert(parsed.transaction.feeLovelace > 0, "Receipt fee must be positive");
  assert(parsed.transaction.transactionSizeBytes > 0, "Receipt size must be positive");
  assert(parsed.confirmation.blockNumber > 0, "Receipt block number must be positive");
  assert(parsed.confirmation.slot > 0, "Receipt slot must be positive");
  assert(
    Number.isFinite(Date.parse(parsed.confirmation.blockTime)),
    "Receipt block time is invalid",
  );
  assert(parsed.transaction.witnessVerified, "Receipt does not prove witness verification");
  assert(parsed.transaction.submitted, "Receipt does not record submission");
  assert(parsed.transaction.confirmed, "Receipt does not record confirmation");
  assert(
    !parsed.privacy.secretsIncluded &&
      !parsed.privacy.addressesIncluded &&
      !parsed.privacy.signedCborIncluded,
    "Receipt privacy flags indicate sensitive data",
  );
  assert(
    parsed.transaction.explorerUrl ===
      `https://preview.cardanoscan.io/transaction/${parsed.transaction.hash}`,
    "Receipt explorer URL does not match its transaction hash",
  );

  return parsed;
};

export const verifyOnChainProof = (params: {
  receipt: ConfirmedReceipt;
  transaction: OnChainTransactionSnapshot;
  networkMagic: number;
  currentSlot: number;
}): OnChainVerification => {
  const { receipt, transaction, networkMagic, currentSlot } = params;

  assert(networkMagic === 2, "Provider is not connected to Cardano Preview network magic 2");
  assert(Number.isSafeInteger(currentSlot), "Current slot is not a safe integer");
  assert(currentSlot >= transaction.slot, "Current slot is older than the transaction slot");
  assert(
    transaction.transactionHash.toLowerCase() === receipt.transaction.hash.toLowerCase(),
    "On-chain transaction hash does not match the receipt",
  );
  assert(transaction.blockHash === receipt.confirmation.blockHash, "On-chain block hash mismatch");
  assert(
    transaction.blockNumber === receipt.confirmation.blockNumber,
    "On-chain block number mismatch",
  );
  assert(transaction.slot === receipt.confirmation.slot, "On-chain slot mismatch");
  assert(transaction.blockTime === receipt.confirmation.blockTime, "On-chain block time mismatch");
  assert(
    transaction.feeLovelace === receipt.transaction.feeLovelace,
    "On-chain transaction fee mismatch",
  );
  assert(
    transaction.transactionSizeBytes === receipt.transaction.transactionSizeBytes,
    "On-chain transaction size mismatch",
  );

  return {
    verified: true,
    network: "preview",
    networkMagic: 2,
    transactionHash: transaction.transactionHash.toLowerCase(),
    blockHash: transaction.blockHash,
    blockNumber: transaction.blockNumber,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    transferLovelace: receipt.transaction.transferLovelace,
    feeLovelace: transaction.feeLovelace,
    transactionSizeBytes: transaction.transactionSizeBytes,
    currentSlot,
    confirmationDepthSlots: currentSlot - transaction.slot,
    receiptMatchesChain: true,
  };
};
