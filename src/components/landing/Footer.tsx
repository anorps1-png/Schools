import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer id="contact" className="bg-ink pt-20 pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* CTA finale */}
        <div className="bg-accent rounded-card-lg p-8 md:p-12 text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-extrabold text-cream tracking-[-1px] mb-6">
            Prêt à moderniser la gestion de votre établissement ?
          </h2>
          <div className="flex flex-col sm:flex-row justify-center gap-3.5">
            <Link href="/login?signup=true" className="px-8 py-4 bg-cream text-ink rounded-control font-extrabold text-lg hover:bg-surface transition-colors">
              Essayer gratuitement
            </Link>
            <Link href="mailto:contact@mboaschool.com" className="px-8 py-4 bg-transparent text-cream border border-cream/30 rounded-control font-bold text-lg hover:border-cream transition-colors">
              Nous contacter
            </Link>
          </div>
        </div>

        {/* Liens */}
        <div className="grid md:grid-cols-4 gap-8 mb-10 border-b border-cream/10 pb-10">
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[10px] bg-accent text-cream flex items-center justify-center font-extrabold text-[15px]">S</div>
              <span className="font-extrabold text-lg text-cream tracking-tight">School&apos;s</span>
            </div>
            <p className="text-[#a89a7e] max-w-sm text-sm font-medium leading-relaxed">
              Le logiciel de gestion scolaire conçu sur-mesure pour les réalités des collèges et lycées du Cameroun.
            </p>
          </div>
          <div>
            <h4 className="text-cream font-extrabold mb-4 text-sm">Produit</h4>
            <ul className="space-y-2.5 text-sm text-[#a89a7e] font-medium">
              <li><a href="#fonctionnalites" className="hover:text-cream transition-colors">Fonctionnalités</a></li>
              <li><a href="#tarifs" className="hover:text-cream transition-colors">Tarifs</a></li>
              <li><a href="#solution" className="hover:text-cream transition-colors">Cas d&apos;usage</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-cream font-extrabold mb-4 text-sm">Légal</h4>
            <ul className="space-y-2.5 text-sm text-[#a89a7e] font-medium">
              <li><a href="#" className="hover:text-cream transition-colors">Mentions légales</a></li>
              <li><a href="#" className="hover:text-cream transition-colors">Confidentialité</a></li>
              <li><a href="#" className="hover:text-cream transition-colors">CGV</a></li>
            </ul>
          </div>
        </div>

        <div className="text-center text-[#a89a7e] text-sm font-medium">
          © {new Date().getFullYear()} School&apos;s · Yaoundé, Cameroun · Fait avec soin pour les écoles d&apos;Afrique centrale
        </div>
      </div>
    </footer>
  );
}
