-- ============================================================================
-- Migration : 20261028120000_eleves_subventionnes.sql
--
-- 1. Ajout de la colonne est_subventionne sur public.eleves (défaut FALSE).
-- 2. Index de recherche/filtrage (etablissement_id, est_subventionne).
-- 3. Mise à jour de get_students_paginated :
--    - Renvoie la colonne est_subventionne
--    - total_due = 55 000 FCFA si est_subventionne = TRUE, sinon (prix - frais_inscription)
--    - Supporte le paramètre de filtre p_est_subventionne (TRUE/FALSE/NULL)
-- 4. Mise à jour de get_students_widget_stats :
--    - total_due adapté aux 55 000 FCFA des élèves subventionnés
--    - Renvoie subventionnesCount
-- 5. Mise à jour de get_dashboard_stats :
--    - total_expected tient compte de 55 000 FCFA pour les subventionnés
--    - Renvoie total_subventions et subventionnes_count
-- ============================================================================

-- 1. Colonne est_subventionne
ALTER TABLE public.eleves
ADD COLUMN IF NOT EXISTS est_subventionne BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_eleves_subventionne
ON public.eleves(etablissement_id, est_subventionne);

-- 3. get_students_paginated
DROP FUNCTION IF EXISTS public.get_students_paginated(uuid, uuid, text, uuid, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_students_paginated(uuid, uuid, text, uuid, text, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.get_students_paginated(
  p_etablissement_id uuid,
  p_annee_scolaire_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_classe_id uuid DEFAULT NULL::uuid,
  p_statut_paiement text DEFAULT NULL::text,
  p_sexe text DEFAULT NULL::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_est_subventionne boolean DEFAULT NULL::boolean
)
RETURNS TABLE(
  id uuid,
  matricule text,
  nom text,
  prenom text,
  sexe text,
  classe_id uuid,
  classe_nom text,
  annee_scolaire_id uuid,
  nom_parent text,
  telephone_parent text,
  email_parent text,
  date_naissance date,
  lieu_naissance text,
  date_inscription date,
  statut text,
  est_subventionne boolean,
  total_due numeric,
  total_paid numeric,
  statut_paiement text,
  reste_a_payer_echu numeric,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_offset INT := GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
BEGIN
  RETURN QUERY
  WITH tranches_sum AS (
    SELECT ts.annee_scolaire_id, SUM(ts.pourcentage) / 100.0 AS pct_echu
    FROM public.tranches_scolarite ts
    WHERE ts.etablissement_id = p_etablissement_id
      AND ts.date_limite < CURRENT_DATE
    GROUP BY ts.annee_scolaire_id
  ),
  base AS (
    SELECT
      e.id, e.matricule, e.nom, e.prenom, e.sexe, e.classe_id, c.nom AS classe_nom,
      e.annee_scolaire_id, e.nom_parent, e.telephone_parent, e.email_parent,
      e.date_naissance, e.lieu_naissance, e.date_inscription, e.statut,
      COALESCE(e.est_subventionne, FALSE) AS est_subventionne,
      -- Règle métier : tout élève subventionné paie 55 000 FCFA.
      -- L'élève standard paie (prix - frais_inscription).
      CASE
        WHEN COALESCE(e.est_subventionne, FALSE) = TRUE THEN 55000::NUMERIC
        ELSE (COALESCE(c.prix, 0) - COALESCE(c.frais_inscription, 0))::NUMERIC
      END AS total_due,
      COALESCE((
        SELECT SUM(pmt.montant) FROM public.paiements pmt
        WHERE pmt.eleve_id = e.id
          AND pmt.statut = 'paid'
          AND pmt.type_frais = 'Scolarité'
      ), 0)::NUMERIC AS total_paid,
      COALESCE(ts.pct_echu, 0)::NUMERIC AS pct_echu
    FROM public.eleves e
    LEFT JOIN public.classes c ON c.id = e.classe_id
    LEFT JOIN tranches_sum ts ON ts.annee_scolaire_id = e.annee_scolaire_id
    WHERE e.etablissement_id = p_etablissement_id
      AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id)
      AND (p_classe_id IS NULL OR e.classe_id = p_classe_id)
      AND (p_sexe IS NULL OR e.sexe = p_sexe)
      AND (p_est_subventionne IS NULL OR COALESCE(e.est_subventionne, FALSE) = p_est_subventionne)
      AND (
        p_search IS NULL OR p_search = '' OR
        (e.nom || ' ' || e.prenom) ILIKE '%' || p_search || '%' OR
        e.matricule ILIKE '%' || p_search || '%'
      )
  ),
  scored AS (
    SELECT base.*,
      CASE
        WHEN base.total_due > 0 AND base.total_paid >= base.total_due THEN 'paid'
        WHEN base.total_due > 0 AND base.total_paid < (base.total_due * base.pct_echu) THEN 'late'
        WHEN base.total_paid > 0 THEN 'partial'
        ELSE 'unpaid'
      END AS statut_paiement,
      GREATEST(0, (base.total_due * base.pct_echu) - base.total_paid)::NUMERIC AS reste_a_payer_echu
    FROM base
  ),
  filtered AS (
    SELECT * FROM scored s
    WHERE p_statut_paiement IS NULL
       OR s.statut_paiement = p_statut_paiement
       OR (p_statut_paiement = 'late' AND s.statut_paiement = 'late')
       OR (p_statut_paiement = 'partial' AND s.statut_paiement IN ('partial', 'late'))
  )
  SELECT f.id, f.matricule, f.nom, f.prenom, f.sexe, f.classe_id, f.classe_nom,
         f.annee_scolaire_id, f.nom_parent, f.telephone_parent, f.email_parent,
         f.date_naissance, f.lieu_naissance, f.date_inscription, f.statut,
         f.est_subventionne,
         f.total_due, f.total_paid, f.statut_paiement, f.reste_a_payer_echu,
         count(*) OVER()::BIGINT AS total_count
  FROM filtered f
  ORDER BY f.nom ASC, f.id ASC
  LIMIT GREATEST(p_page_size, 1)
  OFFSET v_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_students_paginated(UUID, UUID, TEXT, UUID, TEXT, TEXT, INT, INT, BOOLEAN) TO authenticated;

-- 4. get_students_widget_stats
CREATE OR REPLACE FUNCTION public.get_students_widget_stats(
  p_etablissement_id uuid,
  p_annee_scolaire_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_total         INT;
  v_paid          INT;
  v_partial       INT;
  v_late          INT;
  v_unpaid        INT;
  v_subventionnes INT;
BEGIN
  WITH tranches_sum AS (
    SELECT ts.annee_scolaire_id, SUM(ts.pourcentage) / 100.0 AS pct_echu
    FROM public.tranches_scolarite ts
    WHERE ts.etablissement_id = p_etablissement_id
      AND ts.date_limite < CURRENT_DATE
    GROUP BY ts.annee_scolaire_id
  ),
  base AS (
    SELECT
      e.id,
      COALESCE(e.est_subventionne, FALSE) AS est_subventionne,
      CASE
        WHEN COALESCE(e.est_subventionne, FALSE) = TRUE THEN 55000::NUMERIC
        ELSE (COALESCE(c.prix, 0) - COALESCE(c.frais_inscription, 0))::NUMERIC
      END AS total_due,
      COALESCE((
        SELECT SUM(pmt.montant) FROM public.paiements pmt
        WHERE pmt.eleve_id = e.id
          AND pmt.statut = 'paid'
          AND pmt.type_frais = 'Scolarité'
      ), 0)::NUMERIC AS total_paid,
      COALESCE(ts.pct_echu, 0)::NUMERIC AS pct_echu
    FROM public.eleves e
    LEFT JOIN public.classes c ON c.id = e.classe_id
    LEFT JOIN tranches_sum ts ON ts.annee_scolaire_id = e.annee_scolaire_id
    WHERE e.etablissement_id = p_etablissement_id
      AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id)
  ),
  scored AS (
    SELECT
      est_subventionne,
      CASE
        WHEN total_due > 0 AND total_paid >= total_due THEN 'paid'
        WHEN total_due > 0 AND total_paid < (total_due * pct_echu) THEN 'late'
        WHEN total_paid > 0 THEN 'partial'
        ELSE 'unpaid'
      END AS statut_paiement
    FROM base
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE statut_paiement = 'paid'),
    count(*) FILTER (WHERE statut_paiement = 'partial'),
    count(*) FILTER (WHERE statut_paiement = 'late'),
    count(*) FILTER (WHERE statut_paiement = 'unpaid'),
    count(*) FILTER (WHERE est_subventionne = TRUE)
  INTO v_total, v_paid, v_partial, v_late, v_unpaid, v_subventionnes
  FROM scored;

  RETURN jsonb_build_object(
    'total', v_total,
    'paidCount', v_paid,
    'partialCount', v_partial,
    'lateCount', v_late,
    'unpaidCount', v_unpaid,
    'subventionnesCount', v_subventionnes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_students_widget_stats(UUID, UUID) TO authenticated;

-- 5. get_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_etablissement_id UUID,
  p_annee_scolaire_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_students     INT;
  v_active_students    INT;
  v_filles             INT;
  v_garcons            INT;
  v_subventionnes_count INT;
  v_total_teachers     INT;
  v_active_teachers    INT;
  v_nb_classes         INT;
  v_total_expected     NUMERIC;
  v_total_subventions  NUMERIC;
  v_total_paid         NUMERIC;
  v_with_grades        INT;
  v_passed             INT;
  v_success_rate       NUMERIC;
  v_recovery_rate      NUMERIC;
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

  -- Total expected : 55 000 FCFA pour un élève subventionné, scolarité classe pour les autres.
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(e.est_subventionne, FALSE) = TRUE THEN 55000::NUMERIC
      ELSE (c.prix - COALESCE(c.frais_inscription, 0))::NUMERIC
    END
  ), 0)
  INTO v_total_expected
  FROM public.eleves e
  JOIN public.classes c ON c.id = e.classe_id
  WHERE e.etablissement_id = p_etablissement_id
    AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id);

  -- Montant total des subventions prises en charge par l'école :
  -- somme des (scolarite_classe - 55 000) pour les élèves subventionnés
  SELECT COALESCE(SUM(
    GREATEST(0, (c.prix - COALESCE(c.frais_inscription, 0)) - 55000)
  ), 0)
  INTO v_total_subventions
  FROM public.eleves e
  JOIN public.classes c ON c.id = e.classe_id
  WHERE e.etablissement_id = p_etablissement_id
    AND COALESCE(e.est_subventionne, FALSE) = TRUE
    AND (p_annee_scolaire_id IS NULL OR e.annee_scolaire_id = p_annee_scolaire_id);

  -- Seule la scolarité compte, comme total_expected.
  SELECT COALESCE(SUM(pmt.montant), 0)
  INTO v_total_paid
  FROM public.paiements pmt
  JOIN public.eleves e ON e.id = pmt.eleve_id
  WHERE pmt.etablissement_id = p_etablissement_id
    AND pmt.statut = 'paid'
    AND pmt.type_frais = 'Scolarité'
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
