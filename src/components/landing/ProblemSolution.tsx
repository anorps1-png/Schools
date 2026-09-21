import React from 'react';

export default function ProblemSolution() {
  const problems = [
    "Registres papier qui s'abîment, se perdent ou sont illisibles.",
    "Difficile de savoir avec certitude qui a payé ou non les frais de scolarité.",
    "Préparation des bulletins de notes qui prend des jours entiers aux enseignants.",
    "Communication difficile et lente avec les parents d'élèves.",
    "Comptabilité complexe et erreurs de calcul manuelles.",
  ];
  const solutions = [
    "Vous gérez tout en ligne : inscriptions, dossiers élèves, et historique.",
    "Paiements suivis en temps réel (espèces, MTN Mobile Money, Orange Money).",
    "Notes saisies en un clic, calcul automatique et bulletins PDF générés instantanément.",
    "Tableau de bord comptable clair basé sur les normes OHADA.",
    "Emplois du temps synchronisés par classe et par enseignant.",
  ];

  return (
    <section id="solution" className="py-20 lg:py-24 bg-surface border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-1.5px] text-ink">
            La gestion scolaire ne devrait pas être un casse-tête
          </h2>
          <p className="mt-3 text-base text-ink-soft font-medium">
            Fini le stress des fins de trimestre et le suivi manuel des paiements.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* Les Problèmes */}
          <div className="bg-red-bg rounded-card-lg p-8 border border-border">
            <h3 className="text-lg font-extrabold text-accent mb-5">Avant School&apos;s</h3>
            <ul className="space-y-3.5">
              {problems.map((p, i) => (
                <li key={i} className="flex gap-3 text-sm text-ink-soft">
                  <span className="text-accent font-extrabold shrink-0">✕</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* La Solution */}
          <div className="bg-green-bg rounded-card-lg p-8 border border-border relative">
            <div className="absolute -top-3 -right-3 bg-accent text-cream font-extrabold px-4 py-1 rounded-pill text-xs shadow-cta">
              La solution
            </div>
            <h3 className="text-lg font-extrabold text-green mb-5">Avec School&apos;s</h3>
            <ul className="space-y-3.5">
              {solutions.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-ink-soft">
                  <span className="text-green font-extrabold shrink-0">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
