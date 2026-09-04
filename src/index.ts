import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Address,
  BaseAddress,
  Bip32PrivateKey,
  Credential,
  Transaction,
  TransactionHash,
  TransactionWitnessSet,
  Vkeywitnesses,
  make_vkey_witness,
} from "@emurgo/cardano-serialization-lib-nodejs";
import { BasePath } from "@fireblocks/ts-sdk";
import { blake2b } from "blakejs";
import bip39 from "bip39";
import {
  CardanoAmounts,
  DemeterBlockfrostProvider,
  FireblocksCardanoRawSDK,
  Logger,
  LogLevel,
  Networks,
  buildAdaTransactionWithCalculatedFee,
  calculateTtl,
  createTransactionInputs,
  fetchAndSelectUtxosForAda,
  submitTransaction,
  type DetailedTransaction,
} from "cardano-raw-sdk";
import dotenv from "dotenv";

dotenv.config({ path: process.env.CARDANO_ENV_FILE || ".env.development" });

interface RunLogEntry {
  timestamp: string;
  event: string;
  message: string;
  details?: Record<string, unknown>;
}

const runStartedAt = new Date().toISOString();
const runLog: RunLogEntry[] = [];

const logEvent = (
  event: string,
  message: string,
  details?: Record<string, unknown>,
): void => {
  const entry: RunLogEntry = {
    timestamp: new Date().toISOString(),
    event,
    message,
    ...(details && { details }),
  };
  runLog.push(entry);
  console.log(`[${entry.timestamp}] ${message}`);
};

