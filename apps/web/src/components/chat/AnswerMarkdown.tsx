import Markdown, { type Components } from "react-markdown";
import rehypeSanitize, { type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Everything the model is allowed to put on the page.
 *
 * An allowlist rather than a blocklist, so a tag nobody thought about is
 * dropped instead of rendered. `img` is absent on purpose: an Answer has no
 * reason to load anything from a third party.
 */
const ANSWER_SCHEMA: SanitizeSchema = {
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  attributes: {
    a: ["href", "title"],
    code: [["className", /^language-./]],
    li: ["checked"],
    ol: ["start"],
    td: ["align"],
    th: ["align"],
  },
  protocols: { href: ["http", "https"] },
  strip: ["script", "style"],
  clobberPrefix: "answer-",
  clobber: ["id", "name"],
};

// Tailwind has no typography plugin here, so an Answer's block elements are
// styled from the wrapper.
const ANSWER_PROSE = [
  "min-w-0 text-base leading-relaxed break-words",
  "[&>*+*]:mt-3",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
  "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_hr]:border-border",
  "[&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:w-full [&_table]:text-left [&_th]:font-medium",
  "[&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-4 dark:[&_a]:text-blue-400",
].join(" ");

const ANSWER_COMPONENTS: Components = {
  a({ node: _node, href, children }) {
    // Citations stay server-computed (ADR-0002). Inline http(s) links that
    // survive the sanitiser are rendered so a phrase like "this link" is
    // actually a link.
    if (!href) {
      return <span>{children}</span>;
    }
    return (
      <a href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  },
};

/**
 * Renders an Answer as markdown, including one that is still being written.
 *
 * A half-finished code fence or link is ordinary input to the markdown parser,
 * which closes whatever the model has not yet closed, so a partial Answer
 * renders rather than breaking the page.
 */
export function AnswerMarkdown({ children }: { children: string }) {
  return (
    <div className={ANSWER_PROSE}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, ANSWER_SCHEMA]]}
        components={ANSWER_COMPONENTS}
      >
        {children}
      </Markdown>
    </div>
  );
}
