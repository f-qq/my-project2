/** Initialize Node's built-in proxy dispatcher before any outgoing fetch().
 * Node 24.14+ supports http.setGlobalProxyFromEnv(), with Node 24.15 tested on user's PC.
 */
import http from 'node:http';

export function initializeProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (!proxy) return { requested: false, ready: false, reason: 'No HTTPS_PROXY' };
  const useEnv = process.env.NODE_USE_ENV_PROXY === '1';
  if (!useEnv) return { requested: true, ready: false, reason: 'NODE_USE_ENV_PROXY=1 was not set' };
  if (typeof http.setGlobalProxyFromEnv === 'function') {
    http.setGlobalProxyFromEnv();
    return { requested: true, ready: true, reason: 'Explicit global proxy dispatcher enabled' };
  }
  // Node 24.5 through 24.13 supports NODE_USE_ENV_PROXY at process creation,
  // although dynamic setGlobalProxyFromEnv() is unavailable.
  const [major, minor] = process.versions.node.split('.').map(Number);
  if ((major === 24 && minor >= 5) || major > 24 || (major === 22 && minor >= 21)) {
    return { requested: true, ready: true, reason: 'Proxy dispatcher requested at process startup' };
  }
  return { requested: true, ready: false, reason: `Current Node ${process.version} has no built-in fetch env proxy support; install Node 24.14+` };
}
