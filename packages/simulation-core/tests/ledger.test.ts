import { describe, expect, it } from "vitest";
import {
  createAccount,
  createLedgerWorld,
  credit,
  getBalance,
  totalAssetBalanceCents,
  transfer
} from "../src/ledger/index.js";

describe("ledger", () => {
  it("creates accounts and transfers cash with conservation", () => {
    const ledger = createLedgerWorld();
    createAccount(ledger, "a", 1000);
    createAccount(ledger, "b", 0);
    transfer(ledger, "a", "b", 400);
    expect(getBalance(ledger, "a")).toBe(600);
    expect(getBalance(ledger, "b")).toBe(400);
    expect(totalAssetBalanceCents(ledger)).toBe(1000);
  });

  it("rejects overdraft and duplicate ids", () => {
    const ledger = createLedgerWorld();
    createAccount(ledger, "a", 10);
    expect(() => transfer(ledger, "a", "missing", 1)).toThrow(/Unknown ledger account/);
    createAccount(ledger, "b");
    expect(() => transfer(ledger, "a", "b", 11)).toThrow(/Insufficient funds/);
    expect(() => createAccount(ledger, "a")).toThrow(/already exists/);
  });

  it("credits external funding into an account", () => {
    const ledger = createLedgerWorld();
    createAccount(ledger, "pool", 0);
    credit(ledger, "pool", 50);
    expect(getBalance(ledger, "pool")).toBe(50);
  });
});
