// Full request captures remain in backend diagnostics; retain a bounded detail window in RAM.
export function retainDiagnostics<T>(items: T[], item: T, maxCount = 200, maxBytes = 2 * 1024 * 1024): void {
  items.push(item);
  while (items.length > maxCount || items.length > 0 && JSON.stringify(items).length * 2 > maxBytes) items.shift();
}
