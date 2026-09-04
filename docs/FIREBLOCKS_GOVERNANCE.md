# Fireblocks-governed Cardano transfer

This is the advanced POC goal: create a real Cardano Preview transaction with the
Cardano Raw SDK, require Fireblocks transaction authorization before signing,
submit the immutable signed transaction through Demeter, and leave one correlated
audit receipt.

## Why this matters

A blockchain transaction hash proves settlement, but it does not answer the
organizational questions that matter before settlement: Who requested the payment?
Was the recipient approved? Was the fee reasonable? Did the required people
authorize it? Did the approved bytes remain unchanged through submission?

This POC assigns each system a narrow responsibility:

| System             | Responsibility                                             | It does not receive                   |
| ------------------ | ---------------------------------------------------------- | ------------------------------------- |
| Cardano Raw SDK    | Build and validate the exact Cardano transaction           | A Fireblocks private key              |
| Fireblocks         | Enforce the approval/signing policy and sign the body hash | Control of Demeter                    |
| Demeter Blockfrost | Read Cardano state, submit CBOR, and report confirmation   | The signing key or approval authority |
| Cardano Preview    | Validate and settle the signed transaction publicly        | Fireblocks policy context             |

The correlation receipt joins those boundaries. It is useful to treasury
operators, custodians, exchanges, fintech teams, compliance reviewers, incident
responders, and auditors because they can follow one operation from intent to
public settlement without exposing credentials or approver identities.

This is Fireblocks **transaction governance**. It is separate from Cardano
on-chain governance features such as DRep registration, delegation, and voting.

## Why the SDK adds governance types

Think of the transfer as a payment form that must be checked, approved, signed, and
then delivered.

The POC first fills in the complete Cardano payment form. It knows:

- who will receive the ADA;
- how much ADA will be sent;
- which wallet funds will be spent;
- how much will return to the sender as change;
- the network fee; and
- whether any Cardano tokens must be returned safely with the change.

The POC then creates a unique fingerprint of that form, called the **transaction
body hash**. In a Fireblocks RAW signing request, Fireblocks receives this
fingerprint. Fireblocks can apply its approval policy and sign it, but it does not
automatically turn the fingerprint back into the beginner-friendly Cardano payment
details listed above.

The two new types are simply a checklist and a receipt:

- `FireblocksGovernanceRequirements` is the **checklist before signing**. It says
  which recipient is allowed, the highest acceptable fee, and how many approved
  people and designated signers are required.
- `FireblocksGovernanceEvidence` is the **receipt after Fireblocks signing and
  Demeter submission**. It records that the checks passed, Fireblocks approved and
  signed the fingerprint, and Demeter accepted the matching transaction. The POC
  then adds Cardano confirmation details after the transaction appears on-chain.

These types do not replace Fireblocks TAP and do not create a second policy system.
Fireblocks still decides who may approve and sign. The extra types let the POC prove
something more useful than “Fireblocks signed some data.” They let it prove:

> Fireblocks signed the checked Cardano payment, that same payment was submitted
> through Demeter, and Cardano later confirmed it.

## Controls enforced by the SDK

Before Fireblocks is called, the fork validates:

- Preview network on both source and recipient addresses;
- the exact recipient against a local allowlist;
- the transfer amount and an explicit maximum fee;
- every transaction input against the selected UTxOs;
- exactly one recipient output and one change output;
- exact recipient and change lovelace amounts;
- value conservation and native-asset preservation.

The SDK hashes that validated transaction body and sends the hash to Fireblocks as
a RAW signing request with a freshly generated `externalTxId`. After Fireblocks
reaches a terminal state, the SDK requires authorization-group evidence and the
configured approval and signer counts. It then:

1. checks that Fireblocks returned the same `externalTxId` and message hash;
2. verifies the returned Ed25519 signature over the exact Cardano body hash;
3. checks that the public key controls the selected source address;
4. adds only the witness and proves the transaction body bytes did not change;
5. submits binary CBOR through the Demeter provider;
6. requires the Demeter transaction hash to equal the signed body hash.

If any check fails, the transaction is not submitted.

## Fireblocks workspace setup

Use a Fireblocks sandbox/workspace and Cardano Preview test funds for this POC.
Production RAW signing is a separately enabled Fireblocks capability and is more
dangerous than a native asset transfer because Fireblocks signs a caller-supplied
message. Follow your organization's Fireblocks and security review process.

The workspace needs:

1. a vault account containing the Cardano Preview `ADA_TEST` asset and address;
2. an API user that can initiate the request;
3. RAW signing enabled for the workspace;
4. a Transaction Authorization Policy (TAP) rule applicable to the RAW request;
5. one or more authorization groups with the intended approval thresholds;
6. designated signers and derivation-path restrictions appropriate to the vault;
7. operators available to approve the pending request in the Fireblocks console or
   your approved callback workflow.

