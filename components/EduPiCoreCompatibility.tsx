"use client";

import type { WorkbenchView } from "@/lib/edupi-workbench";

export type CoreCompatibilitySnapshot = {
  expected: {
    coreCommit: string;
    componentManifestHash: string;
    runtimeComponentManifestHash: string;
    contractVersion: string;
    schemaHash: string;
    fixtureManifestHash: string;
    supportedCommands: string[];
    supportedProjections: string[];
    unsupportedCommandReasons: Record<string, string>;
    unsupportedProjectionReasons: Record<string, string>;
  };
  actual: {
    coreCommit?: string;
    componentManifestHash?: string;
    runtimeComponentManifestHash?: string;
    contractVersion?: string;
    schemaHash?: string;
    fixtureManifestHash?: string;
    supportedCommands?: string[];
    supportedProjections?: string[];
  } | null;
  reason?: string;
};

type Props = {
  value: CoreCompatibilitySnapshot | null | undefined;
  onNavigate: (view: WorkbenchView) => void;
  onOpenContext: () => void;
};

const COMMAND_LABELS: Record<string, string> = {
  review_observation: "审核观察",
  review_memory_candidate: "审核记忆候选",
  review_teacher_context: "审核教师上下文",
  review_work_candidate: "处理今日候选",
  review_task: "审核任务",
  import_calendar: "写入校历",
  import_timetable: "写入课表",
  intake_material: "接入材料",
  create_task: "创建任务",
  move_task_stage: "移动任务",
  update_memory: "修改记忆",
};

const COMMAND_ACTIONS: Record<string, { label: string; run: (props: Props) => void }> = {
  review_observation: { label: "打开审核", run: (props) => props.onNavigate("review") },
  review_memory_candidate: { label: "打开审核", run: (props) => props.onNavigate("review") },
  review_teacher_context: { label: "打开上下文", run: (props) => props.onOpenContext() },
  review_work_candidate: { label: "打开今日", run: (props) => props.onNavigate("dashboard") },
  review_task: { label: "打开任务", run: (props) => props.onNavigate("tasks") },
  import_calendar: { label: "打开日程", run: (props) => props.onNavigate("calendar") },
  import_timetable: { label: "打开日程", run: (props) => props.onNavigate("calendar") },
  intake_material: { label: "打开材料", run: (props) => props.onNavigate("materials") },
  create_task: { label: "打开工作区", run: (props) => props.onNavigate("workspace") },
  move_task_stage: { label: "打开工作区", run: (props) => props.onNavigate("workspace") },
  update_memory: { label: "打开记忆", run: (props) => props.onNavigate("memory") },
};

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function short(value: string | undefined, length = 16): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function identityMatches(value: CoreCompatibilitySnapshot): boolean {
  const actual = value.actual;
  if (!actual) return false;
  return actual.coreCommit === value.expected.coreCommit
    && actual.componentManifestHash === value.expected.componentManifestHash
    && actual.runtimeComponentManifestHash === value.expected.runtimeComponentManifestHash
    && actual.contractVersion === value.expected.contractVersion
    && actual.schemaHash === value.expected.schemaHash
    && actual.fixtureManifestHash === value.expected.fixtureManifestHash;
}

export function EduPiCoreCompatibility({ value, onNavigate, onOpenContext }: Props) {
  if (!value) return null;
  const actual = value.actual;
  const commandsMatch = Boolean(actual && sameList(actual.supportedCommands, value.expected.supportedCommands));
  const projectionsMatch = Boolean(actual && sameList(actual.supportedProjections, value.expected.supportedProjections));
  const runtimeConnected = typeof actual?.runtimeComponentManifestHash === "string";
  const matched = identityMatches(value) && commandsMatch && projectionsMatch;
  const status = !actual || !runtimeConnected ? "未连接" : matched ? "已匹配" : "版本不匹配";
  const summary = value.reason || (matched ? "版本与能力一致" : runtimeConnected ? "桌面端与 Core 配置不一致" : "Core Runtime 未连接");
  const actionProps = { value, onNavigate, onOpenContext };

  return <section className="edupi-core-compatibility" aria-labelledby="edupi-core-compatibility-title">
    <header className="edupi-core-compatibility__header">
      <div><h2 id="edupi-core-compatibility-title">Core 兼容性</h2><span>{summary}</span></div>
      <strong className={`is-${matched ? "ready" : runtimeConnected ? "warning" : "unavailable"}`}>{status}</strong>
    </header>
    <div className="edupi-core-compatibility__identity">
      <div><span>Core</span><code title={actual?.coreCommit || value.expected.coreCommit}>{short(actual?.coreCommit || value.expected.coreCommit, 12)}</code></div>
      <div><span>合同</span><code>{actual?.contractVersion || value.expected.contractVersion}</code></div>
      <div><span>组件清单</span><code title={actual?.componentManifestHash || value.expected.componentManifestHash}>{short(actual?.componentManifestHash || value.expected.componentManifestHash, 18)}</code></div>
      <div><span>Runtime 清单</span><code title={actual?.runtimeComponentManifestHash || value.expected.runtimeComponentManifestHash}>{short(actual?.runtimeComponentManifestHash || value.expected.runtimeComponentManifestHash, 18)}</code></div>
    </div>
    <details>
      <summary>可交互能力 <span>{actual?.supportedCommands?.length || 0} / {value.expected.supportedCommands.length}</span></summary>
      <div className="edupi-core-compatibility__commands">
        {value.expected.supportedCommands.map((command) => {
          const supported = Boolean(actual?.supportedCommands?.includes(command));
          const action = COMMAND_ACTIONS[command];
          return supported && action
            ? <button type="button" key={command} onClick={() => action.run(actionProps)}><span><i aria-hidden="true" />{COMMAND_LABELS[command] || command}</span><em>{action.label} ↗</em></button>
            : <div key={command} className="is-unavailable"><span><i aria-hidden="true" />{COMMAND_LABELS[command] || command}</span><em>{actual ? "未启用" : "待连接"}</em></div>;
        })}
      </div>
    </details>
    <details>
      <summary>未接入能力 <span>{Object.keys(value.expected.unsupportedCommandReasons).length}</span></summary>
      <div className="edupi-core-compatibility__unsupported">{Object.entries(value.expected.unsupportedCommandReasons).map(([command, reason]) => <p key={command}><strong>{command}</strong><span>{reason}</span></p>)}</div>
    </details>
    <details>
      <summary>未接入投影 <span>{Object.keys(value.expected.unsupportedProjectionReasons).length}</span></summary>
      <div className="edupi-core-compatibility__unsupported">{Object.entries(value.expected.unsupportedProjectionReasons).map(([projection, reason]) => <p key={projection}><strong>{projection}</strong><span>{reason}</span></p>)}</div>
    </details>
    <div className="edupi-core-compatibility__projection"><span>投影</span>{value.expected.supportedProjections.map((projection) => <em key={projection} className={projectionsMatch ? "is-ready" : ""}>{projection}</em>)}</div>
  </section>;
}
