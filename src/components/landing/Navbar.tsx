import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="sticky top-[5px] z-40 w-full bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-[68px] items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-[38px] h-[38px] rounded-[12px] bg-ink text-cream flex items-center justify-center font-extrabold text-lg">S</div>
            <span className="font-extrabold text-xl tracking-tight text-ink">School&apos;s</span>
          </div>

          <div className="hidden md:flex items-center gap-7 text-sm font-semibold">
            <a href="#solution" className="text-ink-soft hover:text-ink transition-colors">Solution</a>
            <a href="#fonctionnalites" className="text-ink-soft hover:text-ink transition-colors">Fonctionnalités</a>
            <a href="#tarifs" className="text-ink-soft hover:text-ink transition-colors">Tarifs</a>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:inline-flex items-center border border-outline text-ink px-5 py-2.5 rounded-pill text-sm font-bold hover:border-ink transition-colors">
              Se connecter
            </Link>
            <Link href="/login?signup=true" className="bg-accent text-cream px-5 py-2.5 rounded-pill text-sm font-extrabold hover:bg-accent-hover transition-colors shadow-cta">
              Essayer gratuitement
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
