-- ============================================================================
-- Migration : Harmonisation du tableau de bord sur le Chiffre d'Affaires Global
--
-- Aligne get_dashboard_stats sur le module Finance (CA vs Trésorerie) :
-- 1. v_total_expected : prend en compte la totalité des frais attendus (classes.prix,
--    qui intègre scolarité + inscription), soit 87.08 M FCFA pour Le Déclic.
--    Tient compte du forfait de 55 000 FCFA pour les élèves subventionnés.
-- 2. v_total_paid : prend en compte tous les encaissements réels perçus
--    (statut = 'paid', tous types de frais : scolarité + inscription), cohérent
--    avec la Trésorerie Perçue du module Finance.
-- 3. v_recovery_rate : taux de recouvrement global homogène (numérateur et
--    dénominateur couvrant le même périmètre).
-- 4. Conserve v_subventionnes_count et v_total_subventions introduits par
--    20261028120000_eleves_subventionnes.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_etablissement_id UUID,
  p_annee_scolaire_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_students      INT;
  v_active_students     INT;
  v_filles              INT;
  v_garcons             INT;
  v_subventionnes_count INT;
  v_total_teachers      INT;
  v_active_teachers     INT;
  v_nb_classes          INT;
  v_total_expected      NUMERIC;
  v_total_subventions   NUMERIC;
  v_total_paid          NUMERIC;
  v_with_grades         INT;
  v_passed              INT;
  v_success_rate        NUMERIC;
  v_recovery_rate       NUMERIC;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE statut = 'actif'),
    count(*) FILTER (WHERE sexe = 'F'),
    count(*) FILTER (WHERE sexe = 'M'),
    count(*) FILTER (WHERE est_subventionne = TRUE)
  INTO v_total_students, v_active_students, v_filles, v_garcons, v_subventionnes_count
  FROM public.eleves
  WHERE etablissement_id = p_etablissement_id
    AND (p_annee_scolaire_id IS NULL OR annee_scolaire_id = p_annee_scolaire_id);

  SELECT count(*), count(*) FILTER (WHERE statut = 'actif')
  INTO v_total_teachers, v_active_teachers
  FROM public.enseignants
  WHERE etablissement_id = p_etablissement_id;

  SELECT count(*)
  INTO v_nb_classes
  FROM public.classes
  WHERE etablissement_id = p_etablissement_id
    AND (p_annee_scolaire_id IS NULL OR annee_scolaire_id = p_annee_scolaire_id);

  -- Total attendu global : classes.prix (qui englobe scolarité et frais d'inscription),
  -- ou 55 000 FCFA pour un élève subventionné.
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(e.est_subventionne, FALSE) = TRUE THEN 55000::NUMERIC
      ELSE COALESCE(c.prix, 0)::NUMERIC
    END
  ), 0)
  INTO v_total_expected
  FROM public.eleves e
  JOIN public.classes c ON c.id = e.classe_id
  WHERE e.etablissement_id = p_etablissement_id
    AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id);

  -- Volume total des subventions accordées
  SELECT COALESCE(SUM(
    GREATEST(0, COALESCE(c.prix, 0) - 55000)
  ), 0)
  INTO v_total_subventions
  FROM public.eleves e
  JOIN public.classes c ON c.id = e.classe_id
  WHERE e.etablissement_id = p_etablissement_id
    AND COALESCE(e.est_subventionne, FALSE) = TRUE
    AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id);

  -- Trésorerie perçue globale : tous encaissements réels encaissés (Scolarité + Inscription).
  SELECT COALESCE(SUM(pmt.montant), 0)
  INTO v_total_paid
  FROM public.paiements pmt
  JOIN public.eleves e ON e.id = pmt.eleve_id
  WHERE pmt.etablissement_id = p_etablissement_id
    AND pmt.statut = 'paid'
    AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id);

  WITH moyennes AS (
    SELECT e.id, AVG(n.note) AS moyenne
    FROM public.eleves e
    JOIN public.notes n ON n.eleve_id = e.id
    WHERE e.etablissement_id = p_etablissement_id
      AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id)
      AND n.note IS NOT NULL
    GROUP BY e.id
  )
  SELECT count(*), count(*) FILTER (WHERE moyenne >= 10)
  INTO v_with_grades, v_passed
  FROM moyennes;

  v_success_rate := CASE WHEN v_with_grades > 0
    THEN round((v_passed::NUMERIC / v_with_grades) * 100, 1) ELSE NULL END;
  v_recovery_rate := CASE WHEN v_total_expected > 0
    THEN round((v_total_paid / v_total_expected) * 100, 1) ELSE 0 END;

  RETURN jsonb_build_object(
    'total_students', v_total_students,
    'active_students', v_active_students,
    'filles', v_filles,
    'garcons', v_garcons,
    'subventionnes_count', v_subventionnes_count,
    'total_teachers', v_total_teachers,
    'active_teachers', v_active_teachers,
    'nb_classes', v_nb_classes,
    'total_expected', v_total_expected,
    'total_subventions', v_total_subventions,
    'total_paid', v_total_paid,
    'students_with_grades', v_with_grades,
    'students_passed', v_passed,
    'success_rate', v_success_rate,
    'recovery_rate', v_recovery_rate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(UUID, UUID) TO authenticated;
