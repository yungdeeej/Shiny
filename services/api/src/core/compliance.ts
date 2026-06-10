/**
 * Pluggable compliance hook (doc 04). Jurisdiction/access control is an external
 * concern — the game only calls `check(user, action)` before gated actions.
 * Default provider allows everything; swap via buildContext options or tests.
 */
export type ComplianceAction = "deposit" | "play" | "withdraw";

export interface ComplianceUser {
  id: string;
  role: "player" | "admin";
  isGuest: boolean;
}

export interface ComplianceProvider {
  check(user: ComplianceUser, action: ComplianceAction): Promise<"allow" | "deny">;
}

export class AllowAllComplianceProvider implements ComplianceProvider {
  async check(): Promise<"allow"> {
    return "allow";
  }
}

export class DenyAllComplianceProvider implements ComplianceProvider {
  async check(): Promise<"deny"> {
    return "deny";
  }
}