const saveJsonArtifact = (
  relativePath: string,
  value: unknown,
): string | undefined => {
  try {
    const outputRoot = resolve(process.env.POC_OUTPUT_DIR || "output");
    const artifactPath = resolve(outputRoot, relativePath);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return artifactPath;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown file error";
    console.warn(`Could not save ${relativePath}: ${message}`);
    return undefined;
  }
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is missing. Add it to .env.development (start by copying .env.example).`,
    );
  }
  return value;
};

const enabled = (name: string): boolean => process.env[name] === "1";

const step = (current: number, total: number, message: string): void => {
  logEvent("step", `[${current}/${total}] ${message}`, { current, total });
};

const formatAda = (lovelace: number): string => {
  const ada = (lovelace / 1_000_000).toFixed(6);
  return `${ada.replace(/\.?0+$/, "")} ADA`;
};

const transferAmount = (): number => {
  const value = Number(process.env.LIVE_TRANSFER_LOVELACE || "2000000");
  if (!Number.isSafeInteger(value) || value < 1_000_000 || value > 5_000_000) {
    throw new Error(
      "LIVE_TRANSFER_LOVELACE must be an integer between 1000000 and 5000000",
    );
  }
  return value;
};

const parseNetwork = (): Networks => {
  const value = (process.env.CARDANO_NETWORK || "preview").toLowerCase();
  if (value === Networks.MAINNET) return Networks.MAINNET;
  if (value === Networks.PREPROD) return Networks.PREPROD;
  if (value === Networks.PREVIEW) return Networks.PREVIEW;
  throw new Error(
    `Unsupported CARDANO_NETWORK '${process.env.CARDANO_NETWORK}'`,
  );
};

const resolveSecretKey = (): string => {
  const direct = process.env.FIREBLOCKS_API_USER_SECRET_KEY?.trim();
  if (direct) {
    if (direct.startsWith("-----BEGIN")) return direct.replace(/\\n/g, "\n");
    const decoded = Buffer.from(direct, "base64").toString("utf8");
    if (decoded.startsWith("-----BEGIN")) return decoded;
    throw new Error(
      "FIREBLOCKS_API_USER_SECRET_KEY is not PEM or base64-encoded PEM",
    );
  }
  return readFileSync(required("FIREBLOCKS_API_USER_SECRET_KEY_PATH"), "utf8");
};

const derivePaymentKey = (mnemonic: string): Bip32PrivateKey => {
  if (!bip39.validateMnemonic(mnemonic))
    throw new Error("CARDANO_MNEMONIC is invalid");
  const entropy = Buffer.from(bip39.mnemonicToEntropy(mnemonic), "hex");
  const harden = (index: number) => 0x80000000 + index;

  // CIP-1852 payment key path: m / 1852' / 1815' / 0' / 0 / 0.
  return Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array())
    .derive(harden(1852))
    .derive(harden(1815))
    .derive(harden(0))
    .derive(0)
    .derive(0);
};

const assertPaymentKeyMatchesAddress = (
  paymentKey: Bip32PrivateKey,
  mnemonic: string,
  expectedAddress: string,
): void => {
  const root = Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(bip39.mnemonicToEntropy(mnemonic), "hex"),
    new Uint8Array(),
  );
  const harden = (index: number) => 0x80000000 + index;
  const account = root
    .derive(harden(1852))
    .derive(harden(1815))
    .derive(harden(0));
  const stake = account.derive(2).derive(0).to_public().to_raw_key();
  const expected = Address.from_bech32(expectedAddress);
  const paymentCredential = Credential.from_keyhash(
    paymentKey.to_public().to_raw_key().hash(),
  );
  const stakeCredential = Credential.from_keyhash(stake.hash());
  const derived = BaseAddress.new(
    expected.network_id(),
    paymentCredential,
    stakeCredential,
  ).to_address();
  if (derived.to_bech32() !== expectedAddress) {
    throw new Error("CARDANO_MNEMONIC does not derive CARDANO_ADDRESS_1");
  }
};

const createProvider = () =>
  new DemeterBlockfrostProvider({
    baseUrl: required("DEMETER_BLOCKFROST_URL"),
    apiKey: required("DEMETER_API_KEY"),
  });

const previewExplorerUrl = (txHash: string): string =>
  `https://preview.cardanoscan.io/transaction/${txHash}`;

const runLocal = async (
  broadcast: boolean,
): Promise<Record<string, unknown>> => {
  if (broadcast && !enabled("RUN_LIVE_LOCAL")) {
    throw new Error(
      "Set RUN_LIVE_LOCAL=1 to authorize signing and broadcasting Preview test ADA",
    );
  }

  const network = parseNetwork();
  if (network !== Networks.PREVIEW) {
    throw new Error(
      "Local custody is restricted to CARDANO_NETWORK=Preview so this POC cannot use real ADA.",
    );
  }

  const provider = createProvider();
  const senderAddress = required("CARDANO_ADDRESS_1");
  const recipientAddress = required("CARDANO_ADDRESS_2");
  const mnemonic = required("CARDANO_MNEMONIC");
  const lovelaceAmount = transferAmount();

  if (senderAddress === recipientAddress) {
    throw new Error(
      "CARDANO_ADDRESS_1 and CARDANO_ADDRESS_2 must be different addresses",
    );
  }

  const totalSteps = broadcast ? 8 : 6;
  console.log(
    `\nCardano + Demeter ${broadcast ? "on-chain" : "mock"} transfer`,
  );
  console.log(`Network: Preview | Amount: ${formatAda(lovelaceAmount)}`);
  console.log(
    broadcast
      ? "Live local custody: this will spend Preview test ADA and broadcast the transaction.\n"
      : "Safety: this mode will build and sign locally, but it cannot submit.\n",
  );
  logEvent("configuration", "Validated Preview local-custody configuration", {
    network,
    mode: broadcast ? "local" : "mock",
    transferLovelace: lovelaceAmount,
  });

  step(1, totalSteps, "Checking the Demeter Blockfrost connection...");
  const health = await provider.checkHealth();
  if (!health.success) {
    throw new Error(
      "Demeter health check failed. Check DEMETER_BLOCKFROST_URL, DEMETER_API_KEY, and your internet connection.",
    );
  }

  step(
    2,
    totalSteps,
    "Reading the source address balance from Cardano Preview...",
  );
  const balance = await provider.getBalanceByAddress({
    address: senderAddress,
    groupByPolicy: false,
  });

  step(3, totalSteps, "Finding enough unspent transaction outputs (UTxOs)...");
  const utxoResult = await fetchAndSelectUtxosForAda({
    chainProvider: provider,
    address: senderAddress,
    lovelaceAmount,
    // Reserve a conservative fee first; the builder calculates the exact fee next.
    transactionFee: CardanoAmounts.ESTIMATED_MAX_FEE,
  });
  logEvent("utxo-selection", "Selected transaction inputs", {
    selectedUtxos: utxoResult.selectedUtxos.length,
    selectedLovelace: utxoResult.accumulatedAda,
  });

  step(
    4,
    totalSteps,
    "Building the unsigned transaction and calculating its fee...",
  );
  const ttl = calculateTtl(await provider.getCurrentSlot());
  const inputs = createTransactionInputs(utxoResult.selectedUtxos);
  const built = buildAdaTransactionWithCalculatedFee(
    {
      lovelaceAmount,
      recipientAddress: Address.from_bech32(recipientAddress),
      senderAddress: Address.from_bech32(senderAddress),
      selectedUtxos: utxoResult.selectedUtxos,
    },
    inputs,
    ttl,
    1,
  );

  step(5, totalSteps, "Creating and verifying a local test witness...");
  const paymentKey = derivePaymentKey(mnemonic);
  assertPaymentKeyMatchesAddress(paymentKey, mnemonic, senderAddress);
  const hashBytes = Uint8Array.from(
    blake2b(built.txBody.to_bytes(), undefined, 32),
  );
  const bodyHash = TransactionHash.from_bytes(hashBytes);
  const rawKey = paymentKey.to_raw_key();
  const signature = rawKey.sign(hashBytes);
  if (!rawKey.to_public().verify(hashBytes, signature)) {
    throw new Error("Local mock witness verification failed");
  }

  const witnesses = Vkeywitnesses.new();
  witnesses.add(make_vkey_witness(bodyHash, rawKey));
  const witnessSet = TransactionWitnessSet.new();
  witnessSet.set_vkeys(witnesses);
  const signedTransaction = Transaction.new(built.txBody, witnessSet);
  const signedCborBytes = signedTransaction.to_bytes().length;
  logEvent(
    "transaction-built",
    "Built and locally verified the signed transaction",
    {
      transferLovelace: lovelaceAmount,
      feeLovelace: built.fee,
      signedCborBytes,
    },
  );

  let submittedHash: string | undefined;
  let confirmation: DetailedTransaction | undefined;
  try {
    if (broadcast) {
      step(6, totalSteps, "Submitting signed CBOR through Demeter...");
      submittedHash = await submitTransaction(provider, signedTransaction);
      logEvent("submission", "Demeter accepted the transaction", {
        transactionHash: submittedHash,
        explorerUrl: previewExplorerUrl(submittedHash),
      });

      console.log(`Submitted transaction: ${submittedHash}`);
      console.log(`Explorer: ${previewExplorerUrl(submittedHash)}\n`);
      step(7, totalSteps, "Waiting for the transaction to appear on-chain...");
      confirmation = await waitForConfirmation(provider, submittedHash);
      logEvent("confirmation", "Transaction confirmed on Cardano Preview", {
        transactionHash: submittedHash,
        blockHash: confirmation.block_hash,
        blockNumber: confirmation.block_no,
        slot: confirmation.slot_no,
        blockTime: confirmation.block_time,
        feeLovelace: confirmation.fee,
        transactionSizeBytes: confirmation.size,
      });
      step(8, totalSteps, "Confirmed on Cardano Preview.\n");
    } else {
      // Mock mode deliberately has no provider.submitTransaction() call.
      step(
        6,
        totalSteps,
        "Complete. The transaction was NOT submitted or broadcast.\n",
      );
    }
  } finally {
    signedTransaction.free();
  }

  const summary: Record<string, unknown> = {
    network,
    balanceAda: formatAda(balance.data.lovelace),
    balanceLovelace: balance.data.lovelace,
    selectedUtxos: utxoResult.selectedUtxos.length,
    transferAda: formatAda(lovelaceAmount),
    transferLovelace: lovelaceAmount,
    feeAda: formatAda(built.fee),
    feeLovelace: built.fee,
    signedCborBytes,
    witnessVerified: true,
    submitted: broadcast,
    confirmed: Boolean(confirmation),
    ...(submittedHash && {
      transactionHash: submittedHash,
      explorerUrl: previewExplorerUrl(submittedHash),
    }),
    ...(confirmation && {
      blockHash: confirmation.block_hash,
      blockNumber: confirmation.block_no,
      slot: confirmation.slot_no,
      blockTime: confirmation.block_time,
      transactionSizeBytes: confirmation.size,
    }),
  };

  if (submittedHash && confirmation) {
    const receiptPath = saveJsonArtifact(`transactions/${submittedHash}.json`, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: "local",
      result: summary,
      privacy: {
        secretsIncluded: false,
        addressesIncluded: false,
        signedCborIncluded: false,
      },
    });
    if (receiptPath) console.log(`Transaction receipt saved: ${receiptPath}`);
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
};

const waitForConfirmation = async (
  provider: DemeterBlockfrostProvider,
  txHash: string,
): Promise<DetailedTransaction> => {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const transaction = await provider.getTransactionDetails(txHash);
    if (transaction) return transaction.data;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    `Transaction ${txHash} was not confirmed within five minutes`,
  );
};

