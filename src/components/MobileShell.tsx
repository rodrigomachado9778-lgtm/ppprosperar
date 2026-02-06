export function MobileShell({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto w-full max-w-md px-4 pb-8 pt-6">
        {(title || subtitle) && (
          <div className="mb-5">
            {title && (
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            )}
            {subtitle && <p className="text-sm text-zinc-400">{subtitle}</p>}
          </div>
        )}

        <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800 shadow">
          {children}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          © {new Date().getFullYear()} Bingo
        </p>
      </div>
    </div>
  );
}
