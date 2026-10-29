-- ==========================================
-- SCHEMA SUPABASE UNIFIÉ - MBOASCHOOL / APON
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Base et Configuration Globale
CREATE TABLE public.etablissements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL,
  seuil_reussite NUMERIC DEFAULT 10,
  annee_scolaire_active_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.annees_scolaires (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL, -- ex: "2025-2026"
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  etablissement_id UUID REFERENCES public.etablissements(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Relation réciproque
ALTER TABLE public.etablissements 
  ADD CONSTRAINT fk_annee_active 
  FOREIGN KEY (annee_scolaire_active_id) 
  REFERENCES public.annees_scolaires(id) ON DELETE SET NULL;

-- 2. Profils Utilisateurs et Rôles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY, -- Référence auth.users.id
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'directeur', 'enseignant', 'parent')),
  etablissement_id UUID REFERENCES public.etablissements(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Structure Académique
CREATE TABLE public.sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  etablissement_id UUID NOT NULL REFERENCES public.etablissements(id) ON DELETE CASCADE,
  nom TEXT NOT NULL, -- ex: "Francophone", "Anglophone"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.niveaux_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  nom TEXT NOT NULL, -- ex: "CM2", "Form 1", "6ème"
  cycle TEXT CHECK (cycle IN ('Maternelle', 'Primaire', 'Secondaire')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.enseignants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricule TEXT UNIQUE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT UNIQUE,
  telephone TEXT,
  genre TEXT CHECK (genre IN ('M', 'F')),
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'en_conge', 'quitte')),
  photo_url TEXT,
  salaire_mensuel NUMERIC DEFAULT 0,
  date_embauche DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niveau_id UUID NOT NULL REFERENCES public.niveaux_classes(id) ON DELETE CASCADE,
  annee_scolaire_id UUID NOT NULL REFERENCES public.annees_scolaires(id) ON DELETE CASCADE,
  nom TEXT NOT NULL, -- ex: "6ème A"
  enseignant_principal_id UUID REFERENCES public.enseignants(id) ON DELETE SET NULL,
  enseignant_assistant_id UUID REFERENCES public.enseignants(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  prix NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.matieres (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niveau_id UUID NOT NULL REFERENCES public.niveaux_classes(id) ON DELETE CASCADE,
  nom TEXT NOT NULL, -- ex: "Mathématiques"
  coefficient NUMERIC DEFAULT 1,
  bareme NUMERIC DEFAULT 20,
  examen_officiel BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Élèves
CREATE TABLE public.eleves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricule TEXT UNIQUE NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  sexe TEXT CHECK (sexe IN ('M', 'F')),
  date_naissance DATE,
  lieu_naissance TEXT,
  classe_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  annee_scolaire_id UUID REFERENCES public.annees_scolaires(id) ON DELETE SET NULL,
  telephone_parent TEXT,
  nom_parent TEXT,
  email_parent TEXT,
  photo_url TEXT,
  date_inscription DATE DEFAULT CURRENT_DATE,
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'transfere')),
  est_subventionne BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Relations d'affectation d'enseignants aux matières/classes
CREATE TABLE public.enseignants_classes (
  enseignant_id UUID REFERENCES public.enseignants(id) ON DELETE CASCADE,
  classe_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (enseignant_id, classe_id)
);

CREATE TABLE public.enseignants_matieres (
  enseignant_id UUID REFERENCES public.enseignants(id) ON DELETE CASCADE,
  matiere_id UUID REFERENCES public.matieres(id) ON DELETE CASCADE,
  PRIMARY KEY (enseignant_id, matiere_id)
);

