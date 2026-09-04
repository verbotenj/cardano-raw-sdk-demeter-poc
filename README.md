# Cardano + Demeter beginner POC

This project is a small, safe introduction to building a Cardano ADA transfer with
the Demeter-enabled
[`verbotenj/cardano-raw-sdk`](https://github.com/verbotenj/cardano-raw-sdk) fork.
It uses Cardano **Preview**, reads blockchain data through Demeter's
Blockfrost-compatible API, builds a 2 ADA transaction, and verifies a local test
signature. An explicitly gated local-custody command can then submit that signed
transaction through Demeter and return a real Preview transaction hash.

The default `mock` mode **never submits or broadcasts the transaction**. You do
not need Fireblocks credentials for either the mock or local on-chain flow.

## What you will learn

By running the example, you will see the main parts of a Cardano transfer:

1. Ask Demeter whether its Blockfrost service is available.
2. Read an address balance and its unspent transaction outputs (UTxOs).
3. Select enough UTxOs to cover the amount and network fee.
4. Build an unsigned transaction with an input, recipient output, change, fee,
   and expiry slot.
5. Derive the payment key from a **test-wallet** recovery phrase.
6. Create and verify a witness (signature) locally.
7. When explicitly enabled, submit the signed CBOR through Demeter and wait for
   on-chain confirmation.

The POC consumes the SDK from its fork; it does not duplicate SDK source code.

## A five-minute Cardano mental model

- **ADA** is Cardano's native currency. **Lovelace** is its smallest unit:
  `1 ADA = 1,000,000 lovelace`.
- **Preview** is a public Cardano test network. Preview ADA has no real-world
  value and can be requested from the testnet faucet.
- A **UTxO** is an unspent output from an earlier transaction. A transaction
  consumes complete UTxOs and creates new UTxOs for the recipient and usually
  for change back to the sender.
- A **witness** proves that the payment key authorized a transaction. The mock
  runner creates and verifies one locally.
- A **chain provider** gives the SDK access to current blockchain data and lets
  supported flows submit transactions. Here, that provider is Demeter.

The data flow is:

```text
your test wallet -> this POC -> build + sign locally
                                      |
             mock stops here <--------+--------> Demeter -> Cardano Preview
```

## What Demeter provides

[Demeter](https://demeter.run/) hosts Cardano infrastructure so this example
does not need a local Cardano node or indexer. Its Blockfrost service exposes the
familiar Blockfrost REST endpoints used for addresses, UTxOs, blocks, and
transactions.

One detail matters when comparing examples from the internet: regular
Blockfrost projects normally use a `project_id` request header, while Demeter
authenticates this resource with `dmtr-api-key`. The SDK provider handles that
header for you; put the key only in `.env.development`.

## Prerequisites

- Node.js 20 or newer (`node --version`)
- npm
- A Demeter account with a Blockfrost resource for **Cardano Preview**
- Two Preview addresses beginning with `addr_test1`
- The recovery phrase for the first address's **disposable Preview test wallet**
- Enough test ADA at the first address for 2 ADA plus a fee

Never use a mainnet wallet, recovery phrase, address, or real ADA in this
tutorial.

## 1. Create the Demeter connection

1. Sign in to [Demeter](https://demeter.run/).
2. Create or select a project.
3. Add a Blockfrost resource/port and select the Cardano **Preview** network.
4. Copy the resource's base URL and API key. Keep the key private.

The expected Preview URL currently looks like:

```text
https://cardano-preview.blockfrost-m1.demeter.run
```

Use the values shown by your own Demeter project if they differ.

## 2. Install and configure the POC

Clone the example, then install it:

```bash
git clone https://github.com/verbotenj/cardano-raw-sdk-demeter-poc.git
cd cardano-raw-sdk-demeter-poc
npm install
cp .env.example .env.development
```

Open `.env.development` and set these values:

| Variable                 | Beginner value                | Purpose                                     |
| ------------------------ | ----------------------------- | ------------------------------------------- |
| `CARDANO_NETWORK`        | `Preview`                     | Prevents the tutorial from using mainnet    |
| `CUSTODY_MODE`           | `mock`                        | Builds and signs locally but never submits  |
| `DEMETER_BLOCKFROST_URL` | Your Preview resource URL     | Demeter API endpoint                        |
| `DEMETER_API_KEY`        | Your private key              | Authenticates requests to Demeter           |
| `CARDANO_MNEMONIC`       | Disposable test-wallet phrase | Derives the local payment key               |
| `CARDANO_ADDRESS_1`      | Funded source `addr_test1...` | Supplies the UTxOs                          |
| `CARDANO_ADDRESS_2`      | Different `addr_test1...`     | Receives the example output                 |
| `LIVE_TRANSFER_LOVELACE` | `2000000`                     | Builds a 2 ADA transfer                     |
| `RUN_LIVE_LOCAL`         | `0`                           | Explicit gate for local on-chain submission |

Leave every `FIREBLOCKS_*` value empty and keep `RUN_LIVE_FIREBLOCKS=0` for the
beginner flow.

If the source address needs test ADA, use the
[official Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)
and select Preview. Faucet funds have no real value, but recovery phrases and
API keys should still be treated as secrets.

## 3. Check and run

First, verify that TypeScript compiles:

```bash
npm run check
```

Then run the guided mock transfer:

```bash
npm run demo
```

`npm run poc:mock` is an equivalent, more explicit command.

The runner prints six stages followed by a summary similar to:

```json
{
  "network": "preview",
  "balanceAda": "10 ADA",
  "balanceLovelace": 10000000,
  "selectedUtxos": 1,
  "transferAda": "2 ADA",
  "transferLovelace": 2000000,
  "feeAda": "0.17 ADA",
  "feeLovelace": 170000,
  "witnessVerified": true,
  "submitted": false,
  "confirmed": false
}
```

Your balance, selected UTxO count, and exact fee will differ. The two results to
look for are `witnessVerified: true` and `submitted: false`.

## 4. Submit the transfer on-chain

After the mock succeeds, the same locally derived Preview payment key can sign
and submit the transaction without Fireblocks. This command spends 2 Preview
test ADA from `CARDANO_ADDRESS_1`, sends it to `CARDANO_ADDRESS_2`, and pays a
Preview network fee:

```bash
RUN_LIVE_LOCAL=1 npm run poc:local
```

`RUN_LIVE_LOCAL=1` is the explicit broadcast gate. The command prints the
transaction hash as soon as Demeter accepts the signed CBOR, provides a Cardano
Preview explorer URL, and polls Demeter until the transaction is confirmed.

A successful result ends with values like:

```json
{
  "witnessVerified": true,
  "submitted": true,
  "confirmed": true,
  "transactionHash": "...",
  "explorerUrl": "https://preview.cardanoscan.io/transaction/..."
}
```

Every execution also writes a timestamped structured log under `output/runs/`.
A confirmed local transfer writes a separate receipt under
`output/transactions/<transaction-hash>.json`. The receipt contains the amount,
fee, CBOR byte size, block, slot, confirmation time, and explorer URL. It omits
wallet addresses, credentials, the recovery phrase, and signed CBOR.

This repository includes the sanitized evidence from its first confirmed run:

- [Confirmed transaction receipt](examples/confirmed-preview-transaction.json)
- [On-chain execution log](examples/confirmed-preview-run.txt)
- [Proof chain: Cardano Raw SDK, Demeter, and on-chain evidence](docs/PROOFS.md)

On-chain transactions cannot be undone. Although Preview ADA has no real-world
value, always verify `CARDANO_ADDRESS_2` and the amount before running this
command.

## Where to look in the code

The complete walkthrough is intentionally kept in
[`src/index.ts`](src/index.ts):

- `createProvider()` configures Demeter.
- `fetchAndSelectUtxosForAda()` reads and selects spendable UTxOs.
- `buildAdaTransactionWithCalculatedFee()` creates the transaction body.
- `derivePaymentKey()` follows the Cardano CIP-1852 payment-key path.
- `assertPaymentKeyMatchesAddress()` prevents signing with the wrong phrase.
- `runLocal(false)` performs the safe six-stage mock tutorial.
- `runLocal(true)` assembles, submits, and confirms the local-custody transfer.
- `runFireblocks()` is the separately gated advanced path.
- `logEvent()` creates timestamped structured execution events.
- `saveJsonArtifact()` writes local run logs and transaction receipts.

For the provider implementation itself, see
[`DemeterBlockfrostProvider`](https://github.com/verbotenj/cardano-raw-sdk/blob/main/src/services/demeter-blockfrost.provider.ts)
in the SDK fork.

## Troubleshooting

### `DEMETER_API_KEY is missing`

Copy `.env.example` to `.env.development` and add the key from your Demeter
resource. Do not add it to `.env.example`.

### Demeter health check failed or HTTP 401/403

Confirm that the URL and key belong to the same active Demeter resource. Set
`POC_VERBOSE=1` temporarily for SDK request diagnostics; secrets remain
sanitized.

### Address not found, no UTxOs, or insufficient funds

Confirm both addresses are Preview addresses and fund `CARDANO_ADDRESS_1` from
the Preview faucet. A displayed wallet balance may consist of UTxOs that have
not appeared in the provider yet; wait briefly and retry.

### `CARDANO_MNEMONIC does not derive CARDANO_ADDRESS_1`

The phrase and source address are from different wallets/accounts, or the wallet
uses a different derivation path. Do not work around this check.

### Mock mode is restricted to Preview

Restore `CARDANO_NETWORK=Preview`. This is a deliberate safety boundary.

### Set `RUN_LIVE_LOCAL=1` to authorize broadcasting

The on-chain command is intentionally blocked without an explicit live flag.
Run `RUN_LIVE_LOCAL=1 npm run poc:local` after verifying the recipient and
amount.

For additional SDK logs:

```bash
POC_VERBOSE=1 npm run demo
```

## Advanced: real Fireblocks custody

The repository retains the original Fireblocks path for developers who already
have a configured Fireblocks Cardano vault. It gets the source address from the
vault, requests raw signing, submits the signed transaction through Demeter, and
polls for confirmation.

This path can move test funds and is not part of the beginner tutorial. It runs
only when all Fireblocks settings are present and
`RUN_LIVE_FIREBLOCKS=1` is explicitly set:

```bash
npm run poc:fireblocks
```

It remains restricted to Preview and a transfer amount between 1 and 5 ADA.

## Security notes

- `.env.development` is ignored by Git; confirm with
  `git check-ignore .env.development`.
- Never paste a recovery phrase, API key, or PEM key into source code, an issue,
  a pull request, or terminal output shared with others.
- Rotate a Demeter key immediately if it is exposed.
- Use a disposable Preview wallet containing only test ADA.
- The runner never prints the mnemonic, API key, PEM content, or signed
  transaction CBOR.
- Generated `output/` artifacts are ignored by Git. Review and sanitize any log
  before deliberately sharing it.

## Learn more

- [Cardano's EUTxO model](https://docs.cardano.org/about-cardano/learn/eutxo-explainer/)
- [Cardano Preview and Pre-production environments](https://docs.cardano.org/cardano-testnets/environments/)
- [Blockfrost API documentation](https://docs.blockfrost.io/)
- [Demeter documentation](https://docs.demeter.run/)
