export type MaterialRecognitionSummary = {
  eventCount: number;
  slotCount: number;
  ocrStatus?: "trusted" | "unavailable";
};

export function materialRecognitionSummary(result: MaterialRecognitionSummary): string {
  if (result.ocrStatus === "unavailable") return "，文字识别未完成，无法判断是否含日程或课表";
  if (result.eventCount + result.slotCount > 0) {
    return `，识别到 ${result.eventCount} 条日程、${result.slotCount} 条课表`;
  }
  return result.ocrStatus === "trusted" ? "，已识别文字中没有可确认的日程或课表" : "，未发现日程或课表";
}
