import type { LegalDocument } from '@content/legal';

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <article className="mx-auto w-full max-w-2xl px-6 pt-12 pb-24 md:pt-16">
      <header className="mb-10 flex flex-col gap-3">
        <h1 className="text-title-page">{document.title}</h1>
        <p className="text-body text-muted-foreground">
          Last updated: <time dateTime={document.updatedAt}>{document.updatedLabel}</time>
        </p>
      </header>
      <div className="flex flex-col gap-11 text-body-lg text-foreground/90">
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-3.5 text-title-section text-foreground">{section.heading}</h2>
            <div className="space-y-4">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
