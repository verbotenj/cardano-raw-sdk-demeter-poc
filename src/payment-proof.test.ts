import assert from "node:assert/strict";
import test from "node:test";
import type { DetailedTransaction } from "cardano-raw-sdk";
import {
  Address,
  EnterpriseAddress,
  Credential,
  Ed25519KeyHash,
} from "@emurgo/cardano-serialization-lib-nodejs";
import { verifyAdaPayment } from "./payment-proof.js";
import { assertPreviewReadiness } from "./preview-safety.js";

const tx: DetailedTransaction = {
  tx_hash: "a".repeat(64),
  block_hash: "b".repeat(64),
  block_no: 10,
  slot_no: 30,
  block_time: "2026-01-01T00:00:00.000Z",
  fee: 170000,
  size: 300,
  utxosComplete: true,
  inputs: [
    {
      tx_hash: "c".repeat(64),
      output_index: 0,
      address: "sender",
      value: { lovelace: 5000000, assets: { "token.00": 4 } },
      collateral: false,
      reference: false,
    },
  ],
  outputs: [
    {
      output_index: 0,
      address: "recipient",
      value: { lovelace: 2000000 },
      collateral: false,
    },
    {
      output_index: 1,
      address: "sender",
      value: { lovelace: 2830000, assets: { "token.00": 4 } },
      collateral: false,
    },
  ],
};
const params = () => ({
  transaction: structuredClone(tx),
  sender: "sender",
  recipient: "recipient",
  lovelace: 2000000,
  tipHeight: 12,
  minimumConfirmations: 3,
  rereadBlockHash: tx.block_hash,
});

test("verifies actual recipient, amount, change, native assets and block depth", () => {
  assert.deepEqual(verifyAdaPayment(params()), {
    paymentVerified: true,
    transferLovelace: 2000000,
    inputCount: 1,
    outputCount: 2,
    changeLovelace: 2830000,
    preservedAssetCount: 1,
    confirmations: 3,
    minimumConfirmations: 3,
    inclusionStableAtRecheck: true,
    scope: "ordinary-two-output-ada-payment",
  });
});
const cases: Array<[string, (p: ReturnType<typeof params>) => void]> = [
  [
    "wrong recipient",
    (p) => {
      p.recipient = "attacker";
    },
  ],
  [
    "wrong amount",
    (p) => {
      p.lovelace++;
    },
  ],
  [
    "wrong change",
    (p) => {
      p.transaction.outputs[1].value.lovelace--;
    },
  ],
  [
    "missing asset",
    (p) => {
      p.transaction.outputs[1].value.assets = {};
    },
  ],
  [
    "extra asset",
    (p) => {
      p.transaction.outputs[1].value.assets!["extra.00"] = 1;
    },
  ],
  [
    "missing inputs",
    (p) => {
      p.transaction.inputs = [];
    },
  ],
  [
    "duplicate inputs",
    (p) => {
      p.transaction.inputs.push(p.transaction.inputs[0]);
    },
  ],
  [
    "incomplete response",
    (p) => {
      p.transaction.utxosComplete = false;
    },
  ],
  [
    "unknown reference flag",
    (p) => {
      delete p.transaction.inputs[0].reference;
    },
  ],
  [
    "reference input",
    (p) => {
      p.transaction.inputs[0].reference = true;
    },
  ],
  [
    "collateral input",
    (p) => {
      p.transaction.inputs[0].collateral = true;
    },
  ],
  [
    "unsafe quantity",
    (p) => {
      p.transaction.inputs[0].value.lovelace = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "insufficient depth",
    (p) => {
      p.tipHeight = 11;
    },
  ],
  [
    "rollback",
    (p) => {
      p.rereadBlockHash = "d".repeat(64);
    },
  ],
];
for (const [name, change] of cases)
  test(`rejects ${name}`, () => {
    const p = params();
    change(p);
    assert.throws(() => verifyAdaPayment(p));
  });

const address = (network: number, key: string) =>
  EnterpriseAddress.new(
    network,
    Credential.from_keyhash(Ed25519KeyHash.from_hex(key.repeat(56))),
  )
    .to_address()
    .to_bech32();
const preview = {
  networkMagic: 2,
  tipTime: 1000,
  nowSeconds: 1100,
  addresses: [address(0, "a"), address(0, "b")],
};
test("accepts only a fresh Preview tip and distinct testnet payment addresses", () => {
  assertPreviewReadiness(preview);
  assert.equal(Address.from_bech32(preview.addresses[0]).network_id(), 0);
});
test("rejects wrong chain even if address has a testnet prefix", () => {
  assert.throws(
    () => assertPreviewReadiness({ ...preview, networkMagic: 1 }),
    /Preview/,
  );
  assert.throws(
    () =>
      assertPreviewReadiness({
        ...preview,
        addresses: [address(1, "a"), address(0, "b")],
      }),
    /testnet/,
  );
});
test("rejects stale/future tips and invalid age limits", () => {
  for (const tipTime of [0, 1200, NaN])
    assert.throws(() => assertPreviewReadiness({ ...preview, tipTime }));
  for (const maxTipAgeSeconds of [0, -1, 3601, NaN])
    assert.throws(() =>
      assertPreviewReadiness({ ...preview, maxTipAgeSeconds }),
    );
});
