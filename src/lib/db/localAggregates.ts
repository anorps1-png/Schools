import { getAllRecordsFromTable, saveRecordsToTable, deleteRecordsFromTable, addToQueue } from './sqlite';

// Équivalents locaux des fonctions RPC Postgres, pour que le desktop Electron
// fonctionne à 100% hors-ligne sur les pages qui dépendaient de calculs faits
// côté serveur (finance, tableau de bord, classements, RH...). Chaque
// fonction ci-dessous a été traduite ligne à ligne depuis le corps SQL vérifié
// en direct sur la base de production (pg_get_functiondef, jamais depuis les
// fichiers de migration seuls — cf. mémoire "migrations désynchronisées") au
// moment de cette réécriture. Si une fonction Postgres change plus tard,
// celle-ci doit être mise à jour manuellement en miroir : il n'y a aucun lien
// automatique entre les deux.
//
// Sur le web, ce fichier n'est jamais utilisé (voir isLocalOnlyRuntime() dans
// src/lib/supabase/client.ts) : ces fonctions ne tournent que dans l'API
// locale du build desktop (src/app/api/local-db/route.ts).

type Row = Record<string, any>;

interface RpcContext {
  callerEtablissementId?: string | null;
  callerRole?: string | null;
}

const alive = (rows: Row[]) => rows.filter((r) => !r.deleted_at);
const num = (v: any) => Number(v) || 0;
const round = (n: number, decimals = 0) => {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
};

async function table(name: string): Promise<Row[]> {
  return await getAllRecordsFromTable(name);
}

