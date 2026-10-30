import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Calendar,
  Camera,
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  Settings2,
  Shield,
  SlidersHorizontal,
  Trash2,
  User,
  UserRound,
} from 'lucide-react';
import {
  ACCOUNT_ACTIVITY_CATEGORIES,
  TOAST_POSITIONS,
  USER_ROLE_LABELS,
  changePasswordSchema,
  updateProfileSchema,
  type AccountActivity,
  type AccountActivityCategory,
  type AccountSummary,
  type PublicUser,
  type ToastPosition,
  type UpdatePreferencesInput,
  type UpdateProfileInput,
} from '@app/shared';
import { Theme } from '@app/design-kit';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatMonthYear, formatRelative } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { useTheme } from '@/features/theme/use-theme';
import { useI18n } from '@/i18n/i18n.context';
import { usePageHeader } from '@/components/shell/page-header.context';

/**
 * Configurações da conta — tudo que a própria pessoa administra: perfil e
 * foto, resumo da atividade, preferências (tema, notificações, posição dos
 * avisos), senha e a trilha do que aconteceu na conta. E-mail, matrícula e
 * perfil de acesso são do administrador (RF-36) e aparecem só para leitura.
 *
 * A foto é redimensionada no navegador (256 px, JPEG) antes de subir, para
 * caber num campo de texto sem trafegar megabytes.
 */
export function ProfilePage() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();

  usePageHeader({ eyebrow: t.profile.eyebrow, title: t.profile.title, description: t.profile.subtitle });

  if (!user) return null;
  return (
    <div className="account">
      <ProfileCard user={user} onSaved={updateUser} />
      <SummaryCard />
      <PreferencesCard user={user} onSaved={updateUser} />
      <PasswordCard />
      <ActivityCard />
    </div>
  );
}

// ---------------------------------------------------------------------------

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

