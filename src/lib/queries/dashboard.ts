import { createClient } from '../supabase/client';

const supabase = createClient();

export interface DashboardStats {
  total_students: number;
  active_students: number;
  filles: number;
  garcons: number;
  subventionnes_count?: number;
  total_teachers: number;
  active_teachers: number;
  nb_classes: number;
  total_expected: number;
  total_subventions?: number;
  total_paid: number;
  students_with_grades: number;
  students_passed: number;
  success_rate: number | null;
  recovery_rate: number;
}

/**
 * Récupère les indicateurs globaux du tableau de bord, calculés en base
 * (agrégats SQL) plutôt que côté navigateur sur l'ensemble des lignes.
 */
export async function getDashboardStats(etablissementId: string, anneeScolaireId?: string | null): Promise<DashboardStats | null> {
  const { data, error } = await supabase.rpc('get_dashboard_stats', {
    p_etablissement_id: etablissementId,
    p_annee_scolaire_id: anneeScolaireId ?? null,
  });
  if (error) throw error;
  return (data as DashboardStats) ?? null;
}

/**
 * Récupère les données brutes nécessaires pour le Dashboard,
 * filtrées par établissement et année scolaire active.
 */
export async function getDashboardData(etablissementId: string, anneeScolaireId?: string | null) {
  let classesQuery = supabase
    .from('classes')
    .select('id, nom, prix, frais_inscription')
    .eq('etablissement_id', etablissementId);

  if (anneeScolaireId) {
    classesQuery = classesQuery.eq('annee_scolaire_id', anneeScolaireId);
  }

  const { data: classes, error: classesError } = await classesQuery.order('nom', { ascending: true });

  if (classesError) throw classesError;

  let allStudents: any[] = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    let elevesQuery = supabase
      .from('eleves')
      .select('id, matricule, nom, prenom, sexe, classe_id, statut, date_inscription, est_subventionne, paiements(id, eleve_id, montant, date, type_frais, statut, reference, mode_paiement)')
      .eq('etablissement_id', etablissementId);

    if (anneeScolaireId) {
      elevesQuery = elevesQuery.eq('annee_scolaire_id', anneeScolaireId);
    }

    const { data: students, error: studentsError } = await elevesQuery
      .order('nom', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + step - 1);

    if (studentsError) throw studentsError;

    if (students && students.length > 0) {
      allStudents = allStudents.concat(students);
      from += step;
      if (students.length < step) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  const { data: teachers, error: teachersError } = await supabase
    .from('enseignants')
    .select('id, statut')
    .eq('etablissement_id', etablissementId);

  if (teachersError) throw teachersError;

  return {
    classes: classes || [],
    students: allStudents,
    teachers: teachers || []
  };
}
