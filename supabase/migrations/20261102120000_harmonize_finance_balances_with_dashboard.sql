-- ============================================================================
-- Migration : Harmonisation stricte de get_finance_account_balances sur le
-- Tableau de Bord et le régime des élèves subventionnés
--
-- 1. Élimine le double comptage des frais d'inscription : classes.prix représente
--    déjà la scolarité globale annuelle (frais d'inscription inclus). La scolarité
--    constatée est donc (classes.prix - frais_inscription) et l'inscription constatée
--    est frais_inscription, de sorte que le compte 706 totalise exactement classes.prix.
-- 2. Applique le forfait de 55 000 FCFA pour tout élève subventionné (frais
--    d'inscription = 0 F), garantissant la cohérence parfaite entre CA Constaté
--    et Total Attendu du Tableau de Bord.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_finance_account_balances(
  p_etablissement_id UUID,
  p_annee_scolaire_id UUID DEFAULT NULL
)
RETURNS TABLE (
  compte_numero TEXT,
  debit NUMERIC,
  credit NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bornes AS (
    SELECT a.date_debut, a.date_fin
    FROM public.annees_scolaires a
    WHERE a.id = p_annee_scolaire_id
  ),
  real_lignes AS (
    SELECT l.compte_numero, l.debit::NUMERIC AS debit, l.credit::NUMERIC AS credit
    FROM public.lignes_ecritures l
    JOIN public.ecritures_comptables e ON e.id = l.ecriture_id
    WHERE e.etablissement_id = p_etablissement_id
      AND (
        p_annee_scolaire_id IS NULL
        OR e.date BETWEEN (SELECT date_debut FROM bornes) AND (SELECT date_fin FROM bornes)
      )
  ),
  eleves_scope AS (
    SELECT
      el.id,
      CASE
        WHEN COALESCE(el.est_subventionne, FALSE) = TRUE THEN 55000::NUMERIC
        ELSE COALESCE(c.prix, 0)::NUMERIC
      END AS total_du,
      CASE
        WHEN COALESCE(el.est_subventionne, FALSE) = TRUE THEN 0::NUMERIC
        ELSE COALESCE(c.frais_inscription, 0)::NUMERIC
      END AS frais_inscription
    FROM public.eleves el
    LEFT JOIN public.classes c ON c.id = el.classe_id
    WHERE el.etablissement_id = p_etablissement_id
      AND (p_annee_scolaire_id IS NULL OR el.annee_scolaire_id = p_annee_scolaire_id)
  ),
  constatation_frais AS (
    SELECT '411'::TEXT AS compte_numero, GREATEST(0, total_du - frais_inscription) AS debit, 0::NUMERIC AS credit
    FROM eleves_scope WHERE (total_du - frais_inscription) > 0
    UNION ALL
    SELECT '706'::TEXT, 0::NUMERIC, GREATEST(0, total_du - frais_inscription)
    FROM eleves_scope WHERE (total_du - frais_inscription) > 0
    UNION ALL
    SELECT '411'::TEXT, frais_inscription, 0::NUMERIC
    FROM eleves_scope WHERE frais_inscription > 0
    UNION ALL
    SELECT '706'::TEXT, 0::NUMERIC, frais_inscription
    FROM eleves_scope WHERE frais_inscription > 0
  ),
  paiements_scope AS (
    SELECT p.mode_paiement, p.montant
    FROM public.paiements p
    JOIN eleves_scope es ON es.id = p.eleve_id
    WHERE p.statut = 'paid'
  ),
  reglement AS (
    SELECT
      (CASE WHEN mode_paiement = 'Virement Bancaire' THEN '521' ELSE '571' END)::TEXT AS compte_numero,
      montant::NUMERIC AS debit,
      0::NUMERIC AS credit
    FROM paiements_scope
    UNION ALL
    SELECT '411'::TEXT, 0::NUMERIC, montant::NUMERIC
    FROM paiements_scope
  ),
  formations_scope AS (
    SELECT f.cout_total::NUMERIC AS cout_total, f.statut
    FROM public.formations_rh f
    WHERE f.etablissement_id = p_etablissement_id
      AND f.cout_total > 0
      AND (
        p_annee_scolaire_id IS NULL
        OR f.date_debut BETWEEN (SELECT date_debut FROM bornes) AND (SELECT date_fin FROM bornes)
      )
  ),
  formation_const AS (
    SELECT '601'::TEXT AS compte_numero, cout_total AS debit, 0::NUMERIC AS credit
    FROM formations_scope
    UNION ALL
    SELECT '401'::TEXT, 0::NUMERIC, cout_total FROM formations_scope
  ),
  formation_reglement AS (
    SELECT '401'::TEXT AS compte_numero, cout_total AS debit, 0::NUMERIC AS credit
    FROM formations_scope WHERE statut IN ('Terminé', 'termine')
    UNION ALL
    SELECT '521'::TEXT, 0::NUMERIC, cout_total
    FROM formations_scope WHERE statut IN ('Terminé', 'termine')
  ),
  all_lignes AS (
    SELECT * FROM real_lignes
    UNION ALL SELECT * FROM constatation_frais
    UNION ALL SELECT * FROM reglement
    UNION ALL SELECT * FROM formation_const
    UNION ALL SELECT * FROM formation_reglement
  )
  SELECT compte_numero, SUM(debit)::NUMERIC AS debit, SUM(credit)::NUMERIC AS credit
  FROM all_lignes
  GROUP BY compte_numero;
$$;

GRANT EXECUTE ON FUNCTION public.get_finance_account_balances(UUID, UUID) TO authenticated;
