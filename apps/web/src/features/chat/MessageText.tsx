/** Texto da mensagem: quebras de linha preservadas e links clicáveis. Nunca HTML. */
const URL_RE = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

export function MessageText({ text }: { text: string }) {
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
          p
        ),
      )}
    </span>
  );
}
