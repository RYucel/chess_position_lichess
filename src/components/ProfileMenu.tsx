'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Download,
  Loader2,
  LogOut,
  Pencil,
  RefreshCw,
  Smartphone,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  activateProfile,
  getProfile,
  getSyncStatus,
  leaveProfile,
  profileEventName,
  syncNow,
  syncStatusEventName,
  type LocalProfile,
  type SyncStatus,
} from '@/lib/profile';
import { normalizeUsername } from '@/lib/progress';
import {
  canInstall,
  installStateEventName,
  isStandalone,
  promptInstall,
} from '@/lib/pwa';
import { summarizeProgress } from '@/lib/scoring';
import { loadAttempts, type AttemptRecord } from '@/lib/storage';

function formatSyncTime(value?: string): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return null;
  }
}

function useProfileSnapshot() {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: 'local' });
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);

  useEffect(() => {
    const refreshProfile = () => setProfile(getProfile());
    const refreshStatus = () => setStatus({ ...getSyncStatus() });
    const refreshAttempts = () => setAttempts(loadAttempts());

    refreshProfile();
    refreshStatus();
    refreshAttempts();

    window.addEventListener(profileEventName(), refreshProfile);
    window.addEventListener(syncStatusEventName(), refreshStatus);
    window.addEventListener('candidate-master:attempts-changed', refreshAttempts);
    return () => {
      window.removeEventListener(profileEventName(), refreshProfile);
      window.removeEventListener(syncStatusEventName(), refreshStatus);
      window.removeEventListener('candidate-master:attempts-changed', refreshAttempts);
    };
  }, []);

  return { profile, status, attempts };
}

function InstallButton() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const refresh = () => setAvailable(canInstall());
    refresh();
    window.addEventListener(installStateEventName(), refresh);
    return () => window.removeEventListener(installStateEventName(), refresh);
  }, []);

  if (!available) return null;

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Uygulamayı yükle"
      title="Uygulamayı yükle"
      onClick={() => void promptInstall()}
    >
      <Download className="h-4 w-4" />
    </button>
  );
}

function statusMeta(status: SyncStatus, profile: LocalProfile | null) {
  if (!profile) {
    return {
      label: 'Bu cihazda yerel',
      detail: 'Henüz bir kullanıcı adına bağlı değil.',
      tone: 'text-stone-500',
      dot: 'bg-stone-600',
      Icon: CloudOff,
    };
  }
  if (status.state === 'syncing') {
    return {
      label: 'Senkronize ediliyor',
      detail: 'Turlar ortak profile gönderiliyor.',
      tone: 'text-amber-300',
      dot: 'bg-amber-400 animate-pulseSoft',
      Icon: Loader2,
    };
  }
  if (status.state === 'synced') {
    const time = formatSyncTime(status.lastSyncedAt ?? profile.lastSyncedAt);
    return {
      label: 'Senkronize',
      detail: time ? `Son senkron: ${time}` : 'Turlar ortak profile bağlı.',
      tone: 'text-emerald-300',
      dot: 'bg-emerald-400',
      Icon: Cloud,
    };
  }
  if (status.state === 'offline') {
    return {
      label: 'Çevrimdışı',
      detail: status.message ?? 'Bağlantı gelince otomatik gönderilecek.',
      tone: 'text-sky-300',
      dot: 'bg-sky-400',
      Icon: WifiOff,
    };
  }
  if (status.state === 'error') {
    return {
      label: 'Senkron hatası',
      detail: status.message ?? 'Tekrar denemek için senkronize et.',
      tone: 'text-rose-300',
      dot: 'bg-rose-400',
      Icon: AlertTriangle,
    };
  }
  if (status.state === 'idle') {
    return {
      label: 'Profil bağlı',
      detail: 'Senkronizasyon hazır.',
      tone: 'text-stone-300',
      dot: 'bg-stone-400',
      Icon: Cloud,
    };
  }
  return {
    label: 'Yerel kayıt',
    detail: status.message ?? 'Sunucu senkronu kullanılamıyor.',
    tone: 'text-stone-500',
    dot: 'bg-stone-600',
    Icon: CloudOff,
  };
}

