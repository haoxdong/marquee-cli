import type { EntityModule } from '../entity/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type { Transport } from '../transport/index.js';

import { createWidgetProductionModule } from './adapters/production.js';

import type { WidgetModule } from './types.js';
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
  WidgetParameterState,
  WidgetParameter,
  EditableDashboard,
  WidgetRenderValue,
  RenderedWidget,
  WidgetError,
  WidgetModule,
} from './types.js';

export function createWidget(
  transport: Pick<Transport, 'request'>,
  options: { entity: EntityModule; controlGroup: ControlGroupModule },
): WidgetModule {
  return createWidgetProductionModule(transport, options);
}

