import {
  cleanDisplayName,
  isAttemptRecord,
  isTrainerSettings,
  isValidUsername,
  mergeAttempts,
  normalizeUsername,
  type SyncedProfile,
} from './progress';
import {
  loadAttempts,
  loadSettings,
  replaceAttempts,
  saveSettings,
  type ProgressChangeDetail,
} from './storage';

const PROFILE_KEY = 'candidate-master:profile:v1';
const PENDING_RESET_KEY = 'candidate-master:pending-reset:v1';
const PROFILE_EVENT = 'candidate-master:profile-changed';
const STATUS_EVENT = 'candidate-master:sync-status';
const SYNC_DELAY_MS = 1200;

export interface LocalProfile {
  username: string;
  displayName: string;
  createdAt: string;
  lastSyncedAt?: string;
  lastResetAt?: string;
}

export type SyncState = 'local' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt?: string;
  message?: string;
}

export type ProfileErrorCode =
  | 'invalid_username'
  | 'network'
  | 'offline'
  | 'sync_unavailable'
  | 'server';

export class ProfileSyncError extends Error {
  readonly code: ProfileErrorCode;

  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileSyncError';
    this.code = code;
  }
}

let status: SyncStatus = { state: 'local' };
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncingPromise: Promise<void> | null = null;
let initialized = false;

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function emitProfileChange() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

function setStatus(next: SyncStatus) {
  status = next;
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent<SyncStatus>(STATUS_EVENT, { detail: next }));
  }
}

function isProfile(value: unknown): value is LocalProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<LocalProfile>;
  return (
    typeof profile.username === 'string' &&
    isValidUsername(profile.username) &&
    typeof profile.displayName === 'string' &&
    typeof profile.createdAt === 'string'
  );
}

function readProfile(): LocalProfile | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeProfile(profile: LocalProfile) {
  if (!isBrowser()) return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  emitProfileChange();
}

function hasPendingReset(): boolean {
  return isBrowser() && window.localStorage.getItem(PENDING_RESET_KEY) === '1';
}

function markPendingReset() {
  if (!isBrowser()) return;
  window.localStorage.setItem(PENDING_RESET_KEY, '1');
}

function clearPendingReset() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(PENDING_RESET_KEY);
}