-- 5. Évaluations et Bulletins
CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleve_id UUID NOT NULL REFERENCES public.eleves(id) ON DELETE CASCADE,
  matiere_id UUID REFERENCES public.matieres(id) ON DELETE CASCADE,
  matiere TEXT,
  trimestre TEXT NOT NULL CHECK (trimestre IN ('Trimestre 1', 'Trimestre 2', 'Trimestre 3')),
  note NUMERIC,
  coefficient NUMERIC DEFAULT 1,
  evaluation_maternelle TEXT CHECK (evaluation_maternelle IN ('Acquis', 'En cours', 'Non acquis')),
  enseignant_id UUID REFERENCES enseignants(id) ON DELETE SET NULL,
  date_saisie TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.bulletins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleve_id UUID NOT NULL REFERENCES public.eleves(id) ON DELETE CASCADE,
  classe_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  trimestre TEXT NOT NULL CHECK (trimestre IN ('Trimestre 1', 'Trimestre 2', 'Trimestre 3')),
  annee_scolaire_id UUID NOT NULL REFERENCES public.annees_scolaires(id) ON DELETE CASCADE,
  total_points NUMERIC DEFAULT 0,
  moyenne NUMERIC DEFAULT 0,
  rang INTEGER,
  mention TEXT,
  appreciation_enseignant TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Discipline et QHSE
CREATE TABLE public.discipline_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleve_id UUID NOT NULL REFERENCES public.eleves(id) ON DELETE CASCADE,
  date_incident DATE NOT NULL,
  type_incident TEXT NOT NULL, -- ex: "Absence", "Retard"
  motif TEXT NOT NULL,
  sanction TEXT,
  statut TEXT NOT NULL, -- ex: "Clos", "Notifié au parent"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.qhse_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  lieu TEXT NOT NULL,
  gravite TEXT CHECK (gravite IN ('Faible', 'Moyenne', 'Grave')),
  description TEXT NOT NULL,
  statut TEXT DEFAULT 'En traitement' CHECK (statut IN ('Résolu', 'En traitement')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.qhse_reunions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  titre TEXT NOT NULL,
  participants INTEGER NOT NULL,
  duree TEXT NOT NULL
);

CREATE TABLE public.qhse_depenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  libelle TEXT NOT NULL,
  montant NUMERIC NOT NULL
);

CREATE TABLE public.qhse_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mois TEXT NOT NULL,
  score NUMERIC NOT NULL,
  remarques TEXT
);

-- 7. Satisfaction et Enquêtes
CREATE TABLE public.enquetes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titre TEXT NOT NULL,
  categorie TEXT CHECK (categorie IN ('Parents', 'Employés', 'Communauté')),
  sous_categorie TEXT NOT NULL,
  statut TEXT DEFAULT 'En cours' CHECK (statut IN ('En cours', 'Clôturée')),
  participants INTEGER DEFAULT 0,
  score_moyen NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.enquetes_historique (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  enquete_id UUID REFERENCES public.enquetes(id) ON DELETE CASCADE,
  annee INTEGER NOT NULL,
  score NUMERIC NOT NULL
);

-- 8. Comptabilité (Plan OHADA & Écritures)
CREATE TABLE public.comptes_ohada (
  numero TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  classe INTEGER CHECK (classe IN (1, 2, 3, 4, 5, 6, 7)),
  etablissement_id UUID REFERENCES public.etablissements(id) ON DELETE CASCADE
);

CREATE TABLE public.ecritures_comptables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  libelle TEXT NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  partenaire TEXT,
  etablissement_id UUID REFERENCES public.etablissements(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.lignes_ecritures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ecriture_id UUID NOT NULL REFERENCES public.ecritures_comptables(id) ON DELETE CASCADE,
  compte_numero TEXT NOT NULL REFERENCES public.comptes_ohada(numero) ON DELETE RESTRICT,
  debit NUMERIC DEFAULT 0,
  credit NUMERIC DEFAULT 0
);

-- 9. Ressources Humaines (RH) et Personnel
CREATE TABLE public.membres_personnel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telephone TEXT,
  sexe TEXT CHECK (sexe IN ('M', 'F')),
  categorie TEXT CHECK (categorie IN ('Administration', 'Enseignant', 'Personnel d''appui', 'Technique')),
  type_contrat TEXT CHECK (type_contrat IN ('CDI', 'CDD', 'Intérimaire', 'Stagiaire')),
  salaire_de_base NUMERIC DEFAULT 0,
  date_embauche DATE DEFAULT CURRENT_DATE,
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'quitte')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.absences_personnel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personnel_id UUID NOT NULL REFERENCES public.membres_personnel(id) ON DELETE CASCADE,
  nom_personnel TEXT NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  motif TEXT CHECK (motif IN ('Maladie', 'Maternité', 'Congé', 'Injustifié', 'Autre')),
  duree_jours INTEGER NOT NULL
);

