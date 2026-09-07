# Does the Fireblocks README work with Demeter?

## Short answer

The original Fireblocks README describes the **whole SDK with IAGON**. It does
not mean that every listed feature automatically works when the chain provider
is changed to Demeter.

The saved Preview receipt proves the **core ADA transaction path with local
signing**, not live Fireblocks custody:

```text
read address + UTxOs -> build transaction -> calculate fee -> sign
    -> submit binary CBOR -> read the confirmed transaction
```

That core is enough for ADA and Cardano native-token transaction building. The
new `getChainQueries()` interface adds a verified subset of indexed reads:
per-address history, basic asset details, stake accounts/addresses/rewards and
individual pool metadata/delegators. It is not full indexed-data parity.

This page audits the feature list in the
[original README at revision `4fe86e8`](https://github.com/fireblocks/cardano-raw-sdk/blob/4fe86e8af026f26281ca1ab6f44d4395e5a58409/README.md).

## What the labels mean

- **Live proven** means this repository called a real Demeter Preview resource
  and received real Cardano data, or has a confirmed Preview transaction.
- **Automated proof** means the SDK test suite exercises the Demeter boundary
  without spending funds.
- **Implemented, not live proven** means the code uses the provider-neutral core,
  but this repository does not contain a confirmed transaction for that feature.
- **Fireblocks-side** means Demeter is not responsible for the feature.
- **Not supported by Demeter yet** means the SDK returns a clear
  `ProviderCapabilityError` instead of pretending the result is available. This
  label describes our adapter, not an absence of endpoints in Dolos or Demeter.

## Additional verified checks

The current implementation adds bounded UTxO scans, stricter provider validation,
non-repeated submission with body-hash comparison, and Preview identity/address/
tip checks in the local runner. `getFullTransactionDetails()` reads actual
`/txs/{hash}/utxos` data; lightweight polling is explicitly marked incomplete.

`proof:chain` now verifies the intended recipient amount, source change, native
asset conservation, confirmation depth in blocks, and a second inclusion lookup.
It needs both original addresses, but no mnemonic. The saved 2 ADA transaction is
reused; no new transfer is needed. A successful check is a point-in-time observation
through Demeter, not permanent finality or independent consensus verification.

The Demeter SDK transfer builders fetch current protocol parameters. Local tests
exercise changed fees and byte costs for ADA, CNT, multi-token and consolidation;
live acceptance currently covers ADA construction only. Direct utility callers
must supply the snapshot; legacy IAGON defaults and staking builders are unchanged.

Run `npm run proof:qa` for one timestamped QA record per implemented action in
[`proofs/qa-compatibility/`](../proofs/qa-compatibility/). These records include the
executed provider/builder hashes, expected/actual results and submission count.
Those transfer-boundary changes did not enable full indexed-data parity. The
subsequent read adapter is documented in [INDEXED_READS.md](INDEXED_READS.md) with
[separate live QA records](../proofs/qa-indexed-reads/). The updated rows below refer
to that narrow interface, not automatic support for the old IAGON-shaped APIs.
The older `examples/` receipts remain historical evidence.

## Feature-by-feature result

The matrix includes the original README claims and the narrower read operations
added by this fork. Live labels refer to the saved, timestamped Preview samples;
they are not guarantees about every deployment, account or historical record.

| Claim in the original README                           | Demeter status                                   | Evidence and beginner explanation                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fireblocks vault management and signing                | **Fireblocks-side; automated proof only**        | Fireblocks supplies the address/public key and signs. Demeter never holds that private key. The governed ADA tests mock the external Fireblocks boundary and verify a real Ed25519 signature, but this repository has no live Fireblocks receipt. |
| Balance by address                                     | **Live proven**                                  | `npm run proof:demeter:live` reads the address in both flat and policy-grouped form and checks that both answers agree.                                                                                                                           |
| Balance by credential or stake key                     | **Legacy API not supported by Demeter yet**      | Legacy credential/stake balance calls still require `credential-and-stake-queries`. The separate stake account read below reports controlled amount, not payment-credential ownership or aggregated account assets. |
| Stake account state and reward balance (new read API) | **Live proven: sampled account** | `getChainQueries().stakeAccount()` read an inactive account with zero available rewards; unknown active stake is not inferred from controlled amount. [Account proof](../proofs/qa-indexed-reads/stake-account.json). |
| Payment addresses associated with a stake address (new read API) | **Live proven: bounded collection** | `getChainQueries().stakeAddresses()` found the configured source address. Association is not proof of control over its payment key. [Address proof](../proofs/qa-indexed-reads/stake-addresses.json). |
| Historical stake rewards (new read API) | **Live proven: empty and nonzero samples** | `getChainQueries().stakeRewards()` read an empty source page and a nonzero historical reward from a sampled public pool delegator. Historical rewards do not prove a currently withdrawable balance. [Reward proof](../proofs/qa-indexed-reads/stake-rewards.json). |
| Native ADA, address-to-address transfer                | **Live proven on Preview**                       | The saved transaction sent 2 ADA, paid a 0.170297 ADA fee, and was confirmed in Preview block 4,629,643.                                                                                                                                          |
| Native ADA with Fireblocks custody                     | **Implemented; automated proof only**            | The SDK builds the body, requests Fireblocks RAW signing, verifies the returned signature, submits through the provider, and checks the returned hash. A live proof still needs a configured Fireblocks workspace.                                |
| Single Cardano native-token transfer                   | **Implemented, not live proven**                 | Selection, building, signing, and submission use the same Demeter `core` methods, but this POC has not submitted a CNT transaction.                                                                                                               |
| Multiple native tokens in one transfer                 | **Implemented, not live proven**                 | The code path is provider-neutral, and Demeter normalizes multi-asset UTxOs. There is no confirmed multi-token receipt in this POC.                                                                                                               |
| Vault-to-vault transfer                                | **Fireblocks-side plus core; not live proven**   | Fireblocks resolves the destination vault address. The resulting Cardano transaction can use Demeter, but this POC has no live vault-to-vault receipt.                                                                                            |
| ADA fee calculation in the transfer builder            | **Live proven**                                  | The live SDK-built transaction produced the 170,297 lovelace fee recorded on-chain. This is indirect evidence for fee logic, not a live call to the separate public `estimateAdaTransactionFee()` method.                                         |
| Single-token and multi-token fee estimation            | **Implemented, not live proven**                 | Fees are calculated locally from transaction bodies after Demeter supplies UTxOs and the latest slot. No CNT fee receipt is included.                                                                                                             |
| UTxO lookup and multi-asset normalization              | **Live plus automated proof**                    | The live command checks normalized Preview UTxOs. SDK tests additionally cover pagination, empty pages, policy grouping, malformed responses, and unsafe quantities.                                                                              |
| UTxO consolidation                                     | **Implemented, not live proven**                 | Consolidation reads UTxOs, builds locally, signs, and submits through the core provider. The POC intentionally has not spent funds just to create this proof.                                                                                     |
| Transaction details by hash                            | **Live proven: header and full UTxOs**           | The proof command checks the saved header and actual inputs/outputs via `getFullTransactionDetails()`. Lightweight `getTransactionDetails()` remains explicitly incomplete (`utxosComplete: false`). [Payment proof](../proofs/qa-compatibility/02-confirmed-payment.json). |
| Full basic/detailed transaction history | **Partial live proof: new read API** | `getChainQueries().addressHistory()` pages one address and optionally hydrates full details. Block-height filters are checked; archive completeness, vault-wide history and legacy history methods are not enabled for Demeter. |
| DRep registration, voting, and DRep delegation         | **Not supported by Demeter yet**                 | These are Cardano protocol-governance operations from the original IAGON implementation. They are different from the Fireblocks signing controls documented in this POC.                                                                          |
| Stake registration, pool delegation, reward withdrawal | **Not supported by Demeter yet**                 | These methods require the `staking` capability.                                                                                                                                                                                                   |
| Pool metadata, delegators, and blocks | **Partial live proof: individual reads** | `getChainQueries().poolMetadata()` and `.poolDelegators()` are verified. Pool block/aggregate statistics and eligibility validation remain disabled. |
| Asset metadata and supply | **Partial live proof: basic asset read** | `getChainQueries().assetDetails()` preserves supply precision and metadata provenance. Separate mint/burn counts, first-mint time, automatic enrichment and legacy `getAssetInfo()` parity are not claimed. |
| Mainnet, preprod, and preview                          | **Code-supported; Preview live proven**          | The fork recognizes all three networks. Governed signing checks Demeter `/genesis` against the expected network magic before Fireblocks is called. This beginner POC deliberately allows live local signing only on Preview.                      |
| Connection pooling                                     | **Provider-independent**                         | Pooling manages SDK instances. It is application infrastructure, not Cardano data supplied by Demeter.                                                                                                                                            |
| REST API server                                        | **Configured for Demeter; not live proven here** | The server accepts `CHAIN_PROVIDER=demeter`. Routes backed by `core` work; routes requiring an unsupported capability return an error.                                                                                                            |
| Docker support                                         | **Provider-independent**                         | A Docker image packages the application. It does not prove any Cardano endpoint works.                                                                                                                                                            |
| Fireblocks webhook verification                        | **Fireblocks-side; rich Demeter enrichment not proven** | Signature verification is independent of Demeter. The webhook enrichment code still calls lightweight `getTransactionDetails()`, not the new full-detail method. Full UTxO reads alone do not establish rich token webhook support. |

## Run the safe proof

With the private Preview values present in `.env.development`, run:

```bash
npm ci
npm run proof:demeter
```

That one command performs five gates:

1. Type-checks and builds the POC.
2. Verifies the governance receipt logic.
3. Runs the mock transaction tutorial, including SDK UTxO selection, fee
   calculation, body construction, and local witness verification. Mock mode
   cannot submit.
4. Calls live Demeter endpoints, proves `/genesis` reports Preview network magic
   `2`, and cross-checks the known confirmed transaction.
5. Re-reads the committed receipt by hash and rejects network, block, slot, time,
   fee or size mismatches; checks actual payment outputs, source change, assets
   and block depth with the configured original source/recipient addresses.

The live compatibility gate writes a sanitized report to:

```text
output/proofs/demeter-readme-compatibility.json
```

The final chain gate writes `output/proofs/on-chain-verification.json`.

The report does not contain the API key, mnemonic, wallet addresses, signed CBOR,
or any Fireblocks secret. The proof command never calls `/tx/submit`.

A historical sanitized run is preserved in
[`examples/demeter-readme-compatibility-proof.json`](../examples/demeter-readme-compatibility-proof.json).
It is not the latest run and is not evidence that later code was executed.
Transfer QA records live in [`proofs/qa-compatibility/`](../proofs/qa-compatibility/);
indexed-read records live in [`proofs/qa-indexed-reads/`](../proofs/qa-indexed-reads/).
Use each record's timestamp and executable hashes to identify what was tested.
Do not relabel earlier receipts with the current dependency revision.

The five-gate command above does **not** run the indexed-read checks. Run
`npm run proof:qa:indexed` separately to reproduce those seven feature reads and
the pool-detail boundary diagnostic. It needs the private Preview URL/key and
source/destination addresses, but no mnemonic or Fireblocks credentials. See
[the indexed-read guide](INDEXED_READS.md) for fixture and pagination limits.

## The separate on-chain proof

The repository already contains this confirmed Preview transaction:

```text
becf7855c04240e0f0961f2bf646e22ad4fa0f75fbe45f15ca2af31a77bee800
```

- [Open it in CardanoScan Preview](https://preview.cardanoscan.io/transaction/becf7855c04240e0f0961f2bf646e22ad4fa0f75fbe45f15ca2af31a77bee800)
- [Read the sanitized receipt](../examples/confirmed-preview-transaction.json)
- [Read the SDK/Demeter proof chain](PROOFS.md)

The public chain proves that the transaction was confirmed. The source,
dependency lock, local log, and Demeter response show how this POC produced and
observed it. Cardano itself does not record the name of the SDK or API gateway.

## What would be required for full parity?

Address-history pagination and input/output hydration, basic asset normalization,
stake account/address/reward reads, and pool metadata/delegator reads are already
implemented and sampled live. They must not be described as missing.

The remaining gaps are:

- **History and ownership:** vault-wide history, payment-credential queries,
  account asset aggregation, registration/delegation histories, and evidence of
  complete archive retention. Paged results cover only provider-retained data.
- **Staking and governance writes:** stake registration, delegation, withdrawals,
  DRep registration and voting remain disabled. Read evidence is not write
  evidence; these operations still need their prerequisites, validation and
  transaction-path tests before any live acceptance claim.
- **Pools:** aggregate/block statistics and eligibility validation remain
  unavailable through this adapter. The saved [pool-detail diagnostic](../proofs/qa-indexed-reads/pool-detail-boundary.json)
  observed HTTP 501 on the selected resource's `/pools/{id}` endpoint. This is a
  point-in-time deployment observation, not a claim about all Demeter servers.
- **Assets and legacy APIs:** separate mint/burn counts, first-mint time,
  automatic metadata enrichment and legacy `getAssetInfo()` parity are not
  proven. The new reads do not enable the old IAGON-shaped history/pool APIs.
- **Other execution evidence:** live Fireblocks custody, native-token and
  consolidation submissions, rich webhook enrichment, and mainnet/preprod
  operation are not proven by these Preview records.

Each additional claim needs matching code, tests and appropriately scoped live
evidence. Local IAGON fixtures do not prove a live IAGON service; sampled Demeter
responses do not prove full Blockfrost/Dolos parity, independent consensus
validation or production security approval.
