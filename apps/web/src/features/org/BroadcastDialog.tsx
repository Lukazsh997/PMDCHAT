import { FILE_RULES, MESSAGE_RULES, type UploadedFile } from '@plataforma/contracts';
import { FileText, Megaphone, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Button, Dialog, toast } from '@/components/ui';
import { ApiRequestError, uploadFile } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { type TreeNode, useBroadcastPreview, useSendBroadcast } from './org-api';

interface Pending {
  key: string;
  file: File;
  result?: UploadedFile;
  error?: string;
}

/**
 * Comunicado em massa para uma unidade. Cada pessoa recebe na conversa direta com
 * quem enviou; as respostas chegam em particular.
 */
export function BroadcastDialog({
  open,
  onClose,
  node,
}: {
  open: boolean;
  onClose: () => void;
  node: TreeNode;
}) {
  const [body, setBody] = useState('');
  const [includeSubunits, setIncludeSubunits] = useState(true);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const hasChildren = node.children.length > 0;
  const preview = useBroadcastPreview(node.id, includeSubunits && hasChildren, open);
  const send = useSendBroadcast();
  const count = preview.data?.recipientCount;

  const uploading = pending.some((p) => !p.result && !p.error);
  const ready = pending.filter((p) => p.result).map((p) => p.result!.id);
  const canSend =
    !uploading &&
    !pending.some((p) => p.error) &&
    (body.trim().length > 0 || ready.length > 0) &&
    !!count;

  function reset() {
    setBody('');
    setPending([]);
    setConfirming(false);
    setClientId(crypto.randomUUID());
    send.reset();
  }

  function close() {
    if (send.isPending) return;
    reset();
    onClose();
  }

  function addFiles(list: FileList) {
    for (const file of [...list].slice(
      0,
      MESSAGE_RULES.maxAttachmentsPerMessage - pending.length,
    )) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if ((FILE_RULES.blockedExtensions as readonly string[]).includes(ext)) {
        toast(`Arquivos .${ext} não são permitidos por segurança.`, 'error');
        continue;
      }
      if (file.size > FILE_RULES.maxSizeBytes) {
        toast(
          `"${file.name}" passa do limite de ${FILE_RULES.maxSizeBytes / 1024 / 1024} MB.`,
          'error',
        );
        continue;
      }
      const key = `${file.name}-${Math.random()}`;
      setPending((p) => [...p, { key, file }]);
      const update = (patch: Partial<Pending>) =>
        setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      uploadFile<UploadedFile>('/files', file)
        .then((result) => update({ result }))
        .catch((e: unknown) =>
          update({ error: e instanceof ApiRequestError ? e.message : 'Falha no envio' }),
        );
    }
  }

  function submit() {
    send.mutate(
      {
        orgUnitId: node.id,
        includeSubunits: includeSubunits && hasChildren,
        clientId,
        body,
        attachmentIds: ready,
      },
      {
        onSuccess: (r) => {
          toast(
            `Comunicado enviado para ${r.recipientCount} ${r.recipientCount === 1 ? 'pessoa' : 'pessoas'}.`,
          );
          reset();
          onClose();
        },
      },
    );
  }

  const target = `${node.name}${includeSubunits && hasChildren ? ' e subunidades' : ''}`;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Enviar comunicado"
      description={`Para ${target}. Cada pessoa recebe em conversa particular com você; as respostas chegam só para você.`}
      footer={
        confirming ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={send.isPending}
            >
              Voltar
            </Button>
            <Button onClick={submit} loading={send.isPending}>
              <Megaphone size={16} aria-hidden="true" /> Confirmar envio para {count}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!canSend}>
              Revisar envio
            </Button>
          </>
        )
      }
    >
      {send.isError && (
        <div className="mb-4">
          <Alert tone="error">{send.error.message}</Alert>
        </div>
      )}
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{count}</strong> {count === 1 ? 'pessoa vai' : 'pessoas vão'} receber este
            comunicado de <strong>{target}</strong>. Não é possível desfazer o envio.
          </p>
          <blockquote className="max-h-60 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-paper px-4 py-3 text-sm whitespace-pre-wrap">
            {body || <span className="text-muted italic">Sem texto</span>}
          </blockquote>
          {pending.length > 0 && (
            <p className="text-sm text-muted">
              {pending.length} {pending.length === 1 ? 'anexo' : 'anexos'}:{' '}
              {pending.map((p) => p.file.name).join(', ')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {hasChildren && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-semibold">Quem recebe</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="alcance"
                  checked={includeSubunits}
                  onChange={() => setIncludeSubunits(true)}
                  className="accent-[var(--color-primary)]"
                />
                {node.name} e todas as unidades abaixo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="alcance"
                  checked={!includeSubunits}
                  onChange={() => setIncludeSubunits(false)}
                  className="accent-[var(--color-primary)]"
                />
                Só quem está lotado em {node.name}
              </label>
            </fieldset>
          )}
          <p className="text-sm" aria-live="polite">
            {count === undefined
              ? 'Contando destinatários…'
              : count === 0
                ? 'Não há pessoas ativas para receber.'
                : `${count} ${count === 1 ? 'destinatário' : 'destinatários'}.`}
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Mensagem</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MESSAGE_RULES.maxBodyLength}
              rows={7}
              placeholder="Escreva o comunicado"
              className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <div>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <Paperclip size={15} aria-hidden="true" /> Anexar arquivo
            </Button>
            {pending.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {pending.map((p) => (
                  <li
                    key={p.key}
                    className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm"
                  >
                    <FileText size={15} aria-hidden="true" className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                    <span className={`text-xs ${p.error ? 'text-danger' : 'text-muted'}`}>
                      {p.error ?? (p.result ? formatBytes(p.file.size) : 'enviando…')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))}
                      aria-label={`Remover ${p.file.name}`}
                      className="text-muted hover:text-danger"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
