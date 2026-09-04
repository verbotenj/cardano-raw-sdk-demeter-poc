type JsonObject = Record<string, unknown>;

const objectAt = (value: unknown, name: string): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as JsonObject;
};

const stringAt = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

const numberAt = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
};

const trueAt = (value: unknown, name: string): true => {
  if (value !== true) throw new Error(`${name} must be true`);
  return true;
};

/**
 * Validate the cross-system invariants in a saved governance receipt.
 * This checks correlation, not the authenticity of a locally stored JSON file.
 */
export const verifyGovernanceReceipt = (value: unknown) => {
  const receipt = objectAt(value, "receipt");
  const result = objectAt(receipt.result, "result");
  const governance = objectAt(result.governance, "result.governance");
  const policy = objectAt(
    governance.matchedPolicy,
    "result.governance.matchedPolicy",
  );
  const preflight = objectAt(
    governance.preflight,
    "result.governance.preflight",
  );
  const privacy = objectAt(receipt.privacy, "privacy");

  const transactionHash = stringAt(
    result.transactionHash,
    "result.transactionHash",
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(transactionHash)) {
    throw new Error("result.transactionHash must be a 32-byte hex hash");
  }

  const correlatedHashes = [
    governance.transactionBodyHash,
    governance.signedMessageHash,
    governance.submittedTransactionHash,
  ].map((hash, index) =>
    stringAt(hash, `governance correlated hash ${index + 1}`).toLowerCase(),
  );
  if (correlatedHashes.some((hash) => hash !== transactionHash)) {
    throw new Error(
      "Cardano, body, signed-message, and Demeter submission hashes must match",
    );
  }
  const confirmedTransactionHash = stringAt(
    result.confirmedTransactionHash,
    "result.confirmedTransactionHash",
  ).toLowerCase();
  if (confirmedTransactionHash !== transactionHash) {
    throw new Error(
      "Confirmed Cardano hash must match the Demeter submission and signed body",
    );
  }

  const approved = numberAt(
    policy.approvedAuthorizers,
    "matchedPolicy.approvedAuthorizers",
  );
  const minimumApprovals = numberAt(
    policy.minimumApprovals,
    "matchedPolicy.minimumApprovals",
  );
  const signers = numberAt(policy.signerCount, "matchedPolicy.signerCount");
  const minimumSigners = numberAt(
    policy.minimumSigners,
    "matchedPolicy.minimumSigners",
  );
  if (approved < minimumApprovals || signers < minimumSigners) {
    throw new Error(
      "Fireblocks approval or signer quorum is below the requirement",
    );
  }

  const fee = numberAt(preflight.feeLovelace, "preflight.feeLovelace");
  const maximumFee = numberAt(
    preflight.maxFeeLovelace,
    "preflight.maxFeeLovelace",
  );
  if (fee > maximumFee) {
    throw new Error("Cardano fee exceeds the governed fee ceiling");
  }

  const amount = numberAt(preflight.amountLovelace, "preflight.amountLovelace");
  const recipientAmount = numberAt(
    preflight.recipientLovelace,
    "preflight.recipientLovelace",
  );
  const change = numberAt(preflight.changeLovelace, "preflight.changeLovelace");
  const inputs = numberAt(preflight.inputLovelace, "preflight.inputLovelace");
  if (amount !== recipientAmount || inputs !== recipientAmount + change + fee) {
    throw new Error(
      "Cardano preflight values do not conserve the governed intent",
    );
  }
  if (
    numberAt(preflight.inputCount, "preflight.inputCount") < 1 ||
    numberAt(preflight.outputCount, "preflight.outputCount") !== 2
  ) {
    throw new Error(
      "Cardano preflight must contain inputs and exactly two outputs",
    );
  }

  stringAt(governance.externalTxId, "governance.externalTxId");
  stringAt(
    governance.fireblocksTransactionId,
    "governance.fireblocksTransactionId",
  );
  if (governance.chainProvider !== "demeter") {
    throw new Error("governance.chainProvider must be demeter");
  }
  if (
    result.network !== "preview" ||
    preflight.network !== "preview" ||
    governance.fireblocksStatus !== "COMPLETED"
  ) {
    throw new Error(
      "receipt must show a completed Fireblocks Preview transfer",
    );
  }
  trueAt(result.confirmed, "result.confirmed");
  trueAt(
    policy.authorizationInfoPresent,
    "matchedPolicy.authorizationInfoPresent",
  );
  trueAt(policy.requirementsSatisfied, "matchedPolicy.requirementsSatisfied");
  trueAt(
    policy.designatedSignerEvidencePresent,
    "matchedPolicy.designatedSignerEvidencePresent",
  );
  trueAt(policy.allSignersDesignated, "matchedPolicy.allSignersDesignated");
  trueAt(preflight.recipientAllowed, "preflight.recipientAllowed");
  trueAt(preflight.assetsPreserved, "preflight.assetsPreserved");
  trueAt(governance.signatureVerified, "governance.signatureVerified");
  trueAt(governance.signerMatchesSource, "governance.signerMatchesSource");
  trueAt(
    governance.transactionBodyUnchanged,
    "governance.transactionBodyUnchanged",
  );
  trueAt(
    governance.demeterSubmissionHashMatchesBody,
    "governance.demeterSubmissionHashMatchesBody",
  );
  trueAt(result.cardanoHashMatchesBody, "result.cardanoHashMatchesBody");

  if (
    privacy.secretsIncluded !== false ||
    privacy.approverIdentitiesIncluded !== false ||
    privacy.addressesIncluded !== false ||
    privacy.signedCborIncluded !== false
  ) {
    throw new Error("governance receipt privacy flags must all be false");
  }

  return {
    evidenceType: stringAt(receipt.evidenceType, "evidenceType"),
    externalTxId: governance.externalTxId,
    fireblocksTransactionId: governance.fireblocksTransactionId,
    transactionHash,
    approvedAuthorizers: approved,
    signerCount: signers,
    feeLovelace: fee,
    verified: true as const,
  };
};
