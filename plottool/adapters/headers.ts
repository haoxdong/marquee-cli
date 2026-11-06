export type PayloadHeaders = Readonly<Record<string, string>>;

export function payloadHeaders(
  callerHeaders: PayloadHeaders = {},
): Record<string, string> {
  return {
    'X-Dash-AppId': 'MQPLOT',
    ...callerHeaders,
  };
}

export function cardPayloadHeaders(
  widgetId: string,
  callerHeaders: PayloadHeaders = {},
): Record<string, string> {
  return {
    ...payloadHeaders(),
    'X-Support-Reference': widgetId,
    ...callerHeaders,
  };
}

export function runnerPostHeaders(
  widgetId: string,
  chartId: string,
  callerHeaders: PayloadHeaders = {},
): Record<string, string> {
  return {
    ...payloadHeaders(),
    'X-Support-Reference': `${widgetId}:${chartId}`,
    ...callerHeaders,
  };
}
