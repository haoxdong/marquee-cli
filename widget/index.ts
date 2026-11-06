import type { EntityModule } from '../entity/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type { DependencyFailure, Transport } from '../transport/index.js';

import { createWidgetProductionModule } from './adapters/production.js';

import type { WidgetError, WidgetModule } from './types.js';
export type {
  WidgetId,
  ConfigId,
  WidgetResult,
  ConfiguredWidgetIdentity,
  WidgetParameterOverride,
  SelectedContext,
  WidgetDefinition,
  WidgetDates,
  WidgetValue,
  WidgetRenderDetail,
  WidgetAccess,
  WidgetGetInput,
  WidgetParameter,
  EditableDashboard,
  WidgetRenderValue,
  RenderedWidget,
  WidgetError,
  WidgetModule,
} from './types.js';

type WidgetDependencyFailure = Readonly<{ kind: DependencyFailure['kind']; status?: number; message?: string }>;

/** The dependency failure a Widget's error carries, with Marquee's status and message when Marquee answered. */
export function widgetDependencyFailure(error: WidgetError): WidgetDependencyFailure | undefined {
  switch (error.kind) {
    case 'widget-load-failure':
      return error.failure;
    case 'control-group-resolution-failure':
      return error.failure.kind === 'dependency' ? error.failure.failure : undefined;
    case 'plottool-failure':
      if (error.problem.kind !== 'chart-load-failed' && error.problem.kind !== 'execution-failed') return undefined;
      return error.problem.authentication === undefined ? error.problem.failure : { kind: 'authentication-required' };
    case 'data-viz-failure':
      return error.problem.kind === 'render-failure' ? error.problem.failure : undefined;
    default:
      return undefined;
  }
}

/** Whether a Widget's error fails the command rather than its Widget (ADR 0030): a sign-in or a cancellation no Widget gets past. */
export function widgetFailsCommand(error: WidgetError): boolean {
  const kind = widgetDependencyFailure(error)?.kind;
  return kind === 'authentication-required' || kind === 'cancelled';
}

export function createWidget(
  transport: Pick<Transport, 'request'>,
  options: { entity: EntityModule; controlGroup: ControlGroupModule },
): WidgetModule {
  return createWidgetProductionModule(transport, options);
}

