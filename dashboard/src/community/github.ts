export const REPO = 'citizensnipssss/OpenGauge';
export const REPO_URL = `https://github.com/${REPO}`;
export async function githubList(path: string): Promise<unknown[]> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers:{Accept:'application/vnd.github+json'}, signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(response.status===403 || response.status===429 ? 'GitHub request limit reached. Try again later.' : `GitHub returned ${response.status}.`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error('GitHub returned an unexpected response.');
  return value;
}
/** Restrict external links from cached or third-party data to this repository. */
export function repoLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin==='https://github.com' && url.pathname.startsWith(`/${REPO}/`) && !url.username && !url.password) return url.href;
  } catch { /* Invalid URL. */ }
  return null;
}
