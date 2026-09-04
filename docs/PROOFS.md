# POC proof chain

This document explains how to verify three separate claims about this POC:

1. The transaction was accepted on Cardano Preview.
2. The POC used the `verbotenj/cardano-raw-sdk` fork to build and submit it.
3. The configured chain provider was Demeter's Blockfrost-compatible service.

These claims require different evidence. A Cardano transaction does not contain
the name of the client library or infrastructure provider that submitted it.

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

The dependency and execution path provide reproducible SDK provenance:

1. [`package.json`](../package.json#L21) declares `cardano-raw-sdk` directly from
   `https://github.com/verbotenj/cardano-raw-sdk.git#main`.
2. [`package-lock.json`](../package-lock.json#L797-L800) resolves that dependency
   to exact SDK commit
   [`833354520d442786cab8aaf50a31456abaa2e1e4`](https://github.com/verbotenj/cardano-raw-sdk/commit/833354520d442786cab8aaf50a31456abaa2e1e4).
   This lock prevents a normal `npm ci` from silently using a different SDK
   revision even if the fork's `main` branch later advances.
3. [`src/index.ts`](../src/index.ts#L17-L30) imports the provider, UTxO selector,
   ADA transaction builder, TTL calculator, input builder, and submission helper
   from `cardano-raw-sdk`.
4. The POC calls the SDK's
   [`fetchAndSelectUtxosForAda()`](../src/index.ts#L251-L258),
   [`buildAdaTransactionWithCalculatedFee()`](../src/index.ts#L271-L281), and
   [`submitTransaction()`](../src/index.ts#L315-L321) functions in the live
   execution path.
5. The SDK submission helper serializes the signed transaction to CBOR and
   delegates it to the selected `CardanoDataProvider`:
   [`src/utils/cardano.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/833354520d442786cab8aaf50a31456abaa2e1e4/src/utils/cardano.ts#L561-L584).

The POC uses Cardano Serialization Library directly for local key derivation and
witness construction. Transaction selection, transaction-body construction,
fee calculation, TTL handling, provider integration, submission, and
confirmation use the Cardano Raw SDK fork.

## Proof that the provider is Demeter

The provider route is explicit from configuration to HTTP request:

1. [`createProvider()`](../src/index.ts#L180-L184) creates the SDK-exported
   `DemeterBlockfrostProvider` with `DEMETER_BLOCKFROST_URL` and
   `DEMETER_API_KEY`.
2. The SDK provider identifies itself as `kind = "demeter"` and implements the
   provider-neutral `CardanoDataProvider` interface:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/833354520d442786cab8aaf50a31456abaa2e1e4/src/services/demeter-blockfrost.provider.ts#L70-L78).
3. Its HTTP client uses the configured Demeter base URL and authenticates every
   request with the `dmtr-api-key` header:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/833354520d442786cab8aaf50a31456abaa2e1e4/src/services/demeter-blockfrost.provider.ts#L80-L104).
4. The provider reads `/health`, `/addresses/{address}`,
   `/addresses/{address}/utxos`, and `/blocks/latest` through that client.
5. Submission posts binary CBOR to `/tx/submit` with
   `Content-Type: application/cbor`:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/833354520d442786cab8aaf50a31456abaa2e1e4/src/services/demeter-blockfrost.provider.ts#L169-L185).
6. Confirmation polls `/txs/{hash}` through the same provider:
   [`demeter-blockfrost.provider.ts`](https://github.com/verbotenj/cardano-raw-sdk/blob/833354520d442786cab8aaf50a31456abaa2e1e4/src/services/demeter-blockfrost.provider.ts#L188-L210).

The execution log records the corresponding sequence: Demeter health check,
address and UTxO reads, SDK transaction build, submission through Demeter, and
confirmation.

## What each artifact proves

| Artifact               | What it proves                                                            | What it does not prove                                        |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cardano explorer       | The transaction exists in a Preview block                                 | SDK or provider identity                                      |
| Locked dependency      | The install resolves to the named SDK commit                              | That a particular process executed it                         |
| Source code            | The live path calls the SDK with the Demeter provider                     | That an unmodified checkout produced a particular transaction |
| Local execution log    | The process reported each SDK/Demeter stage                               | Independent or tamper-proof provider attestation              |
| Transaction receipt    | Hash, amount, fee, block, slot, and confirmation returned by the provider | Server-side proof that Demeter handled the request            |
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
