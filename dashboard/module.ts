import type {
  CreatedDashboard,
  Dashboard,
  DashboardChange,
  DashboardChild,
  DashboardEditOutcome,
  DashboardError,
  DashboardModule,
  DashboardOperationResult,
  DashboardResult,
  DashboardSummary,
  DashboardWidgetArtifact,
} from './types.js';

export interface DashboardPort {
  read(dashboardId: string): Promise<DashboardResult<Dashboard>>;
  findByTitle(name: string): Promise<DashboardResult<readonly DashboardSummary[]>>;
  create(input: {
    name: string;
    widgets: readonly DashboardWidgetArtifact[];
  }): Promise<DashboardResult<CreatedDashboard>>;
  removeChild(input: { dashboardId: string; childId: string }): Promise<DashboardResult<void>>;
  addWidget(input: {
    dashboardId: string;
    widget: DashboardWidgetArtifact;
    rank?: number;
  }): Promise<DashboardResult<void>>;
  createSection(input: {
    dashboardId: string;
    name: string;
    childIds: readonly string[];
  }): Promise<DashboardResult<{ sectionId?: string }>>;
  deleteSection(input: { dashboardId: string; sectionId: string }): Promise<DashboardResult<void>>;
  setSectionChildren(input: {
    dashboardId: string;
    sectionId: string;
    childIds: readonly string[];
  }): Promise<DashboardResult<void>>;
  setSectionRank(input: {
    dashboardId: string;
    sectionId: string;
    rank: number;
  }): Promise<DashboardResult<void>>;
}

function validWidgetArtifact(
  widget: DashboardWidgetArtifact,
): boolean {
  return widget.widgetId.trim().length > 0
    && (widget.configurationId === undefined || widget.configurationId.trim().length > 0)
    && (widget.selectedContext === undefined || widget.selectedContext.trim().length > 0);
}

function mutationOrder(change: DashboardChange): number {
  if (change.kind === 'remove-child' || change.kind === 'remove-section') return 0;
  if (change.kind === 'add-widget') return 1;
  if (change.kind === 'add-section') return 2;
  return 3;
}

function matchingWidgetChildren(
  dashboard: Dashboard,
  widget: DashboardWidgetArtifact,
): DashboardChild[] {
  return dashboard.children.filter((child) => (
    child.kind === 'widget' &&
    child.widget.widgetId === widget.widgetId &&
    child.widget.configurationId === widget.configurationId
  ));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function invalidMutation(reason: string): DashboardResult<never> {
  return { ok: false, error: { kind: 'invalid-mutation', reason } };
}

function validateRemoveChild(
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'remove-child' }>,
): DashboardResult<void> {
  if (!dashboard.children.some(({ childId }) => childId === change.childId)) {
    return invalidMutation(`Dashboard Child ${change.childId} is missing from Dashboard ${dashboard.dashboardId}`);
  }
  if (!change.sectionId) return { ok: true, value: undefined };
  const section = dashboard.sections.find(({ sectionId }) => sectionId === change.sectionId);
  if (!section) return invalidMutation(`Section ${change.sectionId} is missing from Dashboard ${dashboard.dashboardId}`);
  return section.childIds.includes(change.childId)
    ? { ok: true, value: undefined }
    : invalidMutation(`Dashboard Child ${change.childId} is not in Section ${change.sectionId}`);
}

