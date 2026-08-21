/**
 * Shared auth hero mark — product name must dominate the first viewport on branded pages.
 */
export function AuthBrandMark({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <div className="et-grad mb-4 flex size-14 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
        <span className="text-xl font-bold tracking-tight text-et-grad-fg" aria-hidden>
          E
        </span>
      </div>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
        Engage CRM
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground">{title}</h1>
      <p className="mt-1.5 text-[13px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}
