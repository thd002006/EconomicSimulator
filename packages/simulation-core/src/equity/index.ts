import { credit, debit, type LedgerWorld } from "../ledger/index.js";
import type {
  CompanyId,
  EquityAccountResolver,
  EquityState,
  EquityWorld,
  IssueSharesCommand,
  ShareIssuerRef,
  ShareholderRef,
  SharePositionState,
  SharesIssuedEvent
} from "./types.js";

export type {
  CompanyId,
  CountryId,
  EquityAccountResolver,
  EquityState,
  EquityWorld,
  IssueSharesCommand,
  OperatingUnitId,
  ProvinceId,
  ShareIssuerRef,
  ShareholderRef,
  SharePositionState,
  SharesIssuedEvent,
  SocialClassId,
  Tick
} from "./types.js";

export function createEquityWorld(): EquityWorld {
  return {
    equityByIssuer: new Map(),
    positions: new Map()
  };
}

export function issuerKey(issuer: ShareIssuerRef): string {
  return issuer.kind === "company"
    ? `company:${issuer.companyId}`
    : `operating_unit:${issuer.operatingUnitId}`;
}

export function shareholderKey(shareholder: ShareholderRef): string {
  if (shareholder.kind === "population_class") {
    return `population_class:${shareholder.provinceId}:${shareholder.socialClassId}`;
  }
  if (shareholder.kind === "government") {
    return `government:${shareholder.countryId}`;
  }
  return `company:${shareholder.companyId}`;
}

export function positionKey(issuer: ShareIssuerRef, shareholder: ShareholderRef): string {
  return `${issuerKey(issuer)}|${shareholderKey(shareholder)}`;
}

export function getEquityState(
  equity: EquityWorld,
  issuer: ShareIssuerRef
): EquityState | undefined {
  return equity.equityByIssuer.get(issuerKey(issuer));
}

export function getSharePosition(
  equity: EquityWorld,
  issuer: ShareIssuerRef,
  shareholder: ShareholderRef
): SharePositionState | undefined {
  return equity.positions.get(positionKey(issuer, shareholder));
}

export function getShareholders(
  equity: EquityWorld,
  issuer: ShareIssuerRef
): readonly SharePositionState[] {
  const prefix = `${issuerKey(issuer)}|`;
  const result: SharePositionState[] = [];
  for (const [key, position] of equity.positions) {
    if (key.startsWith(prefix)) {
      result.push(position);
    }
  }
  result.sort((a, b) => shareholderKey(a.shareholder).localeCompare(shareholderKey(b.shareholder)));
  return result;
}

export function ownershipShare(
  equity: EquityWorld,
  issuer: ShareIssuerRef,
  shareholder: ShareholderRef
): number {
  const state = getEquityState(equity, issuer);
  if (state === undefined || state.totalSharesOutstanding <= 0) {
    return 0;
  }
  const position = getSharePosition(equity, issuer, shareholder);
  if (position === undefined) {
    return 0;
  }
  return position.sharesOwned / state.totalSharesOutstanding;
}

/** Returns majority shareholder when one holds more than 50%, otherwise null. */
export function getMajorityShareholder(
  equity: EquityWorld,
  issuer: ShareIssuerRef
): ShareholderRef | null {
  const state = getEquityState(equity, issuer);
  if (state === undefined || state.totalSharesOutstanding <= 0) {
    return null;
  }
  const threshold = state.totalSharesOutstanding / 2;
  for (const position of getShareholders(equity, issuer)) {
    if (position.sharesOwned > threshold) {
      return position.shareholder;
    }
  }
  return null;
}

/** Company→Company ownership edges: owner companyId → owned companyId. */
export function listCompanyOwnershipEdges(
  equity: EquityWorld
): ReadonlyArray<readonly [CompanyId, CompanyId]> {
  const edges: Array<readonly [CompanyId, CompanyId]> = [];
  for (const position of equity.positions.values()) {
    if (position.issuer.kind !== "company" || position.shareholder.kind !== "company") {
      continue;
    }
    if (position.sharesOwned <= 0) {
      continue;
    }
    edges.push([position.shareholder.companyId, position.issuer.companyId]);
  }
  return edges;
}

function companyOwnsReachable(
  equity: EquityWorld,
  fromCompanyId: CompanyId,
  targetCompanyId: CompanyId
): boolean {
  const stack = [fromCompanyId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === targetCompanyId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const [owner, owned] of listCompanyOwnershipEdges(equity)) {
      if (owner === current) {
        stack.push(owned);
      }
    }
  }
  return false;
}

/** Reject if subscriber company already reaches issuer (would create a cycle), or self-hold. */
export function wouldCreateCompanyOwnershipCycle(
  equity: EquityWorld,
  issuer: ShareIssuerRef,
  subscriber: ShareholderRef
): boolean {
  if (issuer.kind !== "company" || subscriber.kind !== "company") {
    return false;
  }
  if (issuer.companyId === subscriber.companyId) {
    return true;
  }
  // Edge subscriber → issuer. Cycle if issuer can already reach subscriber.
  return companyOwnsReachable(equity, issuer.companyId, subscriber.companyId);
}

export function issueShares(
  equity: EquityWorld,
  ledger: LedgerWorld,
  accounts: EquityAccountResolver,
  command: IssueSharesCommand
): SharesIssuedEvent {
  if (command.kind !== "issue-shares") {
    throw new Error("Invalid issue-shares command.");
  }
  if (!Number.isSafeInteger(command.sharesToIssue) || command.sharesToIssue <= 0) {
    throw new Error("sharesToIssue must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(command.totalSubscriptionPriceCents) ||
    command.totalSubscriptionPriceCents < 0
  ) {
    throw new Error("totalSubscriptionPriceCents must be a non-negative safe integer.");
  }
  if (wouldCreateCompanyOwnershipCycle(equity, command.issuer, command.subscriber)) {
    throw new Error("Company ownership cycle or self-hold is not allowed.");
  }

  const subscriberCash = accounts.getCashAccount(command.subscriber);
  const subscriberInvestments = accounts.getInvestmentAccount(command.subscriber);
  const issuerCash = accounts.getIssuerCashAccount(command.issuer);
  const issuerCapital = accounts.getIssuerContributedCapitalAccount(command.issuer);

  const key = issuerKey(command.issuer);
  let state = equity.equityByIssuer.get(key);
  if (state === undefined) {
    state = { issuer: command.issuer, totalSharesOutstanding: 0 };
    equity.equityByIssuer.set(key, state);
  }

  const price = command.totalSubscriptionPriceCents;
  if (price > 0) {
    // Cash moves to issuer; subscriber reclassifies cash into investments; issuer books capital.
    debit(ledger, subscriberCash, price);
    credit(ledger, issuerCash, price);
    credit(ledger, subscriberInvestments, price);
    credit(ledger, issuerCapital, price);
  }

  state.totalSharesOutstanding += command.sharesToIssue;

  const posKey = positionKey(command.issuer, command.subscriber);
  const existing = equity.positions.get(posKey);
  if (existing) {
    existing.sharesOwned += command.sharesToIssue;
    existing.lastChangedTick = command.tick;
  } else {
    equity.positions.set(posKey, {
      issuer: command.issuer,
      shareholder: command.subscriber,
      sharesOwned: command.sharesToIssue,
      lastChangedTick: command.tick
    });
  }

  return {
    kind: "shares-issued",
    commandId: command.commandId,
    issuer: command.issuer,
    subscriber: command.subscriber,
    sharesIssued: command.sharesToIssue,
    totalSubscriptionPriceCents: command.totalSubscriptionPriceCents,
    tick: command.tick
  };
}
