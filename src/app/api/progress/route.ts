import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import {
  MAX_SYNC_ATTEMPTS,
  cleanDisplayName,
  isAttemptRecord,
  isTrainerSettings,
  isValidUsername,
  mergeAttempts,
  normalizeUsername,
  SYNC_VERSION,
  type SyncedProfile,
} from '@/lib/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const MAX_DISPLAY_NAME = 40;

interface StoredProfile {
  profile: SyncedProfile;
  etag?: string;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function syncConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

function profilePath(username: string) {
  const hash = createHash('sha256').update(normalizeUsername(username)).digest('hex');
  return `progress/v1/${hash}.json`;
}

function sanitizeProfile(value: unknown, username: string): SyncedProfile | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SyncedProfile>;
  if (!Array.isArray(input.attempts)) return null;

  const displayName =
    typeof input.displayName === 'string' && cleanDisplayName(input.displayName)
      ? cleanDisplayName(input.displayName).slice(0, MAX_DISPLAY_NAME)
      : username;

  return {
    version: SYNC_VERSION,
    username: normalizeUsername(username),
    displayName,
    updatedAt:
      typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    resetAt: typeof input.resetAt === 'string' ? input.resetAt : undefined,
    attempts: input.attempts
      .filter(isAttemptRecord)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, MAX_SYNC_ATTEMPTS),
    settings: isTrainerSettings(input.settings) ? input.settings : undefined,
  };
}

async function readStoredProfile(username: string): Promise<StoredProfile | null> {
  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(profilePath(username), { access: 'private', useCache: false });
  } catch (error) {
    if (error instanceof Error && /not.?found/i.test(error.name + error.message)) return null;
    throw error;
  }

  if (!result || result.statusCode !== 200 || !result.stream) return null;

  try {
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as unknown;
    const profile = sanitizeProfile(parsed, username);
    if (!profile) return null;
    // Vercel Blob returns weak tags (W/"…"); conditional writes require strong quoted ETags.
    const etag =
      typeof result.blob.etag === 'string'
        ? result.blob.etag.replace(/^W\//, '')
        : undefined;
    return { profile, etag };
  } catch {
    return null;
  }
}

function isPreconditionFailure(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'BlobPreconditionFailedError' || /precondition/i.test(error.message))
  );
}

async function writeProfile(
  username: string,
  profile: SyncedProfile,
  existing: StoredProfile | null,
): Promise<SyncedProfile> {
  let candidate = profile;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await put(profilePath(username), JSON.stringify(candidate), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: Boolean(existing),
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(existing?.etag ? { ifMatch: existing.etag } : {}),
      });
      return candidate;
    } catch (error) {
      if (!isPreconditionFailure(error) || attempt === 2) throw error;
      const latest = await readStoredProfile(username);
      if (!latest) throw error;
      candidate = {
        ...candidate,
        resetAt: latest.profile.resetAt,
        updatedAt: new Date().toISOString(),
        attempts: mergeAttempts(
          latest.profile.attempts,
          candidate.attempts,
          latest.profile.resetAt,
        ),
        settings: candidate.settings ?? latest.profile.settings,
      };
      existing = latest;
    }
  }

  throw new Error('Profile write retry limit reached.');
}

export async function GET(request: Request) {
  if (!syncConfigured()) return json({ error: 'sync_unavailable' }, 503);

  const username = new URL(request.url).searchParams.get('username');
  if (!username || !isValidUsername(username)) {
    return json({ error: 'invalid_username' }, 400);
  }

  try {
    const stored = await readStoredProfile(username);
    return json({ profile: stored?.profile ?? null });
  } catch {
    return json({ error: 'sync_unavailable' }, 503);
  }
}

export async function POST(request: Request) {
  if (!syncConfigured()) return json({ error: 'sync_unavailable' }, 503);

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (bodyText.length > MAX_BODY_BYTES) return json({ error: 'body_too_large' }, 413);

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!parsed || typeof parsed !== 'object') return json({ error: 'invalid_body' }, 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const rawUsername = typeof payload.username === 'string' ? payload.username : '';
  if (!isValidUsername(rawUsername)) return json({ error: 'invalid_username' }, 400);

  const username = normalizeUsername(rawUsername);
  const displayName =
    typeof payload.displayName === 'string' && cleanDisplayName(payload.displayName)
      ? cleanDisplayName(payload.displayName).slice(0, MAX_DISPLAY_NAME)
      : rawUsername.slice(0, MAX_DISPLAY_NAME);
  const incomingAttempts = Array.isArray(payload.attempts)
    ? payload.attempts.filter(isAttemptRecord).slice(0, MAX_SYNC_ATTEMPTS)
    : [];
  const incomingSettings = isTrainerSettings(payload.settings) ? payload.settings : undefined;

  try {
    const existing = await readStoredProfile(username);
    const resetAt = existing?.profile.resetAt;
    const profile: SyncedProfile = {
      version: SYNC_VERSION,
      username,
      displayName,
      updatedAt: new Date().toISOString(),
      resetAt,
      attempts: mergeAttempts(existing?.profile.attempts ?? [], incomingAttempts, resetAt),
      settings: incomingSettings ?? existing?.profile.settings,
    };
    const saved = await writeProfile(username, profile, existing);
    return json({ profile: saved });
  } catch {
    return json({ error: 'sync_failed' }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!syncConfigured()) return json({ error: 'sync_unavailable' }, 503);

  const usernameRaw = new URL(request.url).searchParams.get('username');
  if (!usernameRaw || !isValidUsername(usernameRaw)) {
    return json({ error: 'invalid_username' }, 400);
  }

  const username = normalizeUsername(usernameRaw);
  try {
    const existing = await readStoredProfile(username);
    const now = new Date().toISOString();
    const profile: SyncedProfile = {
      version: SYNC_VERSION,
      username,
      displayName: existing?.profile.displayName ?? usernameRaw.slice(0, MAX_DISPLAY_NAME),
      updatedAt: now,
      resetAt: now,
      attempts: [],
      settings: existing?.profile.settings,
    };
    const saved = await writeProfile(username, profile, existing);
    return json({ profile: saved, resetAt: saved.resetAt ?? now });
  } catch {
    return json({ error: 'reset_failed' }, 500);
  }
}