The Fireblocks RAW rule does not encode a Cardano destination. That is why this POC
adds its own exact recipient allowlist and full transaction preflight before the
hash reaches Fireblocks. For production, an independent transaction-approval
callback can decode and validate the Cardano data as another control.

Official references:

- [Fireblocks RAW signing](https://developers.fireblocks.com/docs/raw-signing)
- [Configure a Transaction Authorization Policy](https://developers.fireblocks.com/reference/configure-transaction-authorization-policy)
- [Set a Transaction Authorization Policy](https://developers.fireblocks.com/docs/set-transaction-authorization-policy)
- [Transaction authorization objects](https://developers.fireblocks.com/reference/transaction-authorization-objects)
- [Transaction approval callback](https://developers.fireblocks.com/reference/approve-transactions)

## Configure the POC

Keep credentials in ignored `.env.development`. In addition to the Demeter Preview
settings, configure:

```dotenv
CUSTODY_MODE=fireblocks
FIREBLOCKS_API_USER_KEY=
FIREBLOCKS_API_USER_SECRET_KEY_PATH=/absolute/path/to/fireblocks-secret.pem
FIREBLOCKS_BASE_PATH=https://api.fireblocks.io
FIREBLOCKS_VAULT_ACCOUNT_ID=

# These local requirements should agree with or exceed your TAP expectations.
FIREBLOCKS_MIN_APPROVALS=1
FIREBLOCKS_MIN_SIGNERS=1
# Comma-separated Fireblocks user IDs permitted to sign this request.
FIREBLOCKS_DESIGNATED_SIGNER_IDS=
FIREBLOCKS_MAX_FEE_LOVELACE=300000

# Leave disabled until the recipient, amount, vault, and policy are reviewed.
RUN_LIVE_FIREBLOCKS=0
```

`CARDANO_ADDRESS_2` is the only recipient permitted by this POC run.
`FIREBLOCKS_DESIGNATED_SIGNER_IDS` must list the exact Fireblocks user IDs that TAP
designates to sign the RAW request; the SDK rejects every other `signedBy` value.
The POC generates a new `cardano-demeter-poc-<uuid>` external transaction ID each
time and does not accept a reusable ID from the environment.

## Run it

First check the build and the receipt verifier:

```bash
npm ci
npm run check
npm run proof:verify
```

The included example is marked `simulated-fireblocks-governed-transfer`; it proves
that the verifier and documented schema work, not that Fireblocks signed or Cardano
confirmed a transaction.

After reviewing the Fireblocks vault, TAP rule, Preview recipient, and amount:

```bash
RUN_LIVE_FIREBLOCKS=1 npm run poc:fireblocks
```

The SDK waits for Fireblocks approval and signing. Complete the requested approval
in the Fireblocks workflow. When Demeter accepts the signed transaction, the runner
prints its hash and CardanoScan Preview URL, polls for confirmation, and writes:

```text
output/governance/<cardano-transaction-hash>.json
```

Verify that receipt with:

```bash
npm run proof:verify -- output/governance/<cardano-transaction-hash>.json
```

## What the receipt proves

A successful receipt contains:

- unique `externalTxId` and Fireblocks transaction ID;
- Fireblocks terminal status and sanitized authorization-group counts;
- required and observed approval/signer counts;
- preflight network, amount, fee ceiling, input/output totals, and asset result;
- exact transaction-body, signed-message, Demeter submission, and confirmed
  Cardano hashes, with separate match assertions for submission and confirmation;
- signature, source signer, immutable body, and confirmation booleans;
- Cardano block, slot, timestamp, and explorer URL.

It intentionally excludes API keys, PEM data, mnemonics, full addresses, approver
identities, and signed CBOR.

The receipt is a useful local audit record, not a cryptographic attestation that the
JSON file itself was never edited. A production design should store it in an
append-only audit system and correlate it with Fireblocks audit logs, Demeter
request/usage records, and an independent Cardano explorer or node.

## Evidence status

The SDK governed pipeline is covered by automated tests using a real Cardano
transaction body and real Ed25519 signatures with mocked Fireblocks and Demeter
responses. Those tests cover the successful correlation and rejection for a
disallowed recipient, excessive fee, insufficient approvals, insufficient or
undesignated signers, mismatched Fireblocks IDs, incomplete Fireblocks status,
invalid signatures, and mismatched Demeter submission hashes.

The repository does **not** claim a live Fireblocks governance result yet because
no Fireblocks workspace credentials and policy were available in the development
environment. The existing confirmed Preview receipt demonstrates the independent
local-custody SDK + Demeter + Cardano path. A first live Fireblocks run will create
the missing governance receipt without requiring a code change.