function newId(): string {
  return crypto.randomUUID();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseISO: string, days: number): string {
  const d = new Date(baseISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// get_dashboard_stats
// ============================================================================
async function getDashboardStats(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  const eleves = alive(await table('eleves')).filter(
    (e) => e.etablissement_id === etabId && (!anneeId || e.annee_scolaire_id === anneeId)
  );
  const totalStudents = eleves.length;
  const activeStudents = eleves.filter((e) => e.statut === 'actif').length;
  const filles = eleves.filter((e) => e.sexe === 'F').length;
  const garcons = eleves.filter((e) => e.sexe === 'M').length;

  const enseignants = (await table('enseignants')).filter((en) => !en.deleted_at && en.etablissement_id === etabId);
  const totalTeachers = enseignants.length;
  const activeTeachers = enseignants.filter((en) => en.statut === 'actif').length;

  const classes = (await table('classes')).filter(
    (c) => c.etablissement_id === etabId && (!anneeId || c.annee_scolaire_id === anneeId)
  );
  const nbClasses = classes.length;

  const classesById = new Map((await table('classes')).map((c) => [c.id, c]));
  // Règle métier : tout élève subventionné paie 55 000 FCFA.
  // L'élève standard paie (prix - frais_inscription).
  let totalExpected = 0;
  let totalSubventions = 0;
  const subventionnesCount = eleves.filter((e) => e.est_subventionne === true).length;

  for (const e of eleves) {
    const c = e.classe_id ? classesById.get(e.classe_id) : null;
    const baseTuition = c ? Math.max(0, num(c.prix) - num(c.frais_inscription)) : 0;
    if (e.est_subventionne === true) {
      totalExpected += 55000;
      totalSubventions += Math.max(0, baseTuition - 55000);
    } else {
      totalExpected += baseTuition;
    }
  }

  const elevesIdSet = new Set(eleves.map((e) => e.id));
  const paiements = alive(await table('paiements')).filter(
    (p) => p.etablissement_id === etabId && p.statut === 'paid' && p.type_frais === 'Scolarité' && elevesIdSet.has(p.eleve_id)
  );
  const totalPaid = paiements.reduce((sum, p) => sum + num(p.montant), 0);

  const notes = alive(await table('notes'));
  const moyennesParEleve = new Map<string, number[]>();
  for (const n of notes) {
    if (n.note === null || n.note === undefined) continue;
    if (!elevesIdSet.has(n.eleve_id)) continue;
    if (!moyennesParEleve.has(n.eleve_id)) moyennesParEleve.set(n.eleve_id, []);
    moyennesParEleve.get(n.eleve_id)!.push(num(n.note));
  }
  let withGrades = 0;
  let passed = 0;
  for (const notesEleve of moyennesParEleve.values()) {
    const moyenne = notesEleve.reduce((s, v) => s + v, 0) / notesEleve.length;
    withGrades++;
    if (moyenne >= 10) passed++;
  }

  const successRate = withGrades > 0 ? round((passed / withGrades) * 100, 1) : null;
  const recoveryRate = totalExpected > 0 ? round((totalPaid / totalExpected) * 100, 1) : 0;

  return {
    total_students: totalStudents,
    active_students: activeStudents,
    filles,
    garcons,
    subventionnes_count: subventionnesCount,
    total_teachers: totalTeachers,
    active_teachers: activeTeachers,
    nb_classes: nbClasses,
    total_expected: totalExpected,
    total_subventions: totalSubventions,
    total_paid: totalPaid,
    students_with_grades: withGrades,
    students_passed: passed,
    success_rate: successRate,
    recovery_rate: recoveryRate
  };
}

// ============================================================================
// Statut de paiement par élève (partagé par get_students_paginated et
// get_students_widget_stats) : pourcentage de tranches déjà échues (date
// limite dépassée) sur l'année scolaire de l'élève, comparé au payé.
// ============================================================================
async function computePctEchuParAnnee(etabId: string): Promise<Map<string, number>> {
  const tranches = (await table('tranches_scolarite')).filter(
    (t) => t.etablissement_id === etabId && t.date_limite && t.date_limite < todayISO()
  );
  const parAnnee = new Map<string, number>();
  for (const t of tranches) {
    const cur = parAnnee.get(t.annee_scolaire_id) || 0;
    parAnnee.set(t.annee_scolaire_id, cur + num(t.pourcentage));
  }
  const pctEchu = new Map<string, number>();
  for (const [anneeId, pct] of parAnnee) pctEchu.set(anneeId, pct / 100);
  return pctEchu;
}

function statutPaiement(totalDue: number, totalPaid: number, pctEchu: number): string {
  if (totalDue > 0 && totalPaid >= totalDue) return 'paid';
  if (totalDue > 0 && totalPaid < totalDue * pctEchu) return 'late';
  if (totalPaid > 0) return 'partial';
  return 'unpaid';
}

// ============================================================================
// get_students_paginated
// ============================================================================
async function getStudentsPaginated(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;
  const search = (params.p_search || '').trim().toLowerCase();
  const classeId = params.p_classe_id || null;
  const statutPaiementFilter = params.p_statut_paiement || null;
  const sexe = params.p_sexe || null;
  const estSubventionneFilter = params.p_est_subventionne !== undefined && params.p_est_subventionne !== null ? params.p_est_subventionne : null;
  const page = Math.max(params.p_page || 1, 1);
  const pageSize = Math.max(params.p_page_size || 20, 1);

  const classes = await table('classes');
  const classesById = new Map(classes.map((c) => [c.id, c]));
  const pctEchuParAnnee = await computePctEchuParAnnee(etabId);

  const paiements = alive(await table('paiements')).filter((p) => p.statut === 'paid' && p.type_frais === 'Scolarité');
  const paidByEleve = new Map<string, number>();
  for (const p of paiements) {
    paidByEleve.set(p.eleve_id, (paidByEleve.get(p.eleve_id) || 0) + num(p.montant));
  }

  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);
  if (classeId) eleves = eleves.filter((e) => e.classe_id === classeId);
  if (sexe) eleves = eleves.filter((e) => e.sexe === sexe);
  if (estSubventionneFilter !== null) {
    eleves = eleves.filter((e) => Boolean(e.est_subventionne) === Boolean(estSubventionneFilter));
  }
  if (search) {
    eleves = eleves.filter(
      (e) =>
        `${e.nom || ''} ${e.prenom || ''}`.toLowerCase().includes(search) ||
        (e.matricule || '').toLowerCase().includes(search)
    );
  }

  const scored = eleves.map((e) => {
    const classe = e.classe_id ? classesById.get(e.classe_id) : null;
    const isSub = Boolean(e.est_subventionne);
    // Règle métier : tout élève subventionné paie 55 000 FCFA.
    const totalDue = isSub ? 55000 : (num(classe?.prix) - num(classe?.frais_inscription));
    const totalPaid = paidByEleve.get(e.id) || 0;
    const pctEchu = pctEchuParAnnee.get(e.annee_scolaire_id) || 0;
    const statut = statutPaiement(totalDue, totalPaid, pctEchu);
    const resteAPayerEchu = Math.max(0, totalDue * pctEchu - totalPaid);
    return {
      id: e.id,
      matricule: e.matricule,
      nom: e.nom,
      prenom: e.prenom,
      sexe: e.sexe,
      classe_id: e.classe_id,
      classe_nom: classe?.nom ?? null,
      annee_scolaire_id: e.annee_scolaire_id,
      nom_parent: e.nom_parent,
      telephone_parent: e.telephone_parent,
      email_parent: e.email_parent,
      date_naissance: e.date_naissance,
      lieu_naissance: e.lieu_naissance,
      date_inscription: e.date_inscription,
      statut: e.statut,
      est_subventionne: isSub,
      total_due: totalDue,
      total_paid: totalPaid,
      statut_paiement: statut,
      reste_a_payer_echu: resteAPayerEchu
    };
  });

  const filtered = statutPaiementFilter
    ? scored.filter(
        (s) =>
          s.statut_paiement === statutPaiementFilter ||
          (statutPaiementFilter === 'partial' && (s.statut_paiement === 'partial' || s.statut_paiement === 'late'))
      )
    : scored;

  filtered.sort((a, b) => (a.nom || '').localeCompare(b.nom || '') || String(a.id).localeCompare(String(b.id)));

  const totalCount = filtered.length;
  const offset = (page - 1) * pageSize;
  const pageRows = filtered.slice(offset, offset + pageSize).map((r) => ({ ...r, total_count: totalCount }));

  return pageRows;
}

// ============================================================================
// get_students_widget_stats
// ============================================================================
async function getStudentsWidgetStats(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  const classes = await table('classes');
  const classesById = new Map(classes.map((c) => [c.id, c]));
  const pctEchuParAnnee = await computePctEchuParAnnee(etabId);

  const paiements = alive(await table('paiements')).filter((p) => p.statut === 'paid' && p.type_frais === 'Scolarité');
  const paidByEleve = new Map<string, number>();
  for (const p of paiements) {
    paidByEleve.set(p.eleve_id, (paidByEleve.get(p.eleve_id) || 0) + num(p.montant));
  }

  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);

  const counts = { total: 0, paidCount: 0, partialCount: 0, lateCount: 0, unpaidCount: 0, subventionnesCount: 0 };
  for (const e of eleves) {
    const classe = e.classe_id ? classesById.get(e.classe_id) : null;
    const isSub = Boolean(e.est_subventionne);
    const totalDue = isSub ? 55000 : (num(classe?.prix) - num(classe?.frais_inscription));
    const totalPaid = paidByEleve.get(e.id) || 0;
    const pctEchu = pctEchuParAnnee.get(e.annee_scolaire_id) || 0;
    const statut = statutPaiement(totalDue, totalPaid, pctEchu);
    counts.total++;
    if (isSub) counts.subventionnesCount++;
    if (statut === 'paid') counts.paidCount++;
    else if (statut === 'partial') counts.partialCount++;
    else if (statut === 'late') counts.lateCount++;
    else counts.unpaidCount++;
  }
  return counts;
}

