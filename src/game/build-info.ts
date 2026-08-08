/**
 * The build's own identity, loaded at startup and shown on screen.
 *
 * Small on purpose: it exists so that anyone looking at a screenshot can say
 * which commit produced it, which is precisely what could not be done for the
 * build this work replaces.
 */
export interface BuildInfo {
  repository: string;
  branch: string;
  commit: string;
  shortCommit: string;
  runId: string;
  builtAt: string;
}

const UNKNOWN: BuildInfo = {
  repository: 'apiazza75/supervolley90',
  branch: 'dev',
  commit: 'unknown',
  shortCommit: 'dev',
  runId: 'local',
  builtAt: '',
};

let current: BuildInfo = UNKNOWN;

/** Fetch build-info.json, written at build time. Never throws. */
export async function loadBuildInfo(): Promise<BuildInfo> {
  try {
    const res = await fetch('build-info.json', { cache: 'no-store' });
    if (!res.ok) return current;
    const data = (await res.json()) as Partial<BuildInfo>;
    if (typeof data.commit === 'string' && data.commit.length > 0) {
      current = { ...UNKNOWN, ...data } as BuildInfo;
    }
  } catch {
    // A missing manifest is a development build, not an error.
  }
  return current;
}

export const buildInfo = (): BuildInfo => current;

/** The one-line stamp drawn in the menu and on the pause screen. */
export const buildStamp = (): string => {
  const b = current;
  return `BUILD ${b.shortCommit} · RUN ${b.runId}`;
};
