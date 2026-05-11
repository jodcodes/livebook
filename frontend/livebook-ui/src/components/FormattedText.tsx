"use client";

interface FormattedTextProps {
  text: string;
  className?: string;
}

export default function FormattedText({ text, className = "" }: FormattedTextProps) {
  if (!text) return null;

  // Split into paragraphs by double newlines
  const paragraphs = text.split(/\n\n+/);

  return (
    <div className={`space-y-3 ${className}`}>
      {paragraphs.map((paragraph, pIdx) => {
        const lines = paragraph.split("\n");

        // Check if this paragraph is a bullet list
        const isBulletList = lines.every((line) => line.trim().startsWith("- ") || line.trim().startsWith("* ") || line.trim() === "");

        if (isBulletList && lines.length > 1) {
          return (
            <ul key={pIdx} className="list-disc list-inside space-y-1">
              {lines
                .filter((line) => line.trim())
                .map((line, lIdx) => (
                  <li key={lIdx} className="text-sm text-foreground/90 leading-relaxed">
                    <InlineBold text={line.trim().replace(/^[-*]\s+/, "")} />
                  </li>
                ))}
            </ul>
          );
        }

        // Check for numbered list
        const isNumberedList = lines.every((line) => /^\d+\.\s/.test(line.trim()) || line.trim() === "");
        if (isNumberedList && lines.length > 1) {
          return (
            <ol key={pIdx} className="list-decimal list-inside space-y-1">
              {lines
                .filter((line) => line.trim())
                .map((line, lIdx) => (
                  <li key={lIdx} className="text-sm text-foreground/90 leading-relaxed">
                    <InlineBold text={line.trim().replace(/^\d+\.\s+/, "")} />
                  </li>
                ))}
            </ol>
          );
        }

        // Regular paragraph
        return (
          <p key={pIdx} className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
            <InlineBold text={paragraph} />
          </p>
        );
      })}
    </div>
  );
}

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
