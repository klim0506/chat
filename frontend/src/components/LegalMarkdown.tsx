import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";

interface LegalMarkdownProps {
  markdown: string;
}

function isInternalHref(href: string) {
  return href.startsWith("/") || href.startsWith("#");
}

export function LegalMarkdown({ markdown }: LegalMarkdownProps) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mb-5">
            {children as ReactNode}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mt-8 mb-3">
            {children as ReactNode}
          </h2>
        ),
        p: ({ children }) => (
          <p className="text-sm text-slate-700 leading-relaxed mb-3 last:mb-0">
            {children as ReactNode}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1 mb-3 last:mb-0">
            {children as ReactNode}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1 mb-3 last:mb-0">
            {children as ReactNode}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children as ReactNode}</li>,
        a: ({ href, children }) => {
          const safeHref = (href ?? "").trim();
          const cls = "text-blue-700 underline underline-offset-2 hover:text-blue-800";
          if (!safeHref) return <span className={cls}>{children as ReactNode}</span>;
          if (isInternalHref(safeHref)) return <Link to={safeHref} className={cls}>{children as ReactNode}</Link>;
          return (
            <a href={safeHref} className={cls} target="_blank" rel="noopener noreferrer">
              {children as ReactNode}
            </a>
          );
        },
        code: ({ inline, children }) =>
          inline ? (
            <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-800 text-[0.85em]">
              {children as ReactNode}
            </code>
          ) : (
            <code className="text-slate-100 text-xs">{children as ReactNode}</code>
          ),
        pre: ({ children }) => (
          <pre className="bg-slate-900 rounded-xl p-4 overflow-x-auto mb-4">
            {children as ReactNode}
          </pre>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden bg-white">
              {children as ReactNode}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-slate-50">{children as ReactNode}</thead>,
        th: ({ children }) => (
          <th className="text-left font-semibold text-slate-800 px-3 py-2 border-b border-slate-200">
            {children as ReactNode}
          </th>
        ),
        td: ({ children }) => (
          <td className="align-top text-slate-700 px-3 py-2 border-b border-slate-100">
            {children as ReactNode}
          </td>
        ),
        hr: () => <hr className="my-6 border-slate-200" />,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

