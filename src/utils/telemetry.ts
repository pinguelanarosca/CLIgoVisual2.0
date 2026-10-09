export type TelemetryChannel = 'user_input' | 'assistant_content' | 'runtime_event' | 'tool_event' | 'stderr' | 'artifact';
export function unwrapTelemetry(event: any): any {
  return event?.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? { ...event.data, type: event.data.type || event.type } : event;
}
export function telemetryChannel(event: any): TelemetryChannel | undefined {
  const data = unwrapTelemetry(event);
  if (event?.type === 'runtime_event' || data?.type === 'runtime_event') return 'runtime_event';
  if (['stderr', 'stdout_raw'].includes(data?.type)) return 'stderr';
  if (['tool_use', 'tool_call', 'tool_result'].includes(data?.type)) return 'tool_event';
  if (['artifact', 'final_api_request', 'version_created'].includes(data?.type)) return 'artifact';
  if (data?.type === 'message' && data.role === 'user') return 'user_input';
  if (data?.type === 'message' && data.role === 'assistant') return 'assistant_content';
}
export function assistantText(event: any): string {
  if (telemetryChannel(event) !== 'assistant_content') return '';
  const data = unwrapTelemetry(event);
  return typeof data.content === 'string' ? data.content : typeof data.text === 'string' ? data.text : '';
}