CREATE TABLE public.mouvements_personnel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personnel_id UUID NOT NULL REFERENCES public.membres_personnel(id) ON DELETE CASCADE,
  nom_personnel TEXT NOT NULL,
  type TEXT CHECK (type IN ('embauche', 'depart_volontaire', 'mutation', 'licenciement')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  details TEXT
);

CREATE TABLE public.evaluations_rh (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  enseignant_id UUID NOT NULL REFERENCES public.enseignants(id) ON DELETE CASCADE,
  nom_enseignant TEXT NOT NULL,
  note_moyenne NUMERIC DEFAULT 0,
  adherence_job_role NUMERIC DEFAULT 0,
  adherence_valeurs NUMERIC DEFAULT 0,
  note_formation_moyenne NUMERIC DEFAULT 0,
  date_evaluation DATE NOT NULL DEFAULT CURRENT_DATE,
  evaluateur TEXT
);

CREATE TABLE public.formations_rh (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  theme TEXT NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  cout_total NUMERIC DEFAULT 0,
  organisme TEXT,
  statut TEXT CHECK (statut IN ('planifié', 'en_cours', 'terminé'))
);

CREATE TABLE public.formations_beneficiaires (
  formation_id UUID REFERENCES public.formations_rh(id) ON DELETE CASCADE,
  personnel_id UUID REFERENCES public.membres_personnel(id) ON DELETE CASCADE,
  PRIMARY KEY (formation_id, personnel_id)
);

CREATE TABLE public.paiements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleve_id UUID REFERENCES public.eleves(id) ON DELETE CASCADE,
  montant NUMERIC NOT NULL,
  date DATE NOT NULL,
  mode_paiement TEXT CHECK (mode_paiement IN ('Orange Money', 'MTN Mobile Money', 'Espèces', 'Virement Bancaire')),
  type_frais TEXT CHECK (type_frais IN ('Scolarité', 'Inscription', 'Examen', 'Transport')),
  statut TEXT DEFAULT 'pending' CHECK (statut IN ('paid', 'pending', 'failed')),
  reference TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 10. INDEX DE PERFORMANCE
-- ==========================================
CREATE INDEX idx_classes_niveau ON public.classes(niveau_id);
CREATE INDEX idx_classes_annee ON public.classes(annee_scolaire_id);
CREATE INDEX idx_eleves_classe ON public.eleves(classe_id);
CREATE INDEX idx_eleves_annee ON public.eleves(annee_scolaire_id);
CREATE INDEX idx_notes_eleve ON public.notes(eleve_id);
CREATE INDEX idx_notes_matiere ON public.notes(matiere_id);
CREATE INDEX idx_bulletins_eleve ON public.bulletins(eleve_id);
CREATE INDEX idx_bulletins_classe ON public.bulletins(classe_id);
CREATE INDEX idx_lignes_ecriture ON public.lignes_ecritures(ecriture_id);
CREATE INDEX idx_lignes_compte ON public.lignes_ecritures(compte_numero);

-- ==========================================
-- 11. SÉCURITÉ ET RLS
-- ==========================================

-- Helper function to fetch user's establishment
CREATE OR REPLACE FUNCTION public.current_user_etablissement_id()
RETURNS UUID AS $$
  SELECT etablissement_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Enable RLS
ALTER TABLE public.etablissements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.niveaux_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eleves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paiements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annees_scolaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comptes_ohada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecritures_comptables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lignes_ecritures ENABLE ROW LEVEL SECURITY;

-- Simple Multi-tenant RLS Policies
CREATE POLICY "Etablissement read access" ON public.etablissements FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Profile user access" ON public.profiles TO authenticated 
  USING (id = auth.uid() OR etablissement_id = public.current_user_etablissement_id());

CREATE POLICY "Sections scope access" ON public.sections TO authenticated 
  USING (etablissement_id = public.current_user_etablissement_id());