function ProfileDialog({
  profile,
  status,
  attempts,
  onClose,
}: {
  profile: LocalProfile | null;
  status: SyncStatus;
  attempts: AttemptRecord[];
  onClose: () => void;
}) {
  const [name, setName] = useState(profile?.displayName ?? '');
  const [editing, setEditing] = useState(!profile);
  const [busy, setBusy] = useState<'connect' | 'sync' | 'leave' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installAvailable, setInstallAvailable] = useState(false);
  const progress = useMemo(() => summarizeProgress(attempts), [attempts]);
  const meta = statusMeta(status, profile);

  useEffect(() => {
    setName(profile?.displayName ?? '');
  }, [profile?.displayName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    const refresh = () => setInstallAvailable(canInstall());
    refresh();
    window.addEventListener(installStateEventName(), refresh);
    return () => window.removeEventListener(installStateEventName(), refresh);
  }, []);

  const connect = async () => {
    if (busy) return;
    const nextName = name.trim();
    if (!nextName) {
      setError('Bir kullanıcı adı gir.');
      return;
    }
    if (
      profile &&
      normalizeUsername(nextName) !== profile.username &&
      !window.confirm(
        'Başka bir profile geçmek üzeresin. Bu cihazdaki yerel geçmiş yeni profile taşınmaz. Devam edilsin mi?',
      )
    ) {
      return;
    }

    setBusy('connect');
    setError(null);
    try {
      await activateProfile(nextName);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profil bağlanamadı.');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (busy) return;
    setBusy('sync');
    setError(null);
    try {
      await syncNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senkronize edilemedi.');
    } finally {
      setBusy(null);
    }
  };

  const leave = () => {
    if (!window.confirm('Bu cihazdan profil bağlantısı kaldırılsın mı? Yerel turlar silinmez.')) {
      return;
    }
    leaveProfile();
    setEditing(true);
    setName('');
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-ink-950/[0.98] sm:flex-row sm:items-center sm:justify-center sm:bg-black/70 sm:backdrop-blur-sm sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        className="panel relative mx-auto flex h-full min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-none border-white/[0.1] bg-ink-900/[0.98] sm:h-auto sm:max-h-[86dvh] sm:flex-none sm:rounded-[1.4rem]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4">
          <div>
            <div className="eyebrow">Profil</div>
            <h2
              id="profile-dialog-title"
              className="mt-1 font-display text-xl font-semibold text-stone-50"
            >
              Cihazlar arası ilerleme
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-stone-500">
              Aynı kullanıcı adını tablet ve telefonda gir; turlar tek profilde birleşsin.
            </p>
          </div>
          <button type="button" className="icon-btn shrink-0" aria-label="Kapat" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {profile ? (
            <div className="panel-inset p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] font-display text-sm font-semibold uppercase text-emerald-300">
                  {profile.displayName.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-semibold text-stone-100">
                    {profile.displayName}
                  </div>
                  <div className={cn('mt-0.5 inline-flex items-center gap-1.5 text-[10px]', meta.tone)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                    {meta.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-semibold text-stone-50">
                    {progress.points}
                  </div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-stone-600">
                    puan
                  </div>
                </div>
              </div>
              <p className="mt-2.5 text-[10px] leading-4 text-stone-500">{meta.detail}</p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-2 text-[11px]"
                  onClick={() => void sync()}
                  disabled={busy !== null}
                >
                  {busy === 'sync' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Şimdi senkronize et
                </button>
                <button
                  type="button"
                  className="btn-ghost border border-white/[0.07] px-3 py-2 text-[11px]"
                  onClick={leave}
                  disabled={busy !== null}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Bu cihazdan çık
                </button>
              </div>

              <button
                type="button"
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-300"
                onClick={() => {
                  setEditing((value) => !value);
                  setError(null);
                }}
              >
                <Pencil className="h-3 w-3" />
                {editing ? 'Profili düzenlemeyi kapat' : 'Başka profile geç'}
              </button>
            </div>
          ) : (
            <div className="panel-inset p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-200">
                <UserRound className="h-4 w-4 text-emerald-300" />
                Kullanıcı adıyla bağlan
              </div>
              <p className="mt-1 text-[10px] leading-4 text-stone-500">
                İlk bağlantıda bu cihazdaki turlar yeni profile taşınır. Sonraki cihazlarda aynı
                adı girmen yeterli.
              </p>
            </div>
          )}

          {(!profile || editing) && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label
                htmlFor="profile-name"
                className="block font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              >
                Kullanıcı adı
              </label>
              <div className="flex gap-2">
                <input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={24}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="ör. yusuf"
                  className="min-w-0 flex-1 rounded-xl border border-white/[0.09] bg-black/25 px-3 py-2.5 text-sm text-stone-100 outline-none transition placeholder:text-stone-700 focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
                />
                <button
                  type="submit"
                  className="btn-primary shrink-0 px-3.5 py-2.5 text-[11px]"
                  disabled={busy !== null}
                >
                  {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {profile ? 'Değiştir' : 'Bağlan'}
                </button>
              </div>
              <p className="text-[9.5px] leading-4 text-stone-600">
                2–24 karakter: harf, rakam, boşluk, nokta, tire, alt çizgi.
              </p>
            </form>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-[10.5px] leading-4 text-rose-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-stone-200">
              <Smartphone className="h-3.5 w-3.5 text-sky-300" />
              {isStandalone() ? 'Uygulama olarak açık' : 'Tablete / telefona yükle'}
            </div>
            {installAvailable ? (
              <button
                type="button"
                className="btn-secondary mt-2.5 w-full px-3 py-2 text-[11px]"
                onClick={() => void promptInstall()}
              >
                <Download className="h-3.5 w-3.5" />
                Uygulamayı yükle
              </button>
            ) : (
              <p className="mt-1.5 text-[9.5px] leading-4 text-stone-500">
                iPhone/iPad: Safari → Paylaş → “Ana Ekrana Ekle”. Android: Chrome menüsü →
                “Uygulamayı yükle”. Kurulumdan sonra çevrimdışı da açılır.
              </p>
            )}
          </div>

          <p className="text-[9px] leading-4 text-stone-600">
            Not: Bu kişisel bir antrenör profili, hesap sistemi değildir. Aynı kullanıcı adını
            bilen biri ilerlemeyi görebilir; kişisel bilgi içermeyen bir takma ad seç.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProfileMenu() {
  const { profile, status, attempts } = useProfileSnapshot();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={cn('icon-btn relative', profile && 'border-emerald-400/25 text-emerald-300')}
        aria-label={profile ? `${profile.displayName} profili` : 'Profil ve senkronizasyon'}
        title={profile ? `${profile.displayName} · ${status.state}` : 'Profil ve senkronizasyon'}
        onClick={() => setOpen(true)}
      >
        <UserRound className="h-4 w-4" />
        {profile && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-ink-950" />
        )}
      </button>
      {open &&
        createPortal(
          <ProfileDialog
            profile={profile}
            status={status}
            attempts={attempts}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

export { InstallButton };
