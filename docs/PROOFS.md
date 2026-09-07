# POC proof chain

This document explains how to verify three separate claims about this POC:

1. The transaction was accepted on Cardano Preview.
2. The POC used the `verbotenj/cardano-raw-sdk` fork to build and submit it.
3. The configured chain provider was Demeter's Blockfrost-compatible service.

These claims require different evidence. A Cardano transaction does not contain
the name of the client library or infrastructure provider that submitted it.

For a feature-by-feature audit of the original Fireblocks README, including the
features that the initial Demeter provider does **not** support, see
[`DEMETER_README_COMPATIBILITY.md`](DEMETER_README_COMPATIBILITY.md).

The original receipt below used local Preview custody. It proves the SDK, Demeter,
and Cardano data path, but it is not evidence of Fireblocks authorization. The new
governed mode adds a fourth claim: the exact Cardano body hash passed the configured
Fireblocks approval/signing requirements before Demeter received it. See
[`FIREBLOCKS_GOVERNANCE.md`](FIREBLOCKS_GOVERNANCE.md) for that flow and its honest
evidence status.

## Confirmed transaction

The first live local-custody run produced this Cardano Preview transaction:

| Field            | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Transaction hash | `becf7855c04240e0f0961f2bf646e22ad4fa0f75fbe45f15ca2af31a77bee800` |
| Block hash       | `2c08961c68da4ba1c5d1246dfc48917c6ed5dfb37d2df6c6f51c58192d978434` |
| Block number     | `4629643`                                                          |
| Slot             | `121833286`                                                        |
| Block time       | `2026-09-04T02:34:46.000Z`                                         |
| Transfer         | 2 ADA                                                              |
| Fee              | 0.170297 ADA                                                       |
| Transaction size | 299 bytes                                                          |

Independent chain evidence:

