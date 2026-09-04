import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemeterBlockfrostProvider } from "cardano-raw-sdk";
import dotenv from "dotenv";
import {
  parseConfirmedReceipt,
  verifyOnChainProof,
} from "./on-chain-proof.js";

dotenv.config({ path: process.env.CARDANO_ENV_FILE || ".env.development" });

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .env.development`);
  return value;
};

const receiptPath = fileURLToPath(
  new URL("../examples/confirmed-preview-transaction.json", import.meta.url),
);

const main = async (): Promise<void> => {
  const receipt = parseConfirmedReceipt(
    JSON.parse(readFileSync(receiptPath, "utf8")) as unknown,
  );
  const provider = new DemeterBlockfrostProvider({
    baseUrl: required("DEMETER_BLOCKFROST_URL"),
    apiKey: required("DEMETER_API_KEY"),
  });

  console.log("Cardano + Demeter read-only on-chain verification");
  console.log(`Transaction: ${receipt.transaction.hash}`);

  const health = await provider.checkHealth();
  if (!health.success) throw new Error("Demeter health check failed");
  console.log("PASS Demeter provider is healthy");

  const [networkMagic, currentSlot, response] = await Promise.all([
    provider.getNetworkMagic(),
    provider.getCurrentSlot(),
    provider.getTransactionDetails(receipt.transaction.hash),
  ]);
  if (!response?.success) {
    throw new Error("Saved transaction was not found through Demeter");
  }

  const verification = verifyOnChainProof({
    receipt,
    networkMagic,
    currentSlot,
    transaction: {
      transactionHash: response.data.tx_hash,
      blockHash: response.data.block_hash,
      blockNumber: response.data.block_no,
      slot: response.data.slot_no,
      blockTime: response.data.block_time,
      feeLovelace: response.data.fee,
      transactionSizeBytes: response.data.size,
    },
  });

  const checks = [
    {
      claim: "Demeter provider is healthy",
      status: "passed",
      evidence: { provider: provider.kind, status: health.data.status },
    },
    {
      claim: "Provider is connected to Cardano Preview",
      status: "passed",
      evidence: { networkMagic, expectedNetworkMagic: 2 },
    },
    {
      claim: "Transaction is included in a Cardano block",
      status: "passed",
      evidence: {
        transactionHash: verification.transactionHash,
        blockHash: verification.blockHash,
        blockNumber: verification.blockNumber,
        slot: verification.slot,
        blockTime: verification.blockTime,
      },
    },
    {
      claim: "Live chain fields match the committed receipt",
      status: "passed",
      evidence: {
        receiptMatchesChain: verification.receiptMatchesChain,
        feeLovelace: verification.feeLovelace,
        transactionSizeBytes: verification.transactionSizeBytes,
      },
    },
    {
      claim: "Cardano has advanced beyond the confirmation slot",
      status: "passed",
      evidence: {
        transactionSlot: verification.slot,
        currentSlot: verification.currentSlot,
        confirmationDepthSlots: verification.confirmationDepthSlots,
      },
    },
  ];

  for (const check of checks.slice(1)) console.log(`PASS ${check.claim}`);

  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    generatedAt,
    proofType: "live-read-only-chain-verification",
    provider: "demeter",
    network: "preview",
    readOnly: true,
    submittedTransaction: false,
    checks,
    result: verification,
    privacy: {
      apiKeyIncluded: false,
      mnemonicIncluded: false,
      addressesIncluded: false,
      signedCborIncluded: false,
    },
  };

  const outputRoot = resolve(process.env.POC_OUTPUT_DIR || "output");
  const jsonPath = resolve(outputRoot, "proofs/on-chain-verification.json");
  const logPath = resolve(outputRoot, "proofs/on-chain-verification.txt");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const log = [
    "Cardano + Demeter read-only on-chain verification",
    `Generated: ${generatedAt}`,
    `Provider: demeter | Network: preview | Network magic: ${networkMagic}`,
    `Transaction: ${verification.transactionHash}`,
    `Block: ${verification.blockNumber} (${verification.blockHash})`,
    `Slot: ${verification.slot} | Current slot: ${verification.currentSlot}`,
    `Fee: ${verification.feeLovelace} lovelace | Size: ${verification.transactionSizeBytes} bytes`,
    "PASS transaction found on Cardano Preview",
    "PASS live chain fields match committed receipt",
    "PASS no transaction was submitted by this verification",
    "",
  ].join("\n");
  writeFileSync(logPath, log, { encoding: "utf8", mode: 0o600 });

  console.log(`\n${checks.length}/${checks.length} on-chain checks passed.`);
  console.log("No transaction was submitted.");
  console.log(`Sanitized JSON report: ${jsonPath}`);
  console.log(`Sanitized text log: ${logPath}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`On-chain verification failed: ${message}`);
  process.exitCode = 1;
});
