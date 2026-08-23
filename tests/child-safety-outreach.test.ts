import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type OutreachTarget = {
  organization: string;
  officialContact: string;
  officialSource: string;
  status: string;
};

type OutreachConfig = {
  sender: string;
  sendGate: {
    resendDomainMustBeVerified: boolean;
    replyMailboxMustBeOperational: boolean;
    personalEmailAllowed: boolean;
    currentState: string;
  };
  policy: {
    noChildPersonalData: boolean;
    noCsamAttachmentsOrForwarding: boolean;
  };
  targets: OutreachTarget[];
};

function config(): OutreachConfig {
  return JSON.parse(
    readFileSync("ops/child-safety-outreach.json", "utf8"),
  ) as OutreachConfig;
}

describe("child safety institutional outreach", () => {
  it("never falls back to a personal sender and requires an operational branded mailbox", () => {
    const value = config();
    expect(value.sender).toBe("info@xguardgate.com");
    expect(value.sendGate.personalEmailAllowed).toBe(false);
    expect(value.sendGate.resendDomainMustBeVerified).toBe(true);
    expect(value.sendGate.replyMailboxMustBeOperational).toBe(true);
    expect(value.sendGate.currentState).toBe("blocked_pending_dns_verification");
  });

  it("forbids child case data and abuse-material attachments in outreach", () => {
    const value = config();
    expect(value.policy.noChildPersonalData).toBe(true);
    expect(value.policy.noCsamAttachmentsOrForwarding).toBe(true);
  });

  it("requires an official source for every first-wave target", () => {
    const value = config();
    expect(value.targets.length).toBeGreaterThanOrEqual(6);
    for (const target of value.targets) {
      expect(target.organization.length).toBeGreaterThan(2);
      expect(target.officialContact.length).toBeGreaterThan(5);
      expect(target.officialSource.startsWith("https://")).toBe(true);
      expect(target.status).toContain("pending");
    }
  });
});