// ============================================================================
// get_students_per_class
// ============================================================================
async function getStudentsPerClass(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;
  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId && e.classe_id);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);
  const counts = new Map<string, number>();
  for (const e of eleves) counts.set(e.classe_id, (counts.get(e.classe_id) || 0) + 1);
  return Array.from(counts.entries()).map(([classe_id, student_count]) => ({ classe_id, student_count }));
}

// ============================================================================
// get_finance_account_balances
// ============================================================================
async function getFinanceAccountBalances(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  let dateDebut: string | null = null;
  let dateFin: string | null = null;
  if (anneeId) {
    const annee = (await table('annees_scolaires')).find((a) => a.id === anneeId);
    dateDebut = annee?.date_debut ?? null;
    dateFin = annee?.date_fin ?? null;
  }

  const ecritures = alive(await table('ecritures_comptables')).filter((e) => {
    if (e.etablissement_id !== etabId) return false;
    if (anneeId && dateDebut && dateFin) return e.date >= dateDebut && e.date <= dateFin;
    return true;
  });
  const ecrituresIds = new Set(ecritures.map((e) => e.id));
  const realLignes = alive(await table('lignes_ecritures'))
    .filter((l) => ecrituresIds.has(l.ecriture_id))
    .map((l) => ({ compte_numero: l.compte_numero, debit: num(l.debit), credit: num(l.credit) }));

  const classes = await table('classes');
  const classesById = new Map(classes.map((c) => [c.id, c]));
  let elevesScope = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) elevesScope = elevesScope.filter((e) => e.annee_scolaire_id === anneeId);
  const elevesScopeInfo = elevesScope.map((e) => {
    const c = e.classe_id ? classesById.get(e.classe_id) : null;
    return { id: e.id, prix: num(c?.prix), frais_inscription: num(c?.frais_inscription) };
  });

  const constatationFrais: { compte_numero: string; debit: number; credit: number }[] = [];
  for (const e of elevesScopeInfo) {
    if (e.prix > 0) {
      constatationFrais.push({ compte_numero: '411', debit: e.prix, credit: 0 });
      constatationFrais.push({ compte_numero: '706', debit: 0, credit: e.prix });
    }
    if (e.frais_inscription > 0) {
      constatationFrais.push({ compte_numero: '411', debit: e.frais_inscription, credit: 0 });
      constatationFrais.push({ compte_numero: '706', debit: 0, credit: e.frais_inscription });
    }
  }

  const elevesScopeIds = new Set(elevesScope.map((e) => e.id));
  const paiementsScope = alive(await table('paiements')).filter((p) => p.statut === 'paid' && elevesScopeIds.has(p.eleve_id));
  const reglement: { compte_numero: string; debit: number; credit: number }[] = [];
  for (const p of paiementsScope) {
    const montant = num(p.montant);
    const compte = p.mode_paiement === 'Virement Bancaire' ? '521' : '571';
    reglement.push({ compte_numero: compte, debit: montant, credit: 0 });
    reglement.push({ compte_numero: '411', debit: 0, credit: montant });
  }

  const formationsScope = (await table('formations_rh')).filter((f) => {
    if (f.etablissement_id !== etabId || !(num(f.cout_total) > 0)) return false;
    if (anneeId && dateDebut && dateFin) return f.date_debut >= dateDebut && f.date_debut <= dateFin;
    return true;
  });
  const formationConst: { compte_numero: string; debit: number; credit: number }[] = [];
  const formationReglement: { compte_numero: string; debit: number; credit: number }[] = [];
  for (const f of formationsScope) {
    const cout = num(f.cout_total);
    formationConst.push({ compte_numero: '601', debit: cout, credit: 0 });
    formationConst.push({ compte_numero: '401', debit: 0, credit: cout });
    if (f.statut === 'Terminé' || f.statut === 'termine') {
      formationReglement.push({ compte_numero: '401', debit: cout, credit: 0 });
      formationReglement.push({ compte_numero: '521', debit: 0, credit: cout });
    }
  }

  const all = [...realLignes, ...constatationFrais, ...reglement, ...formationConst, ...formationReglement];
  const balances = new Map<string, { debit: number; credit: number }>();
  for (const l of all) {
    const cur = balances.get(l.compte_numero) || { debit: 0, credit: 0 };
    cur.debit += l.debit;
    cur.credit += l.credit;
    balances.set(l.compte_numero, cur);
  }
  return Array.from(balances.entries()).map(([compte_numero, v]) => ({ compte_numero, debit: v.debit, credit: v.credit }));
}

