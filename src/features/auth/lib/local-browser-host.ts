export function isLocalBrowserHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return true;
  }
  if (host.endsWith('.ts.net')) return true;
  const octets = host.split('.');
  if (octets.length !== 4) return false;
  const nums = octets.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const first = nums.at(0);
  const second = nums.at(1);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}
