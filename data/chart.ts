import { writeFile } from 'node:fs/promises';
import type { Result } from '../lib/result.js';
import type { Transport } from '../transport/index.js';
import { createChart, fetchChartPicture } from './adapters/chart.js';
import type { DataChartFailure, DataEvalInput, DataSavedChart } from './types.js';
import { dataStoredWindow } from './window.js';

/**
 * Saves a run's Expressions as a PlotTool Pro chart over its window as given, so the answer can
 * cite a link a reader opens in Marquee Web; with `picture`, then writes the chart's PNG there
 * (maintainer decision, 2026-10-28).
 */
export async function saveEvalChart(
  request: Transport['request'],
  input: DataEvalInput,
): Promise<Result<DataSavedChart, DataChartFailure>> {
  const created = await createChart(request, input.expressions, dataStoredWindow(input));
  if (!created.ok) return created;
  const { id, link } = created.value;
  if (input.picture === undefined) return { ok: true, value: { link } };
  return { ok: true, value: { link, picture: await writtenPicture(request, id, input.picture) } };
}

async function writtenPicture(
  request: Transport['request'],
  chartId: string,
  path: string,
): Promise<Result<string, DataChartFailure>> {
  const png = await fetchChartPicture(request, chartId);
  if (!png.ok) return png;
  try {
    await writeFile(path, png.value);
    return { ok: true, value: path };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { kind: 'picture-unwritable', path, problem } };
  }
}