// ============================================================================
// get_finance_ca_par_classe
// ============================================================================
async function getFinanceCaParClasse(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;
  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId && e.classe_id);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);
  const elevesById = new Map(eleves.map((e) => [e.id, e]));

  const paiements = alive(await table('paiements')).filter((p) => p.statut === 'paid' && elevesById.has(p.eleve_id));
  const map = new Map<string, number>();
  for (const p of paiements) {
    const classeId = elevesById.get(p.eleve_id)!.classe_id;
    map.set(classeId, (map.get(classeId) || 0) + num(p.montant));
  }
  return Array.from(map.entries()).map(([classe_id, ca_collecte]) => ({ classe_id, ca_collecte }));
}

// ============================================================================
// get_finance_reconciliation_quotidienne
// ============================================================================
async function getFinanceReconciliationQuotidienne(params: any) {
  const etabId = params.p_etablissement_id;
  const jours = Math.max(params.p_jours || 7, 1);
  const anneeId = params.p_annee_scolaire_id || null;

  const today = todayISO();
  const startDate = addDaysISO(today, -(jours - 1));

  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);
  const elevesIds = new Set(eleves.map((e) => e.id));

  const paiements = alive(await table('paiements')).filter(
    (p) => elevesIds.has(p.eleve_id) && p.date >= startDate && p.date <= today
  );

  const byDay = new Map<string, { constate: number; encaisse: number }>();
  for (const p of paiements) {
    const cur = byDay.get(p.date) || { constate: 0, encaisse: 0 };
    cur.constate += num(p.montant);
    if (p.statut === 'paid') cur.encaisse += num(p.montant);
    byDay.set(p.date, cur);
  }

  const jourList: { jour: string; ca_constate: number; encaisse: number }[] = [];
  for (let i = 0; i < jours; i++) {
    const jour = addDaysISO(startDate, i);
    const v = byDay.get(jour) || { constate: 0, encaisse: 0 };
    jourList.push({ jour, ca_constate: v.constate, encaisse: v.encaisse });
  }
  return jourList;
}

