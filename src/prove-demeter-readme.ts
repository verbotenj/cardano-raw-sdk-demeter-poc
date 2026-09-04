import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChainProviderCapability,
  DemeterBlockfrostProvider,
} from "cardano-raw-sdk";
import dotenv from "dotenv";

dotenv.config({ path: process.env.CARDANO_ENV_FILE || ".env.development" });

interface ConfirmedReceipt {
  network: string;
  transaction: {
    hash: string;
    feeLovelace: number;
    transactionSizeBytes: number;
    confirmed: boolean;
  };
  confirmation: {
    blockHash: string;
    blockNumber: number;
    slot: number;
    blockTime: string;
  };
}

interface ProofCheck {
  claim: string;
  status: "passed";
  evidence: Record<string, unknown>;
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing from .env.development`);
  }
  return value;
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const flattenGroupedAssets = (
  grouped: Record<string, Record<string, number>>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(grouped).flatMap(([policyId, assets]) =>
      Object.entries(assets).map(([assetName, quantity]) => [
        `${policyId}.${assetName}`,
        quantity,
      ]),
    ),
  );

const sameRecord = (
  left: Record<string, number>,
  right: Record<string, number>,
): boolean => {
  const sort = (value: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    );
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
};

const receiptPath = fileURLToPath(
  new URL("../examples/confirmed-preview-transaction.json", import.meta.url),
);

const main = async (): Promise<void> => {
  const network = (process.env.CARDANO_NETWORK || "Preview").toLowerCase();
  assert(
    network === "preview",
    "The live compatibility proof is restricted to CARDANO_NETWORK=Preview",
  );

  const sourceAddress = required("CARDANO_ADDRESS_1");
  assert(
    sourceAddress.startsWith("addr_test1"),
    "CARDANO_ADDRESS_1 must be a Cardano testnet address",
  );

  const provider = new DemeterBlockfrostProvider({
    baseUrl: required("DEMETER_BLOCKFROST_URL"),
    apiKey: required("DEMETER_API_KEY"),
  });
  const receipt = JSON.parse(
    readFileSync(receiptPath, "utf8"),
  ) as ConfirmedReceipt;
  const transactionHash = (
    process.env.PROOF_TRANSACTION_HASH || receipt.transaction.hash
  ).trim();
  assert(
    /^[0-9a-f]{64}$/i.test(transactionHash),
    "PROOF_TRANSACTION_HASH must be a 64-character hexadecimal hash",
  );

  const checks: ProofCheck[] = [];
  const passed = (claim: string, evidence: Record<string, unknown>): void => {
    checks.push({ claim, status: "passed", evidence });
    console.log(`PASS ${claim}`);
  };

  assert(provider.kind === "demeter", "The selected provider is not Demeter");
  assert(
    provider.capabilities.size === 1 &&
      provider.capabilities.has(ChainProviderCapability.CORE),
    "The Demeter provider must advertise exactly the provider-neutral core",
  );
  passed("SDK selected the Demeter core provider", {
    provider: provider.kind,
    capabilities: [...provider.capabilities],
  });

  const health = await provider.checkHealth();
  assert(health.success, "Demeter health check reported unhealthy");
  passed("Demeter Blockfrost health endpoint is reachable", {
    providerStatus: health.data.status,
  });

  const [
    networkMagic,
    flatBalance,
    groupedBalance,
    utxos,
    currentSlot,
    transaction,
  ] = await Promise.all([
    provider.getNetworkMagic(),
    provider.getBalanceByAddress({
      address: sourceAddress,
      groupByPolicy: false,
    }),
    provider.getBalanceByAddress({
      address: sourceAddress,
      groupByPolicy: true,
    }),
    provider.getUtxosByAddress(sourceAddress),
    provider.getCurrentSlot(),
    provider.getTransactionDetails(transactionHash),
  ]);

  assert(
    networkMagic === 2,
    `Demeter network magic ${networkMagic} is not Cardano Preview network magic 2`,
  );
  passed("Demeter genesis identifies the Cardano Preview network", {
    networkMagic,
    expectedNetworkMagic: 2,
    matchesConfiguredNetwork: true,
  });

  assert(flatBalance.success, "Flat address balance query failed");
  assert(groupedBalance.success, "Grouped address balance query failed");
  assert(
    flatBalance.data.lovelace === groupedBalance.data.lovelace,
    "Flat and grouped balances disagree about lovelace",
  );
  const flatAssets = flatBalance.data.assets as Record<string, number>;
  const groupedAssets = groupedBalance.data.assets as Record<
    string,
    Record<string, number>
  >;
  assert(
    sameRecord(flatAssets, flattenGroupedAssets(groupedAssets)),
    "Flat and policy-grouped native asset balances disagree",
  );
  passed("Address balance works in flat and policy-grouped form", {
    lovelaceIsSafeInteger: Number.isSafeInteger(flatBalance.data.lovelace),
    assetCount: Object.keys(flatAssets).length,
    policyCount: Object.keys(groupedAssets).length,
    flatAndGroupedMatch: true,
  });

  assert(utxos.success && Array.isArray(utxos.data), "UTxO query failed");
  assert(utxos.data.length > 0, "Source address has no spendable UTxOs");
  assert(
    utxos.data.every(
      (utxo) =>
        /^[0-9a-f]{64}$/i.test(utxo.transaction_id) &&
        Number.isSafeInteger(utxo.value.lovelace),
    ),
    "Demeter returned an invalid normalized UTxO",
  );
  passed("Address UTxOs are returned in the SDK model", {
    utxoCount: utxos.data.length,
    allTransactionIdsValid: true,
    allLovelaceQuantitiesSafe: true,
  });

  assert(
    Number.isSafeInteger(currentSlot) &&
      currentSlot > receipt.confirmation.slot,
    "Latest Cardano slot is not newer than the saved confirmed transaction",
  );
  passed("Latest Cardano slot is available through Demeter", {
    slotIsSafeInteger: true,
    newerThanSavedProof: true,
  });

  assert(
    transaction?.success,
    "Confirmed transaction was not found through Demeter",
  );
  assert(
    transaction.data.tx_hash.toLowerCase() === transactionHash.toLowerCase(),
    "Demeter transaction hash does not match the requested hash",
  );
  if (transactionHash === receipt.transaction.hash) {
    assert(
      transaction.data.block_hash === receipt.confirmation.blockHash &&
        transaction.data.block_no === receipt.confirmation.blockNumber &&
        transaction.data.slot_no === receipt.confirmation.slot &&
        transaction.data.block_time === receipt.confirmation.blockTime &&
        transaction.data.fee === receipt.transaction.feeLovelace &&
        transaction.data.size === receipt.transaction.transactionSizeBytes,
      "Live Demeter transaction data does not match the saved on-chain receipt",
    );
  }
  passed("Confirmed transaction details are readable through Demeter", {
    transactionHash,
    receiptCrossCheck:
      transactionHash === receipt.transaction.hash
        ? "matched"
        : "not-requested",
    blockNumber: transaction.data.block_no,
    slot: transaction.data.slot_no,
    feeLovelace: transaction.data.fee,
    transactionSizeBytes: transaction.data.size,
  });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    proofScope: "upstream-readme-demeter-core",
    upstreamReadmeRevision: "4fe86e8af026f26281ca1ab6f44d4395e5a58409",
    sdkForkRevision: "10728f966fde07874342ba4e22938eaff4196d00",
    network: "preview",
    provider: "demeter",
    readOnly: true,
    submittedTransaction: false,
    checks,
    conclusion: {
      passed: checks.length,
      failed: 0,
      coreProviderWorks: true,
      fullUpstreamFeatureParity: false,
    },
    limitations: [
      "This command does not broadcast a new transaction.",
      "A prior sanitized receipt supplies the transaction submitted by the POC.",
      "Fireblocks custody, CNT transfers, staking, Cardano governance, pools, full history, and asset metadata are outside this live proof.",
    ],
    privacy: {
      apiKeyIncluded: false,
      mnemonicIncluded: false,
      addressesIncluded: false,
      signedCborIncluded: false,
    },
  };

  const outputPath = resolve(
    process.env.POC_OUTPUT_DIR || "output",
    "proofs/demeter-readme-compatibility.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(
    `\n${checks.length}/${checks.length} live Demeter checks passed.`,
  );
  console.log("No transaction was submitted by this proof command.");
  console.log(`Sanitized report saved: ${outputPath}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Demeter README proof failed: ${message}`);
  process.exitCode = 1;
});
