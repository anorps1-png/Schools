import React from 'react';
import Link from 'next/link';

export default function Hero() {
  const features = [
    { icon: '👥', label: 'Gestion complète des élèves' },
    { icon: '📊', label: 'Notes et bulletins automatisés' },
    { icon: '💰', label: 'Suivi des paiements intégré' },
  ];

  return (
    <section className="px-4 sm:px-6 lg:px-8 pt-20 pb-20 lg:pt-24 lg:pb-24 text-center flex flex-col items-center">
      <div className="inline-flex items-center gap-2 text-sm font-bold text-green bg-green-bg rounded-pill px-4 py-2 animate-fade-up">
        <span className="w-2 h-2 rounded-full bg-green animate-pulse-dot"></span>
        Spécialement conçu pour le Cameroun
      </div>

      <h1 className="mt-7 text-5xl md:text-6xl lg:text-7xl font-extrabold text-ink tracking-[-3px] leading-[1.02] max-w-4xl animate-fade-up [animation-delay:0.08s]">
        La gestion de votre école, <span className="text-accent">enfin simplifiée.</span>
      </h1>

      <p className="mt-7 text-lg md:text-xl text-ink-soft font-medium max-w-2xl leading-relaxed animate-fade-up [animation-delay:0.16s]">
        School&apos;s centralise les élèves, les enseignants, les paiements, les notes et les bulletins dans une seule plateforme, pensée pour les écoles camerounaises.
      </p>

      <div className="flex flex-col sm:flex-row justify-center gap-3.5 mt-10 animate-fade-up [animation-delay:0.24s]">
        <Link href="/login?signup=true" className="px-9 py-4 bg-accent text-cream rounded-[16px] font-extrabold text-lg hover:bg-accent-hover transition-colors shadow-cta">
          Essayer gratuitement
        </Link>
        <Link href="/login" className="px-9 py-4 bg-surface text-ink border border-outline rounded-[16px] font-bold text-lg hover:border-ink transition-colors">
          Voir la démo →
        </Link>
      </div>

      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-card overflow-hidden max-w-3xl w-full animate-fade-up [animation-delay:0.32s]">
        {features.map((f) => (
          <div key={f.label} className="bg-surface px-7 py-7 flex flex-col items-center gap-3">
            <span className="text-[40px]">{f.icon}</span>
            <div className="text-sm font-semibold text-ink-faint">{f.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