// ============================================================================
// get_class_rankings
// ============================================================================
async function getClassRankings(params: any) {
  const classeId = params.p_classe_id;
  const trimestre = params.p_trimestre;

  // etablissements n'est jamais mirroé localement (table de compte) : le
  // seuil de réussite personnalisé de l'établissement n'est donc pas
  // disponible hors-ligne. On retombe sur le même défaut (10) que la
  // fonction Postgres utilise déjà quand seuil_reussite est NULL.
  const seuil = 10;

  const eleves = alive(await table('eleves')).filter((e) => e.classe_id === classeId);
  const notes = alive(await table('notes')).filter((n) => n.trimestre === trimestre && n.note !== null && n.note !== undefined);
  const elevesIds = new Set(eleves.map((e) => e.id));
  const notesParEleve = new Map<string, { totalPoints: number; totalCoefs: number }>();
  for (const n of notes) {
    if (!elevesIds.has(n.eleve_id)) continue;
    const coef = n.coefficient ? num(n.coefficient) : 1;
    const cur = notesParEleve.get(n.eleve_id) || { totalPoints: 0, totalCoefs: 0 };
    cur.totalPoints += num(n.note) * coef;
    cur.totalCoefs += coef;
    notesParEleve.set(n.eleve_id, cur);
  }

  const perStudent = eleves.map((e) => {
    const agg = notesParEleve.get(e.id);
    const moyenneRaw = agg && agg.totalCoefs > 0 ? agg.totalPoints / agg.totalCoefs : 0;
    return {
      eleve_id: e.id,
      nom: e.nom,
      prenom: e.prenom,
      matricule: e.matricule,
      moyenneRaw,
      totalPoints: agg?.totalPoints ?? 0
    };
  });

  const ranked = [...perStudent]
    .filter((p) => p.moyenneRaw > 0)
    .sort((a, b) => b.moyenneRaw - a.moyenneRaw);
  const rangByEleve = new Map<string, number>();
  ranked.forEach((p, idx) => {
    // RANK() : mêmes ex-aequo partagent le même rang, saut du rang suivant.
    if (idx > 0 && ranked[idx - 1].moyenneRaw === p.moyenneRaw) {
      rangByEleve.set(p.eleve_id, rangByEleve.get(ranked[idx - 1].eleve_id)!);
    } else {
      rangByEleve.set(p.eleve_id, idx + 1);
    }
  });

  const mention = (moyenneRaw: number) => {
    if (moyenneRaw >= 16) return 'Très Bien';
    if (moyenneRaw >= 14) return 'Bien';
    if (moyenneRaw >= 12) return 'Assez Bien';
    if (moyenneRaw >= seuil) return 'Passable';
    return 'Insuffisant';
  };

  const effectif = eleves.length;
  const result = perStudent.map((p) => ({
    eleve_id: p.eleve_id,
    nom: p.nom,
    prenom: p.prenom,
    matricule: p.matricule,
    moyenne: round(p.moyenneRaw, 2),
    total_points: round(p.totalPoints, 2),
    rang: rangByEleve.get(p.eleve_id) ?? null,
    mention: mention(p.moyenneRaw),
    effectif
  }));

  result.sort((a, b) => {
    const aNull = a.rang === null;
    const bNull = b.rang === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && a.rang !== b.rang) return (a.rang as number) - (b.rang as number);
    return (a.nom || '').localeCompare(b.nom || '') || (a.prenom || '').localeCompare(b.prenom || '');
  });

  return result;
}

// ============================================================================
// get_moyenne_generale
// ============================================================================
async function getMoyenneGenerale(params: any) {
  const etabId = params.p_etablissement_id;
  const trimestre = params.p_trimestre || null;

  const eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  const elevesIds = new Set(eleves.map((e) => e.id));
  let notes = alive(await table('notes')).filter((n) => n.note !== null && n.note !== undefined && elevesIds.has(n.eleve_id));
  if (trimestre) notes = notes.filter((n) => n.trimestre === trimestre);

  const parEleve = new Map<string, { totalPoints: number; totalCoefs: number }>();
  for (const n of notes) {
    const coef = n.coefficient ? num(n.coefficient) : 1;
    const cur = parEleve.get(n.eleve_id) || { totalPoints: 0, totalCoefs: 0 };
    cur.totalPoints += num(n.note) * coef;
    cur.totalCoefs += coef;
    parEleve.set(n.eleve_id, cur);
  }

  const moyennes: number[] = [];
  for (const agg of parEleve.values()) {
    if (agg.totalCoefs > 0) moyennes.push(agg.totalPoints / agg.totalCoefs);
  }
  if (moyennes.length === 0) return null;
  return round(moyennes.reduce((s, v) => s + v, 0) / moyennes.length, 2);
}

// ============================================================================
// get_moyennes_par_section
// ============================================================================
async function getMoyennesParSection(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  const classes = await table('classes');
  const classesById = new Map(classes.map((c) => [c.id, c]));

  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);
  const elevesById = new Map(eleves.map((e) => [e.id, e]));

  const notes = alive(await table('notes')).filter((n) => n.note !== null && n.note !== undefined && elevesById.has(n.eleve_id));

  // clé composite eleve_id -> section, comme le GROUP BY n.eleve_id, section
  const parEleveSection = new Map<string, { section: string; totalPoints: number; totalCoefs: number }>();
  for (const n of notes) {
    const e = elevesById.get(n.eleve_id)!;
    const classe = e.classe_id ? classesById.get(e.classe_id) : null;
    const section = classe?.section || 'Francophone';
    const key = `${n.eleve_id}::${section}`;
    const coef = n.coefficient ? num(n.coefficient) : 1;
    const cur = parEleveSection.get(key) || { section, totalPoints: 0, totalCoefs: 0 };
    cur.totalPoints += num(n.note) * coef;
    cur.totalCoefs += coef;
    parEleveSection.set(key, cur);
  }

  const moyennesParSection = new Map<string, number[]>();
  for (const { section, totalPoints, totalCoefs } of parEleveSection.values()) {
    if (totalCoefs <= 0) continue;
    if (!moyennesParSection.has(section)) moyennesParSection.set(section, []);
    moyennesParSection.get(section)!.push(totalPoints / totalCoefs);
  }

  return Array.from(moyennesParSection.entries()).map(([section, moyennes]) => ({
    section,
    moyenne: round(moyennes.reduce((s, v) => s + v, 0) / moyennes.length, 2)
  }));
}

