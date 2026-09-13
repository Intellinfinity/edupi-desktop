import { issueEducationIntake, type EducationIntakeCommand, type MaterialIntake } from "./edupi-education-intake";
import { recognizeStagedMaterial, type MaterialRecognitionResult } from "./edupi-material-recognition";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";
import { markRecognizedTimetableNote } from "./edupi-recognition-markers";

type RawRecord = Record<string, unknown>;

type FlowInput = {
  descriptor: MaterialStagingDescriptor;
  title?: string;
  materialKind: MaterialIntake["kind"];
  subject: string | null;
  classId: string | null;
  recognize?: boolean;
};

type IssueResult = { receipt: RawRecord; data: unknown };

type FlowDependencies = {
  recognize?: (descriptor: MaterialStagingDescriptor) => Promise<MaterialRecognitionResult>;
  issue?: (command: EducationIntakeCommand) => Promise<IssueResult>;
};

export async function intakeRecognizedMaterial(input: FlowInput, dependencies: FlowDependencies = {}): Promise<{
  receipts: RawRecord[];
  data: unknown;
  recognition: { eventCount: number; slotCount: number };
}> {
  const recognize = dependencies.recognize || ((descriptor: MaterialStagingDescriptor) => {
    let index = 0;
    return recognizeStagedMaterial(descriptor, { idFactory: () => `recognized-${descriptor.staging_id.slice("stg_".length)}-${++index}` });
  });
  const issue = dependencies.issue || issueEducationIntake;
  const recognized = input.recognize === false ? { events: [], slots: [] } : await recognize(input.descriptor);
  const source = {
    source_id: input.descriptor.staging_id,
    source_kind: "teacher_file" as const,
    source_hash: input.descriptor.source_hash,
    evidence_ids: [input.descriptor.staging_id],
  };
  const commands: EducationIntakeCommand[] = [{
    command_type: "intake_material",
    source,
    material: {
      material_id: `material-${input.descriptor.staging_id.slice("stg_".length)}`,
      staging_id: input.descriptor.staging_id,
      staging_path: input.descriptor.staging_path,
      source_path: null,
      source_hash: input.descriptor.source_hash,
      expected_size_bytes: input.descriptor.expected_size_bytes,
      kind: input.materialKind,
      title: input.title?.trim() || input.descriptor.original_name,
      subject: input.subject,
      class_id: input.classId,
      source_scope: "desktop_staging",
    },
  }];
  if (recognized.events.length > 0) commands.push({ command_type: "import_calendar", source, events: recognized.events });
  if (recognized.slots.length > 0) commands.push({
    command_type: "import_timetable",
    source,
    slots: recognized.slots.map((slot) => ({ ...slot, notes: markRecognizedTimetableNote(slot.notes) })),
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
    recognition: { eventCount: recognized.events.length, slotCount: recognized.slots.length },
  };
}
