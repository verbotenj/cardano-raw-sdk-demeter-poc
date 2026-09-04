import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyGovernanceReceipt } from "./governance-proof.js";

const example = JSON.parse(
  readFileSync("examples/simulated-fireblocks-governance-receipt.json", "utf8"),
) as any;
const clone = () => structuredClone(example);

assert.equal(verifyGovernanceReceipt(clone()).verified, true);

const changedBody = clone();
changedBody.result.governance.transactionBodyHash = "a".repeat(64);
assert.throws(() => verifyGovernanceReceipt(changedBody), /hashes must match/);

const changedConfirmation = clone();
changedConfirmation.result.confirmedTransactionHash = "a".repeat(64);
assert.throws(
  () => verifyGovernanceReceipt(changedConfirmation),
  /Confirmed Cardano hash must match/,
);

const inadequateApproval = clone();
inadequateApproval.result.governance.matchedPolicy.approvedAuthorizers = 0;
assert.throws(
  () => verifyGovernanceReceipt(inadequateApproval),
  /quorum is below/,
);

const excessiveFee = clone();
excessiveFee.result.governance.preflight.feeLovelace = 300001;
assert.throws(() => verifyGovernanceReceipt(excessiveFee), /fee exceeds/);

const wrongNetwork = clone();
wrongNetwork.result.governance.preflight.providerNetworkMagic = 1;
assert.throws(() => verifyGovernanceReceipt(wrongNetwork), /network magic 2/);

const inconsistentPolicy = clone();
inconsistentPolicy.result.governance.matchedPolicy.groups[0].approved = 0;
assert.throws(
  () => verifyGovernanceReceipt(inconsistentPolicy),
  /group satisfaction does not match/,
);

const exposedSecrets = clone();
exposedSecrets.privacy.secretsIncluded = true;
assert.throws(() => verifyGovernanceReceipt(exposedSecrets), /privacy flags/);

console.log("Governance receipt tests passed (valid + 7 rejection cases).");