// ============================================================================
// get_sections_summary
// ============================================================================
async function getSectionsSummary(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  let classes = (await table('classes')).filter((c) => c.etablissement_id === etabId);
  if (anneeId) classes = classes.filter((c) => c.annee_scolaire_id === anneeId);
  const eleves = alive(await table('eleves'));

  const bySection = new Map<string, { classIds: Set<string>; studentsCount: number }>();
  for (const c of classes) {
    const section = c.section || 'Francophone';
    if (!bySection.has(section)) bySection.set(section, { classIds: new Set(), studentsCount: 0 });
    bySection.get(section)!.classIds.add(c.id);
  }
  for (const e of eleves) {
    if (!e.classe_id) continue;
    const classe = classes.find((c) => c.id === e.classe_id);
    if (!classe) continue;
    const section = classe.section || 'Francophone';
    if (bySection.has(section)) bySection.get(section)!.studentsCount++;
  }

  return Array.from(bySection.entries()).map(([section, v]) => ({
    section,
    classes_count: v.classIds.size,
    students_count: v.studentsCount
  }));
}

// ============================================================================
// get_parents_list
// ============================================================================
async function getParentsList(params: any) {
  const etabId = params.p_etablissement_id;
  const anneeId = params.p_annee_scolaire_id || null;

  let eleves = alive(await table('eleves')).filter((e) => e.etablissement_id === etabId);
  if (anneeId) eleves = eleves.filter((e) => e.annee_scolaire_id === anneeId);

  const pkeyOf = (e: Row) => {
    const tel = (e.telephone_parent || '').trim();
    if (tel) return tel;
    const email = (e.email_parent || '').trim();
    if (email) return email;
    return `parent-of-${e.id}`;
  };

  const base = eleves.map((e) => ({ ...e, pkey: pkeyOf(e) }));
  const byPkey = new Map<string, Row[]>();
  for (const e of base) {
    if (!byPkey.has(e.pkey)) byPkey.set(e.pkey, []);
    byPkey.get(e.pkey)!.push(e);
  }

  const cmpNomId = (a: Row, b: Row) => (a.nom || '').localeCompare(b.nom || '') || String(a.id).localeCompare(String(b.id));

  const result: any[] = [];
  for (const [pkey, group] of byPkey) {
    const first = [...group].sort(cmpNomId)[0];
    const withNomParent = group.filter((e) => e.nom_parent && e.nom_parent !== '');
    const longestNomParent =
      withNomParent.length > 0
        ? [...withNomParent].sort(
            (a, b) => (b.nom_parent.length - a.nom_parent.length) || cmpNomId(a, b)
          )[0]
        : null;
    const enfants = [...group]
      .sort(cmpNomId)
      .map((e) => ({
        id: e.id,
        nom: e.nom,
        prenom: e.prenom,
        telephoneParent: e.telephone_parent,
        emailParent: e.email_parent,
        nomParent: e.nom_parent
      }));

    result.push({
      parent_key: pkey,
      nom: longestNomParent?.nom_parent || 'Non renseigné',
      telephone: first.telephone_parent || '-',
      email: first.email_parent || '-',
      enfants
    });
  }
  return result;
}

// ============================================================================
// get_masse_salariale_historique
// ============================================================================
async function getMasseSalarialeHistorique(params: any) {
  const etabId = params.p_etablissement_id;
  const months = Math.max(params.p_months ?? 6, 1);

  const fiches = (await table('fiches_de_paie')).filter(
    (f) => f.etablissement_id === etabId && ['valide', 'paye'].includes(f.statut)
  );
  const byPeriode = new Map<string, { total: number; personnelIds: Set<string> }>();
  for (const f of fiches) {
    const cur = byPeriode.get(f.periode) || { total: 0, personnelIds: new Set<string>() };
    cur.total += num(f.salaire_brut);
    if (f.personnel_id) cur.personnelIds.add(f.personnel_id);
    byPeriode.set(f.periode, cur);
  }

  const periodsAsc = Array.from(byPeriode.keys()).sort();
  const scored = periodsAsc.map((periode, idx) => {
    const { total, personnelIds } = byPeriode.get(periode)!;
    const nombreSalaries = personnelIds.size;
    const salaireMoyen = nombreSalaries > 0 ? Math.round(total / nombreSalaries) : 0;
    const prevTotal = idx > 0 ? byPeriode.get(periodsAsc[idx - 1])!.total : null;
    const tauxCroissance = prevTotal === null || prevTotal === 0 ? null : round(((total - prevTotal) / prevTotal) * 100, 1);
    return { periode, valeur_total: total, nombre_salaries: nombreSalaries, salaire_moyen: salaireMoyen, taux_croissance: tauxCroissance };
  });

  const recentDesc = [...scored].sort((a, b) => b.periode.localeCompare(a.periode)).slice(0, months);
  return recentDesc.sort((a, b) => a.periode.localeCompare(b.periode));
}

