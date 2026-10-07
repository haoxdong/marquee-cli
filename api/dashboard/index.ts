import type { Endpoint } from '../../transport/index.js';
import { del, get, post, put, type ApiRequester } from '../index.js';

const DASHBOARDS = '/v1/marketview/dashboards';

function dashboardPath(dashboardId: string): string {
  return `${DASHBOARDS}/${encodeURIComponent(dashboardId)}`;
}

function sectionPath(dashboardId: string, sectionId: string): string {
  return `${dashboardPath(dashboardId)}/sections/${encodeURIComponent(sectionId)}`;
}

// Marquee's MarketView Dashboard endpoints, in gs-quant's client shape (ADR 0072).
export class DashboardApi {
  // The editable Dashboards list, whose path its failures carry.
  static readonly editableDashboards: Endpoint = get(DASHBOARDS);

  constructor(private readonly requester: ApiRequester) {}

  // The first page of Dashboards the user may edit, as Web lists them.
  getEditableDashboards(): Promise<unknown> {
    return this.requester.request(DashboardApi.editableDashboards, {
      query: { view_as: 'edit', size: 100, page: 1 },
    });
  }

  // One Dashboard with its children expanded.
  getDashboard(dashboardId: string): Promise<unknown> {
    return this.requester.request(get(dashboardPath(dashboardId)), { query: { expand: true } });
  }

  createDashboard(dashboard: unknown): Promise<unknown> {
    return this.requester.request(post(`${DASHBOARDS}/default`), { body: dashboard });
  }

  addChildren(dashboardId: string, children: readonly unknown[]): Promise<unknown> {
    return this.requester.request(post(`${dashboardPath(dashboardId)}/children`), { body: children });
  }

  deleteChild(dashboardId: string, childId: string): Promise<unknown> {
    return this.requester.request(
      del(`${dashboardPath(dashboardId)}/children/${encodeURIComponent(childId)}`),
    );
  }

  createSection(dashboardId: string, section: unknown): Promise<unknown> {
    return this.requester.request(post(`${dashboardPath(dashboardId)}/sections`), { body: section });
  }

  updateSection(dashboardId: string, sectionId: string, changes: unknown): Promise<unknown> {
    return this.requester.request(put(sectionPath(dashboardId, sectionId)), { body: changes });
  }

  deleteSection(dashboardId: string, sectionId: string): Promise<unknown> {
    return this.requester.request(del(sectionPath(dashboardId, sectionId)));
  }
}