function validateAddWidget(
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'add-widget' }>,
): DashboardResult<void> {
  if (!validWidgetArtifact(change.widget)) {
    return { ok: false, error: { kind: 'invalid-widget', widget: change.widget } };
  }
  if (change.childId) {
    const child = dashboard.children.find(({ childId }) => childId === change.childId);
    if (!child) {
      return invalidMutation(`Dashboard Child ${change.childId} is missing from Dashboard ${dashboard.dashboardId}`);
    }
    if (
      child.kind !== 'widget' ||
      child.widget.widgetId !== change.widget.widgetId ||
      child.widget.configurationId !== change.widget.configurationId
    ) {
      return invalidMutation(`Dashboard Child ${change.childId} does not match the requested Configured Widget`);
    }
  }
  if (!change.sectionId) return { ok: true, value: undefined };
  if (!dashboard.sections.some(({ sectionId }) => sectionId === change.sectionId)) {
    return invalidMutation(`failed to resolve section ${change.sectionId} on dashboard ${dashboard.dashboardId}`);
  }
  const configuredChild = change.childId
    ? dashboard.children.find(({ childId }) => childId === change.childId)
    : matchingWidgetChildren(dashboard, change.widget)[0];
  const existingSection = configuredChild && dashboard.sections.find((section) => (
    section.sectionId !== change.sectionId && section.childIds.includes(configuredChild.childId)
  ));
  return existingSection
    ? invalidMutation(`Dashboard Child ${configuredChild.childId} is already in Section ${existingSection.sectionId}`)
    : { ok: true, value: undefined };
}

function validateSectionOrder(
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'order-sections' }>,
): DashboardResult<void> {
  const current = dashboard.sections.map(({ sectionId }) => sectionId);
  return new Set(change.sectionIds).size === change.sectionIds.length && sameMembers(current, change.sectionIds)
    ? { ok: true, value: undefined }
    : invalidMutation(`Section order must list exactly the ${current.length} Sections on Dashboard ${dashboard.dashboardId}`);
}

function validateSectionChildOrder(
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'order-section-children' }>,
): DashboardResult<void> {
  const section = dashboard.sections.find(({ sectionId }) => sectionId === change.sectionId);
  if (!section) return invalidMutation(`Section ${change.sectionId} is missing from Dashboard ${dashboard.dashboardId}`);
  return new Set(change.childIds).size === change.childIds.length && sameMembers(section.childIds, change.childIds)
    ? { ok: true, value: undefined }
    : invalidMutation(`Section order must list exactly the ${section.childIds.length} Dashboard Children in Section ${change.sectionId}`);
}

function validateMutation(dashboard: Dashboard, change: DashboardChange): DashboardResult<void> {
  if (change.kind === 'remove-child') return validateRemoveChild(dashboard, change);
  if (change.kind === 'remove-section') {
    return dashboard.sections.some(({ sectionId }) => sectionId === change.sectionId)
      ? { ok: true, value: undefined }
      : invalidMutation(`Section ${change.sectionId} is missing from Dashboard ${dashboard.dashboardId}`);
  }
  if (change.kind === 'add-widget') return validateAddWidget(dashboard, change);
  if (change.kind === 'add-section') {
    return change.name.trim()
      ? { ok: true, value: undefined }
      : invalidMutation('Section name must not be blank');
  }
  if (change.kind === 'order-sections') return validateSectionOrder(dashboard, change);
  return validateSectionChildOrder(dashboard, change);
}

function plannedIdentity(prefix: 'child' | 'section', index: number, existing: ReadonlySet<string>): string {
  let identity = `__planned_${prefix}_${index + 1}`;
  while (existing.has(identity)) identity = `_${identity}`;
  return identity;
}

