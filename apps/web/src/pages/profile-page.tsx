import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, KeyRound, Trash2 } from 'lucide-react';
import { USER_ROLE_LABELS, changePasswordSchema, updateProfileSchema, type PublicUser, type UpdateProfileInput } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/use-auth';
import { useI18n } from '@/i18n/i18n.context';
import { usePageHeader } from '@/components/shell/page-header.context';

/**
 * Meu perfil — os dados que a própria pessoa administra: nome, telefone,
 * foto e senha. E-mail, matrícula e perfil são do administrador (RF-36) e
 * aparecem só para leitura.
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
    <div className="profile">
      <ProfileForm user={user} onSaved={updateUser} />
      <PasswordForm />
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

function ProfileForm({ user, onSaved }: { user: PublicUser; onSaved: (u: PublicUser) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
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
    <form className="tp-card profile__card" onSubmit={submit}>
      <div className="tp-card__head">
        <h3>{t.profile.dataTitle}</h3>
        <span className="tp-badge">{USER_ROLE_LABELS[user.role]}</span>
      </div>

      <div className="profile__identity">
        <div className="profile__avatar-wrap">
          <button
            type="button"
            className="profile__avatar"
            onClick={() => fileRef.current?.click()}
            aria-label={t.profile.changePhoto}
            title={t.profile.changePhoto}
          >
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(name || user.name)}</span>}
            <span className="profile__avatar-hint">
              <Camera size={16} />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickFile(e)} />
          <div className="profile__avatar-actions">
            <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => fileRef.current?.click()}>
              <Camera size={14} /> {t.profile.changePhoto}
            </button>
            {avatarUrl && (
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => { setAvatarUrl(null); setSaved(false); }}>
                <Trash2 size={14} /> {t.profile.removePhoto}
              </button>
            )}
          </div>
          <span className="tp-help">{t.profile.photoHint}</span>
        </div>

        <div className="tp-stack profile__fields">
          <label className="tp-field">
            <span className="tp-label">{t.profile.name}</span>
            <input className="tp-input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={120} required />
          </label>
          <label className="tp-field">
            <span className="tp-label">{t.profile.phone}</span>
            <input className="tp-input" value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} placeholder="(11) 9 0000-0000" maxLength={32} />
          </label>
          <div className="profile__readonly">
            <div className="tp-field">
              <span className="tp-label">{t.profile.email}</span>
              <span className="profile__value">{user.email}</span>
            </div>
            <div className="tp-field">
              <span className="tp-label">{t.profile.registration}</span>
              <span className="profile__value">{user.registration ?? '—'}</span>
            </div>
          </div>
          <span className="tp-help">{t.profile.adminOnly}</span>
        </div>
      </div>

      {error && <p className="tp-error">{error}</p>}

      <div className="profile__foot">
        {saved && !dirty && <span className="profile__saved">{t.profile.saved}</span>}
        <button type="submit" className="tp-btn tp-btn--primary" disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? t.profile.saving : t.profile.save}
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
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
    <form className="tp-card profile__card" onSubmit={submit}>
      <div className="tp-card__head">
        <h3>
          <KeyRound size={16} /> {t.profile.passwordTitle}
        </h3>
        <span className="chart__hint">{t.profile.passwordHint}</span>
      </div>
      <div className="profile__password">
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
      <div className="profile__foot">
        {done && <span className="profile__saved">{t.profile.passwordChanged}</span>}
        <button type="submit" className="tp-btn tp-btn--secondary" disabled={mutation.isPending || !current || !next || !confirm}>
          {mutation.isPending ? t.profile.saving : t.profile.changePassword}
        </button>
      </div>
    </form>
  );
}
