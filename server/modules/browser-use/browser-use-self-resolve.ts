// The agent browser runs ON the box, and the box resolves its own tailnet name
// publicly (host resolver 1.1.1.1 first, Tailscale DNS off on purpose), to the Funnel
// ingress, where every port but 443 times out. A proof made from the box pins the name
// to the tailnet IP (INV-642); this module gives the agent browser that pin, so
// `browser_navigate https://<this box's tailnet name>:<port>/` reaches the served app
// instead of timing out in page.goto. Both values are read from tailscaled, never kept
// by hand; with no tailscale on the box the browser launches with no pin.
import { execFileSync } from 'node:child_process';

type SelfName = { name: string; address: string } | null;

let cached: SelfName | undefined;

function readSelfName(): SelfName {
  try {
    const raw = execFileSync('tailscale', ['status', '--json'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const self = JSON.parse(raw)?.Self;
    const name = String(self?.DNSName || '').replace(/\.$/, '');
    const address = (self?.TailscaleIPs || []).find((ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    return name && address ? { name, address } : null;
  } catch {
    return null;
  }
}

/** Chromium args that pin this box's own tailnet name to its tailnet IP (empty when there is none). */
export function selfTailnetResolverArgs(): string[] {
  if (cached === undefined) {
    cached = readSelfName();
  }
  return cached ? [`--host-resolver-rules=MAP ${cached.name} ${cached.address}`] : [];
}
