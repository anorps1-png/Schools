export interface Etablissement {
  id: string;
  nom: string;
  seuilReussite: number; // Configurable: ex. 10
  anneeScolaireActiveId: string;
}

export interface AnneeScolaire {
  id: string;
  nom: string; // ex: "2024-2025"
  dateDebut: string;
  dateFin: string;
}

export interface Section {
  id: string;
  etablissementId: string;
  nom: 'Francophone' | 'Anglophone' | string;
}

export interface NiveauClasse {
  id: string;
  sectionId: string;
  nom: string; // ex: "CM2", "Form 1", "Maternelle Grande Section"
  cycle: 'Maternelle' | 'Primaire' | 'Secondaire';
}

export interface Classe {
  id: string;
  niveauId: string;
  anneeScolaireId: string;
  nom: string; // ex: "CM2 A"
  enseignantPrincipalId?: string;
  enseignantAssistantId?: string;
  sectionId?: string; // ex: 'sec-fr' ou 'sec-en'
  prix?: number; // Prix de la scolarité pour cette classe
  frais_inscription?: number;
  fraisInscription?: number;
  // Agrégations pré-calculées
  effectifTotal?: number;
  effectifFilles?: number;
  effectifGarcons?: number;
  moyenneClasse?: number;
  tauxReussite?: number;
}

export interface Matiere {
  id: string;
  niveauId: string;
  nom: string;
  coefficient: number;
  bareme: number; // ex: 20, 30, 50
  examenOfficiel: boolean;
}

export interface Paiement {
  id: string;
  eleveId: string;
  montant: number;
  date: string;
  modePaiement: 'Orange Money' | 'MTN Mobile Money' | 'Espèces' | 'Virement Bancaire';
  typeFrais: 'Scolarité' | 'Inscription' | 'Examen' | 'Transport';
  statut: 'paid' | 'pending' | 'failed';
  reference: string;
  /** Tranche de scolarité à laquelle ce paiement a été explicitement rattaché
   * (uniquement pertinent pour typeFrais === 'Scolarité'). Absent pour les
   * paiements antérieurs à cette fonctionnalité ou les autres types de frais. */
  trancheId?: string | null;
}

export interface Eleve {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  sexe: 'M' | 'F';
  dateNaissance: string;
  lieuNaissance: string;
  
  // Affectation
  classeId: string;
  anneeScolaireId: string;

  // Contact
  telephoneParent: string;
  nomParent: string;
  emailParent: string;
  
  dateInscription: string;
  statut: 'actif' | 'suspendu' | 'transfere';
  photoUrl?: string;
  estSubventionne?: boolean;
  est_subventionne?: boolean;

  // Attributs pour jointure locale/API
  statutPaiement?: 'paid' | 'partial' | 'unpaid';
  paiements?: Paiement[];
  notes?: NoteMatiere[];
  bulletins?: Bulletin[];
  discipline?: DisciplineIncident[];
}

export interface Enseignant {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  genre: 'M' | 'F';
  matieresId: string[]; // Liste des IDs des matières enseignées
  classesId: string[];  // Liste des IDs des classes
  statut: 'active' | 'inactive';
  dateRecrutement: string;
  photoUrl?: string;
}

export interface NoteMatiere {
  id: string;
  eleveId: string;
  matiereId: string;
  trimestre: 'Trimestre 1' | 'Trimestre 2' | 'Trimestre 3';
  
  // Évaluation classique
  note?: number; // La note obtenue sur le barème de la matière
  coefficient?: number; // Le coefficient appliqué à cette note
  
  // Évaluation maternelle
  evaluationMaternelle?: 'Acquis' | 'En cours' | 'Non acquis';
  
  enseignantId: string;
  dateSaisie: string;
}

export interface Bulletin {
  id: string;
  eleveId: string;
  classeId: string;
  trimestre: 'Trimestre 1' | 'Trimestre 2' | 'Trimestre 3';
  anneeScolaireId: string;
  
  totalPoints: number;
  moyenne: number;
  rang: number;
  mention: string;
  
  // Remarques et signatures
  appreciationEnseignant?: string;
}

export interface ConfigurationFrais {
  niveauId: string;
  fraisInscription: number;
  fraisScolarite: number;
  fraisExamen: number;
  total: number;
}