// ============================================================================
// create_enseignant_with_personnel (écriture, multi-table)
// ============================================================================
async function createEnseignantWithPersonnel(params: any) {
  const etabId = params.p_etablissement_id;
  const nom = params.p_nom;
  const prenom = params.p_prenom;

  const existing = (await table('enseignants')).filter((e) => e.etablissement_id === etabId);
  let matricule = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = 'PROF-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!existing.some((e) => e.matricule === candidate)) {
      matricule = candidate;
      break;
    }
  }
  if (!matricule) throw new Error("Impossible de générer un matricule unique après 20 tentatives.");

  const dateEmbauche = params.p_date_embauche || todayISO();
  const enseignant = {
    id: newId(),
    matricule,
    nom,
    prenom,
    sexe: params.p_sexe,
    telephone: params.p_telephone ?? null,
    email: params.p_email ?? null,
    matiere_principale: params.p_matiere_principale ?? null,
    salaire_mensuel: params.p_salaire_mensuel ?? 0,
    statut: params.p_statut ?? 'actif',
    type_contrat: params.p_type_contrat ?? 'CDI',
    categorie: params.p_categorie ?? 'Enseignant',
    date_embauche: dateEmbauche,
    etablissement_id: etabId
  };

  const personnel = {
    id: newId(),
    nom,
    prenom,
    email: params.p_email ?? '',
    telephone: params.p_telephone ?? '+237 600 00 00 00',
    sexe: params.p_sexe,
    categorie: params.p_categorie ?? 'Enseignant',
    type_contrat: params.p_type_contrat ?? 'CDI',
    salaire_de_base: params.p_salaire_mensuel ?? 0,
    date_embauche: dateEmbauche,
    statut: 'actif',
    etablissement_id: etabId
  };

  const mouvement = {
    id: newId(),
    personnel_id: personnel.id,
    nom_personnel: `${nom} ${prenom}`,
    type: 'embauche',
    date: dateEmbauche,
    details: `Embauche en contrat ${personnel.type_contrat} (${personnel.categorie})`,
    etablissement_id: etabId
  };

  await saveRecordsToTable('enseignants', [enseignant]);
  await saveRecordsToTable('membres_personnel', [personnel]);
  await saveRecordsToTable('mouvements_personnel', [mouvement]);
  for (const [tbl, payload] of [
    ['enseignants', enseignant],
    ['membres_personnel', personnel],
    ['mouvements_personnel', mouvement]
  ] as const) {
    await addToQueue({ id: `task_${Date.now()}_${Math.floor(Math.random() * 100000)}`, table: tbl, action: 'insert', payload, timestamp: Date.now() });
  }

  return enseignant;
}

// ============================================================================
// create_ecriture_comptable (écriture, multi-table)
// ============================================================================
async function createEcritureComptable(params: any, ctx: RpcContext) {
  const etabId = ctx.callerEtablissementId;
  if (!etabId) throw new Error("Aucun établissement associé à l'utilisateur courant.");

  const lignes = params.p_lignes;
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error("L'écriture doit comporter au moins une ligne.");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lignes) {
    totalDebit += num(l.debit);
    totalCredit += num(l.credit);
    if (!l.compte_numero) throw new Error("Une ligne d'écriture référence un compte vide.");
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Écriture déséquilibrée : total débit = ${totalDebit}, total crédit = ${totalCredit}.`);
  }
  if (totalDebit <= 0) {
    throw new Error("Le montant total de l'écriture doit être strictement positif.");
  }

  const comptesExistants = (await table('comptes_ohada')).filter(
    (c) => c.etablissement_id === etabId || c.etablissement_id === null
  );
  const nouveauxComptes: Row[] = [];
  for (const l of lignes) {
    const already = comptesExistants.some((c) => c.numero === l.compte_numero);
    const dejaAjoute = nouveauxComptes.some((c) => c.numero === l.compte_numero);
    if (!already && !dejaAjoute) {
      nouveauxComptes.push({
        id: newId(),
        numero: l.compte_numero,
        libelle: l.libelle || `Compte ${l.compte_numero}`,
        classe: l.classe ? Number(l.classe) : Number(String(l.compte_numero)[0]),
        etablissement_id: etabId
      });
    }
  }
  if (nouveauxComptes.length > 0) {
    await saveRecordsToTable('comptes_ohada', nouveauxComptes);
    for (const c of nouveauxComptes) {
      await addToQueue({ id: `task_${Date.now()}_${Math.floor(Math.random() * 100000)}`, table: 'comptes_ohada', action: 'insert', payload: c, timestamp: Date.now() });
    }
  }

  const ecritureId = newId();
  const ecriture = {
    id: ecritureId,
    libelle: params.p_libelle,
    reference: params.p_reference,
    date: params.p_date || todayISO(),
    partenaire: params.p_partenaire ?? null,
    etablissement_id: etabId
  };
  await saveRecordsToTable('ecritures_comptables', [ecriture]);
  await addToQueue({ id: `task_${Date.now()}_${Math.floor(Math.random() * 100000)}`, table: 'ecritures_comptables', action: 'insert', payload: ecriture, timestamp: Date.now() });

  const lignesPayload = lignes.map((l: any) => ({
    id: newId(),
    ecriture_id: ecritureId,
    compte_numero: l.compte_numero,
    debit: num(l.debit),
    credit: num(l.credit)
  }));
  await saveRecordsToTable('lignes_ecritures', lignesPayload);
  for (const l of lignesPayload) {
    await addToQueue({ id: `task_${Date.now()}_${Math.floor(Math.random() * 100000)}`, table: 'lignes_ecritures', action: 'insert', payload: l, timestamp: Date.now() });
  }

  return ecritureId;
}

// ============================================================================
// soft_delete_paiement / soft_delete_eleve / soft_delete_ecriture (écriture)
// ============================================================================
const ADMIN_ROLES = new Set(['admin', 'administrateur', 'directeur']);

async function softDeleteRow(tableName: string, id: string) {
  const rows = await table(tableName);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const updated = { ...row, deleted_at: new Date().toISOString() };
  await saveRecordsToTable(tableName, [updated]);
  await addToQueue({
    id: `task_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    table: tableName,
    action: 'update',
    payload: { id, deleted_at: updated.deleted_at },
    filters: [{ field: 'id', value: id }],
    timestamp: Date.now()
  });
  return updated;
}

