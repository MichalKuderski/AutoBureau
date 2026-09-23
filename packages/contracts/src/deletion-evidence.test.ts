import { describe, expect, it } from "vitest";
import { assessDeletionEvidence, DELETION_COMPONENTS } from "./deletion-evidence.js";
const requestId = "10000000-0000-4000-8000-000000000001", householdId = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-20T12:00:00Z");
const report = () => ({ version: 1, requestId, householdId, requestedAt: "2026-09-01T12:00:00Z", writesFencedAt: "2026-09-20T11:59:00Z",
  observations: DELETION_COMPONENTS.map(component => ({ component, requestId, householdId, evidenceId: requestId,
    observedAt: now.toISOString(), state: "absent", remaining: 0 })) });
describe("deletion evidence coverage and limits", () => {
  it("requires independent verification even when every online observation is absent", () => {
    expect(assessDeletionEvidence(report(), now)).toEqual({ status: "ready-for-independent-verification", receiptIssuable: false, gaps: [], retained: [] });
  });
  it.each(DELETION_COMPONENTS)("cannot omit %s from the deletion assessment", component => {
    const data = report(); data.observations = data.observations.filter(row => row.component !== component);
    expect(assessDeletionEvidence(data, now)).toMatchObject({ status: "incomplete", receiptIssuable: false, gaps: [component] });
  });
  it.each(["remaining", "unknown", "retained"])("refuses unsupported %s claims", state => {
    const data = report(); data.observations[0]!.state = state;
    expect(assessDeletionEvidence(data, now).status).toBe("incomplete");
  });
  it.each([
    { householdId: requestId }, { requestId: householdId }, { observedAt: "2026-09-20T12:01:00Z" },
    { observedAt: "2026-09-19T12:00:00Z" }, { remaining: 1 }, { remaining: -1 }, { filename: "private-canary" },
  ])("refuses mismatched, stale or malformed evidence %j", change => {
    const data = report(); Object.assign(data.observations[0]!, change);
    const result = assessDeletionEvidence(data, now);
    expect(result.status).toBe("incomplete"); expect(JSON.stringify(result)).not.toContain("private-canary");
  });
  it("rejects duplicate coverage and premature deletion before the undo period", () => {
    const data = report(); data.observations[1] = data.observations[0]!;
    expect(assessDeletionEvidence(data, now).status).toBe("incomplete");
    expect(assessDeletionEvidence({ ...report(), requestedAt: now.toISOString() }, now).status).toBe("incomplete");
  });
  it("discloses bounded backups without claiming full deletion; overdue retention needs fresh absence proof", () => {
    const data = report(); Object.assign(data.observations.at(-1)!, { state: "retained", remaining: 1,
      retention: { kind: "backup-expiry", until: "2026-10-20T12:00:00Z" } });
    expect(assessDeletionEvidence(data, now)).toMatchObject({ status: "ready-for-independent-verification", receiptIssuable: false, retained: ["backups"] });
    for (const until of ["2026-09-19T12:00:00Z", "2027-10-20T12:00:00Z"]) {
      Object.assign(data.observations.at(-1)!, { retention: { kind: "backup-expiry", until } });
      expect(assessDeletionEvidence(data, now).status).toBe("incomplete");
    }
  });
  it("cannot use retention as an exception for document content or identifier secrets", () => {
    for (const component of ["documents", "identifier-secrets", "quarantine", "outbox-delivery-inbox"]) {
      const data = report(); Object.assign(data.observations.find(row => row.component === component)!, {
        state: "retained", remaining: 1, retention: { kind: "security-hold", until: "2026-09-21T12:00:00Z" } });
      expect(assessDeletionEvidence(data, now).status).toBe("incomplete");
    }
  });
});
