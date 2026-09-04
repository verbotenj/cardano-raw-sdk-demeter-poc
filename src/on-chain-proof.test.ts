import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseConfirmedReceipt,
  verifyOnChainProof,
  type ConfirmedReceipt,
  type OnChainTransactionSnapshot,
} from "./on-chain-proof.js";

const receiptValue = JSON.parse(
  readFileSync("examples/confirmed-preview-transaction.json", "utf8"),
) as unknown;
const receipt = parseConfirmedReceipt(receiptValue);

const snapshot = (source: ConfirmedReceipt): OnChainTransactionSnapshot => ({
  transactionHash: source.transaction.hash,
  blockHash: source.confirmation.blockHash,
  blockNumber: source.confirmation.blockNumber,
  slot: source.confirmation.slot,
  blockTime: source.confirmation.blockTime,
  feeLovelace: source.transaction.feeLovelace,
  transactionSizeBytes: source.transaction.transactionSizeBytes,
});

const valid = verifyOnChainProof({
  receipt,
  transaction: snapshot(receipt),
  networkMagic: 2,
  currentSlot: receipt.confirmation.slot + 100,
});
assert.equal(valid.verified, true);
assert.equal(valid.receiptMatchesChain, true);
assert.equal(valid.confirmationDepthSlots, 100);

assert.throws(
  () =>
    verifyOnChainProof({
      receipt,
      transaction: { ...snapshot(receipt), transactionHash: "a".repeat(64) },
      networkMagic: 2,
      currentSlot: receipt.confirmation.slot + 1,
    }),
  /transaction hash/,
);

assert.throws(
  () =>
    verifyOnChainProof({
      receipt,
      transaction: { ...snapshot(receipt), blockHash: "b".repeat(64) },
      networkMagic: 2,
      currentSlot: receipt.confirmation.slot + 1,
    }),
  /block hash/,
);

assert.throws(
  () =>
    verifyOnChainProof({
      receipt,
      transaction: { ...snapshot(receipt), feeLovelace: 1 },
      networkMagic: 2,
      currentSlot: receipt.confirmation.slot + 1,
    }),
  /fee mismatch/,
);

assert.throws(
  () =>
    verifyOnChainProof({
      receipt,
      transaction: snapshot(receipt),
      networkMagic: 1,
      currentSlot: receipt.confirmation.slot + 1,
    }),
  /network magic 2/,
);

assert.throws(
  () =>
    verifyOnChainProof({
      receipt,
      transaction: snapshot(receipt),
      networkMagic: 2,
      currentSlot: receipt.confirmation.slot - 1,
    }),
  /older than the transaction slot/,
);

const unsafeReceipt = structuredClone(receiptValue) as {
  privacy: { secretsIncluded: boolean };
};
unsafeReceipt.privacy.secretsIncluded = true;
assert.throws(() => parseConfirmedReceipt(unsafeReceipt), /sensitive data/);

const unconfirmedReceipt = structuredClone(receiptValue) as {
  transaction: { confirmed: boolean };
};
unconfirmedReceipt.transaction.confirmed = false;
assert.throws(() => parseConfirmedReceipt(unconfirmedReceipt), /does not record confirmation/);

console.log("On-chain proof tests passed (valid + 7 rejection cases).");
