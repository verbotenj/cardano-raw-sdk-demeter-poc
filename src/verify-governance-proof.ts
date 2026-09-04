import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyGovernanceReceipt } from "./governance-proof.js";

const receiptPath = resolve(
  process.argv[2] || "examples/simulated-fireblocks-governance-receipt.json",
);
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
const result = verifyGovernanceReceipt(receipt);

console.log(`Governance receipt verified: ${receiptPath}`);
console.log(JSON.stringify(result, null, 2));