function projectMutation(
  dashboard: Dashboard,
  change: DashboardChange,
  index: number,
): Dashboard {
  if (change.kind === 'remove-child') {
    if (change.sectionId) {
      return {
        ...dashboard,
        sections: dashboard.sections.map((section) => section.sectionId === change.sectionId
          ? { ...section, childIds: section.childIds.filter((id) => id !== change.childId) }
          : section),
      };
    }
    return {
      ...dashboard,
      children: dashboard.children.filter(({ childId }) => childId !== change.childId),
      sections: dashboard.sections.map((section) => ({
        ...section,
        childIds: section.childIds.filter((id) => id !== change.childId),
      })),
    };
  }
  if (change.kind === 'remove-section') {
    return { ...dashboard, sections: dashboard.sections.filter(({ sectionId }) => sectionId !== change.sectionId) };
  }
  if (change.kind === 'add-widget') {
    const existing = change.childId
      ? dashboard.children.find(({ childId }) => childId === change.childId)
      : matchingWidgetChildren(dashboard, change.widget)[0];
    const child = existing ?? {
      kind: 'widget' as const,
      childId: plannedIdentity('child', index, new Set(dashboard.children.map(({ childId }) => childId))),
      rank: dashboard.children.length + 1,
      widget: change.widget,
      parameters: [],
    };
    return {
      ...dashboard,
      children: existing ? dashboard.children : [...dashboard.children, child],
      sections: change.sectionId
        ? dashboard.sections.map((section) => section.sectionId === change.sectionId && !section.childIds.includes(child.childId)
          ? { ...section, childIds: [...section.childIds, child.childId] }
          : section)
        : dashboard.sections,
    };
  }
  if (change.kind === 'add-section') {
    return {
      ...dashboard,
      sections: [...dashboard.sections, {
        sectionId: plannedIdentity('section', index, new Set(dashboard.sections.map(({ sectionId }) => sectionId))),
        name: change.name,
        rank: dashboard.sections.length + 1,
        childIds: [],
      }],
    };
  }
  if (change.kind === 'order-sections') {
    const rankById = new Map(change.sectionIds.map((id, rankIndex) => [id, rankIndex + 1]));
    return {
      ...dashboard,
      sections: [...dashboard.sections]
        .sort((left, right) => (rankById.get(left.sectionId) ?? 0) - (rankById.get(right.sectionId) ?? 0))
        .map((section) => ({ ...section, rank: rankById.get(section.sectionId) ?? section.rank })),
    };
  }
  return {
    ...dashboard,
    sections: dashboard.sections.map((section) => section.sectionId === change.sectionId
      ? { ...section, childIds: [...change.childIds] }
      : section),
  };
}

async function writeRemoveChild(
  port: DashboardPort,
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'remove-child' }>,
): Promise<DashboardResult<{ createdSectionId?: string }>> {
  const section = change.sectionId
    ? dashboard.sections.find(({ sectionId }) => sectionId === change.sectionId)
    : undefined;
  const result = section
    ? await port.setSectionChildren({
        dashboardId: dashboard.dashboardId,
        sectionId: section.sectionId,
        childIds: section.childIds.filter((id) => id !== change.childId),
      })
    : await port.removeChild({ dashboardId: dashboard.dashboardId, childId: change.childId });
  return result.ok ? { ok: true, value: {} } : result;
}

async function writeAddWidget(
  port: DashboardPort,
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'add-widget' }>,
): Promise<DashboardResult<{ createdSectionId?: string }>> {
  const targetSection = change.sectionId
    ? dashboard.sections.find(({ sectionId }) => sectionId === change.sectionId)
    : undefined;
  const configuredChild = change.childId
    ? dashboard.children.find(({ childId }) => childId === change.childId)
    : matchingWidgetChildren(dashboard, change.widget)[0];
  if (targetSection && configuredChild) {
    if (targetSection.childIds.includes(configuredChild.childId)) return { ok: true, value: {} };
    const result = await port.setSectionChildren({
      dashboardId: dashboard.dashboardId,
      sectionId: targetSection.sectionId,
      childIds: [...targetSection.childIds, configuredChild.childId],
    });
    return result.ok ? { ok: true, value: {} } : result;
  }
  const existing = dashboard.children.find((child) => (
    child.kind === 'widget' && child.widget.widgetId === change.widget.widgetId
  ));
  const added = await port.addWidget({
    dashboardId: dashboard.dashboardId,
    widget: change.widget,
    ...(existing ? { rank: existing.rank } : {}),
  });
  if (!added.ok || !targetSection) return added.ok ? { ok: true, value: {} } : added;
  const refreshed = await port.read(dashboard.dashboardId);
  if (!refreshed.ok) return refreshed;
  const child = matchingAddedChildren(dashboard, refreshed.value, change).find(({ childId }) => (
    !dashboard.children.some((beforeChild) => beforeChild.childId === childId)
  ));
  const section = refreshed.value.sections.find(({ sectionId }) => sectionId === targetSection.sectionId);
  if (!child || !section) return invalidMutation(`Added Widget could not be resolved in Section ${targetSection.sectionId}`);
  const result = await port.setSectionChildren({
    dashboardId: dashboard.dashboardId,
    sectionId: targetSection.sectionId,
    childIds: [...section.childIds, child.childId],
  });
  return result.ok ? { ok: true, value: {} } : result;
}