export interface DisciplineIncident {
  id: string;
  eleveId: string;
  dateIncident: string;
  typeIncident: 'Absence' | 'Retard' | 'Avertissement' | 'Blâme' | 'Exclusion' | 'Autre' | string;
  motif: string;
  sanction?: string;
  statut: 'Non notifié' | 'Notifié au parent' | 'Convoqué' | 'Clos' | string;
}

// Représente l'objet d'une transaction de paiement aplati avec jointure de l'élève
export interface TransactionPaiement extends Paiement {
  nomEleve: string;
  matriculeEleve: string;
  classeNom: string;
}

// Représente un cours de l'emploi du temps
export interface Cours {
  id: string;
  classeId: string;
  matiereId: string;
  enseignantId: string;
  jourSemaine: number; // 1 = Lundi, 2 = Mardi, ..., 6 = Samedi
  heureDebut: string; // ex: '08:00'
  heureFin: string;   // ex: '10:00'
  salle: string;
  couleur: string;
}

// Module Comptabilité OHADA
export interface CompteOHADA {
  numero: string;
  libelle: string;
  classe: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface LigneEcriture {
  compteNumero: string;
  debit: number;
  credit: number;
}

export interface EcritureComptable {
  id: string;
  date: string;
  libelle: string;
  reference: string;
  lignes: LigneEcriture[];
  partenaire?: string;
}

// Module Ressources Humaines (RH)

export interface MembrePersonnel {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  sexe: 'M' | 'F';
  categorie: 'Administration' | 'Enseignant' | 'Personnel d\'appui' | 'Technique';
  typeContrat: 'CDI' | 'CDD' | 'Intérimaire' | 'Stagiaire';
  salaireDeBase: number;
  dateEmbauche: string;
  statut: 'actif' | 'suspendu' | 'quitte';
  modePaiementPreferentiel?: 'Banque' | 'Caisse';
}

export interface MasseSalarialeHistorique {
  periode: string; // ex: "2026-01" ou "2025"
  valeurTotal: number;
  nombreSalaries: number;
  salaireMoyen: number;
  interessement: number;
  tauxCroissance: number;
}

export interface AbsenceRecord {
  id: string;
  personnelId: string;
  nomPersonnel: string;
  dateDebut: string;
  dateFin: string;
  motif: 'Maladie' | 'Maternité' | 'Congé' | 'Injustifié' | 'Autre';
  dureeJours: number;
}

export interface MouvementPersonnel {
  id: string;
  personnelId: string;
  nomPersonnel: string;
  type: 'embauche' | 'depart_volontaire' | 'mutation' | 'licenciement';
  date: string;
  details: string; // ex: motif ou cible
}

export interface EvaluationRH {
  id: string;
  enseignantId: string;
  nomEnseignant: string;
  noteMoyenne: number; // sur 100
  adherenceJobRole: number; // pourcentage
  adherenceValeurs: number; // pourcentage
  noteFormationMoyenne: number; // sur 20
  dateEvaluation: string;
  evaluateur: string;
}

export interface FormationRH {
  id: string;
  theme: string;
  dateDebut: string;
  dateFin: string;
  beneficiairesIds: string[]; // IDs des membres de personnel bénéficiaires
  coutTotal: number;
  organisme: string;
  statut: 'planifié' | 'en_cours' | 'terminé';
}

// Bulletin de paie conforme CNPS Cameroun
export interface FicheDePaie {
  id: string;
  personnelId: string;
  nomPersonnel: string;
  periode: string; // ex: "2026-06"
  datePaiement: string;

  // Éléments de rémunération
  salaireDeBase: number;
  primeTransport: number;
  primeLogement: number;
  primeAnciennete: number;
  autresPrimes: number;
  salaireBrut: number;

  // Retenues salariales (part employé)
  cnpsSalariale: number;       // Pension Vieillesse — défaut 4.2%
  cfcSalariale: number;        // Crédit Foncier — défaut 1.0%
  irpp: number;                // Impôt sur le Revenu — barème progressif
  cac: number;                 // Centimes Additionnels Communaux — 10% de l'IRPP
  rav: number;                 // Redevance Audio Visuelle — 13 000 FCFA/an
  totalRetenues: number;

  // Charges patronales
  cnpsPatronale: number;       // défaut 16.2% (AF + AT/MP + PV)
  cfcPatronale: number;        // défaut 1.5%
  fne: number;                 // Fonds National Emploi — défaut 1.0%
  totalChargesPatronales: number;

  // Net
  netAPayer: number;

  modePaiement?: 'Banque' | 'Caisse';

  statut: 'brouillon' | 'valide' | 'paye';
}

