import { DashboardApi } from '../../api/dashboard/index.js';
import { MarqueeError } from '../../transport/index.js';
import type { EditableDashboard } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function editableDashboardsFromResponse(value: unknown): EditableDashboard[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new MarqueeError('http', 'Malformed dashboard list response: expected results array', {
      path: DashboardApi.editableDashboards.path,
    });
  }
  return value.results.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new MarqueeError('http', `Malformed dashboard list response: expected dashboard id and title strings at results[${index}]`, {
        path: DashboardApi.editableDashboards.path,
      });
    }
    const { id, ...fields } = item;
    return { ...fields, dashboardId: id, title: item.title };
  });
}
