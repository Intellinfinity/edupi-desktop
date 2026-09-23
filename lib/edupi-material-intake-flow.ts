import { issueEducationIntake, type EducationIntakeCommand, type MaterialIntake } from "./edupi-education-intake";
import { MaterialRecognitionError, recognizeStagedMaterial, type MaterialRecognitionResult } from "./edupi-material-recognition";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";
import { markRecognizedTimetableNote } from "./edupi-recognition-markers";
import { stableCalendarEventId, stableFileScheduleIssuer, stableOccurrenceCalendarEventId, stableRecognizedCalendarEventId, stableRecognizedTimetableSlotId, stableTimetableSlotId } from "./edupi-schedule-upload";

type RawRecord = Record<string, unknown>;

type FlowInput = {
  descriptor: MaterialStagingDescriptor;
  scheduleSourceId?: string;
  title?: string;
  materialKind: MaterialIntake["kind"];
  subject: string | null;
  classId: string | null;
  recognize?: boolean;
};

type IssueResult = { receipt: RawRecord; data: unknown };

function distinctRecognized<T>(items: T[], idOf: (item: T) => string): T[] {
  const seen = new Map<string, string>();
  return items.filter((item) => {
    const id = idOf(item);
    const content = JSON.stringify(item);
    const previous = seen.get(id);
    if (previous !== undefined && previous !== content) {
      throw new MaterialRecognitionError("ambiguous_schedule", "识别到同名同日的不同安排，请核对原文件后再导入。");
    }
    seen.set(id, content);
    return previous === undefined;
  });
}

type FlowDependencies = {
  recognize?: (descriptor: MaterialStagingDescriptor) => Promise<MaterialRecognitionResult>;
  issue?: (command: EducationIntakeCommand) => Promise<IssueResult>;
};

export async function intakeRecognizedMaterial(input: FlowInput, dependencies: FlowDependencies = {}): Promise<{
  receipts: RawRecord[];
  data: unknown;
  recognition: { eventCount: number; slotCount: number };
  scheduleNeedsReview: boolean;
  calendarOccurrences: Array<{ sourceOccurrenceRef: string; eventId: string }>;
  cancelledOccurrenceRefs: string[];
}> {
  const recognize = dependencies.recognize || ((descriptor: MaterialStagingDescriptor) => {
    let index = 0;
    return recognizeStagedMaterial(descriptor, { idFactory: () => `recognized-${descriptor.staging_id.slice("stg_".length)}-${++index}` });
  });
  const issue = dependencies.issue || issueEducationIntake;
  const recognized = input.recognize === false ? { events: [], slots: [] } : await recognize(input.descriptor);
  const scheduleSourceId = input.scheduleSourceId || stableFileScheduleIssuer(input.descriptor.original_name, input.descriptor.source_hash);
  const baseEvents = distinctRecognized(recognized.events.map((event) => ({ ...event,
    event_id: event.source_occurrence_ref
      ? stableOccurrenceCalendarEventId(scheduleSourceId, event.source_occurrence_ref)
      : event.time_interval
        ? stableRecognizedCalendarEventId({ date: event.date, endDate: event.end_date, name: event.name, type: event.type,
          notes: event.notes, timeInterval: event.time_interval, location: event.location })
        : stableCalendarEventId({ date: event.date, endDate: event.end_date, name: event.name, type: event.type }),
  })), (event) => event.event_id);
  const events = baseEvents.map((event) => event.source_occurrence_ref ? event : ({ ...event,
    event_id: stableRecognizedCalendarEventId({ date: event.date, endDate: event.end_date, name: event.name, type: event.type,
      notes: event.notes, timeInterval: event.time_interval, location: event.location }),
  }));
  if (input.descriptor.kind === "calendar" && events.some((event) => !event.source_occurrence_ref)) {
    throw new MaterialRecognitionError("invalid_output", "ICS 日历缺少稳定事项身份。");
  }
  const baseSlots = distinctRecognized(recognized.slots.map((slot) => ({ ...slot,
    slot_id: stableTimetableSlotId({ dayOfWeek: slot.day_of_week, period: slot.period, subject: slot.subject, className: slot.class_name, kind: slot.kind }),
  })), (slot) => slot.slot_id);
  const slots = baseSlots.map((slot) => ({ ...slot,
    slot_id: stableRecognizedTimetableSlotId({ dayOfWeek: slot.day_of_week, period: slot.period, subject: slot.subject, className: slot.class_name, kind: slot.kind, notes: slot.notes }),
  }));
  const materialSource = {
    source_id: input.descriptor.kind === "calendar"
      ? `calendar-evidence-${input.descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`
      : input.descriptor.staging_id,
    source_kind: "teacher_file" as const,
    source_hash: input.descriptor.source_hash,
    evidence_ids: [input.descriptor.staging_id],
  };
  const scheduleSource = {
    ...materialSource,
    source_id: scheduleSourceId,
    evidence_ids: [input.descriptor.kind === "calendar" ? materialSource.source_id
      : `schedule-evidence-${input.descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`],
  };
  const commands: EducationIntakeCommand[] = [{
    command_type: "intake_material",
    source: materialSource,
    material: {
      material_id: input.descriptor.kind === "calendar" ? materialSource.source_id
        : `material-${input.descriptor.staging_id.slice("stg_".length)}`,
      staging_id: input.descriptor.staging_id,
      staging_path: input.descriptor.staging_path,
      source_path: null,
      source_hash: input.descriptor.source_hash,
      expected_size_bytes: input.descriptor.expected_size_bytes,
      kind: input.materialKind,
      title: input.descriptor.kind === "calendar" ? `ICS 日历来源 ${input.descriptor.source_hash.slice("sha256:".length, "sha256:".length + 8)}`
        : input.title?.trim() || input.descriptor.original_name,
      subject: input.subject,
      class_id: input.classId,
      source_scope: "desktop_staging",
    },
  }];
  if (events.length > 0) commands.push({ command_type: "import_calendar", source: scheduleSource, events });
  if (slots.length > 0) commands.push({
    command_type: "import_timetable",
    source: scheduleSource,
    slots: slots.map((slot) => ({ ...slot, notes: markRecognizedTimetableNote(slot.notes) })),
  });

  const receipts: RawRecord[] = [];
  let data: unknown = null;
  for (const command of commands) {
    const result = await issue(command);
    receipts.push(result.receipt);
    data = result.data;
  }
  return {
    receipts,
    data,
    recognition: { eventCount: events.length, slotCount: slots.length },
    scheduleNeedsReview: receipts.slice(1).some((receipt) => !["accepted", "modified"].includes(String(receipt.status))
      || Array.isArray(receipt.rejected_ids) && receipt.rejected_ids.length > 0),
    calendarOccurrences: events.flatMap((event) => event.source_occurrence_ref
      ? [{ sourceOccurrenceRef: event.source_occurrence_ref, eventId: event.event_id }]
      : []),
    cancelledOccurrenceRefs: [...(recognized.cancelled_occurrence_refs || [])],
  };
}
