import type {
  CreatedDashboard,
  Dashboard,
  DashboardModule,
  DashboardChange,
  DashboardEditOutcome,
  DashboardResult,
  DashboardWidgetArtifact,
} from '../../dashboard/index.js';

type FakeDashboardOptions = {
  beforeCreate?: () => void;
};

function mutationOrder(change: DashboardChange): number {
  if (change.kind === 'remove-child' || change.kind === 'remove-section') return 0;
  if (change.kind === 'add-widget') return 1;
  if (change.kind === 'add-section') return 2;
  return 3;
}

function createDashboardValue(
  dashboardId: string,
  name: string,
  widgets: readonly DashboardWidgetArtifact[],
): Dashboard {
  return {
    dashboardId,
    name,
    kind: 'custom',
    tags: [],
    permissions: { viewers: [], editors: ['test-owner'], administrators: [] },
    children: widgets.map((widget, index) => ({
      kind: 'widget',
      childId: `CHILD_${index + 1}`,
      rank: index + 1,
      widget,
      parameters: [],
    })),
    sections: [],
    link: `https://marquee.gs.com/s/marketview/dashboards/${dashboardId}`,
  };
}

function applyChange(
  dashboard: Dashboard,
  change: DashboardChange,
  index: number,
): Dashboard {
  if (change.kind === 'remove-child') {
    if (change.sectionId) {
      return {
        ...dashboard,
        sections: dashboard.sections.map((section) => section.sectionId === change.sectionId
          ? { ...section, childIds: section.childIds.filter((childId) => childId !== change.childId) }
          : section),
      };
    }
    return {
      ...dashboard,
      children: dashboard.children.filter(({ childId }) => childId !== change.childId),
      sections: dashboard.sections.map((section) => ({
        ...section,
        childIds: section.childIds.filter((childId) => childId !== change.childId),
      })),
    };
  }
  if (change.kind === 'remove-section') {
    return {
      ...dashboard,
      sections: dashboard.sections.filter(({ sectionId }) => sectionId !== change.sectionId),
    };
  }
  if (change.kind === 'add-widget') {
    const existing = change.childId
      ? dashboard.children.find(({ childId }) => childId === change.childId)
      : undefined;
    const child = existing ?? {
      kind: 'widget' as const,
      childId: `CHILD_ADDED_${index + 1}`,
      rank: dashboard.children.length + 1,
      widget: change.widget,
      parameters: [],
    };
    return {
      ...dashboard,
      children: existing ? dashboard.children : [...dashboard.children, child],
      sections: change.sectionId
        ? dashboard.sections.map((section) => (
            section.sectionId === change.sectionId && !section.childIds.includes(child.childId)
              ? { ...section, childIds: [...section.childIds, child.childId] }
              : section
          ))
        : dashboard.sections,
    };
  }
  if (change.kind === 'add-section') {
    return {
      ...dashboard,
      sections: [...dashboard.sections, {
        sectionId: `SECTION_ADDED_${index + 1}`,
        name: change.name,
        rank: dashboard.sections.length + 1,
        childIds: [],
      }],
    };
  }
  if (change.kind === 'order-sections') {
    const rank = new Map(change.sectionIds.map((sectionId, rankIndex) => [sectionId, rankIndex + 1]));
    return {
      ...dashboard,
      sections: [...dashboard.sections]
        .sort((left, right) => (rank.get(left.sectionId) ?? 0) - (rank.get(right.sectionId) ?? 0))
        .map((section) => ({ ...section, rank: rank.get(section.sectionId) ?? section.rank })),
    };
  }
  return {
    ...dashboard,
    sections: dashboard.sections.map((section) => section.sectionId === change.sectionId
      ? { ...section, childIds: [...change.childIds] }
      : section),
  };
}

export function createFakeDashboardModule(
  initialDashboards: readonly Dashboard[] = [],
  options: FakeDashboardOptions = {},
): DashboardModule {
  const dashboards = new Map(initialDashboards.map((dashboard) => [dashboard.dashboardId, dashboard]));
  let nextDashboardId = 1;

  const get = async (dashboardId: string): Promise<DashboardResult<Dashboard>> => {
    const dashboard = dashboards.get(dashboardId);
    return dashboard
      ? { ok: true, value: dashboard }
      : { ok: false, error: { kind: 'not-found', dashboardId } };
  };

  return {
    get,
    async create(input) {
      const name = input.name.trim();
      if (!name) return { ok: false, error: { kind: 'invalid-name', name: input.name } };
      const matches = [...dashboards.values()].filter(
        (dashboard) => dashboard.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (matches.length > 0) {
        return {
          ok: false,
          error: {
            kind: 'dashboard-exists',
            name,
            matches: matches.map(({ dashboardId, name: dashboardName, kind }) => ({
              dashboardId,
              name: dashboardName,
              kind,
            })),
          },
        };
      }
      const invalidWidget = input.widgets.find((widget) => !widget.configurationId);
      if (invalidWidget) {
        return { ok: false, error: { kind: 'invalid-widget', widget: invalidWidget } };
      }
      options.beforeCreate?.();
      const dashboard = createDashboardValue(`MD_TEST_${nextDashboardId++}`, name, input.widgets);
      dashboards.set(dashboard.dashboardId, dashboard);
      return { ok: true, value: dashboard } satisfies DashboardResult<CreatedDashboard>;
    },
    async edit(target, requestedChanges) {
      const invalidWidget = requestedChanges.find((change) => (
        change.kind === 'add-widget' && !change.widget.configurationId
      ));
      if (invalidWidget?.kind === 'add-widget') {
        return { ok: false, error: { kind: 'invalid-widget', widget: invalidWidget.widget } };
      }
      const dashboardId = target.dashboardId;
      let dashboard = dashboards.get(dashboardId);
      if (!dashboard) {
        return { ok: false, error: { kind: 'not-found', dashboardId } };
      }
      const before = dashboard;
      const changes = requestedChanges
        .map((change, index) => ({ change, index }))
        .sort((left, right) => (
          mutationOrder(left.change) - mutationOrder(right.change)
          || left.index - right.index
        ))
        .map(({ change }) => change);
      const results = [];
      for (const [index, change] of changes.entries()) {
        dashboard = applyChange(dashboard, change, index);
        dashboards.set(dashboardId, dashboard);
        results.push({ change, status: 'applied' as const, dashboard });
      }
      return { ok: true, value: { before, dashboard, results } } satisfies DashboardResult<DashboardEditOutcome>;
    },
  };
}