const runFireblocks = async (): Promise<Record<string, unknown>> => {
  if (!enabled("RUN_LIVE_FIREBLOCKS")) {
    throw new Error(
      "Set RUN_LIVE_FIREBLOCKS=1 to authorize real signing and broadcast",
    );
  }
  const network = parseNetwork();
  if (network !== Networks.PREVIEW) {
    throw new Error("The live POC is restricted to CARDANO_NETWORK=Preview");
  }

  const provider = createProvider();
  const sdk = await FireblocksCardanoRawSDK.createInstance({
    fireblocksConfig: {
      apiKey: required("FIREBLOCKS_API_USER_KEY"),
      secretKey: resolveSecretKey(),
      basePath: (process.env.FIREBLOCKS_BASE_PATH || BasePath.US) as BasePath,
    },
    vaultAccountId: required("FIREBLOCKS_VAULT_ACCOUNT_ID"),
    network,
    chainProvider: {
      type: "demeter",
      baseUrl: required("DEMETER_BLOCKFROST_URL"),
      apiKey: required("DEMETER_API_KEY"),
    },
  });

  try {
    const result = await sdk.transferAda({
      recipientAddress: required("CARDANO_ADDRESS_2"),
      lovelaceAmount: transferAmount(),
    });
    const confirmation = await waitForConfirmation(provider, result.txHash);
    console.log(
      `Fireblocks/Demeter POC confirmed transaction ${result.txHash}`,
    );
    return {
      network,
      mode: "fireblocks",
      transactionHash: result.txHash,
      explorerUrl: previewExplorerUrl(result.txHash),
      confirmed: true,
      blockHash: confirmation.block_hash,
      blockNumber: confirmation.block_no,
      slot: confirmation.slot_no,
      blockTime: confirmation.block_time,
      transactionSizeBytes: confirmation.size,
    };
  } finally {
    await sdk.shutdown();
  }
};

