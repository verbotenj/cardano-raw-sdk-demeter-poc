# Does the Fireblocks README work with Demeter?

## Short answer

The original Fireblocks README describes the **whole SDK with IAGON**. It does
not mean that every listed feature automatically works when the chain provider
is changed to Demeter.

The Demeter fork currently proves the **core transaction path**:

```text
read address + UTxOs -> build transaction -> calculate fee -> sign
    -> submit binary CBOR -> read the confirmed transaction
```

That core is enough for ADA and Cardano native-token transaction building. It is
not enough for features that need additional indexed data, such as full history,
stake rewards, DRep data, pool information, or asset metadata.

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
  `ProviderCapabilityError` instead of pretending the result is available.

## Feature-by-feature result

| Claim in the original README | Demeter status | Evidence and beginner explanation |
| --- | --- | --- |
| Fireblocks vault management and signing | **Fireblocks-side; automated proof only** | Fireblocks supplies the address/public key and signs. Demeter never holds that private key. The governed ADA tests mock the external Fireblocks boundary and verify a real Ed25519 signature, but this repository has no live Fireblocks receipt. |
| Balance by address | **Live proven** | `npm run proof:demeter:live` reads the address in both flat and policy-grouped form and checks that both answers agree. |
| Balance by credential or stake key | **Not supported by Demeter yet** | These calls require the SDK's `credential-and-stake-queries` capability. The initial Demeter provider advertises only `core`. |
| Native ADA, address-to-address transfer | **Live proven on Preview** | The saved transaction sent 2 ADA, paid a 0.170297 ADA fee, and was confirmed in Preview block 4,629,643. |
| Native ADA with Fireblocks custody | **Implemented; automated proof only** | The SDK builds the body, requests Fireblocks RAW signing, verifies the returned signature, submits through the provider, and checks the returned hash. A live proof still needs a configured Fireblocks workspace. |
| Single Cardano native-token transfer | **Implemented, not live proven** | Selection, building, signing, and submission use the same Demeter `core` methods, but this POC has not submitted a CNT transaction. |
| Multiple native tokens in one transfer | **Implemented, not live proven** | The code path is provider-neutral, and Demeter normalizes multi-asset UTxOs. There is no confirmed multi-token receipt in this POC. |
| Vault-to-vault transfer | **Fireblocks-side plus core; not live proven** | Fireblocks resolves the destination vault address. The resulting Cardano transaction can use Demeter, but this POC has no live vault-to-vault receipt. |
| ADA fee estimation | **Live proven** | The same SDK builder calculated the 170,297 lovelace fee recorded in the confirmed transaction receipt. |
| Single-token and multi-token fee estimation | **Implemented, not live proven** | Fees are calculated locally from transaction bodies after Demeter supplies UTxOs and the latest slot. No CNT fee receipt is included. |
| UTxO lookup and multi-asset normalization | **Live plus automated proof** | The live command checks normalized Preview UTxOs. SDK tests additionally cover pagination, empty pages, policy grouping, malformed responses, and unsafe quantities. |
| UTxO consolidation | **Implemented, not live proven** | Consolidation reads UTxOs, builds locally, signs, and submits through the core provider. The POC intentionally has not spent funds just to create this proof. |
| Transaction details by hash | **Live proven** | The proof command reads the saved transaction through Demeter and compares its block, slot, time, fee, and size with the committed receipt. |
| Full basic/detailed transaction history | **Not supported by Demeter yet** | One transaction can be looked up by hash, but paginated address history still needs the SDK's `history` capability. |
| DRep registration, voting, and DRep delegation | **Not supported by Demeter yet** | These are Cardano protocol-governance operations from the original IAGON implementation. They are different from the Fireblocks signing controls documented in this POC. |
| Stake registration, pool delegation, reward withdrawal | **Not supported by Demeter yet** | These methods require the `staking` capability. |
| Pool metadata, delegators, and blocks | **Not supported by Demeter yet** | These methods require the `pools` capability. |
| Asset metadata and supply | **Not supported by Demeter yet** | Demeter returns on-chain asset quantities for the core path, but the richer metadata endpoint requires `asset-metadata`. |
| Mainnet, preprod, and preview | **Code-supported; Preview live proven** | The fork recognizes all three networks. This beginner POC deliberately allows live local signing only on Preview. Each network needs the matching Demeter resource URL. |
| Connection pooling | **Provider-independent** | Pooling manages SDK instances. It is application infrastructure, not Cardano data supplied by Demeter. |
| REST API server | **Configured for Demeter; not live proven here** | The server accepts `CHAIN_PROVIDER=demeter`. Routes backed by `core` work; routes requiring an unsupported capability return an error. |
| Docker support | **Provider-independent** | A Docker image packages the application. It does not prove any Cardano endpoint works. |
| Fireblocks webhook verification | **Fireblocks-side** | Signature verification is independent of Demeter. The initial Demeter transaction-detail response does not include full inputs and outputs, so rich token webhook enrichment is not claimed. |

## Run the safe proof

With the private Preview values present in `.env.development`, run:

```bash
npm ci
npm run proof:demeter
```

That one command performs four gates:

1. Type-checks and builds the POC.
2. Verifies the governance receipt logic.
3. Runs the mock transaction tutorial, including SDK UTxO selection, fee
   calculation, body construction, and local witness verification. Mock mode
   cannot submit.
4. Calls live Demeter endpoints and cross-checks the known confirmed transaction.

The last gate writes a sanitized report to:

```text
output/proofs/demeter-readme-compatibility.json
```

The report does not contain the API key, mnemonic, wallet addresses, signed CBOR,
or any Fireblocks secret. The proof command never calls `/tx/submit`.

The sanitized result of the repository maintainer's latest run is committed as
[`examples/demeter-readme-compatibility-proof.json`](../examples/demeter-readme-compatibility-proof.json).

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

Each missing group needs additional provider methods and tests, not just README
wording. For example, full history would need Blockfrost address-transaction
pagination plus input/output hydration; staking needs account, reward, and epoch
data; pool operations need pool endpoints; and asset information needs metadata
normalization. Only after those paths have contract tests and live evidence should
they be marked as Demeter-supported.
