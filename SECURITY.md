# Security policy

## Scope

This repository is an educational Cardano Preview proof of concept. It is not
an audited wallet, custody product, or production transaction service.

## Reporting

Report vulnerabilities through GitHub private vulnerability reporting for
`verbotenj/cardano-raw-sdk-demeter-poc`. Do not put mnemonics, API keys, PEM
material, wallet addresses, signed CBOR, or exploit details in a public issue.
Revoke any credential that might have been disclosed.

## Safety boundaries

- `mock` is the default and cannot submit a transaction.
- `local` can spend only Preview test ADA and requires `RUN_LIVE_LOCAL=1`.
- `fireblocks` requires `RUN_LIVE_FIREBLOCKS=1` plus an explicit governance
  contract. It is not represented as live-proven in the committed evidence.
- `.env.development`, `output/`, and all key material must remain untracked.
- Pull-request CI is offline and receives no wallet or provider credentials.
- Logs and receipts are sanitized audit evidence, not tamper-proof Demeter
  control-plane attestations.

Review [docs/PROOFS.md](docs/PROOFS.md) for exactly what each artifact proves.