/** Lê o arquivo, desenha num canvas de 256×256 (recorte central) e devolve JPEG. */
async function resizeAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler a imagem'));
      el.src = url;
    });
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível');
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CardHead({ icon, title, hint, right }: { icon: React.ReactNode; title: string; hint: string; right?: React.ReactNode }) {
  return (
    <div className="account__head">
      <div>
        <h3 className="account__title">
          <span className="account__title-icon">{icon}</span>
          {title}
        </h3>
        <p className="account__hint">{hint}</p>
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileCard({ user, onSaved }: { user: PublicUser; onSaved: (u: PublicUser) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    meta: { success: 'Perfil atualizado' },
    mutationFn: (input: UpdateProfileInput) => api.patch<PublicUser>('/users/me', input),
    onSuccess: (u) => {
      onSaved(u);
      setSaved(true);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t.profile.saveError),
  });

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.profile.notImage);
      return;
    }
    try {
      setAvatarUrl(await resizeAvatar(file));
      setSaved(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.profile.notImage);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = updateProfileSchema.safeParse({ name, phone: phone || undefined, avatarUrl });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.profile.saveError);
      return;
    }
    setSaved(false);
    mutation.mutate(parsed.data);
  }

  const dirty = name !== user.name || (phone || '') !== (user.phone ?? '') || avatarUrl !== user.avatarUrl;

  return (
    <form className="tp-card account__card" onSubmit={submit}>
      <CardHead icon={<UserRound size={18} />} title={t.profile.infoTitle} hint={t.profile.infoHint} />

      <div className="account__photo">
        <button
          type="button"
          className="account__avatar"
          onClick={() => fileRef.current?.click()}
          aria-label={t.profile.changePhoto}
          title={t.profile.changePhoto}
        >
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(name || user.name)}</span>}
          <span className="account__avatar-badge" aria-hidden><Camera size={13} /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickFile(e)} />
        <div className="account__photo-text">
          <b>{t.profile.clickToChange}</b>
          <span>{t.profile.photoHint}</span>
          {avatarUrl && (
            <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm account__photo-remove" onClick={() => { setAvatarUrl(null); setSaved(false); }}>
              <Trash2 size={14} /> {t.profile.removePhoto}
            </button>
          )}
        </div>
      </div>

      <div className="account__fields">
        <label className="tp-field">
          <span className="tp-label account__label"><User size={14} /> {t.profile.fullName}</span>
          <input className="tp-input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={120} required />
        </label>
        <div className="tp-field">
          <span className="tp-label account__label"><Mail size={14} /> {t.profile.email}</span>
          <input className="tp-input" value={user.email} readOnly />
        </div>
        <label className="tp-field">
          <span className="tp-label account__label"><MessageSquare size={14} /> {t.profile.phone}</span>
          <input className="tp-input" value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} placeholder="(11) 9 0000-0000" maxLength={32} />
        </label>
        <div className="tp-field">
          <span className="tp-label account__label"><KeyRound size={14} /> {t.profile.registration}</span>
          <input className="tp-input" value={user.registration ?? '—'} readOnly />
        </div>
        <div className="tp-field">
          <span className="tp-label account__label"><Shield size={14} /> {t.profile.role}</span>
          <span><span className="tp-badge tp-badge--brand">{USER_ROLE_LABELS[user.role]}</span></span>
        </div>
        <div className="tp-field">
          <span className="tp-label account__label"><Clock size={14} /> {t.profile.status}</span>
          <span>
            <span className={`tp-badge account__status${user.isActive ? ' is-active' : ''}`}>
              <i aria-hidden />
              {user.isActive ? t.profile.active : t.profile.inactive}
            </span>
          </span>
        </div>
        <div className="tp-field">
          <span className="tp-label account__label"><Calendar size={14} /> {t.profile.memberSince}</span>
          <span className="account__value">{formatMonthYear(user.createdAt)}</span>
        </div>
      </div>

      <span className="tp-help">{t.profile.adminOnly}</span>
      {error && <p className="tp-error">{error}</p>}

      <div className="account__foot">
        {saved && !dirty && <span className="account__saved">{t.profile.saved}</span>}
        <button type="submit" className="tp-btn tp-btn--primary" disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? t.profile.saving : t.profile.save}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function SummaryCard() {
  const { t } = useI18n();
  const { data } = useQuery({ queryKey: ['me-summary'], queryFn: () => api.get<AccountSummary>('/users/me/summary') });

  const tiles = [
    { value: data ? String(data.actionsThisMonth) : '…', label: t.profile.actionsMonth, note: t.profile.thisMonth },
    { value: data ? String(data.eventsThisMonth) : '…', label: t.profile.eventsMonth, note: t.profile.thisMonth },
    { value: data ? (data.lastLoginAt ? formatDateTime(data.lastLoginAt) : t.profile.never) : '…', label: t.profile.lastLogin, small: true },
    { value: data ? String(data.activeSessions) : '…', label: t.profile.sessions },
  ];

  return (
    <section className="tp-card account__card">
      <CardHead icon={<Clock size={18} />} title={t.profile.summaryTitle} hint={t.profile.summaryHint} />
      <div className="account__tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="account__tile">
            <b className={tile.small ? 'is-small' : undefined}>{tile.value}</b>
            <span>{tile.label}</span>
            {tile.note && <small>{tile.note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function PreferencesCard({ user, onSaved }: { user: PublicUser; onSaved: (u: PublicUser) => void }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const resolvedDark =
    theme === Theme.SYSTEM ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === Theme.DARK;

  const save = useMutation({
    mutationFn: (input: UpdatePreferencesInput) => api.patch<PublicUser>('/users/me/preferences', input),
    meta: { success: t.profile.prefsSaved },
    onSuccess: onSaved,
  });

  const prefs = user.preferences;

  return (
    <section className="tp-card account__card">
      <CardHead icon={<Settings2 size={18} />} title={t.profile.prefsTitle} hint={t.profile.prefsHint} />

      <div className="pref">
        <span className="pref__icon"><Moon size={16} /></span>
        <div className="pref__text">
          <b>{t.profile.darkMode}</b>
          <span>{t.profile.darkModeHint}</span>
        </div>
        <button type="button" role="switch" aria-checked={resolvedDark} className={`tp-switch${resolvedDark ? ' is-on' : ''}`} onClick={() => setTheme(resolvedDark ? Theme.LIGHT : Theme.DARK)}>
          <i className="tp-switch__knob" />
        </button>
      </div>

      <div className="pref">
        <span className="pref__icon"><Bell size={16} /></span>
        <div className="pref__text">
          <b>{t.profile.notifications}</b>
          <span>{t.profile.notificationsHint}</span>
        </div>
        <button type="button" role="switch" aria-checked={prefs.notifications} className={`tp-switch${prefs.notifications ? ' is-on' : ''}`} disabled={save.isPending} onClick={() => save.mutate({ notifications: !prefs.notifications })}>
          <i className="tp-switch__knob" />
        </button>
      </div>

      <div className="pref pref--block">
        <span className="pref__icon"><MessageSquare size={16} /></span>
        <div className="pref__text">
          <b>{t.profile.toastPosition}</b>
          <span>{t.profile.toastPositionHint}</span>
        </div>
        <div className="pref__positions" role="radiogroup" aria-label={t.profile.toastPosition}>
          {TOAST_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={prefs.toastPosition === pos}
              className={`pos-pick pos-pick--${pos}${prefs.toastPosition === pos ? ' is-active' : ''}`}
              disabled={save.isPending}
              onClick={() => save.mutate({ toastPosition: pos as ToastPosition })}
            >
              <span className="pos-pick__screen" aria-hidden><i /></span>
              <span className="pos-pick__label">{t.profile.positions[pos]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function PasswordCard() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    meta: { success: 'Senha alterada' },
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.post('/users/me/password', input),
    onSuccess: () => {
      setDone(true);
      setError(null);
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t.profile.passwordError),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) {
      setError(t.profile.passwordMismatch);
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.profile.passwordError);
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <form className="tp-card account__card" onSubmit={submit}>
      <CardHead icon={<KeyRound size={18} />} title={t.profile.passwordTitle} hint={t.profile.passwordHint} />
      <div className="account__fields account__fields--3">
        <label className="tp-field">
          <span className="tp-label">{t.profile.currentPassword}</span>
          <input className="tp-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="tp-field">
          <span className="tp-label">{t.profile.newPassword}</span>
          <input className="tp-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
        </label>
        <label className="tp-field">
          <span className="tp-label">{t.profile.confirmPassword}</span>
          <input className="tp-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
        </label>
      </div>
      {error && <p className="tp-error">{error}</p>}
      <div className="account__foot">
        {done && <span className="account__saved">{t.profile.passwordChanged}</span>}
        <button type="submit" className="tp-btn tp-btn--secondary" disabled={mutation.isPending || !current || !next || !confirm}>
          {mutation.isPending ? t.profile.saving : t.profile.changePassword}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

const CATEGORY_ICON: Record<AccountActivityCategory, React.ReactNode> = {
  security: <Shield size={15} />,
  profile: <UserRound size={15} />,
  preferences: <SlidersHorizontal size={15} />,
  system: <Activity size={15} />,
};

function ActivityCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<AccountActivityCategory | 'all'>('all');

  const { data, isPending } = useQuery({
    queryKey: ['me-activity', category],
    queryFn: () => api.get<AccountActivity[]>(`/users/me/activity${category === 'all' ? '' : `?category=${category}`}`),
    placeholderData: (prev) => prev,
  });

  const rows = data ?? [];
  const groups = groupByDay(rows, t.profile.today, t.profile.yesterday);
  void queryClient;

  return (
    <section className="tp-card account__card">
      <CardHead icon={<Activity size={18} />} title={t.profile.activityTitle} hint={t.profile.activityHint} />
      <div className="tp-segmented tp-segmented--wide" role="radiogroup" aria-label={t.profile.activityTitle}>
        {(['all', ...ACCOUNT_ACTIVITY_CATEGORIES] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className={`tp-segmented__item${category === c ? ' is-active' : ''}`} onClick={() => setCategory(c)}>
            {c === 'all' ? t.profile.activityAll : t.profile.categories[c]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="tp-muted account__empty">{isPending ? '…' : t.profile.activityEmpty}</p>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="activity__day">
            <div className="activity__day-title"><span>{g.label}</span><i aria-hidden /></div>
            <ul className="activity__list">
              {g.items.map((a) => (
                <li key={a.id} className={`activity activity--${a.category}`}>
                  <span className="activity__icon">{a.action === 'auth.login' ? <LogIn size={15} /> : a.action === 'auth.logout' ? <LogOut size={15} /> : CATEGORY_ICON[a.category]}</span>
                  <div className="activity__text">
                    <b>{actionLabel(a, t.profile.actions)}</b>
                    <span>{[a.ip ? `IP ${a.ip}` : null, a.userAgent ? shortAgent(a.userAgent) : null].filter(Boolean).join(' • ') || '—'}</span>
                  </div>
                  <div className="activity__meta">
                    <span className={`tp-badge activity__cat activity__cat--${a.category}`}>{t.profile.categories[a.category]}</span>
                    <span className="activity__time" title={formatDateTime(a.createdAt)}>{formatRelative(a.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function actionLabel(a: AccountActivity, labels: Record<string, string>): string {
  const known = labels[a.action];
  if (known) return known;
  const [entity, verb] = a.action.split('.');
  return `${entity ?? a.entity}${verb ? ` · ${verb.replace(/-/g, ' ')}` : ''}`;
}

/** "Chrome 130 · Windows" a partir do user agent, sem a sopa de letras inteira. */
function shortAgent(ua: string): string {
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\/(\d+)/.exec(ua)
    ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua)
      ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
      : /Firefox\/(\d+)/.exec(ua)
        ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
        : /Safari\/\d+/.test(ua)
          ? 'Safari'
          : ua.slice(0, 40);
  return [browser, os].filter(Boolean).join(' · ');
}

function groupByDay(rows: AccountActivity[], today: string, yesterday: string) {
  const now = new Date();
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayKey = keyOf(now);
  const yKey = keyOf(new Date(now.getTime() - 86_400_000));
  const map = new Map<string, { key: string; label: string; items: AccountActivity[] }>();
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = keyOf(d);
    if (!map.has(key)) {
      map.set(key, { key, label: key === todayKey ? today : key === yKey ? yesterday : formatDate(r.createdAt), items: [] });
    }
    map.get(key)!.items.push(r);
  }
  return [...map.values()];
}
