import type { DetailedTransaction } from "cardano-raw-sdk";

const requireCheck = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};
const quantity = (value: number): bigint => {
  requireCheck(
    Number.isSafeInteger(value) && value >= 0,
    "Unsafe payment quantity",
  );
  return BigInt(value);
};

/** Narrow proof for this POC's ordinary, two-output ADA payment, not arbitrary scripts/staking. */
export const verifyAdaPayment = (params: {
  transaction: DetailedTransaction;
  sender: string;
  recipient: string;
  lovelace: number;
  tipHeight: number;
  minimumConfirmations: number;
  rereadBlockHash: string;
}) => {
  const { transaction: tx, sender, recipient } = params;
  requireCheck(
    tx.utxosComplete === true,
    "Complete transaction UTxOs are required",
  );
  requireCheck(
    sender.length > 0 && recipient.length > 0 && sender !== recipient,
    "Distinct payment intent addresses are required",
  );
  requireCheck(params.lovelace > 0, "Payment amount must be positive");
  requireCheck(
    Number.isSafeInteger(params.tipHeight) && params.tipHeight >= tx.block_no,
    "Invalid tip height",
  );
  requireCheck(
    Number.isSafeInteger(params.minimumConfirmations) &&
      params.minimumConfirmations > 0,
    "Invalid confirmation threshold",
  );
  const confirmations = params.tipHeight - tx.block_no + 1;
  requireCheck(
    confirmations >= params.minimumConfirmations,
    "Insufficient block confirmations",
  );
  requireCheck(
    params.rereadBlockHash === tx.block_hash,
    "Transaction inclusion changed during verification",
  );
  requireCheck(
    tx.inputs.length > 0 && tx.outputs.length === 2,
    "Expected inputs and exactly two payment outputs",
  );
  requireCheck(
    new Set(tx.inputs.map((i) => `${i.tx_hash}#${i.output_index}`)).size ===
      tx.inputs.length,
    "Duplicate payment input",
  );
  requireCheck(
    new Set(tx.outputs.map((o) => o.output_index)).size === tx.outputs.length,
    "Duplicate payment output",
  );
  requireCheck(
    tx.inputs.every(
      (input) =>
        input.address === sender &&
        input.collateral === false &&
        input.reference === false,
    ),
    "Inputs must be ordinary source inputs with explicit collateral/reference flags",
  );
  requireCheck(
    tx.outputs.every((output) => output.collateral === false),
    "Collateral output is not an ordinary payment",
  );
  const payment = tx.outputs.filter((output) => output.address === recipient);
  const change = tx.outputs.filter((output) => output.address === sender);
  requireCheck(
    payment.length === 1 && change.length === 1,
    "Recipient/change addresses do not match intent",
  );
  requireCheck(
    quantity(payment[0].value.lovelace) === quantity(params.lovelace),
    "Recipient amount does not match intent",
  );
  requireCheck(
    Object.keys(payment[0].value.assets ?? {}).length === 0,
    "ADA recipient must not receive native tokens",
  );
  const inputAda = tx.inputs.reduce(
    (sum, input) => sum + quantity(input.value.lovelace),
    0n,
  );
  const outputAda = tx.outputs.reduce(
    (sum, output) => sum + quantity(output.value.lovelace),
    0n,
  );
  requireCheck(
    inputAda === outputAda + quantity(tx.fee),
    "ADA inputs do not equal outputs plus fee",
  );
  const assets = new Map<string, bigint>();
  for (const input of tx.inputs) {
    for (const [unit, amount] of Object.entries(input.value.assets ?? {})) {
      assets.set(unit, (assets.get(unit) ?? 0n) + quantity(amount));
    }
  }
  const changeAssets = change[0].value.assets ?? {};
  requireCheck(
    assets.size === Object.keys(changeAssets).length,
    "Change asset inventory mismatch",
  );
  for (const [unit, amount] of assets) {
    requireCheck(
      changeAssets[unit] !== undefined &&
        quantity(changeAssets[unit]) === amount,
      "Native assets are not preserved in change",
    );
  }
  return {
    paymentVerified: true as const,
    transferLovelace: params.lovelace,
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
    changeLovelace: change[0].value.lovelace,
    preservedAssetCount: assets.size,
    confirmations,
    minimumConfirmations: params.minimumConfirmations,
    inclusionStableAtRecheck: true as const,
    scope: "ordinary-two-output-ada-payment" as const,
  };
};
