import { AVATAR_RULES, type MeResponse, type PublicUser } from '@plataforma/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Avatar, Button, toast } from '@/components/ui';
import { api, ApiRequestError, uploadFile } from '@/lib/api';
import { meKey } from '../auth/auth-api';

/** Foto de perfil: escolher, trocar ou remover. O servidor recorta em quadrado. */
export function AvatarEditor({ user }: { user: PublicUser }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const apply = (u: PublicUser) => {
    qc.setQueryData<MeResponse | null>(meKey, (m) => m && { ...m, user: u });
    void qc.invalidateQueries({ queryKey: ['conversation'] });
  };
  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadFile<PublicUser>('/users/me/avatar', file, undefined, undefined, 'PUT'),
    onSuccess: (u) => {
      apply(u);
      toast('Foto atualizada.');
    },
    onError: (e) =>
      toast(e instanceof ApiRequestError ? e.message : 'Não foi possível enviar a foto.', 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api<PublicUser>('DELETE', '/users/me/avatar'),
    onSuccess: (u) => {
      apply(u);
      toast('Foto removida.');
    },
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > AVATAR_RULES.maxSizeBytes) {
      toast(`A foto passa do limite de ${AVATAR_RULES.maxSizeBytes / 1024 / 1024} MB.`, 'error');
      return;
    }
    upload.mutate(file);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-full"
        aria-label="Trocar foto de perfil"
      >
        <Avatar name={user.displayName} size={72} src={user.avatarUrl} />
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Camera size={22} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={AVATAR_RULES.acceptedTypes.join(',')}
        className="hidden"
        onChange={onPick}
      />
      <div className="flex flex-col items-start gap-1.5">
        <Button
          variant="secondary"
          loading={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Camera size={15} aria-hidden="true" />{' '}
          {user.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}
        </Button>
        {user.avatarUrl && (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-danger"
          >
            <Trash2 size={13} aria-hidden="true" /> Remover foto
          </button>
        )}
      </div>
    </div>
  );
}
