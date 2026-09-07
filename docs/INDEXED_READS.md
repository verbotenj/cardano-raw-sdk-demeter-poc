# Reading Cardano history, tokens and staking data

The new SDK read interface lets an application ask either IAGON or Demeter for
indexed Cardano data. It does not sign transactions or need custody credentials.
The live checks here use **Demeter Preview**. IAGON compatibility is checked with
local HTTP fixtures, not a live IAGON account.

## Beginner example

```typescript
import { DemeterBlockfrostProvider } from "cardano-raw-sdk";

const provider = new DemeterBlockfrostProvider({
  baseUrl: process.env.DEMETER_BLOCKFROST_URL!,
  apiKey: process.env.DEMETER_API_KEY!,
});
const reads = provider.queries;
// With an initialized FireblocksCardanoRawSDK, use sdk.getChainQueries() instead.
const history = await reads.addressHistory(process.env.CARDANO_ADDRESS_1!, {
  count: 10,
  details: "full",
});
console.log(history.items.map((tx) => tx.txHash));
```

An address is where payments arrive. A **stake address** identifies a staking
credential, not ownership of every payment address associated with it. A **pool
ID** identifies a stake pool. An **asset unit** is a 56-character policy ID followed
by the asset name's hex bytes (the name can be empty). These are different inputs;
the SDK rejects mixing them up.

## What was verified

| Read operation | Demeter endpoint | Acceptance evidence |
| --- | --- | --- |
| `addressHistory(address, options)` | `/addresses/{address}/transactions`, then transaction header/UTxOs for full detail | Two distinct pages, full input/output hydration, and a block-height range check. |
| `assetDetails(unit)` | `/assets/{unit}` | Identity/fingerprint, supply string, on-chain versus registry metadata. |
| `stakeAccount(stakeAddress)` | `/accounts/{stake}` | Account identity, reward fields, unknown active stake kept separate from controlled amount. |
| `stakeAddresses(stakeAddress, options)` | `/accounts/{stake}/addresses` | Bounded collection includes the configured source payment address. |
| `stakeRewards(stakeAddress, options)` | `/accounts/{stake}/rewards` | Source page plus a nonzero reward from a sampled public pool delegator, retaining epoch and reward type. |
| `poolMetadata(poolId)` | `/pools/{pool}/metadata` | Pool identity and metadata fields; no homepage URL followed. |
| `poolDelegators(poolId, options)` | `/pools/{pool}/delegators` | Individual entries and live stake amounts, without invented aggregate totals or active epochs. |

These methods are on `sdk.getChainQueries()` / `provider.queries`. They do **not**
silently enable legacy methods such as `sdk.getTransactionHistory()`,
`sdk.getAssetInfo()` or `sdk.getPoolInfo()` for Demeter. The old IAGON response
contracts have different required fields, so the narrower interface is explicit.

## Pagination and unknown values

- `page` starts at 1. `count` is 1–100; full history is capped at 25 per page.
  Page numbers are capped at 1000. Each full-history transaction is fetched
  sequentially, not through unlimited parallel requests.
- A Demeter page has `total: null`, meaning “the API did not report the total.”
  A full page supplies `nextPage` as a page to try; it can legitimately be empty.
- `collectChainPages(fetchPage, identity, { count, maxPages })` collects within a
  budget and rejects duplicate/shifted pages or budget exhaustion. It never
  returns a silently truncated collection.
- Address history uses descending block height/transaction index for Demeter.
  Other list ordering is provider-defined. Pagination does not create a snapshot
  of a changing chain, and an empty result does not prove complete archive retention.
- `fromBlock`/`toBlock` mean **block height**, not slot number. This filter is
  implemented for Demeter only. A `fromSlot` option is rejected here; IAGON's
  existing slot-based API is separate.
- Asset supply, reward and stake quantities remain decimal strings, so large
  values do not lose digits. Use `BigInt(value)` for arithmetic instead of
  `Number(value)`. Hydrated transaction UTxOs retain the SDK's separate safe-number
  model and reject quantities beyond its numeric range.
- Reward entries are historical records. A nonzero entry does not prove the
  same amount is currently available to withdraw; that is a separate account field.
- A combined mint/burn count cannot tell us separate mint and burn counts.
  Controlled ADA is not necessarily active delegated stake. Missing registration,
  epoch and metadata information stays `null` rather than being guessed.
- Pool delegator `amountKind` is `live-stake` for Demeter and `provider-reported`
  for IAGON. The IAGON field is not relabeled as Demeter's live-stake metric.
- Metadata is untrusted data. Escape it for display and do not automatically
  fetch URLs embedded in it. Registry metadata being null does not establish
  whether a registry is configured on the server.

## Reproduce the QA evidence

After installing the pinned SDK archive with `npm ci`, supply the same private
Preview URL/key and source/destination addresses used by this POC:

```bash
npm run quality
npm run proof:qa:indexed
```

No mnemonic or Fireblocks credentials are required. The source fixture must be
a base address so its stake credential can be derived. The runner discovers one
public asset and pool through bounded list requests, unless `PROOF_ASSET_UNIT`
and `PROOF_POOL_ID` are supplied. It examines at most three delegators for a
nonzero reward fixture. If none is found, that acceptance check fails rather
than claiming a nonempty reward was verified.

Each action writes one sanitized record under
[`proofs/qa-indexed-reads/`](../proofs/qa-indexed-reads/). It records expected and
observed results, timestamps and executable SDK hashes. The public SDK facade is
used for feature reads. Custody is a throwing test double and submission is
disabled; the logs count any attempts. Discovery requests and the pool-detail
HTTP diagnostic are explicitly separate from SDK feature evidence.

## What this does not enable

Vault-wide history, payment-credential queries, account asset aggregation,
registration/delegation histories, automatic metadata enrichment, pool aggregate
statistics and pool eligibility validation remain outside this adapter.
Staking registration, pool delegation, withdrawals, DRep registration and voting
remain disabled for Demeter. A reward **read** does not prove reward **withdrawal**.
The pool-detail boundary log records the deployed HTTP status separately; a
successful metadata read is not proof that `/pools/{id}` works.

These records prove sampled behavior through the selected Demeter resource, not
full Blockfrost parity, complete archive retention, independent consensus
validation, production security approval or live Fireblocks signing.