CREATE POLICY "Niveaux classes scope access" ON public.niveaux_classes TO authenticated 
  USING (
    section_id IN (
      SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
    )
  );

CREATE POLICY "Classes scope access" ON public.classes TO authenticated 
  USING (
    niveau_id IN (
      SELECT id FROM public.niveaux_classes WHERE section_id IN (
        SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
      )
    )
  );

CREATE POLICY "Eleves scope access" ON public.eleves TO authenticated 
  USING (
    classe_id IN (
      SELECT id FROM public.classes WHERE niveau_id IN (
        SELECT id FROM public.niveaux_classes WHERE section_id IN (
          SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
        )
      )
    )
  );

CREATE POLICY "Paiements scope access" ON public.paiements TO authenticated 
  USING (
    eleve_id IN (
      SELECT id FROM public.eleves WHERE classe_id IN (
        SELECT id FROM public.classes WHERE niveau_id IN (
          SELECT id FROM public.niveaux_classes WHERE section_id IN (
            SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
          )
        )
      )
    )
  );

CREATE POLICY "Notes scope access" ON public.notes TO authenticated 
  USING (
    eleve_id IN (
      SELECT id FROM public.eleves WHERE classe_id IN (
        SELECT id FROM public.classes WHERE niveau_id IN (
          SELECT id FROM public.niveaux_classes WHERE section_id IN (
            SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
          )
        )
      )
    )
  );

CREATE POLICY "Bulletins scope access" ON public.bulletins TO authenticated 
  USING (
    eleve_id IN (
      SELECT id FROM public.eleves WHERE classe_id IN (
        SELECT id FROM public.classes WHERE niveau_id IN (
          SELECT id FROM public.niveaux_classes WHERE section_id IN (
            SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
          )
        )
      )
    )
  );

CREATE POLICY "Etablissement access for ALL on annees_scolaires" ON public.annees_scolaires TO authenticated
  USING (etablissement_id = public.current_user_etablissement_id())
  WITH CHECK (etablissement_id = public.current_user_etablissement_id());

CREATE POLICY "Comptes OHADA access for authenticated" ON public.comptes_ohada TO authenticated
  USING (etablissement_id = public.current_user_etablissement_id())
  WITH CHECK (etablissement_id = public.current_user_etablissement_id());

CREATE POLICY "Ecritures comptables access for authenticated" ON public.ecritures_comptables TO authenticated
  USING (etablissement_id = public.current_user_etablissement_id())
  WITH CHECK (etablissement_id = public.current_user_etablissement_id());

CREATE POLICY "Lignes ecritures access for authenticated" ON public.lignes_ecritures TO authenticated
  USING (
    ecriture_id IN (
      SELECT id FROM public.ecritures_comptables WHERE etablissement_id = public.current_user_etablissement_id()
    )
  )
  WITH CHECK (
    ecriture_id IN (
      SELECT id FROM public.ecritures_comptables WHERE etablissement_id = public.current_user_etablissement_id()
    )
  );

-- ==========================================
-- 12. EMPLOI DU TEMPS
-- ==========================================
CREATE TABLE public.emploi_du_temps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  etablissement_id UUID REFERENCES public.etablissements(id) ON DELETE CASCADE,
  classe_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  jour_semaine INTEGER NOT NULL CHECK (jour_semaine BETWEEN 1 AND 6),
  heure_debut TEXT NOT NULL,
  heure_fin TEXT NOT NULL,
  matiere_id UUID REFERENCES public.matieres(id) ON DELETE CASCADE,
  enseignant_id UUID REFERENCES public.enseignants(id) ON DELETE CASCADE,
  salle TEXT,
  couleur TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.emploi_du_temps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Emploi du temps scope access" ON public.emploi_du_temps TO authenticated
  USING (
    classe_id IN (
      SELECT id FROM public.classes WHERE niveau_id IN (
        SELECT id FROM public.niveaux_classes WHERE section_id IN (
          SELECT id FROM public.sections WHERE etablissement_id = public.current_user_etablissement_id()
        )
      )
    )
  );

