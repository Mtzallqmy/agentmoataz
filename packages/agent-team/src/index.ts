/**
 * agent-team — bounded multi-agent coordination.
 *
 * Roles: MANAGER (delegates/integrates), PLANNER (task graph), CODER
 * (file mutation), RESEARCHER (read-only), REVIEWER (diff/correctness gate),
 * MEDIA (routing, post-MVP).
 *
 * Delegations and sub-agent results are persisted as structured records.
 * Concurrency and depth are bounded; no uncontrolled self-spawn.
 */
import type { StructuredError } from "@agentmoataz/agent-protocol";
import { portableCrypto, type CryptoAdapter } from "@agentmoataz/agent-platform";

export type AgentRole = "MANAGER" | "PLANNER" | "CODER" | "RESEARCHER" | "REVIEWER" | "MEDIA";

export interface Delegation {
  id: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  instruction: string;
  status: "pending" | "completed" | "rejected" | "failed";
  result?: string;
  rejectionReason?: string;
  error?: StructuredError;
  createdAt: string;
}

export interface TeamLimits {
  maxDelegationsPerRun: number;
  maxDepth: number;
}

const DEFAULT_LIMITS: TeamLimits = { maxDelegationsPerRun: 12, maxDepth: 2 };

export interface ReviewInput {
  /** Unified diff or summary of changes. */
  changes: string;
  acceptanceCriteria: string[];
}

export interface ReviewVerdict {
  approved: boolean;
  issues: string[];
}

export type ReviewerFn = (input: ReviewInput) => Promise<ReviewVerdict> | ReviewVerdict;

export class AgentTeam {
  private delegations: Delegation[] = [];
  private seq = 0;
  private limits: TeamLimits;
  private reviewer: ReviewerFn;
  private crypto: CryptoAdapter;

  constructor(options?: { limits?: Partial<TeamLimits>; reviewer?: ReviewerFn; crypto?: CryptoAdapter }) {
    this.limits = { ...DEFAULT_LIMITS, ...(options?.limits ?? {}) };
    this.reviewer =
      options?.reviewer ??
      ((input) => ({
        approved:
          input.acceptanceCriteria.length === 0 ||
          input.changes.trim().length > 0,
        issues: [],
      }));
    this.crypto = options?.crypto ?? portableCrypto;
  }

  get auditTrail(): readonly Delegation[] {
    return this.delegations;
  }

  delegate(fromRole: AgentRole, toRole: AgentRole, instruction: string, depth = 0): Delegation {
    if (this.delegations.length >= this.limits.maxDelegationsPerRun) {
      const d: Delegation = {
        id: `del-${Date.now()}-${++this.seq}`,
        fromRole,
        toRole,
        instruction,
        status: "failed",
        error: {
          code: "CAPABILITY_UNAVAILABLE",
          category: "capability",
          message: `delegation budget exhausted (${this.limits.maxDelegationsPerRun})`,
          recoverable: false,
          retryable: false,
        },
        createdAt: new Date().toISOString(),
      };
      this.delegations.push(d);
      return d;
    }
    if (depth > this.limits.maxDepth) {
      const d: Delegation = {
        id: `del-${Date.now()}-${++this.seq}`,
        fromRole,
        toRole,
        instruction,
        status: "failed",
        error: {
          code: "CAPABILITY_UNAVAILABLE",
          category: "capability",
          message: `delegation depth limit (${this.limits.maxDepth}) exceeded`,
          recoverable: false,
          retryable: false,
        },
        createdAt: new Date().toISOString(),
      };
      this.delegations.push(d);
      return d;
    }
    const d: Delegation = {
      id: this.crypto.randomId("del"),
      fromRole,
      toRole,
      instruction,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.delegations.push(d);
    return d;
  }

  complete(id: string, result: string): void {
    const d = this.require(id);
    d.status = "completed";
    d.result = result;
  }

  reject(id: string, reason: string): void {
    const d = this.require(id);
    d.status = "rejected";
    d.rejectionReason = reason;
  }

  fail(id: string, error: StructuredError): void {
    const d = this.require(id);
    d.status = "failed";
    d.error = error;
  }

  /** REVIEWER gate — must pass before a run may complete. */
  async review(input: ReviewInput): Promise<ReviewVerdict> {
    return this.reviewer(input);
  }

  private require(id: string): Delegation {
    const d = this.delegations.find((x) => x.id === id);
    if (!d) throw new Error(`unknown delegation ${id}`);
    return d;
  }

  static strictReviewer(criteriaThreshold = 1): ReviewerFn {
    return (input) => {
      const issues: string[] = [];
      if (!input.changes || input.changes.trim().length < criteriaThreshold * 10) {
        issues.push("no substantive changes found");
      }
      for (let i = 0; i < input.acceptanceCriteria.length; i++) {
        const c = input.acceptanceCriteria[i]!;
        if (c.startsWith("FAIL:") || c.toLowerCase().includes("missing")) {
          issues.push(`acceptance criterion not met: ${c}`);
        }
      }
      if (/TODO|FIXME/.test(input.changes)) {
        issues.push("unresolved TODO/FIXME markers in changes");
      }
      return { approved: issues.length === 0, issues };
    };
  }
}
