import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Address,
  BaseAddress,
  RewardAddress,
} from "@emurgo/cardano-serialization-lib-nodejs";
import dotenv from "dotenv";
import {
  DemeterBlockfrostProvider,
  FireblocksCardanoRawSDK,
  Logger,
  LogLevel,
  Networks,
  collectChainPages,
  type FireblocksService,
} from "cardano-raw-sdk";
import { assertPreviewReadiness } from "./preview-safety.js";

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
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const require = createRequire(import.meta.url);

const main = async () => {
  const baseUrl = required("DEMETER_BLOCKFROST_URL").replace(/\/+$/, "");
  const apiKey = required("DEMETER_API_KEY");
  const source = required("CARDANO_ADDRESS_1");
  const destination = required("CARDANO_ADDRESS_2");
  const provider = new DemeterBlockfrostProvider({ baseUrl, apiKey });
  let submissionAttempts = 0;
  let custodyCalls = 0;
  provider.submitTransfer = async () => {
    submissionAttempts++;
    throw new Error("Submission is forbidden by indexed QA");
  };
  const custody = new Proxy(
    {},
    {
      get: () => {
        custodyCalls++;
        throw new Error("Custody is forbidden by indexed QA");
      },
    },
  ) as FireblocksService;
  // The SDK constructor accepts injected services. The custody boundary is a throwing
  // test double; all indexed HTTP reads are real and use the selected provider.
  const sdk = new FireblocksCardanoRawSDK({
    chainProvider: provider,
    fireblocksService: custody,
    vaultAccountId: "unused-read-only",
    network: Networks.PREVIEW,
    logger: new Logger("qa-indexed"),
  });
  const queries = sdk.getChainQueries();
  const [magic, tip] = await Promise.all([
    provider.getNetworkMagic(),
    provider.getChainTip(),
  ]);
  assertPreviewReadiness({
    networkMagic: magic,
    tipTime: tip.time,
    addresses: [source, destination],
  });
  const cslSource = Address.from_bech32(source);
  const base = BaseAddress.from_address(cslSource);
  assert(
    base,
    "This QA fixture requires a base address with a stake credential",
  );
  const stake = RewardAddress.new(0, base.stake_cred())
    .to_address()
    .to_bech32();
  base.free();
  cslSource.free();
  const sdkDist = dirname(require.resolve("cardano-raw-sdk"));
  const artifactHashes = Object.fromEntries(
    [
      "FireblocksCardanoRawSDK.js",
      "services/demeter-blockfrost.provider.js",
      "services/blockfrost.queries.js",
      "services/chain-query.validation.js",
      "utils/chain-queries.js",
    ].map((file) => [file, digest(readFileSync(resolve(sdkDist, file)))]),
  );
  const proofDir = resolve(
    process.env.INDEXED_QA_PROOF_DIR || "proofs/qa-indexed-reads",
  );
  mkdirSync(proofDir, { recursive: true });
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
      assert.equal(custodyCalls, 0);
    } catch (error) {
      status = "failed";
      process.exitCode = 1;
      evidence = {
        errorType: error instanceof Error ? error.name : "UnknownError",
        reason:
          "Acceptance check failed; inspect locally without publishing raw provider data",
      };
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
          evidence,
          network: "preview",
          networkMagic: magic,
          sdkEntryPoint: "FireblocksCardanoRawSDK.getChainQueries",
          artifactHashes,
          runnerSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
          nodeVersion: process.version,
          submissionAttempts,
          custodyCalls,
          custodyBoundary: "throwing-test-double-never-called",
          privacy: {
            secretsIncluded: false,
            walletAddressesIncluded: false,
            cborIncluded: false,
          },
          limitations:
            "Sampled retained data; not complete Blockfrost parity, complete archive coverage, ledger governance, or live Fireblocks evidence",
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(`${status.toUpperCase()} ${action}`);
  };
  // Only fixture discovery and an explicit unavailable-endpoint probe use fetch.
  // Accepted feature reads below always go through sdk.getChainQueries().
  const rawGet = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "dmtr-api-key": apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Fixture discovery unavailable");
    return (await response.json()) as unknown;
  };

  await run(
    "address-history",
    "Two distinct paginated history entries, block-height filtering, and full input/output hydration",
    async () => {
      const first = await queries.addressHistory(source, { count: 1 });
      const second = await queries.addressHistory(source, {
        count: 1,
        page: 2,
      });
      assert.equal(first.items.length, 1);
      assert.equal(second.items.length, 1);
      assert.notEqual(first.items[0].txHash, second.items[0].txHash);
      assert.equal(first.total, null);
      assert.equal(first.nextPage, 2);
      const full = await queries.addressHistory(source, {
        count: 1,
        details: "full",
      });
      assert.equal(full.items[0].txHash, first.items[0].txHash);
      assert.equal(full.items[0].details?.utxosComplete, true);
      const height = first.items[0].blockHeight;
      const filtered = await queries.addressHistory(source, {
        count: 25,
        fromBlock: height,
        toBlock: height,
      });
      assert(
        filtered.items.some((item) => item.txHash === first.items[0].txHash),
      );
      assert(filtered.items.every((item) => item.blockHeight === height));
      return {
        firstHash: first.items[0].txHash,
        secondHash: second.items[0].txHash,
        knownTotal: first.total,
        fullInputCount: full.items[0].details!.inputs.length,
        fullOutputCount: full.items[0].details!.outputs.length,
        fromBlock: height,
        toBlock: height,
        filteredCount: filtered.items.length,
        blockFilterVerified: true,
      };
    },
  );
  await run(
    "asset-details",
    "Asset identity/fingerprint, decimal supply and separately identified metadata are returned by the SDK",
    async () => {
      let unit = process.env.PROOF_ASSET_UNIT?.trim();
      if (!unit) {
        const assets = (await rawGet("/assets?count=1&page=1")) as Array<{
          asset: string;
        }>;
        assert(Array.isArray(assets) && typeof assets[0]?.asset === "string");
        unit = assets[0].asset;
      }
      const result = await queries.assetDetails(unit);
      assert.equal(result.unit, unit.toLowerCase());
      assert(BigInt(result.supply) >= 0n);
      assert.equal(result.mintCount, null);
      assert.equal(result.burnCount, null);
      return {
        unit: result.unit,
        fingerprint: result.fingerprint,
        supply: result.supply,
        mintOrBurnCount: result.mintOrBurnCount,
        separateMintBurnCountsUnavailable: true,
        onchainMetadataPresent: result.onchainMetadata !== null,
        registryMetadataPresent: result.registryMetadata !== null,
      };
    },
  );
  await run(
    "stake-account",
    "Read source stake account without equating controlled amount with active stake or guessing registration",
    async () => {
      const result = await queries.stakeAccount(stake);
      assert.equal(result.stakeAddress, stake);
      assert.equal(result.activeStake, null);
      assert(BigInt(result.availableRewards) >= 0n);
      return {
        stakeAddressSha256: digest(stake),
        active: result.active,
        registered: result.registered,
        activeStake: result.activeStake,
        controlledAmountReported: result.controlledAmount !== null,
        availableRewards: result.availableRewards,
        registrationUnknown: result.registered === null,
      };
    },
  );
  await run(
    "stake-addresses",
    "Bounded page collection enumerates the source payment address without claiming ownership from a stake credential",
    async () => {
      const addresses = await collectChainPages(
        (opts) => queries.stakeAddresses(stake, opts),
        (item) => item,
        { count: 25, maxPages: 4 },
      );
      assert(addresses.includes(source));
      return {
        addressCount: addresses.length,
        includesConfiguredSource: true,
        pagesBound: 4,
        count: 25,
        ownershipInferred: false,
        addressesIncluded: false,
      };
    },
  );
  let selectedPool: string | undefined = process.env.PROOF_POOL_ID?.trim();
  const fixturePool = async () => {
    if (selectedPool) return selectedPool;
    const pools = (await rawGet("/pools?count=1&page=1")) as string[];
    assert(Array.isArray(pools) && typeof pools[0] === "string");
    selectedPool = pools[0];
    return selectedPool;
  };
  await run(
    "pool-metadata",
    "Retrieve individual pool metadata through the SDK without fetching its untrusted homepage",
    async () => {
      const pool = await fixturePool();
      const result = await queries.poolMetadata(pool);
      assert.equal(result.poolId, pool);
      return {
        poolId: result.poolId,
        namePresent: result.name !== null,
        tickerPresent: result.ticker !== null,
        homepagePresent: result.homepage !== null,
        externalMetadataUrlsFetched: false,
      };
    },
  );
  await run(
    "pool-delegators",
    "Read individual delegators without fabricating aggregate totals, active epochs or pool-validation support",
    async () => {
      const pool = await fixturePool();
      const result = await queries.poolDelegators(pool, { count: 3 });
      assert(result.items.length > 0);
      assert.equal(result.total, null);
      assert(
        result.items.every(
          (item) => BigInt(item.amount) >= 0n && item.activeEpoch === null,
        ),
      );
      await assert.rejects(() => sdk.getPoolInfo(pool), /does not support/);
      return {
        poolId: pool,
        sampleCount: result.items.length,
        total: result.total,
        activeEpochUnknown: true,
        legacyPoolValidationRemainsDisabled: true,
      };
    },
  );
  await run(
    "stake-rewards",
    "Read source rewards and verify a nonzero reward sample, preserving epoch and reward type",
    async () => {
      const sourceRewards = await queries.stakeRewards(stake, { count: 3 });
      const candidates = await queries.poolDelegators(await fixturePool(), {
        count: 3,
      });
      for (const candidate of candidates.items) {
        const result = await queries.stakeRewards(candidate.stakeAddress, {
          count: 3,
        });
        const reward = result.items.find((item) => BigInt(item.amount) > 0n);
        if (reward)
          return {
            sourceRewardCount: sourceRewards.items.length,
            nonzeroRewardVerified: true,
            sampleStakeSha256: digest(candidate.stakeAddress),
            epoch: reward.epoch,
            amount: reward.amount,
            type: reward.type,
            poolId: reward.poolId,
          };
      }
      throw new Error(
        "No nonzero reward fixture found among three sampled delegators",
      );
    },
  );
  await run(
    "pool-detail-boundary",
    "SDK pool validation stays disabled; independently record the deployed pool-detail HTTP status without treating it as SDK support",
    async () => {
      const pool = await fixturePool();
      await assert.rejects(() => sdk.getPoolInfo(pool), /does not support/);
      const response = await fetch(
        `${baseUrl}/pools/${encodeURIComponent(pool)}`,
        {
          headers: { "dmtr-api-key": apiKey },
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        },
      );
      await response.body?.cancel();
      return {
        poolId: pool,
        sdkPoolDetailsEnabled: false,
        backendDiagnosticOnly: true,
        deployedPoolDetailHttpStatus: response.status,
        diagnosticRequestCount: 1,
      };
    },
  );
};
main().catch(() => {
  console.error(
    "Indexed QA initialization failed; check the private Preview environment",
  );
  process.exitCode = 1;
});
