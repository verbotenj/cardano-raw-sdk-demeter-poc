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

const arrayAt = (value: unknown, name: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
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
  if (policy.evidenceSource !== "fireblocks-authorization-info") {
    throw new Error(
      "matchedPolicy must come from Fireblocks authorizationInfo",
    );
  }
  const logic = stringAt(policy.logic, "matchedPolicy.logic");
  if (logic !== "AND" && logic !== "OR") {
    throw new Error("matchedPolicy.logic must be AND or OR");
  }
  const groups = arrayAt(policy.groups, "matchedPolicy.groups");
  if (!groups.length) {
    throw new Error("matchedPolicy.groups must not be empty");
  }
  const groupResults = groups.map((value, index) => {
    const group = objectAt(value, `matchedPolicy.groups[${index}]`);
    const threshold = numberAt(
      group.threshold,
      `matchedPolicy.groups[${index}].threshold`,
    );
    const groupApproved = numberAt(
      group.approved,
      `matchedPolicy.groups[${index}].approved`,
    );
    const pending = numberAt(
      group.pending,
      `matchedPolicy.groups[${index}].pending`,
    );
    const rejected = numberAt(
      group.rejected,
      `matchedPolicy.groups[${index}].rejected`,
    );
    const notApplicable = numberAt(
      group.notApplicable,
      `matchedPolicy.groups[${index}].notApplicable`,
    );
    if (
      threshold < 1 ||
      groupApproved < 0 ||
      pending < 0 ||
      rejected < 0 ||
      notApplicable < 0
    ) {
      throw new Error("matchedPolicy group counts must be non-negative");
    }
    const satisfied = groupApproved >= threshold;
    if (group.satisfied !== satisfied) {
      throw new Error(
        "matchedPolicy group satisfaction does not match its approval threshold",
      );
    }
    return satisfied;
  });
  const groupsSatisfied =
    logic === "OR" ? groupResults.some(Boolean) : groupResults.every(Boolean);
  if (!groupsSatisfied) {
    throw new Error("matchedPolicy authorization groups are not satisfied");
  }
  const configuredSigners = numberAt(
    policy.configuredDesignatedSignerCount,
    "matchedPolicy.configuredDesignatedSignerCount",
  );
  if (configuredSigners < signers || configuredSigners < 1) {
    throw new Error("matchedPolicy designated signer evidence is inconsistent");
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

  const externalTxId = stringAt(
    governance.externalTxId,
    "governance.externalTxId",
  );
  if (!externalTxId.startsWith("cardano-demeter-poc-")) {
    throw new Error(
      "governance.externalTxId must be generated by the Cardano Demeter POC",
    );
  }
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
  const providerNetworkMagic = numberAt(
    preflight.providerNetworkMagic,
    "preflight.providerNetworkMagic",
  );
  const expectedNetworkMagic = numberAt(
    preflight.expectedNetworkMagic,
    "preflight.expectedNetworkMagic",
  );
  if (providerNetworkMagic !== 2 || expectedNetworkMagic !== 2) {
    throw new Error(
      "receipt must prove Demeter and the SDK were both configured for Preview network magic 2",
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
    externalTxId,
    fireblocksTransactionId: governance.fireblocksTransactionId,
    transactionHash,
    approvedAuthorizers: approved,
    signerCount: signers,
    providerNetworkMagic,
    feeLovelace: fee,
    verified: true as const,
  };
};