async function softDeletePaiement(params: any, ctx: RpcContext) {
  const role = (ctx.callerRole || '').toLowerCase();
  if (!ADMIN_ROLES.has(role)) {
    throw new Error('Seul un administrateur ou un directeur peut annuler un paiement.');
  }
  const paiement = (await table('paiements')).find((p) => p.id === params.p_id);
  if (!paiement || paiement.etablissement_id !== ctx.callerEtablissementId) {
    throw new Error('Paiement introuvable dans votre établissement.');
  }
  await softDeleteRow('paiements', params.p_id);
  return null;
}

async function softDeleteEleve(params: any, ctx: RpcContext) {
  const eleve = (await table('eleves')).find((e) => e.id === params.p_id);
  if (!eleve || eleve.etablissement_id !== ctx.callerEtablissementId) {
    throw new Error('Élève introuvable dans votre établissement.');
  }
  await softDeleteRow('eleves', params.p_id);
  const paiements = (await table('paiements')).filter((p) => p.eleve_id === params.p_id && !p.deleted_at);
  for (const p of paiements) await softDeleteRow('paiements', p.id);
  const notes = (await table('notes')).filter((n) => n.eleve_id === params.p_id && !n.deleted_at);
  for (const n of notes) await softDeleteRow('notes', n.id);
  const bulletins = (await table('bulletins')).filter((b) => b.eleve_id === params.p_id && !b.deleted_at);
  for (const b of bulletins) await softDeleteRow('bulletins', b.id);
  return null;
}

async function softDeleteEcriture(params: any, ctx: RpcContext) {
  const ecriture = (await table('ecritures_comptables')).find((e) => e.id === params.p_id);
  if (!ecriture || ecriture.etablissement_id !== ctx.callerEtablissementId) {
    throw new Error('Écriture introuvable dans votre établissement.');
  }
  await softDeleteRow('ecritures_comptables', params.p_id);
  const lignes = (await table('lignes_ecritures')).filter((l) => l.ecriture_id === params.p_id && !l.deleted_at);
  for (const l of lignes) await softDeleteRow('lignes_ecritures', l.id);
  return null;
}

// ============================================================================
// Dispatch
// ============================================================================
export async function callLocalAggregate(fn: string, params: any, ctx: RpcContext = {}): Promise<any> {
  switch (fn) {
    case 'get_dashboard_stats':
      return await getDashboardStats(params);
    case 'get_students_paginated':
      return await getStudentsPaginated(params);
    case 'get_students_widget_stats':
      return await getStudentsWidgetStats(params);
    case 'get_students_per_class':
      return await getStudentsPerClass(params);
    case 'get_finance_account_balances':
      return await getFinanceAccountBalances(params);
    case 'get_finance_ca_par_classe':
      return await getFinanceCaParClasse(params);
    case 'get_finance_reconciliation_quotidienne':
      return await getFinanceReconciliationQuotidienne(params);
    case 'get_class_rankings':
      return await getClassRankings(params);
    case 'get_moyenne_generale':
      return await getMoyenneGenerale(params);
    case 'get_moyennes_par_section':
      return await getMoyennesParSection(params);
    case 'get_sections_summary':
      return await getSectionsSummary(params);
    case 'get_parents_list':
      return await getParentsList(params);
    case 'get_masse_salariale_historique':
      return await getMasseSalarialeHistorique(params);
    case 'create_enseignant_with_personnel':
      return await createEnseignantWithPersonnel(params);
    case 'create_ecriture_comptable':
      return await createEcritureComptable(params, ctx);
    case 'soft_delete_paiement':
      return await softDeletePaiement(params, ctx);
    case 'soft_delete_eleve':
      return await softDeleteEleve(params, ctx);
    case 'soft_delete_ecriture':
      return await softDeleteEcriture(params, ctx);
    default:
      throw new Error(`Cette action (${fn}) nécessite une connexion internet et ne peut pas s'exécuter hors-ligne.`);
  }
}