async function writeSectionOrder(
  port: DashboardPort,
  dashboardId: string,
  sectionIds: readonly string[],
): Promise<DashboardResult<{ createdSectionId?: string }>> {
  for (const [index, sectionId] of sectionIds.entries()) {
    // eslint-disable-next-line no-await-in-loop -- writes section ranks one at a time and stops at the first failure without sending the rest
    const result = await port.setSectionRank({ dashboardId, sectionId, rank: index + 1 });
    if (!result.ok) return result;
  }
  return { ok: true, value: {} };
}

function matchingAddedChildren(
  before: Dashboard,
  dashboard: Dashboard,
  change: Extract<DashboardChange, { kind: 'add-widget' }>,
): DashboardChild[] {
  if (change.childId) return dashboard.children.filter(({ childId }) => childId === change.childId);
  if (!change.sectionId) return dashboard.children.filter((child) => (
    child.kind === 'widget' && child.widget.widgetId === change.widget.widgetId
  ));
  const configuredIds = new Set(matchingWidgetChildren(before, change.widget).map(({ childId }) => childId));
  if (configuredIds.size > 0) return dashboard.children.filter(({ childId }) => configuredIds.has(childId));
  const priorIds = new Set(before.children.map(({ childId }) => childId));
  const addedChildren = dashboard.children.filter((child) => (
    child.kind === 'widget' &&
    child.widget.widgetId === change.widget.widgetId &&
    !priorIds.has(child.childId)
  ));
  return addedChildren.length === 1 ? addedChildren : [];
}

function effectObserved(
  before: Dashboard,
  after: Dashboard,
  change: DashboardChange,
  createdSectionId?: string,
): boolean {
  if (change.kind === 'remove-child') {
    if (!change.sectionId) return !after.children.some(({ childId }) => childId === change.childId);
    const section = after.sections.find(({ sectionId }) => sectionId === change.sectionId);
    return !!section && !section.childIds.includes(change.childId) && after.children.some(({ childId }) => childId === change.childId);
  }
  if (change.kind === 'remove-section') return !after.sections.some(({ sectionId }) => sectionId === change.sectionId);
  if (change.kind === 'add-widget') {
    const priorIds = new Set(before.children.map(({ childId }) => childId));
    const afterMatches = matchingAddedChildren(before, after, change);
    if (!change.sectionId) return afterMatches.some(({ childId }) => !priorIds.has(childId));
    const section = after.sections.find(({ sectionId }) => sectionId === change.sectionId);
    return !!section && afterMatches.some(({ childId }) => section.childIds.includes(childId));
  }
  if (change.kind === 'add-section') {
    return after.sections.some((section) => (
      (createdSectionId ? section.sectionId === createdSectionId : !before.sections.some(({ sectionId }) => sectionId === section.sectionId)) &&
      section.name === change.name
    ));
  }
  if (change.kind === 'order-sections') {
    return sameOrder(after.sections.map(({ sectionId }) => sectionId), change.sectionIds);
  }
  const section = after.sections.find(({ sectionId }) => sectionId === change.sectionId);
  return !!section && sameOrder(section.childIds, change.childIds);
}

async function writeMutation(
  port: DashboardPort,
  dashboard: Dashboard,
  change: DashboardChange,
): Promise<DashboardResult<{ createdSectionId?: string }>> {
  if (change.kind === 'remove-child') return writeRemoveChild(port, dashboard, change);
  if (change.kind === 'remove-section') {
    const result = await port.deleteSection({ dashboardId: dashboard.dashboardId, sectionId: change.sectionId });
    return result.ok ? { ok: true, value: {} } : result;
  }
  if (change.kind === 'add-widget') return writeAddWidget(port, dashboard, change);
  if (change.kind === 'add-section') {
    const result = await port.createSection({ dashboardId: dashboard.dashboardId, name: change.name, childIds: [] });
    return result.ok
      ? { ok: true, value: { ...(result.value.sectionId ? { createdSectionId: result.value.sectionId } : {}) } }
      : result;
  }
  if (change.kind === 'order-section-children') {
    const result = await port.setSectionChildren({
      dashboardId: dashboard.dashboardId,
      sectionId: change.sectionId,
      childIds: change.childIds,
    });
    return result.ok ? { ok: true, value: {} } : result;
  }
  return writeSectionOrder(port, dashboard.dashboardId, change.sectionIds);
}

