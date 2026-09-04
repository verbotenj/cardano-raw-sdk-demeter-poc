# Cardano Raw SDK Demeter POC

A standalone Preview-network example that consumes the Demeter-enabled
[`verbotenj/cardano-raw-sdk`](https://github.com/verbotenj/cardano-raw-sdk) fork.
The SDK is installed from the fork's `main` branch; no SDK source is duplicated in
this repository.

## Setup

```bash
npm install
cp .env.example .env.development
```

Add the private values to `.env.development`. That file is ignored by Git.

## Mock custody

Mock custody reads the live Preview address and UTxOs through Demeter, builds a
2 ADA transaction, derives the source payment key from `CARDANO_MNEMONIC`, and
verifies a local witness. It never submits the transaction.

Set `DEMETER_API_KEY`, both Cardano addresses, and the mnemonic, then run:

```bash
npm run poc:mock
```

## Fireblocks custody

Fireblocks custody obtains the source address from the configured vault, requests
raw signing, submits the signed CBOR through Demeter, and polls for confirmation.
It is restricted to Preview and exactly gated by `RUN_LIVE_FIREBLOCKS=1`.

```bash
npm run poc:fireblocks
```

Never commit mnemonics, Demeter keys, Fireblocks API keys, or PEM material. The
runner does not print credentials or signed transaction CBOR.
