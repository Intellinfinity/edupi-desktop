import type { EducationContract } from "./edupi-education-contract";

export type EduPiOperationHistoryRow = { id: string; action: string; status: string; at: string | null; note: string | null };

const actionLabels: Record<string, string> = {
  import_calendar: "写入校历",
  import_timetable: "写入课表",
  intake_material: "接入材料",
};

export function intakeOperationHistory(data: EducationContract, commandType: "import_calendar" | "import_timetable" | "intake_material", targetId: string): EduPiOperationHistoryRow[] {
  const historyByReceipt = new Map(data.intakeReviewHistory.filter((item) => item.receiptId).map((item) => [item.receiptId!, item]));
  const rows = data.intakeReceipts.filter((receipt) => receipt.commandType === commandType && receipt.appliedIds.includes(targetId)).map((receipt) => {
    const history = historyByReceipt.get(receipt.receiptId);
    return { id: history?.reviewId || receipt.receiptId, action: actionLabels[commandType], status: history?.status || receipt.status, at: history?.reviewedAt || history?.teacherReview.reviewedAt || receipt.createdAt || receipt.teacherReview.reviewedAt, note: history?.teacherReview.note || receipt.teacherReview.note };
  });
  return rows.sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")) || right.id.localeCompare(left.id));
}