type MutationStep = Readonly<{
  dashboard: Dashboard;
  result: DashboardOperationResult;
  stop: boolean;
}>;

type MutationWriteResult = Awaited<ReturnType<typeof writeMutation>>;

const DASHBOARD_VERIFY_ATTEMPTS = 10;
const DASHBOARD_VERIFY_RETRY_DELAY_MS = 1000;

async function waitForDashboardVerifyRetry(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  await new Promise((resolve) => {
    setTimeout(resolve, DASHBOARD_VERIFY_RETRY_DELAY_MS);
  });
}

async function pollMutationEffect(
  port: DashboardPort,
  dashboard: Dashboard,
  change: DashboardChange,
  initial: Dashboard,
  createdSectionId?: string,
): Promise<DashboardResult<Dashboard>> {
  let refreshed = initial;
  for (let attempt = 1; attempt < DASHBOARD_VERIFY_ATTEMPTS && !effectObserved(
    dashboard,
    refreshed,
    change,
    createdSectionId,
  ); attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- retries the read until the change is observed
    await waitForDashboardVerifyRetry();
    // eslint-disable-next-line no-await-in-loop -- retries the read until the change is observed
    const next = await port.read(dashboard.dashboardId);
    if (!next.ok) return next;
    refreshed = next.value;
  }
  return { ok: true, value: refreshed };
}

function verificationFailureStep(
  dashboard: Dashboard,
  change: DashboardChange,
  cause: DashboardError,
  write: MutationWriteResult,
): MutationStep {
  return {
    dashboard,
    result: {
      change,
      status: 'uncertain',
      error: {
        kind: 'verification-failed',
        cause,
        ...(!write.ok ? { writeError: write.error } : {}),
      },
      dashboard,
    },
    stop: true,
  };
}

function definitiveWriteFailureStep(
  write: MutationWriteResult,
  change: DashboardChange,
  refreshed: Dashboard,
): MutationStep | undefined {
  if (write.ok) return undefined;
  const ambiguous = write.error.kind === 'dependency' || (
    write.error.kind === 'write-failed' && write.error.isAmbiguous
  );
  if (ambiguous) return undefined;
  return {
    dashboard: refreshed,
    result: { change, status: 'failed', error: write.error, dashboard: refreshed },
    stop: true,
  };
}

function reconciledMutationStep(
  write: MutationWriteResult,
  dashboard: Dashboard,
  refreshed: Dashboard,
  change: DashboardChange,
  observed: boolean,
): MutationStep {
  if (!write.ok) {
    return {
      dashboard: refreshed,
      result: {
        change,
        status: observed ? 'applied' : 'uncertain',
        ...(!observed ? { error: write.error } : {}),
        dashboard: refreshed,
      },
      stop: true,
    };
  }
  if (!observed) {
    return {
      dashboard: refreshed,
      result: {
        change,
        status: 'failed',
        error: {
          kind: 'effect-not-observed',
          reason: `${change.kind} effect was not observed on Dashboard ${dashboard.dashboardId}`,
        },
        dashboard: refreshed,
      },
      stop: true,
    };
  }
  return {
    dashboard: refreshed,
    result: { change, status: 'applied', dashboard: refreshed },
    stop: false,
  };
}