const main = async (): Promise<void> => {
  Logger.setLogLevel(enabled("POC_VERBOSE") ? LogLevel.INFO : LogLevel.NONE);

  const mode = (process.env.CUSTODY_MODE || "mock").toLowerCase();
  let summary: Record<string, unknown>;
  try {
    if (mode === "mock") {
      summary = await runLocal(false);
    } else if (mode === "local") {
      summary = await runLocal(true);
    } else if (mode === "fireblocks") {
      summary = await runFireblocks();
    } else {
      throw new Error("CUSTODY_MODE must be 'mock', 'local', or 'fireblocks'");
    }

    const logPath = saveJsonArtifact(
      `runs/${runStartedAt.replace(/[:.]/g, "-")}-${mode}.json`,
      {
        schemaVersion: 1,
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        mode,
        status: "succeeded",
        events: runLog,
        summary,
      },
    );
    if (logPath) console.log(`Run log saved: ${logPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logEvent("error", `Run failed: ${message}`);
    const logPath = saveJsonArtifact(
      `runs/${runStartedAt.replace(/[:.]/g, "-")}-${mode}-failed.json`,
      {
        schemaVersion: 1,
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        mode,
        status: "failed",
        events: runLog,
        error: message,
      },
    );
    if (logPath) console.error(`Failed run log saved: ${logPath}`);
    throw error;
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`\nPOC failed: ${message}`);
  process.exitCode = 1;
});
