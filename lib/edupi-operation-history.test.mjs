import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { intakeOperationHistory } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-operation-history.ts");

test("projects only the selected Core intake target and avoids receipt duplicates", () => {
  const target = { targetKind: "calendar_import", targetId: "calendar-import-1", commandType: "import_calendar" };
  const teacherReview = { state: "accepted", reviewerId: "teacher", reviewedAt: "2026-09-14T02:00:00.000Z", note: "修正日期", revision: 1 };
  const data = {
    intakeReviewHistory: [{ reviewId: "history-1", commandType: "import_calendar", target, decision: "import", revision: 1, status: "accepted", evidenceIds: [], receiptId: "receipt-1", beforeSnapshotId: "before", afterSnapshotId: "after", beforeStateHash: "sha256:before", afterStateHash: "sha256:after", teacherReview, rollback: { available: false, rollbackId: null, expiresAt: null }, externalSend: false, reviewedAt: teacherReview.reviewedAt }],
    intakeReceipts: [
      { receiptId: "receipt-1", commandType: "import_calendar", target, appliedIds: ["event-1"], status: "accepted", createdAt: teacherReview.reviewedAt, teacherReview },
      { receiptId: "receipt-2", commandType: "import_calendar", target: { ...target, targetId: "calendar-import-2" }, appliedIds: ["event-2"], status: "accepted", createdAt: teacherReview.reviewedAt, teacherReview },
    ],
  };
  assert.deepEqual(intakeOperationHistory(data, "import_calendar", "event-1"), [{ id: "history-1", action: "写入校历", status: "accepted", at: teacherReview.reviewedAt, note: "修正日期" }]);
});
