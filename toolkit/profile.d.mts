// Type declaration for profile.mjs so TypeScript consumers (e.g. the Playwright
// config) can import the loader under strict typechecking.

export interface ProfileTarget {
  name: string;
  baseURL: string;
}

export interface ProfileJourney {
  id: string;
  role?: string;
}

export interface Profile {
  name: string;
  description: string;
  contract: string | null;
  api: { baseURL: string | null; openapi: string | null; resetPath: string };
  targets: ProfileTarget[];
  journeys: ProfileJourney[];
  gateway: { url: string };
  auth: { mode: 'form' | 'session'; statePath: string };
  workDir: string;
  baseDir: string;
  profilePath: string;
  raw: unknown;
}

export function loadProfile(nameOrPath?: string): Profile;
