import { Fragment } from 'react';

/** Texto da mensagem: quebras de linha preservadas, links clicáveis e menções em destaque. Nunca HTML. */
const URL_RE = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function MessageText({
  text,
  mentionNames = [],
  mentionsAll = false,
  myName,
}: {
  text: string;
  /** Nomes das pessoas mencionadas, como aparecem depois do @. */
  mentionNames?: string[];
  mentionsAll?: boolean;
  /** Menção a mim recebe destaque maior. */
  myName?: string;
}) {
  const tokens = [...mentionNames, ...(mentionsAll ? ['todos'] : [])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => `@${escape(n)}`);
  const mentionRe = tokens.length ? new RegExp(`(${tokens.join('|')})`, 'giu') : null;
  const me = myName?.toLocaleLowerCase('pt-BR');

  const withMentions = (chunk: string, key: number) => {
    if (!mentionRe) return chunk;
    const pieces = chunk.split(mentionRe);
    return (
      <Fragment key={key}>
        {pieces.map((p, i) => {
          if (i % 2 === 0) return p;
          const target = p.slice(1).toLocaleLowerCase('pt-BR');
          const toMe = target === me || target === 'todos';
          return (
            <span
              key={i}
              className={`rounded px-0.5 font-semibold ${toMe ? 'bg-accent-soft text-ink' : 'text-primary'}`}
            >
              {p}
            </span>
          );
        })}
      </Fragment>
    );
  };

  const parts = text.split(URL_RE);
  return (
    <span className="break-words whitespace-pre-wrap">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {p}
          </a>
        ) : (
          withMentions(p, i)
        ),
      )}
    </span>
  );
}
