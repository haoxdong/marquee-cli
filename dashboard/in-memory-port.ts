import type { Dashboard, DashboardSummary } from './types.js';
import type { DashboardPort } from './module.js';

export function createDashboardInMemoryPort(initialDashboards: readonly Dashboard[] = []): DashboardPort {
  const dashboards = new Map(initialDashboards.map((dashboard) => [dashboard.dashboardId, dashboard]));
  let nextId = initialDashboards.length + 1;
  let nextChildId = 1;
  let nextSectionId = 1;

  return {
    async read(dashboardId) {
      const dashboard = dashboards.get(dashboardId);
      return dashboard
        ? { ok: true, value: dashboard }
        : { ok: false, error: { kind: 'not-found', dashboardId } };
    },
    async findByTitle(name) {
      const target = name.trim().toLowerCase();
      const matches: DashboardSummary[] = [...dashboards.values()]
        .filter((dashboard) => dashboard.name.trim().toLowerCase() === target)
        .map(({ dashboardId, name: dashboardName, kind }) => ({ dashboardId, name: dashboardName, kind }));
      return { ok: true, value: matches };
    },
    async create(input) {
      const dashboardId = `MD_TEST_${nextId++}`;
      const dashboard: Dashboard = {
        dashboardId,
        name: input.name,
        kind: 'custom',
        tags: [],
        permissions: { viewers: [], editors: [], administrators: [] },
        children: input.widgets.map((widget, index) => ({
          kind: 'widget',
          childId: `CHILD_${dashboardId}_${index + 1}`,
          rank: index + 1,
          widget,
          parameters: [],
        })),
        sections: [],
        link: `https://marquee.gs.com/s/marketview/dashboards/${dashboardId}`,
      };
      dashboards.set(dashboardId, dashboard);
      return { ok: true, value: dashboard };
    },
    async removeChild({ dashboardId, childId }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      dashboards.set(dashboardId, {
        ...dashboard,
        children: dashboard.children.filter((child) => child.childId !== childId),
        sections: dashboard.sections.map((section) => ({
          ...section,
          childIds: section.childIds.filter((id) => id !== childId),
        })),
      });
      return { ok: true, value: undefined };
    },
    async addWidget({ dashboardId, widget, rank }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      const child = {
        kind: 'widget' as const,
        childId: `CHILD_${nextChildId++}`,
        rank: rank ?? dashboard.children.length + 1,
        widget,
        parameters: [],
      };
      dashboards.set(dashboardId, { ...dashboard, children: [...dashboard.children, child] });
      return { ok: true, value: undefined };
    },
    async createSection({ dashboardId, name, childIds }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      const sectionId = `SECTION_${nextSectionId++}`;
      dashboards.set(dashboardId, {
        ...dashboard,
        sections: [...dashboard.sections, {
          sectionId: sectionId,
          name,
          rank: dashboard.sections.length + 1,
          childIds,
        }],
      });
      return { ok: true, value: { sectionId } };
    },
    async deleteSection({ dashboardId, sectionId }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      dashboards.set(dashboardId, {
        ...dashboard,
        sections: dashboard.sections.filter((section) => section.sectionId !== sectionId),
      });
      return { ok: true, value: undefined };
    },
    async setSectionChildren({ dashboardId, sectionId, childIds }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      dashboards.set(dashboardId, {
        ...dashboard,
        sections: dashboard.sections.map((section) => (
          section.sectionId === sectionId ? { ...section, childIds } : section
        )),
      });
      return { ok: true, value: undefined };
    },
    async setSectionRank({ dashboardId, sectionId, rank }) {
      const dashboard = dashboards.get(dashboardId);
      if (!dashboard) return { ok: false, error: { kind: 'not-found', dashboardId: dashboardId } };
      dashboards.set(dashboardId, {
        ...dashboard,
        sections: dashboard.sections
          .map((section) => section.sectionId === sectionId ? { ...section, rank } : section)
          .sort((left, right) => left.rank - right.rank),
      });
      return { ok: true, value: undefined };
    },
  };
}
