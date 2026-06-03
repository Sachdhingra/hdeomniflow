import ReactMarkdown from "react-markdown";

interface Profile { id: string; name: string }

interface Props {
  body: string;
  mine: boolean;
  profiles: Profile[];
  currentUserId: string;
}

/** Renders chat body as markdown with @mention highlighting. */
const MessageBody = ({ body, mine, profiles, currentUserId }: Props) => {
  // Highlight @mentions by replacing tokens with markdown-styled span via simple regex pass first.
  // We escape later by letting react-markdown treat ` ` etc normally.
  const names = profiles.map(p => p.name).filter(Boolean);
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionRe = names.length
    ? new RegExp(`@(${names.map(escapeRe).join("|")})\\b`, "g")
    : null;

  const withMentions = mentionRe
    ? body.replace(mentionRe, (_m, n) => `**@${n}**`)
    : body;

  const isMentioningMe = (() => {
    const me = profiles.find(p => p.id === currentUserId)?.name;
    if (!me) return false;
    return new RegExp(`@${escapeRe(me)}\\b`).test(body);
  })();

  return (
    <div
      className={`prose prose-sm max-w-none break-words ${
        mine ? "prose-invert" : ""
      } prose-p:my-0 prose-pre:my-1 prose-code:before:hidden prose-code:after:hidden ${
        isMentioningMe ? "ring-2 ring-amber-400/60 rounded-md p-0.5 -m-0.5" : ""
      }`}
    >
      <ReactMarkdown
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" className="underline" />
          ),
          code: ({ node, ...props }) => (
            <code {...props} className="px-1 py-0.5 rounded bg-black/10 text-[0.85em]" />
          ),
        }}
      >
        {withMentions}
      </ReactMarkdown>
    </div>
  );
};

export default MessageBody;