- [View the transaction on CardanoScan Preview](https://preview.cardanoscan.io/transaction/becf7855c04240e0f0961f2bf646e22ad4fa0f75fbe45f15ca2af31a77bee800)
- [Sanitized transaction receipt](../examples/confirmed-preview-transaction.json)
- [Sanitized execution log](../examples/confirmed-preview-run.txt)

CardanoScan independently confirms that the hash was included in a Preview
block. It proves that a valid transaction reached Cardano, but it cannot prove
which SDK or provider sent it.

## Proof that the POC uses Cardano Raw SDK

The saved transaction predates the current SDK pin. The September 7 QA records
prove that the **current** pinned code reads and verifies that existing payment
and builds a new mock body; they do not retroactively prove that this newer SDK
revision originally submitted the September 4 transaction. Keep the historical
receipt/run log separate from the new read-only and mock evidence.

The current dependency and execution path provide reproducible SDK provenance:

1. [`package.json`](../package.json) pins `cardano-raw-sdk` directly to the
   governed fork commit.
2. [`package-lock.json`](../package-lock.json) resolves that dependency
   to exact SDK commit
   [`5719be731ea8cb4ebae4ef1c91a19f9593448156`](https://github.com/verbotenj/cardano-raw-sdk/commit/5719be731ea8cb4ebae4ef1c91a19f9593448156).
   This lock prevents a normal `npm ci` from silently using a different SDK
   revision even if the fork's `main` branch later advances.
3. [`src/index.ts`](../src/index.ts) imports the provider, UTxO selector,
   ADA transaction builder, TTL calculator, input builder, and submission helper
   from `cardano-raw-sdk`.
4. The POC calls the SDK's
   [`fetchAndSelectUtxosForAda()`](../src/index.ts),
   [`buildAdaTransactionWithCalculatedFee()`](../src/index.ts), and
   [`submitTransaction()`](../src/index.ts) functions in the live
   execution path.
5. The SDK submission helper serializes the signed transaction to CBOR and
   delegates it to the selected `CardanoDataProvider`:
   [`src/utils/cardano.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/utils/cardano.ts).

The POC uses Cardano Serialization Library directly for local key derivation and
witness construction. Transaction selection, transaction-body construction,
fee calculation, TTL handling, provider integration, submission, and
confirmation use the Cardano Raw SDK fork.

## Proof that the provider is Demeter

The provider route is explicit from configuration to HTTP request:

1. [`createProvider()`](../src/index.ts) creates the SDK-exported
   `DemeterBlockfrostProvider` with `DEMETER_BLOCKFROST_URL` and
   `DEMETER_API_KEY`.
2. The SDK provider identifies itself as `kind = "demeter"` and implements the
   provider-neutral `CardanoDataProvider` interface:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/services/demeter-blockfrost.provider.ts).
3. Its HTTP client uses the configured Demeter base URL and authenticates every
   request with the `dmtr-api-key` header:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/services/demeter-blockfrost.provider.ts).
4. The provider reads `/health`, `/genesis`, `/addresses/{address}`,
   `/addresses/{address}/utxos`, and `/blocks/latest` through that client.
5. Submission posts binary CBOR to `/tx/submit` with
   `Content-Type: application/cbor`:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/services/demeter-blockfrost.provider.ts).
6. Confirmation polls `/txs/{hash}` through the same provider:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/services/demeter-blockfrost.provider.ts).

The execution log records the corresponding sequence: Demeter health check,
address and UTxO reads, SDK transaction build, submission through Demeter, and
confirmation.

## Proof of the governed Fireblocks path

The POC now passes a strict `governance` object into the fork's public
`transferAda()` API. The proof chain is visible in both repositories:

1. The POC generates a fresh `externalTxId`, pins the only permitted recipient,
   sets an explicit fee ceiling and approval/signer counts, and calls the SDK:
   [`runFireblocks()`](../src/index.ts).
2. The SDK preflight validates the complete locally built transaction before the
   Fireblocks request, including Demeter's authoritative network magic:
   [`FireblocksCardanoRawSDK.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/FireblocksCardanoRawSDK.ts).
3. It sends only the exact body hash with `externalTxId`, checks Fireblocks
   authorization-group and signer evidence, verifies the Ed25519 signature and
   source key, and proves witness assembly did not change the body:
   [`FireblocksCardanoRawSDK.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/FireblocksCardanoRawSDK.ts).
4. The Demeter path rejects a returned submission hash that differs from the
   Fireblocks-signed body hash:
   [`FireblocksCardanoRawSDK.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/FireblocksCardanoRawSDK.ts).
5. SDK tests exercise a real Cardano transaction body and real Ed25519 signatures
   with mocked Fireblocks and Demeter boundaries, including eleven rejection cases:
   [`FireblocksCardanoRawSDK.governance.test.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/5719be731ea8cb4ebae4ef1c91a19f9593448156/src/__tests__/FireblocksCardanoRawSDK.governance.test.ts).
6. The POC saves successful live evidence to `output/governance/<hash>.json`, and
   [`verifyGovernanceReceipt()`](../src/governance-proof.ts) independently checks
   its correlation invariants.

[`examples/simulated-fireblocks-governance-receipt.json`](../examples/simulated-fireblocks-governance-receipt.json)
is intentionally labeled simulated. It proves the receipt shape and verifier, not
a live Fireblocks approval or Cardano transaction. A genuine governed proof exists
only after a configured Fireblocks workspace completes `npm run poc:fireblocks`.

## What each artifact proves

| Artifact               | What it proves                                                            | What it does not prove                                        |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cardano explorer       | The transaction exists in a Preview block                                 | SDK or provider identity                                      |
| Locked dependency      | The install resolves to the named SDK commit                              | That a particular process executed it                         |
| Source code            | The live path calls the SDK with the Demeter provider                     | That an unmodified checkout produced a particular transaction |
| Local execution log    | The process reported each SDK/Demeter stage                               | Independent or tamper-proof provider attestation              |
| Transaction receipt    | Hash, amount, fee, block, slot, and confirmation returned by the provider | Server-side proof that Demeter handled the request            |
| Chain verification     | A fresh Demeter lookup matches the committed receipt and Preview network  | Which local process originally submitted the transaction      |
| Demeter server records | Requests reached the configured Demeter resource                          | Local source revision unless correlated with the receipt      |

Local logs and repository files can be changed by their owner, so they are an
audit trail rather than cryptographic attestation. Strong independent proof that
Demeter handled a specific submission requires a matching request record,
request ID, or usage log from the Demeter control plane.

## Reproduce the evidence

Install exactly the dependency revision in the lock file:

```bash
npm ci
npm ls cardano-raw-sdk
```

Run the read-only path and inspect its structured log:

```bash
npm run demo
jq '{status, events, summary}' output/runs/*-mock.json
```

Or run the complete safe README compatibility proof:

```bash
npm run proof:demeter
jq . output/proofs/demeter-readme-compatibility.json
```

To isolate the chain check from wallet setup, run the dedicated read-only proof:

```bash
npm run proof:chain
jq . output/proofs/on-chain-verification.json
```

It requires the Demeter URL/API key and the original source/recipient wallet
addresses from the private environment, but no mnemonic. It
looks up the saved transaction through Demeter and rejects any mismatch in the
network magic, transaction hash, block hash/number, slot/time, fee, or byte size.
It now also hydrates actual inputs/outputs and checks the intended recipient,
amount, source change, asset conservation, minimum block depth (default three),
and unchanged block inclusion on a second lookup. It rejects missing/pruned input
data and reference/collateral transactions outside this ordinary-payment proof.
It cannot guarantee future finality or independently authenticate Demeter's data.

`npm run proof:qa` writes one sanitized acceptance record per implemented action
under [`proofs/qa-compatibility/`](../proofs/qa-compatibility/), including timestamps
and hashes of the executed SDK provider/builder files. This is where the new,
stronger evidence lives; the older `examples/` reports remain historical evidence.

The parser also rejects receipts that are unconfirmed or claim to include
sensitive data. See the committed [JSON report](../examples/on-chain-verification.json),
[text log](../examples/on-chain-verification.txt), and offline tamper tests in
[`src/on-chain-proof.test.ts`](../src/on-chain-proof.test.ts).

After checking the configured Preview recipient and amount, create another
on-chain proof:

```bash
RUN_LIVE_LOCAL=1 npm run poc:local
jq . output/transactions/*.json
```

The live command spends Preview test ADA. It prints the submitted hash, waits
for `/txs/{hash}` to return confirmation data, and writes a sanitized receipt.
It never writes the mnemonic, API key, wallet addresses, PEM data, or signed CBOR
to the proof artifacts.