async function executeMutationStep(
  port: DashboardPort,
  dashboard: Dashboard,
  change: DashboardChange,
): Promise<MutationStep> {
  if (change.kind === 'add-widget' && !change.sectionId && matchingWidgetChildren(dashboard, change.widget).length > 0) {
    return {
      dashboard,
      result: { change, status: 'applied', note: 'already-present', dashboard },
      stop: false,
    };
  }
  const write = await writeMutation(port, dashboard, change);
  let refreshed = await port.read(dashboard.dashboardId);
  if (!refreshed.ok) {
    return verificationFailureStep(dashboard, change, refreshed.error, write);
  }
  const failedWrite = definitiveWriteFailureStep(write, change, refreshed.value);
  if (failedWrite) return failedWrite;
  if (!write.ok && change.kind === 'add-widget' && change.sectionId && !change.childId
    && matchingWidgetChildren(dashboard, change.widget).length === 0) {
    return reconciledMutationStep(write, dashboard, refreshed.value, change, false);
  }

  const verified = await pollMutationEffect(
    port,
    dashboard,
    change,
    refreshed.value,
    write.ok ? write.value.createdSectionId : undefined,
  );
  if (!verified.ok) {
    return verificationFailureStep(dashboard, change, verified.error, write);
  }
  refreshed = verified;
  const observed = effectObserved(
    dashboard,
    refreshed.value,
    change,
    write.ok ? write.value.createdSectionId : undefined,
  );
  return reconciledMutationStep(write, dashboard, refreshed.value, change, observed);
}

async function mutateDashboard(
  port: DashboardPort,
  before: Dashboard,
  requestedChanges: readonly DashboardChange[],
): Promise<DashboardResult<DashboardEditOutcome>> {
  const results: DashboardOperationResult[] = [];
  let dashboard = before;
  const changes = requestedChanges
    .map((change, index) => ({ change, index }))
    .sort((left, right) => mutationOrder(left.change) - mutationOrder(right.change) || left.index - right.index)
    .map(({ change }) => change);
  let projected = dashboard;
  let invalidIndex = -1;
  let validation: DashboardResult<void> = { ok: true, value: undefined };
  for (const [index, change] of changes.entries()) {
    validation = validateMutation(projected, change);
    if (!validation.ok) {
      invalidIndex = index;
      break;
    }
    projected = projectMutation(projected, change, index);
  }
  if (invalidIndex >= 0) {
    if (validation.ok) throw new Error('Dashboard mutation validation changed during preflight');
    return {
      ok: true,
      value: {
        before,
        dashboard,
        results: changes.map((change, index) => index === invalidIndex
          ? { change, status: 'failed', error: validation.error, dashboard }
          : { change, status: 'not-attempted', dashboard }),
      },
    };
  }
  for (const change of changes) {
    // eslint-disable-next-line no-await-in-loop -- each mutation applies to the Dashboard the previous one returned
    const step = await executeMutationStep(port, dashboard, change);
    dashboard = step.dashboard;
    results.push(step.result);
    if (step.stop) break;
  }
  for (const change of changes.slice(results.length)) {
    results.push({ change, status: 'not-attempted', dashboard });
  }
  return { ok: true, value: { before, dashboard, results } };
}

export function createDashboardModuleFromPort(port: DashboardPort): DashboardModule {
  return {
    get(id) {
      return port.read(id);
    },
    async create(input) {
      const name = input.name.trim();
      if (!name) return { ok: false, error: { kind: 'invalid-name', name: input.name } };
      const matches = await port.findByTitle(name);
      if (!matches.ok) {
        return matches.error.kind === 'dependency'
          ? {
              ok: false,
              error: {
                kind: 'lookup-failed',
                name,
                failure: matches.error.failure,
              },
            }
          : matches;
      }
      if (matches.value.length > 0) {
        return { ok: false, error: { kind: 'dashboard-exists', name, matches: matches.value } };
      }
      const invalidWidget = input.widgets.find((widget) => !validWidgetArtifact(widget));
      if (invalidWidget) {
        return { ok: false, error: { kind: 'invalid-widget', widget: invalidWidget } };
      }
      return port.create({ name, widgets: input.widgets });
    },
    async edit(target, changes) {
      const before = await port.read(target.dashboardId);
      if (!before.ok) return before;
      if (
        before.value.permissions.editors.length === 0 &&
        before.value.permissions.administrators.length === 0
      ) {
        return { ok: false, error: { kind: 'permission-denied', dashboardId: before.value.dashboardId } };
      }
      return mutateDashboard(port, before.value, changes);
    },
  };
}
