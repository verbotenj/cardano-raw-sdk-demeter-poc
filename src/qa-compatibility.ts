import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { Address } from "@emurgo/cardano-serialization-lib-nodejs";
import dotenv from "dotenv";
import {
  DemeterBlockfrostProvider,
  Logger,
  LogLevel,
  buildAdaTransactionWithCalculatedFee,
  calculateTtl,
  createTransactionInputs,
  fetchAndSelectUtxosForAda,
  validateProtocolParameters,
} from "cardano-raw-sdk";
import { assertPreviewReadiness } from "./preview-safety.js";
import { parseConfirmedReceipt, verifyOnChainProof } from "./on-chain-proof.js";
import { verifyAdaPayment } from "./payment-proof.js";

dotenv.config({
  path: process.env.CARDANO_ENV_FILE || ".env.development",
  quiet: true,
});
Logger.setLogLevel(LogLevel.NONE);
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const hashFile = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const sdkDist = dirname(
  createRequire(import.meta.url).resolve("cardano-raw-sdk"),
);

const main = async () => {
  const provider = new DemeterBlockfrostProvider({
    baseUrl: required("DEMETER_BLOCKFROST_URL"),
    apiKey: required("DEMETER_API_KEY"),
  });
  let submissionAttempts = 0;
  provider.submitTransfer = async () => {
    submissionAttempts++;
    throw new Error("QA runner forbids submission");
  };
  const sender = required("CARDANO_ADDRESS_1");
  const recipient = required("CARDANO_ADDRESS_2");
  const proofDir = resolve(
    process.env.QA_PROOF_DIR || "proofs/qa-compatibility",
  );
  mkdirSync(proofDir, { recursive: true });
  const provenance = {
    sdkProviderSha256: hashFile(
      resolve(sdkDist, "services/demeter-blockfrost.provider.js"),
    ),
    sdkBuilderSha256: hashFile(resolve(sdkDist, "utils/cardano.js")),
    runnerSha256: hashFile(new URL(import.meta.url).pathname),
    nodeVersion: process.version,
  };
  const run = async (
    action: string,
    expected: string,
    execute: () => Promise<unknown>,
  ) => {
    const startedAt = new Date().toISOString();
    let evidence: unknown;
    let status = "passed";
    try {
      evidence = await execute();
      assert.equal(submissionAttempts, 0);
    } catch {
      status = "failed";
      evidence = {
        reason:
          "Acceptance check failed; diagnose locally without publishing credentials",
      };
      process.exitCode = 1;
    }
    writeFileSync(
      resolve(proofDir, `${action}.json`),
      JSON.stringify(
        {
          schemaVersion: 1,
          action,
          startedAt,
          completedAt: new Date().toISOString(),
          status,
          expected,
          provenance,
          scope: "live-preview-read-only-plus-local-construction",
          evidence,
          submissionAttempts,
          secretsIncluded: false,
          addressesIncluded: false,
          limitations:
            "Sampled Preview state, not full Blockfrost parity, node-independent consensus verification, or Fireblocks custody evidence",
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(`${status.toUpperCase()} ${action}`);
  };

  await run(
    "01-transfer-readiness",
    "Fresh Preview network, matching flat/grouped balance and bounded UTxO reads; no submission",
    async () => {
      const [health, networkMagic, tip, balance, grouped, utxos] =
        await Promise.all([
          provider.checkHealth(),
          provider.getNetworkMagic(),
          provider.getChainTip(),
          provider.getBalanceByAddress({
            address: sender,
            groupByPolicy: false,
          }),
          provider.getBalanceByAddress({
            address: sender,
            groupByPolicy: true,
          }),
          provider.getUtxosByAddress(sender),
        ]);
      assert(health.success && utxos.success);
      assertPreviewReadiness({
        networkMagic,
        tipTime: tip.time,
        addresses: [sender, recipient],
      });
      assert.equal(balance.data.lovelace, grouped.data.lovelace);
      assert.equal(
        utxos.data!.reduce(
          (sum, utxo) => sum + BigInt(utxo.value.lovelace),
          0n,
        ),
        BigInt(balance.data.lovelace),
      );
      return {
        networkMagic,
        tipHeight: tip.height,
        tipSlot: tip.slot,
        tipAgeSeconds: Math.floor(Date.now() / 1000) - tip.time,
        utxoCount: utxos.data!.length,
        balanceMatchesUtxos: true,
        balanceGroupingLovelaceMatches: true,
      };
    },
  );
  await run(
    "02-confirmed-payment",
    "Saved receipt header, actual recipient/amount/change, asset conservation and stable block-depth check",
    async () => {
      const receipt = parseConfirmedReceipt(
        JSON.parse(
          readFileSync("examples/confirmed-preview-transaction.json", "utf8"),
        ),
      );
      const [networkMagic, tip, response] = await Promise.all([
        provider.getNetworkMagic(),
        provider.getChainTip(),
        provider.getFullTransactionDetails(receipt.transaction.hash),
      ]);
      assert(response?.success);
      assertPreviewReadiness({
        networkMagic,
        tipTime: tip.time,
        addresses: [sender, recipient],
      });
      const tx = response.data;
      const header = verifyOnChainProof({
        receipt,
        networkMagic,
        currentSlot: tip.slot,
        transaction: {
          transactionHash: tx.tx_hash,
          blockHash: tx.block_hash,
          blockNumber: tx.block_no,
          slot: tx.slot_no,
          blockTime: tx.block_time,
          feeLovelace: tx.fee,
          transactionSizeBytes: tx.size,
        },
      });
      const reread = await provider.getTransactionDetails(tx.tx_hash);
      assert(reread?.success);
      const payment = verifyAdaPayment({
        transaction: tx,
        sender,
        recipient,
        lovelace: receipt.transaction.transferLovelace,
        tipHeight: tip.height,
        minimumConfirmations: 3,
        rereadBlockHash: reread.data.block_hash,
      });
      return {
        transactionHash: tx.tx_hash,
        blockHash: tx.block_hash,
        headerMatchesReceipt: header.receiptMatchesChain,
        ...payment,
      };
    },
  );
  await run(
    "03-current-protocol-build",
    "Current Preview parameters drive SDK construction; returned fee equals encoded fee and inputs equal outputs plus fee",
    async () => {
      const parameters = await provider.getProtocolParameters();
      validateProtocolParameters(parameters, 2);
      const tip = await provider.getChainTip();
      assertPreviewReadiness({
        networkMagic: parameters.networkMagic,
        tipTime: tip.time,
        addresses: [sender, recipient],
      });
      const selected = await fetchAndSelectUtxosForAda({
        chainProvider: provider,
        address: sender,
        lovelaceAmount: 2000000,
        transactionFee: 1000000,
      });
      const inputs = createTransactionInputs(selected.selectedUtxos);
      const senderAddress = Address.from_bech32(sender);
      const recipientAddress = Address.from_bech32(recipient);
      try {
        const built = buildAdaTransactionWithCalculatedFee(
          {
            senderAddress,
            recipientAddress,
            selectedUtxos: selected.selectedUtxos,
            lovelaceAmount: 2000000,
            protocolParameters: parameters,
          },
          inputs,
          calculateTtl(tip.slot),
          1,
        );
        try {
          assert.equal(built.fee, Number(built.txBody.fee().to_str()));
          const outputLovelace = built.outputs.reduce(
            (sum, output) => sum + BigInt(output.amount().coin().to_str()),
            0n,
          );
          assert.equal(
            outputLovelace + BigInt(built.fee),
            BigInt(selected.accumulatedAda),
          );
          return {
            parameters,
            inputCount: inputs.length,
            outputCount: built.outputs.length,
            feeLovelace: built.fee,
            feeMatchesEncodedBody: true,
            adaConserved: true,
            unsignedBodyBytes: built.txBody.to_bytes().length,
            signed: false,
          };
        } finally {
          built.txBody.free();
          built.outputs.forEach((output) => output.free());
        }
      } finally {
        inputs.forEach((input) => input.free());
        senderAddress.free();
        recipientAddress.free();
        selected.release();
      }
    },
  );
};
main().catch(() => {
  console.error(
    "QA initialization failed; check the private Preview environment locally",
  );
  process.exitCode = 1;
});
