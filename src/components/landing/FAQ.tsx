import React from 'react';

export default function FAQ() {
  const faqs = [
    {
      q: "Est-ce que School's fonctionne sans connexion internet ?",
      a: "Oui ! School's est capable de fonctionner en mode hors-ligne. Vous pouvez continuer à saisir des notes ou enregistrer des paiements sans internet. Une fois la connexion rétablie, toutes vos données seront automatiquement synchronisées dans la base de données de l'école. De plus, vous avez toujours la possibilité d'exporter l'ensemble de vos données sur Excel à tout moment.",
    },
    {
      q: "Les données de mon école sont-elles en sécurité ?",
      a: "Absolument. Nous utilisons des serveurs sécurisés et vos données sont sauvegardées quotidiennement. Personne d'autre que les administrateurs autorisés de votre école ne peut y accéder.",
    },
    {
      q: "Si un autre établissement importe des données avec des structures similaires, y aura-t-il un conflit ?",
      a: "Non, absolument aucun risque. School's s'appuie sur des politiques de sécurité au niveau des lignes (RLS) de Supabase. Chaque établissement dispose d'un espace hermétiquement cloisonné : il est impossible qu'un établissement accède aux données d'un autre ou provoque des conflits d'importation.",
    },
    {
      q: "Que se passe-t-il si je décide de supprimer mon compte ?",
      a: "Vous êtes pleinement propriétaire de vos données. Dans vos paramètres, vous disposez d'un bouton de suppression définitive. Après double validation, ce processus efface instantanément et intégralement toutes vos données (élèves, paiements, écritures comptables, bulletins) de notre base de données, ainsi que votre compte utilisateur.",
    },
    {
      q: "Pouvez-vous adapter les bulletins à notre modèle actuel ?",
      a: "Oui, la plateforme permet de configurer le format d'impression des bulletins et des relevés de notes pour qu'ils respectent la charte graphique de votre établissement.",
    },
    {
      q: "Comment se passe la formation de mon personnel ?",
      a: "Lors de la souscription au plan Standard ou Premium, une session d'accompagnement est incluse pour former l'intendant, le censeur et le personnel administratif à l'utilisation du logiciel.",
    },
  ];

  return (
    <section className="py-20 lg:py-24 bg-bg border-t border-border">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-1.5px] text-ink">
            Questions fréquentes
          </h2>
        </div>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-surface p-6 rounded-card border border-border">
              <h4 className="text-base font-extrabold text-ink mb-2">{faq.q}</h4>
              <p className="text-sm text-ink-soft leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