function readSyncedProfile(payload: unknown): SyncedProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  const profile = payload as Partial<SyncedProfile>;
  if (!Array.isArray(profile.attempts)) return null;
  return {
    version: 1,
    username: typeof profile.username === 'string' ? profile.username : '',
    displayName:
      typeof profile.displayName === 'string' && profile.displayName.trim()
        ? cleanDisplayName(profile.displayName)
        : 'CandidateMaster',
    updatedAt:
      typeof profile.updatedAt === 'string' ? profile.updatedAt : new Date(0).toISOString(),
    resetAt: typeof profile.resetAt === 'string' ? profile.resetAt : undefined,
    attempts: profile.attempts.filter(isAttemptRecord),
    settings: isTrainerSettings(profile.settings) ? profile.settings : undefined,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function fetchRemoteProfile(username: string): Promise<SyncedProfile | null> {
  let response: Response;
  try {
    response = await fetch(`/api/progress?username=${encodeURIComponent(username)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new ProfileSyncError('network', 'Sunucuya ulaşılamadı.');
  }

  if (response.status === 503) {
    throw new ProfileSyncError('sync_unavailable', 'Sunucu senkronu yapılandırılmadı.');
  }
  if (!response.ok) {
    throw new ProfileSyncError('server', 'Senkron sunucusu beklenmeyen bir yanıt verdi.');
  }

  const data = (await readJson(response)) as { profile?: unknown } | null;
  if (!data?.profile) return null;
  return readSyncedProfile(data.profile);
}

async function pushProfile(profile: SyncedProfile): Promise<SyncedProfile> {
  let response: Response;
  try {
    response = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: profile.username,
        displayName: profile.displayName,
        attempts: profile.attempts,
        settings: profile.settings,
      }),
    });
  } catch {
    throw new ProfileSyncError('network', 'Sunucuya ulaşılamadı.');
  }

  if (response.status === 503) {
    throw new ProfileSyncError('sync_unavailable', 'Sunucu senkronu yapılandırılmadı.');
  }
  if (!response.ok) {
    throw new ProfileSyncError('server', 'Senkron kaydedilemedi.');
  }

  const data = (await readJson(response)) as { profile?: unknown } | null;
  const saved = readSyncedProfile(data?.profile);
  if (!saved) throw new ProfileSyncError('server', 'Senkron yanıtı okunamadı.');
  return saved;
}

function statusFromError(error: unknown): SyncStatus {
  if (error instanceof ProfileSyncError) {
    if (error.code === 'sync_unavailable') {
      return {
        state: 'local',
        message: 'Sunucu senkronu yapılandırılmadı; ilerleme bu cihazda tutuluyor.',
      };
    }
    if (error.code === 'network' || error.code === 'offline') {
      return {
        state: 'offline',
        message: 'Çevrimdışısın; ilerleme bu cihazda saklanıyor ve bağlantıda gönderilecek.',
      };
    }
    return { state: 'error', message: error.message };
  }
  return { state: 'error', message: 'Senkron sırasında bilinmeyen bir hata oluştu.' };
}

export function getProfile(): LocalProfile | null {
  return readProfile();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function profileEventName() {
  return PROFILE_EVENT;
}

export function syncStatusEventName() {
  return STATUS_EVENT;
}

export async function activateProfile(input: string): Promise<LocalProfile> {
  if (!isBrowser()) {
    throw new ProfileSyncError('server', 'Profil yalnızca tarayıcıda etkinleştirilebilir.');
  }

  const displayName = cleanDisplayName(input);
  if (!isValidUsername(displayName)) {
    throw new ProfileSyncError(
      'invalid_username',
      'Kullanıcı adı 2–24 karakter olmalı; harf, rakam, boşluk, nokta, tire ve alt çizgi kullanabilirsin.',
    );
  }

  const username = normalizeUsername(displayName);
  const current = readProfile();
  const sameProfile = current?.username === username;
  if (current && !sameProfile) clearPendingReset();
  const localAttempts = loadAttempts();
  const localSettings = loadSettings();

  setStatus({ state: 'syncing' });

  let remote: SyncedProfile | null = null;
  let syncError: unknown = null;
  try {
    remote = await fetchRemoteProfile(username);
  } catch (error) {
    syncError = error;
  }

  if (syncError && current && !sameProfile) {
    const status = statusFromError(syncError);
    setStatus(status);
    throw syncError;
  }

  const baseAttempts = !current || sameProfile ? localAttempts : [];
  const now = new Date().toISOString();
  let merged: SyncedProfile;

  if (remote) {
    merged = {
      ...remote,
      username,
      displayName,
      attempts: mergeAttempts(baseAttempts, remote.attempts, remote.resetAt),
      settings: sameProfile ? localSettings : (remote.settings ?? localSettings),
    };
  } else {
    merged = {
      version: 1,
      username,
      displayName,
      updatedAt: now,
      attempts: mergeAttempts(baseAttempts, []),
      settings: localSettings,
    };
  }

  let saved = merged;
  if (!syncError) {
    try {
      saved = await pushProfile(merged);
    } catch (error) {
      syncError = error;
    }
  }

  const profile: LocalProfile = {
    username,
    displayName: saved.displayName,
    createdAt: sameProfile && current ? current.createdAt : now,
    lastSyncedAt: syncError ? current?.lastSyncedAt : saved.updatedAt,
    lastResetAt: saved.resetAt,
  };

  writeProfile(profile);
  replaceAttempts(saved.attempts);
  if (saved.settings) saveSettings(saved.settings);

  if (syncError) {
    setStatus(statusFromError(syncError));
  } else {
    setStatus({ state: 'synced', lastSyncedAt: saved.updatedAt });
  }

  return profile;
}

export function leaveProfile(): void {
  if (!isBrowser()) return;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  window.localStorage.removeItem(PROFILE_KEY);
  clearPendingReset();
  setStatus({ state: 'local' });
  emitProfileChange();
}

export function queueProfileSync(delay = SYNC_DELAY_MS): void {
  if (!isBrowser() || !readProfile()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, delay);
}

export async function syncNow(): Promise<void> {
  const profile = readProfile();
  if (!profile) return;

  if (syncingPromise) return syncingPromise;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus({
      state: 'offline',
      lastSyncedAt: profile.lastSyncedAt,
      message: 'Çevrimdışısın; ilerleme bu cihazda saklanıyor.',
    });
    return;
  }

  syncingPromise = (async () => {
    setStatus({ state: 'syncing', lastSyncedAt: profile.lastSyncedAt });
    try {
      if (hasPendingReset()) {
        await resetRemoteProgress(profile, false);
      }

      const remote = await fetchRemoteProfile(profile.username);
      const local = loadAttempts();
      const merged = mergeAttempts(local, remote?.attempts ?? [], remote?.resetAt);
      const saved = await pushProfile({
        version: 1,
        username: profile.username,
        displayName: profile.displayName,
        updatedAt: new Date().toISOString(),
        resetAt: remote?.resetAt,
        attempts: merged,
        settings: loadSettings(),
      });

      const updated: LocalProfile = {
        ...profile,
        displayName: saved.displayName,
        lastSyncedAt: saved.updatedAt,
        lastResetAt: saved.resetAt,
      };
      writeProfile(updated);
      replaceAttempts(saved.attempts);
      if (saved.settings) saveSettings(saved.settings);
      setStatus({ state: 'synced', lastSyncedAt: saved.updatedAt });
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      syncingPromise = null;
    }
  })();

  return syncingPromise;
}

async function resetRemoteProgress(profile: LocalProfile, reportStatus = true): Promise<void> {
  if (reportStatus) setStatus({ state: 'syncing', lastSyncedAt: profile.lastSyncedAt });

  let response: Response;
  try {
    response = await fetch(`/api/progress?username=${encodeURIComponent(profile.username)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    throw new ProfileSyncError('network', 'Sıfırlama sunucuya gönderilemedi.');
  }

  if (response.status === 503) {
    throw new ProfileSyncError('sync_unavailable', 'Sunucu senkronu yapılandırılmadı.');
  }
  if (!response.ok) {
    throw new ProfileSyncError('server', 'Sıfırlama sunucuya kaydedilemedi.');
  }

  const data = (await readJson(response)) as { profile?: unknown } | null;
  const resetProfile = readSyncedProfile(data?.profile);
  const now = new Date().toISOString();
  const updated: LocalProfile = {
    ...profile,
    lastSyncedAt: resetProfile?.updatedAt ?? now,
    lastResetAt: resetProfile?.resetAt ?? now,
  };
  writeProfile(updated);
  replaceAttempts([]);
  clearPendingReset();
  if (reportStatus) setStatus({ state: 'synced', lastSyncedAt: updated.lastSyncedAt });
}

function handleAttemptsChanged(event: Event) {
  const detail = (event as CustomEvent<ProgressChangeDetail>).detail;
  if (detail?.source === 'remote') return;
  const profile = readProfile();
  if (!profile) return;

  if (detail?.reset) {
    markPendingReset();
    void resetRemoteProgress(profile).catch((error: unknown) => {
      setStatus(statusFromError(error));
    });
    return;
  }

  queueProfileSync();
}

export function initProfileSync(): void {
  if (!isBrowser() || initialized) return;
  initialized = true;

  window.addEventListener('candidate-master:attempts-changed', handleAttemptsChanged);
  window.addEventListener('online', () => {
    if (readProfile()) void syncNow();
  });

  const profile = readProfile();
  if (!profile) {
    setStatus({ state: 'local' });
    return;
  }

  setStatus({
    state: typeof navigator !== 'undefined' && navigator.onLine ? 'idle' : 'offline',
    lastSyncedAt: profile.lastSyncedAt,
    message:
      typeof navigator === 'undefined' || navigator.onLine
        ? undefined
        : 'Çevrimdışısın; ilerleme bu cihazda saklanıyor.',
  });

  window.setTimeout(() => {
    if (hasPendingReset()) {
      void resetRemoteProgress(profile).catch((error: unknown) => {
        setStatus(statusFromError(error));
      });
    } else {
      void syncNow();
    }
  }, 700);
}
