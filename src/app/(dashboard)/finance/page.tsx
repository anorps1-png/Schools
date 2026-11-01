'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { 
  EcritureComptable, 
  CompteOHADA, 
  Eleve, 
  MembrePersonnel, 
  FormationRH 
} from '@/types/domain';
import { planComptableOHADA } from '@/mock/comptabilite';
import type { BudgetPrevisionnel } from '@/mock/finance';
import { createClient } from '@/lib/supabase/client';
import { useEtablissement } from '@/contexts/etablissement-context';
import { captureError, captureMessage } from '@/lib/observability/logger';
import { getDashboardStats, type DashboardStats } from '@/lib/queries/dashboard';
import { sanitizeExcelValue } from '@/lib/excel';
import { getMoyenneGenerale } from '@/lib/queries/evaluations';
import { getAbsences, getEvaluationsRH } from '@/lib/queries/rh';
import {
  getFinanceAccountBalances,
  getFinanceCaParClasse,
  getFinanceReconciliationQuotidienne,
  type AccountBalance,
  type ReconciliationJour,
} from '@/lib/queries/finance';


export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<'bsc' | 'productivity' | 'ratios' | 'cash' | 'budget' | 'accounting'>('bsc');
  
  // State for accounting transactions
  const [ecritures, setEcritures] = useState<EcritureComptable[]>([]);
  const [planComptable, setPlanComptable] = useState<CompteOHADA[]>([]);
  
  // State for other domains
  const [students, setStudents] = useState<Eleve[]>([]);
  const [personnel, setPersonnel] = useState<MembrePersonnel[]>([]);
  const [formations, setFormations] = useState<FormationRH[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [tranches, setTranches] = useState<any[]>([]);

  // Modals for accounting
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expTypeSaisie, setExpTypeSaisie] = useState<'immediat' | 'credit' | 'reglement'>('immediat');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expLibelle, setExpLibelle] = useState('');
  const [expReference, setExpReference] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expAmountPaye, setExpAmountPaye] = useState('');
  const [expCompteDebit, setExpCompteDebit] = useState('601');
  const [expCompteTiers, setExpCompteTiers] = useState('401');
  const [expCompteCredit, setExpCompteCredit] = useState('571');
  const [expTva, setExpTva] = useState(false);
  const [expPartenaire, setExpPartenaire] = useState('');

  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccNum, setNewAccNum] = useState('');
  const [newAccLibelle, setNewAccLibelle] = useState('');
  const [newAccClasse, setNewAccClasse] = useState('6');

  // Subtab for accounting
  const [accountingSubTab, setAccountingSubTab] = useState<'journal' | 'balance' | 'bilan' | 'dsf'>('journal');
  const [userRole, setUserRole] = useState<string>('directeur');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [journalSearchTerm, setJournalSearchTerm] = useState('');

  // BSC years state

  // Budget states
  const [budgetLines, setBudgetLines] = useState<BudgetPrevisionnel[]>([]);
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [newBudgetPoste, setNewBudgetPoste] = useState('');
  const [newBudgetCategorie, setNewBudgetCategorie] = useState<'Revenu' | 'Charge'>('Charge');
  const [newBudgetPrevu, setNewBudgetPrevu] = useState('');
  const [newBudgetRealise, setNewBudgetRealise] = useState('');

  // Editing budget lines
  const [editingBudgetIndex, setEditingBudgetIndex] = useState<number | null>(null);
  const [editBudgetPoste, setEditBudgetPoste] = useState('');
  const [editBudgetCategorie, setEditBudgetCategorie] = useState<'Revenu' | 'Charge'>('Charge');
  const [editBudgetPrevu, setEditBudgetPrevu] = useState('');
  const [editBudgetRealise, setEditBudgetRealise] = useState('');

  // Budget report state
  const [showBudgetReportModal, setShowBudgetReportModal] = useState(false);

  const { etablissementId, academicYearId } = useEtablissement();

  // Trésorerie perçue / effectif élèves : calculés en base (RPC déjà utilisée
  // par le tableau de bord, get_dashboard_stats) quand disponible, plutôt que
  // de dépendre du fetch complet élèves+paiements plus bas (students). Repli
  // automatique sur le calcul client existant si la RPC échoue.
  const [serverStats, setServerStats] = useState<DashboardStats | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getDashboardStats(etablissementId, academicYearId || null)
        .then(setServerStats)
        .catch(() => setServerStats(null));
    }
  }, [etablissementId, academicYearId]);

  // Moyenne générale réelle (RPC get_moyenne_generale) pour la carte BSC
  // "Moyenne Générale", qui affichait auparavant une constante fabriquée (12,5).
  const [serverMoyenneGenerale, setServerMoyenneGenerale] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getMoyenneGenerale(etablissementId)
        .then(setServerMoyenneGenerale)
        .catch(() => setServerMoyenneGenerale(null));
    }
  }, [etablissementId]);

  // Total des jours d'absence du personnel pour la carte BSC "Jours Absences
  // Staff", qui affichait auparavant une constante fabriquée (42).
  const [totalAbsenceDays, setTotalAbsenceDays] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getAbsences(etablissementId)
        .then((rows) => {
          const total = (rows || []).reduce((sum: number, r: any) => sum + (Number(r.duree_jours) || 0), 0);
          setTotalAbsenceDays(total);
        })
        .catch(() => setTotalAbsenceDays(null));
    }
  }, [etablissementId]);

  // Évaluations RH réelles, pour les cartes BSC "Adhérence Job Role" et "Note
  // d'évaluation stages" (auparavant des constantes fixes : 89,2% / 15,6).
  const [evaluationsRH, setEvaluationsRH] = useState<any[]>([]);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getEvaluationsRH(etablissementId)
        .then((rows) => setEvaluationsRH(rows || []))
        .catch(() => setEvaluationsRH([]));
    }
  }, [etablissementId]);

  // Soldes par compte calculés en base (get_finance_account_balances), pour
  // éviter le fetch complet élèves+paiements+écritures ci-dessous. N'est
  // utilisée comme source que si aucune écriture synthétique n'a été masquée
  // localement (voir hasLocalDeletedEcritures plus bas) : ce masquage n'existe
  // que dans le localStorage du navigateur et ne peut pas être reproduit
  // côté serveur, donc le calcul client reste la seule source fiable pour un
  // établissement qui a utilisé cette fonctionnalité.
  const [serverBalances, setServerBalances] = useState<Record<string, AccountBalance> | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getFinanceAccountBalances(etablissementId, academicYearId || null)
        .then(setServerBalances)
        .catch(() => setServerBalances(null));
    }
  }, [etablissementId, academicYearId]);

  // CA collecté par classe, calculé en base (get_finance_ca_par_classe), pour
  // getClassProductivity/getSectionProductivity. Ne dépend pas des écritures
  // ni du registre de masquage local, donc toujours sûre à préférer.
  const [serverCaParClasse, setServerCaParClasse] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getFinanceCaParClasse(etablissementId, academicYearId || null)
        .then(setServerCaParClasse)
        .catch(() => setServerCaParClasse(null));
    }
  }, [etablissementId, academicYearId]);

  // Rapprochement de trésorerie quotidien, calculé en base
  // (get_finance_reconciliation_quotidienne). Même remarque que ci-dessus :
  // basée sur paiements, pas sur ecritures, donc toujours sûre à préférer.
  const [serverReconciliation, setServerReconciliation] = useState<ReconciliationJour[] | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getFinanceReconciliationQuotidienne(etablissementId, 7, academicYearId || null)
        .then(setServerReconciliation)
        .catch(() => setServerReconciliation(null));
    }
  }, [etablissementId, academicYearId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSession = localStorage.getItem('mboaschool_offline_session');
      if (storedSession) {
        try {
          const parsed = JSON.parse(storedSession);
          if (parsed.role) {
            setUserRole(parsed.role);
          }
        } catch (e) {
          captureError(e, { context: "Error parsing offline session:" });
        }
      }
    }

    if (!etablissementId) return;
    const loadData = async () => {
      const supabase = createClient();
      
      // 1. Fetch Plan Comptable
      try {
        const { data: storedPlan, error } = await supabase
          .from('comptes_ohada')
          .select('*')
          .eq('etablissement_id', etablissementId)
          .order('numero', { ascending: true });
        
        let loadedPlan = planComptableOHADA;
        if (!error && storedPlan && storedPlan.length > 0) {
          loadedPlan = storedPlan;
        } else {
          const stored = localStorage.getItem('mboaschool_plancomptable');
          if (stored) {
            try {
              loadedPlan = JSON.parse(stored);
            } catch (e) {}
          }
        }
        
        // Merge missing accounts from planComptableOHADA dynamically
        const mergedPlan = [...loadedPlan];
        planComptableOHADA.forEach(mockAcc => {
          if (!mergedPlan.some(p => p.numero === mockAcc.numero)) {
            mergedPlan.push(mockAcc);
          }
        });
        
        const sortedPlan = mergedPlan.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
        setPlanComptable(sortedPlan);
      } catch (err) {
        const stored = localStorage.getItem('mboaschool_plancomptable');
        let loadedPlan = planComptableOHADA;
        if (stored) {
          try {
            loadedPlan = JSON.parse(stored);
          } catch (e) {}
        }
        const mergedPlan = [...loadedPlan];
        planComptableOHADA.forEach(mockAcc => {
          if (!mergedPlan.some(p => p.numero === mockAcc.numero)) {
            mergedPlan.push(mockAcc);
          }
        });
        const sortedPlan = mergedPlan.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
        setPlanComptable(sortedPlan);
      }

      // 1.5 Fetch Classes first so we have access to class prices!
      let loadedClasses: any[] = [];
      try {
        let classesQuery = supabase
          .from('classes')
          .select('*')
          .eq('etablissement_id', etablissementId);

        if (academicYearId) {
          classesQuery = classesQuery.eq('annee_scolaire_id', academicYearId);
        }

        const { data: classesData, error: classesErr } = await classesQuery;
        if (!classesErr && classesData) {
          loadedClasses = classesData;
          setClasses(classesData);
        } else {
          setClasses([]);
        }
      } catch (err) {
        captureError(err, { context: 'Error fetching classes in loadData:' });
      }

      // 2. Fetch Students & Payments from Supabase
      let loadedStudents: Eleve[] = [];
      let loadedPersonnel: MembrePersonnel[] = [];
      let loadedFormations: FormationRH[] = [];
      try {
        let allElevesData: any[] = [];
        let from = 0;
        const step = 1000;
        let hasMore = true;
        let fetchError: any = null;
        while (hasMore) {
          let elevesQuery = supabase
            .from('eleves')
            .select('*, paiements(*)')
            .eq('etablissement_id', etablissementId);

          if (academicYearId) {
            elevesQuery = elevesQuery.eq('annee_scolaire_id', academicYearId);
          }

          const { data, error: err } = await elevesQuery
            .order('nom', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + step - 1);
          if (err) {
            fetchError = err;
            break;
          }
          if (data && data.length > 0) {
            allElevesData = allElevesData.concat(data);
            from += step;
            if (data.length < step) hasMore = false;
          } else {
            hasMore = false;
          }
        }
        const elevesData = allElevesData;
        const error = fetchError;
        
        if (!error && elevesData) {
          // Map to domain format
          loadedStudents = elevesData.map((e: any) => ({
            id: e.id,
            matricule: e.matricule,
            nom: e.nom,
            prenom: e.prenom,
            sexe: e.sexe,
            dateNaissance: e.date_naissance,
            lieuNaissance: e.lieu_naissance,
            classeId: e.classe_id,
            anneeScolaireId: e.annee_scolaire_id,
            telephoneParent: e.telephone_parent,
            nomParent: e.nom_parent,
            emailParent: e.email_parent,
            dateInscription: e.date_inscription,
            statut: e.statut,
            estSubventionne: Boolean(e.est_subventionne),
            est_subventionne: Boolean(e.est_subventionne),
            paiements: (e.paiements || []).map((p: any) => ({
              id: p.id,
              eleveId: p.eleve_id,
              montant: Number(p.montant),
              date: p.date,
              modePaiement: p.mode_paiement,
              typeFrais: p.type_frais,
              statut: p.statut,
              reference: p.reference
            }))
          }));
          setStudents(loadedStudents);
        } else {
          setStudents([]);
        }
      } catch (err) {
        setStudents([]);
      }

      // 3. Fetch Personnel (membres_personnel)
      try {
        const { data: persData, error } = await supabase
          .from('membres_personnel')
          .select('*')
          .eq('etablissement_id', etablissementId);
        if (!error && persData && persData.length > 0) {
          const mapped = persData.map((p: any) => ({
            id: p.id,
            nom: p.nom,
            prenom: p.prenom,
            email: p.email,
            telephone: p.telephone,
            sexe: p.sexe,
            categorie: p.categorie,
            typeContrat: p.type_contrat,
            salaireDeBase: Number(p.salaire_de_base),
            dateEmbauche: p.date_embauche,
            statut: p.statut
          }));
          loadedPersonnel = mapped;
          setPersonnel(mapped);
        } else {
          setPersonnel([]);
        }
      } catch (err) {
        setPersonnel([]);
      }

      // 4. Formations
      try {
        const { data: formsData, error } = await supabase
          .from('formations_rh')
          .select('*')
          .eq('etablissement_id', etablissementId);
        if (!error && formsData && formsData.length > 0) {
          const mapped = formsData.map((f: any) => ({
            id: f.id,
            theme: f.theme,
            dateDebut: f.date_debut,
            dateFin: f.date_fin,
            coutTotal: Number(f.cout_total),
            organisme: f.organisme,
            statut: f.statut,
            beneficiairesIds: []
          }));
          loadedFormations = mapped;
          setFormations(mapped);
        } else {
          setFormations([]);
        }
      } catch (err) {
        setFormations([]);
      }

      // 5. Fetch General Ledger entries
      let customEcritures: EcritureComptable[] = [];
      let loadedFromSupabase = false;
      try {
        const { data: ecrData, error } = await supabase
          .from('ecritures_comptables')
          .select('*, lignes_ecritures(*)')
          .eq('etablissement_id', etablissementId);
        
        if (!error && ecrData && ecrData.length > 0) {
          customEcritures = ecrData.map((e: any) => ({
            id: e.id,
            date: e.date,
            libelle: e.libelle,
            reference: e.reference,
            partenaire: e.partenaire,
            lignes: (e.lignes_ecritures || []).map((l: any) => ({
              compteNumero: l.compte_numero,
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0)
            }))
          }));
          loadedFromSupabase = true;
          // Sync to local storage for offline use
          localStorage.setItem('mboaschool_ecritures', JSON.stringify(customEcritures));
        }
      } catch (err) {
        captureError(err, { context: "Error loading ecritures:" });
      }

      // Fallback to local storage if not loaded from Supabase (e.g. offline, empty database, or network error)
      if (!loadedFromSupabase && typeof window !== 'undefined') {
        const stored = localStorage.getItem('mboaschool_ecritures');
        if (stored) {
          try {
            customEcritures = JSON.parse(stored);
          } catch (e) {
            customEcritures = [];
          }
        } else {
          // Un nouvel établissement démarre avec un journal vierge
          customEcritures = [];
        }
      }

      // Auto-generate entries from student payments dynamically
      const paymentEcritures: EcritureComptable[] = [];
      loadedStudents.forEach((student: Eleve) => {
        if (!student) return;
        const isSub = Boolean(student.estSubventionne ?? student.est_subventionne);
        const matchedClass = loadedClasses.find((c: any) => c.id === student.classeId || c.nom === student.classeId);
        const standardPrice = matchedClass ? Number(matchedClass.prix || 0) : 200000;
        const classPrice = isSub ? 55000 : standardPrice;
        
        if (classPrice > 0) {
          const dateConst = student.dateInscription ? student.dateInscription.split('T')[0] : '2025-09-01';
          paymentEcritures.push({
            id: `ecr-const-${student.id}`,
            date: dateConst,
            libelle: `Constatation Frais Scolaires${isSub ? ' (Subventionné)' : ''} - ${student.nom} ${student.prenom}`,
            reference: `FACT-${student.matricule}`,
            lignes: [
              { compteNumero: '411', debit: classPrice, credit: 0 },
              { compteNumero: '706', debit: 0, credit: classPrice }
            ]
          });
        }

        // Constatation des frais d'inscription : même compte 706 que la
        // scolarité (les deux sont des prestations de services de l'école),
        // pour que la Trésorerie Perçue (qui inclut l'inscription) se
        // rapproche d'un CA Constaté qui couvre le même périmètre.
        // Les élèves subventionnés bénéficient d'un forfait conventionné (0 F inscription supplémentaire).
        const fraisInscription = isSub ? 0 : (matchedClass ? Number(matchedClass.frais_inscription || 0) : 0);
        if (fraisInscription > 0) {
          const dateConst = student.dateInscription ? student.dateInscription.split('T')[0] : '2025-09-01';
          paymentEcritures.push({
            id: `ecr-const-insc-${student.id}`,
            date: dateConst,
            libelle: `Constatation Frais Inscription - ${student.nom} ${student.prenom}`,
            reference: `FACT-INSC-${student.matricule}`,
            lignes: [
              { compteNumero: '411', debit: fraisInscription, credit: 0 },
              { compteNumero: '706', debit: 0, credit: fraisInscription }
            ]
          });
        }

        const paiements = student.paiements || [];
        paiements.forEach(p => {
          if (p.statut === 'paid') {
            const compTres = p.modePaiement === 'Virement Bancaire' ? '521' : '571';
            paymentEcritures.push({
              id: `ecr-pay-${p.id}`,
              date: p.date.split('T')[0],
              libelle: `Règlement ${p.typeFrais} - ${student.nom} ${student.prenom}`,
              reference: p.reference,
              lignes: [
                { compteNumero: compTres, debit: p.montant, credit: 0 },
                { compteNumero: '411', debit: 0, credit: p.montant }
              ]
            });
          }
        });
      });

      // Les écritures de salaire réelles (constatation + règlement) sont posées
      // par la validation de paie RH (rh/page.tsx handleValiderPaie -> addEcritureComptable),
      // et arrivent donc déjà dans customEcritures via la table ecritures_comptables.
      // Une génération automatique ici dupliquait ces écritures réelles (double
      // comptage du compte 661 dès qu'une paie était validée) en plus de fabriquer
      // 5 mois de salaire complet pour tout le personnel actif, qu'il ait ou non
      // été réellement payé. Supprimée : la masse salariale ne reflète maintenant
      // que la paie réellement validée.

      // Auto-generate training entries dynamically
      const trainingEcritures: EcritureComptable[] = [];
      loadedFormations.forEach((f: any) => {
        const amount = Number(f.cout_total || f.coutTotal || 0);
        if (amount > 0) {
          const dateConst = f.date_debut || f.dateDebut || '2026-03-01';
          const datePay = f.date_fin || f.dateFin || '2026-03-15';
          // Constatation
          trainingEcritures.push({
            id: `ecr-train-const-${f.id}`,
            date: typeof dateConst === 'string' ? dateConst.split('T')[0] : '2026-03-01',
            libelle: `Frais formation : ${f.theme}`,
            reference: `FOR-${(f.id || '').slice(-4)}`,
            partenaire: f.organisme || 'Organisme de formation',
            lignes: [
              { compteNumero: '601', debit: amount, credit: 0 },
              { compteNumero: '401', debit: 0, credit: amount }
            ]
          });
          // Règlement (paid) if status is Terminé
          if (f.statut === 'Terminé' || f.statut === 'termine') {
            trainingEcritures.push({
              id: `ecr-train-pay-${f.id}`,
              date: typeof datePay === 'string' ? datePay.split('T')[0] : '2026-03-15',
              libelle: `Règlement formation : ${f.theme}`,
              reference: `PAY-FOR-${(f.id || '').slice(-4)}`,
              partenaire: f.organisme || 'Organisme de formation',
              lignes: [
                { compteNumero: '401', debit: amount, credit: 0 },
                { compteNumero: '521', debit: 0, credit: amount }
              ]
            });
          }
        }
      });

      // Load registry of deleted entries (so admin deleted ones don't show up again)
      let deletedIds: string[] = [];
      const storedDeleted = localStorage.getItem('mboaschool_deleted_ecritures');
      if (storedDeleted) {
        try {
          deletedIds = JSON.parse(storedDeleted);
        } catch (e) {
          captureError(e, { context: "Error parsing deleted ecritures:" });
        }
      }

      const combined = [...customEcritures, ...paymentEcritures, ...trainingEcritures]
        .filter(e => !deletedIds.includes(e.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setEcritures(combined);

      // 7. Budget lines
      const storedBudget = localStorage.getItem('mboaschool_budget_lines');
      setBudgetLines(storedBudget ? JSON.parse(storedBudget) : []);

      // 8. Classes already fetched in step 1.5

      // Fetch Teachers
      try {
        const { data: teachersData, error: teachersErr } = await supabase
          .from('enseignants')
          .select('*')
          .eq('etablissement_id', etablissementId);
        if (!teachersErr && teachersData) {
          setTeachers(teachersData);
        }
      } catch (err) {
        captureError(err, { context: 'Error fetching teachers:' });
      }

      // 9. Fetch Sections
      try {
        const { data: sectionsData, error: sectionsErr } = await supabase
          .from('sections')
          .select('*')
          .eq('etablissement_id', etablissementId);
        if (!sectionsErr && sectionsData) {
          setSections(sectionsData);
        }
      } catch (err) {
        captureError(err, { context: 'Error fetching sections:' });
      }

      // 10. Fetch Tranches
      try {
        const { data: tranchesData } = await supabase
          .from('tranches_scolarite')
          .select('*')
          .eq('etablissement_id', etablissementId);
        if (tranchesData) {
          setTranches(tranchesData);
        }
      } catch (err) {
        captureError(err, { context: 'Error fetching tranches:' });
      }
    };

    loadData();
  }, [etablissementId, academicYearId]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Accounting balance computed first to feed financial metrics.
  // legacyAccountBalances : calcul client historique (fetch complet
  // élèves+paiements+écritures plus haut), c'est la seule source qui respecte
  // le registre local de masquage d'écritures synthétiques (voir plus haut).
  const legacyAccountBalances: Record<string, { debit: number, credit: number, solde: number }> = {};
  planComptable.forEach(c => {
    legacyAccountBalances[c.numero] = { debit: 0, credit: 0, solde: 0 };
  });

  ecritures.forEach(ecr => {
    ecr.lignes.forEach(ligne => {
      if (!legacyAccountBalances[ligne.compteNumero]) {
        legacyAccountBalances[ligne.compteNumero] = { debit: 0, credit: 0, solde: 0 };
      }
      legacyAccountBalances[ligne.compteNumero].debit += ligne.debit;
      legacyAccountBalances[ligne.compteNumero].credit += ligne.credit;
    });
  });

  Object.keys(legacyAccountBalances).forEach(num => {
    const b = legacyAccountBalances[num];
    b.solde = b.debit - b.credit;
  });

  const hasLocalDeletedEcritures = (() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('mboaschool_deleted_ecritures');
      return !!stored && (JSON.parse(stored) as string[]).length > 0;
    } catch {
      return false;
    }
  })();

  // accountBalances : préfère le calcul serveur (get_finance_account_balances)
  // quand il est disponible ET qu'aucune écriture synthétique n'a été masquée
  // localement — sinon repli sur legacyAccountBalances, seule source fiable
  // dans ce cas précis (voir commentaire sur serverBalances plus haut).
  const accountBalances: Record<string, { debit: number, credit: number, solde: number }> =
    (serverBalances && !hasLocalDeletedEcritures)
      ? (() => {
          const merged: Record<string, { debit: number, credit: number, solde: number }> = {};
          planComptable.forEach(c => {
            merged[c.numero] = { debit: 0, credit: 0, solde: 0 };
          });
          Object.keys(serverBalances).forEach(num => {
            const b = serverBalances[num];
            merged[num] = { debit: b.debit, credit: b.credit, solde: b.debit - b.credit };
          });
          return merged;
        })()
      : legacyAccountBalances;

  // --- Dynamic Financial Metrics for 2026 ---

  // Chiffre d'Affaires 2026 (credit balance of all Class 7 accounts in ledger)
  const totalCA2026 = planComptable
    .filter(c => c.numero.startsWith('7'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.credit - accountBalances[c.numero]?.debit || 0), 0);

  // Trésorerie perçue (real cash collections from student payments) :
  // RPC serveur si disponible (évite de dépendre du fetch complet students),
  // sinon repli sur le calcul client historique.
  // Inscription + Scolarité (tout encaissement réel, quel que soit le type de
  // frais) : la trésorerie perçue est un montant de caisse, pas un agrégat
  // scolarité seule. Le CA Constaté (compte 706) est élargi en miroir
  // (constatation frais d'inscription ci-dessus) pour que le rapprochement
  // compare le même périmètre des deux côtés.
  const totalTresoreriePercue = serverStats?.total_paid ?? students.reduce((sum, student) => {
    return sum + (student.paiements || [])
      .filter(p => p.statut === 'paid')
      .reduce((s, p) => s + p.montant, 0);
  }, 0);

  // Masse salariale mensuelle et annuelle 2026 from ledger (account 661)
  const activeStaff = personnel.filter(p => p.statut === 'actif');
  const masseSalarialeMensuelle2026 = activeStaff.reduce((sum, p) => sum + p.salaireDeBase, 0);
  const masseSalarialeAnnuelle2026 = accountBalances['661']?.debit || 0;

  // Training expenditures
  const totalTrainingCosts2026 = formations.reduce((sum, f) => sum + f.coutTotal, 0);

  // Operating charges from OHADA journal (Class 6 except account 661, minus training costs to avoid double-counting)
  const totalChargesComptables2026Raw = planComptable
    .filter(c => c.numero.startsWith('6') && c.numero !== '661')
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.debit - accountBalances[c.numero]?.credit || 0), 0);
  const totalChargesComptables2026 = Math.max(0, totalChargesComptables2026Raw - totalTrainingCosts2026);

  // Bénéfice Net 2026 (perfectly consistent with double entry ledger)
  const netProfit2026 = totalCA2026 - (masseSalarialeAnnuelle2026 + totalChargesComptables2026 + totalTrainingCosts2026);

  // Dynamic balance sheet data from ledger entries (ecritures)
  const dynamicInterestExpense = ecritures.reduce((sum, ecr) => {
    return sum + ecr.lignes.reduce((lSum, l) => {
      const isInterestAcc = l.compteNumero.startsWith('67') || l.compteNumero === '631';
      return isInterestAcc ? lSum + (l.debit - l.credit) : lSum;
    }, 0);
  }, 0);
  const simulatedInterestExpense = dynamicInterestExpense;

  const dynamicDebts = ecritures.reduce((sum, ecr) => {
    return sum + ecr.lignes.reduce((lSum, l) => {
      const num = l.compteNumero;
      const isDebtAcc = num.startsWith('40') || num.startsWith('42') || num.startsWith('43') || num.startsWith('44') || num.startsWith('16');
      return isDebtAcc ? lSum + (l.credit - l.debit) : lSum;
    }, 0);
  }, 0);
  const simulatedDebts = dynamicDebts;

  const dynamicEquity = ecritures.reduce((sum, ecr) => {
    return sum + ecr.lignes.reduce((lSum, l) => {
      const num = l.compteNumero;
      const isEquityAcc = num.startsWith('10');
      return isEquityAcc ? lSum + (l.credit - l.debit) : lSum;
    }, 0);
  }, 0);
  const simulatedEquity = dynamicEquity;

  const totalAssets = simulatedEquity + simulatedDebts; // Total Actifs

  // Ratios calculations
  const ratioMargin = totalCA2026 > 0 ? (netProfit2026 / totalCA2026) * 100 : 0; // Rendement ventes
  const ratioROA = simulatedEquity > 0 ? (netProfit2026 / simulatedEquity) * 100 : 0; // RCI / Rentabilité des capitaux
  const ratioAssetTurnover = totalAssets > 0 ? totalCA2026 / totalAssets : 0; // Rotation des actifs
  const ratioLeverage = simulatedEquity > 0 ? totalAssets / simulatedEquity : 1; // Levier financier
  const ratioDebt = totalAssets > 0 ? (simulatedDebts / totalAssets) * 100 : 0; // Ratio d'endettement

  // --- Clients/Students Perspective ---
  const totalStudents2026 = serverStats?.total_students ?? students.length;
  // Taux de recouvrement : trésorerie perçue / montant constaté (706 crédit).
  // totalFeesDue2026 utilisait auparavant un taux forfaitaire fabriqué
  // (110 000 F/élève) déconnecté du vrai prix des classes — alors que
  // totalCA2026 (constatation réelle, prix de classe réel) EST déjà le
  // montant dû sous ce système en comptabilité d'engagement. Les deux
  // constantes étaient incohérentes entre elles ; on les aligne.
  const totalFeesDue2026 = totalCA2026;
  const totalRecoveryRate2026 = totalFeesDue2026 > 0 ? (totalTresoreriePercue / totalFeesDue2026) * 100 : 0;

  const currentDate = new Date().toISOString().split('T')[0];
  const totalArrieresEchus2026 = students.reduce((sum, s) => {
    const matchedClass = classes.find((c: any) => c.id === s.classeId || c.nom === s.classeId);
    const classPrice = matchedClass ? Number(matchedClass.prix || 0) : 0;
    // Seule la scolarité amortit l'échéancier de tranches (même convention que
    // la fiche élève et get_students_paginated).
    const totalPaid = (s.paiements || []).filter(p => p.statut === 'paid' && p.typeFrais === 'Scolarité').reduce((acc, p) => acc + p.montant, 0);

    const studentTranches = tranches.filter(t => t.annee_scolaire_id === s.anneeScolaireId);
    const tranchesEchues = studentTranches.filter(t => t.date_limite < currentDate);
    const montantTranchesEchues = tranchesEchues.reduce((acc, t) => acc + (Number(t.montant) || 0), 0);
    const pctEchu = tranchesEchues.reduce((acc, t) => acc + Number(t.pourcentage || 0), 0) / 100;
    
    const expectedPaid = montantTranchesEchues > 0 ? montantTranchesEchues : classPrice * pctEchu;
    const resteEchu = Math.max(0, expectedPaid - totalPaid);
    return sum + resteEchu;
  }, 0);

  // --- Internal Process Perspective ---
  const avgMoyenneGenerale2026 = serverMoyenneGenerale;
  const totalAbsences2026 = totalAbsenceDays;
  const avgClassSize2026 = classes.length > 0 ? students.length / classes.length : null;

  // --- Learning & Growth Perspective ---
  const trainingPayrollRatio2026 = masseSalarialeAnnuelle2026 > 0
    ? (totalTrainingCosts2026 / masseSalarialeAnnuelle2026) * 100
    : 0;
  // Adhérence job role / note de formation : moyenne des évaluations RH
  // réelles (evaluationsRH, chargées ci-dessous), null si aucune évaluation
  // n'existe encore — remplace les constantes fixes (89,2% / 15,6) qui se
  // faisaient auparavant passer pour des mesures réelles.
  const avgTeacherJobRoleAdherence2026 = evaluationsRH.length > 0
    ? evaluationsRH.reduce((sum, ev) => sum + (Number(ev.adherence_job_role) || 0), 0) / evaluationsRH.length
    : null;
  const avgTeacherTrainingScore2026 = evaluationsRH.length > 0
    ? evaluationsRH.reduce((sum, ev) => sum + (Number(ev.note_formation_moyenne) || 0), 0) / evaluationsRH.length
    : null;

  // --- Segment Productivity calculations ---

  // Global CA / Employee
  const activeEmployeeCount = activeStaff.length;
  const globalProductivity = activeEmployeeCount > 0 ? totalCA2026 / activeEmployeeCount : 0;

  // Productivité par section : calcul dynamique réel uniquement, basé sur les
  // sections/classes/enseignants effectivement configurés en base. Retourne
  // `null` (plutôt qu'un chiffre inventé) quand aucune section réelle ne peut
  // être résolue — c'était le cas systématique pour toute vraie école tant que
  // la table `sections` n'est pas peuplée : l'ancien code affichait alors des
  // pourcentages fabriqués (répartition arbitraire 25%/15%, IDs de démo en
  // dur) comme s'ils étaient réels.
  const getSectionProductivity = (secId: 'sec-fr' | 'sec-en' | 'sec-bi'): number | null => {
    const cleanSecId = secId.toLowerCase();
    const dbSection = sections.find(s =>
      s.id === secId ||
      s.nom.toLowerCase().includes(cleanSecId === 'sec-fr' ? 'fran' : cleanSecId === 'sec-en' ? 'angl' : 'bil')
    );

    if (!dbSection) return null;

    // Find classes in this section
    const sectionClasses = classes.filter(c => c.section_id === dbSection.id || c.nom.toLowerCase().includes(dbSection.nom.toLowerCase()));
    if (sectionClasses.length === 0) return null;
    const classIds = sectionClasses.map(c => c.id);
    const classNames = sectionClasses.map(c => c.nom);

    // Sum CA for this section : préfère le CA par classe calculé en base
    // (get_finance_ca_par_classe), sinon repli sur le calcul client complet.
    const secCA = serverCaParClasse
      ? classIds.reduce((sum, id) => sum + (serverCaParClasse[id] || 0), 0)
      : students
          .filter(s => classIds.includes(s.classeId) || classNames.includes(s.classeId))
          .flatMap(s => s.paiements || [])
          .reduce((sum, p) => p.statut === 'paid' ? sum + p.montant : sum, 0);

    // Count unique teachers assigned to these classes
    const teachersSet = new Set<string>();
    sectionClasses.forEach(c => {
      if (c.enseignant_principal_id) teachersSet.add(c.enseignant_principal_id);
      if (c.enseignant_assistant_id) teachersSet.add(c.enseignant_assistant_id);
    });
    let secStaff = teachersSet.size;

    // Add a share of other admin staff
    const otherStaffCount = activeStaff.filter(p => p.categorie !== 'Enseignant').length;
    const sectionsCount = sections.length > 0 ? sections.length : 3;
    secStaff += (otherStaffCount / sectionsCount);

    return secStaff > 0 ? secCA / secStaff : null;
  };

  // Format money helper
  const formatMoney = (val: number) => {
    if (val >= 1000000) {
      const millions = val / 1000000;
      return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(millions) + ' M FCFA';
    }
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(val);
  };

  const isAdmin = userRole && (userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'administrateur');

  const filteredEcritures = journalSearchTerm.trim() === ''
    ? ecritures
    : ecritures.filter(ecr =>
        ecr.reference.toLowerCase().includes(journalSearchTerm.toLowerCase()) ||
        ecr.libelle.toLowerCase().includes(journalSearchTerm.toLowerCase()) ||
        ecr.date.toLowerCase().includes(journalSearchTerm.toLowerCase()) ||
        ecr.partenaire?.toLowerCase().includes(journalSearchTerm.toLowerCase()) ||
        ecr.lignes.some(l => {
          const compteDef = planComptable.find(c => c.numero === l.compteNumero);
          const rawSearch = journalSearchTerm.toLowerCase();
          return l.compteNumero.includes(journalSearchTerm) ||
                 compteDef?.libelle.toLowerCase().includes(rawSearch) ||
                 l.debit.toString().includes(journalSearchTerm) ||
                 l.credit.toString().includes(journalSearchTerm);
        })
      );

  // Calculées une fois : null si la section correspondante n'est pas
  // configurée en base (voir getSectionProductivity).
  const secFrProductivity = getSectionProductivity('sec-fr');
  const secEnProductivity = getSectionProductivity('sec-en');
  const secBiProductivity = getSectionProductivity('sec-bi');

  // Productivité par classe (CA collecté) : préfère la RPC get_finance_ca_par_classe,
  // sinon repli sur le calcul client complet basé sur le classeId réel.
  const getClassProductivity = (classId: string) => {
    if (serverCaParClasse) return serverCaParClasse[classId] || 0;
    const classStudents = students.filter(s => s.classeId === classId);
    return classStudents.flatMap(s => s.paiements || []).reduce((sum, p) => p.statut === 'paid' ? sum + p.montant : sum, 0);
  };

  // --- Daily cash reconciliation (7 last days) ---
  const getDailyReconciliation = () => {
    // Préfère le rapprochement calculé en base (get_finance_reconciliation_quotidienne).
    if (serverReconciliation) {
      return serverReconciliation.map(r => ({
        date: r.jour,
        caConstated: r.caConstate,
        cashReceived: r.encaisse,
        gap: r.encaisse - r.caConstate,
      }));
    }

    const days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      // Sum actual payments received on this date
      const cashReceived = students.flatMap(s => s.paiements || [])
        .filter(p => p.date && p.date.split('T')[0] === dateStr && p.statut === 'paid')
        .reduce((sum, p) => sum + p.montant, 0);

      // Sum of all payments (both paid and unpaid/pending) due on this date
      const dailyCAConstated = students.flatMap(s => s.paiements || [])
        .filter(p => p.date && p.date.split('T')[0] === dateStr)
        .reduce((sum, p) => sum + p.montant, 0);

      days.push({
        date: dateStr,
        caConstated: dailyCAConstated,
        cashReceived: cashReceived,
        gap: cashReceived - dailyCAConstated
      });
    }
    return days;
  };

  const dailyData = getDailyReconciliation();

  // --- Budget Variance ---
  const getBudgetVariance = () => {
    return budgetLines.map(item => {
      let realized = 0;
      if (item.realiseReel !== undefined && item.realiseReel !== null && !isNaN(Number(item.realiseReel))) {
        realized = Number(item.realiseReel);
      } else {
        const lowerPoste = item.poste.toLowerCase();
        if (item.categorie === 'Revenu') {
          if (lowerPoste.includes('scolarité') || lowerPoste.includes('inscription') || lowerPoste.includes('revenu')) {
            realized = totalCA2026;
          } else {
            realized = 150000; // divers
          }
        } else {
          if (lowerPoste.includes('salariale') || lowerPoste.includes('salaire')) {
            realized = masseSalarialeAnnuelle2026;
          } else if (lowerPoste.includes('formation') || lowerPoste.includes('stage')) {
            realized = totalTrainingCosts2026;
          } else if (lowerPoste.includes('fourniture') || lowerPoste.includes('entretien')) {
            realized = totalChargesComptables2026 * 0.4;
          } else if (lowerPoste.includes('loyer') || lowerPoste.includes('locat')) {
            realized = totalChargesComptables2026 * 0.3;
          } else if (lowerPoste.includes('fluid') || lowerPoste.includes('eau') || lowerPoste.includes('élec') || lowerPoste.includes('internet')) {
            realized = totalChargesComptables2026 * 0.15;
          } else {
            realized = totalChargesComptables2026 * 0.15; // equipement/divers
          }
        }
      }

      const diff = item.categorie === 'Revenu' ? realized - item.budgetPrevu : item.budgetPrevu - realized;
      const pctDiff = item.budgetPrevu > 0 ? (diff / item.budgetPrevu) * 100 : 0;

      return {
        ...item,
        realise: realized,
        diff: realized - item.budgetPrevu,
        pct: pctDiff,
        isFavorable: diff >= 0
      };
    });
  };

  const budgetVariances = getBudgetVariance();

  // --- Accounting Ledger functions ---
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const ts = Date.now();
    const ref = expReference || `OP-${ts.toString().slice(-6)}`;
    const newEcrituresList: EcritureComptable[] = [];

    if (expTypeSaisie === 'immediat' || expTypeSaisie === 'credit') {
      const amountTTC = Number(expAmount);
      if (!amountTTC || amountTTC <= 0) return;

      let ht = amountTTC;
      let tva = 0;
      if (expTva) {
        ht = Math.round(amountTTC / 1.1925);
        tva = amountTTC - ht;
      }

      const lines = [
        { compteNumero: expCompteDebit, debit: ht, credit: 0 }
      ];
      if (expTva) lines.push({ compteNumero: '445', debit: tva, credit: 0 });
      lines.push({ compteNumero: expCompteTiers, debit: 0, credit: amountTTC });

      newEcrituresList.push({
        id: `ecr-cst-${ts}`,
        date: expDate,
        libelle: `Constatation : ${expLibelle}`,
        reference: ref,
        partenaire: expPartenaire || undefined,
        lignes: lines
      });
    }

    let toPay = 0;
    if (expTypeSaisie === 'immediat') toPay = Number(expAmount);
    else if (expTypeSaisie === 'credit' || expTypeSaisie === 'reglement') toPay = Number(expAmountPaye);

    if (toPay > 0) {
      newEcrituresList.push({
        id: `ecr-reg-${ts}`,
        date: expDate,
        libelle: `Règlement : ${expLibelle}`,
        reference: `PAY-${ref}`,
        partenaire: expPartenaire || undefined,
        lignes: [
          { compteNumero: expCompteTiers, debit: toPay, credit: 0 },
          { compteNumero: expCompteCredit, debit: 0, credit: toPay }
        ]
      });
    }

    if (newEcrituresList.length === 0) return;

    // Save to Supabase (attempt)
    const supabase = createClient();
    let savedToSupabase = false;

    try {
      for (const ecr of newEcrituresList) {
        // Insert ecriture
        const { data: ecrData, error: ecrErr } = await supabase
          .from('ecritures_comptables')
          .insert([{
            date: ecr.date,
            libelle: ecr.libelle,
            reference: ecr.reference,
            partenaire: ecr.partenaire || null,
            etablissement_id: etablissementId
          }])
          .select()
          .single();

        if (ecrErr) throw ecrErr;

        if (ecrData) {
          // Insert lines
          const linesToInsert = ecr.lignes.map(l => ({
            ecriture_id: ecrData.id,
            compte_numero: l.compteNumero,
            debit: l.debit,
            credit: l.credit
          }));

          const { error: linesErr } = await supabase
            .from('lignes_ecritures')
            .insert(linesToInsert);

          if (linesErr) throw linesErr;
        }
      }
      savedToSupabase = true;
    } catch (err) {
      captureMessage("Failed to save transaction in Supabase, falling back to local storage:", { detail: err });
    }

    // Save to local storage (always do as local sync / fallback)
    const stored = localStorage.getItem('mboaschool_ecritures');
    const existing = stored ? JSON.parse(stored) : [];
    const updated = [...newEcrituresList, ...existing];
    localStorage.setItem('mboaschool_ecritures', JSON.stringify(updated));

    // Reload ecritures from Supabase to get real IDs (don't use temporary IDs)
    if (savedToSupabase) {
      try {
        const { data: ecrData } = await supabase
          .from('ecritures_comptables')
          .select('*, lignes_ecritures(*)')
          .eq('etablissement_id', etablissementId);

        if (ecrData && ecrData.length > 0) {
          const reloadedEcritures = ecrData.map((e: any) => ({
            id: e.id,
            date: e.date,
            libelle: e.libelle,
            reference: e.reference,
            partenaire: e.partenaire,
            lignes: (e.lignes_ecritures || []).map((l: any) => ({
              compteNumero: l.compte_numero,
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0)
            }))
          }));
          setEcritures(prev => {
            const systemEntries = prev.filter(e => e.id.startsWith('ecr-const-') || e.id.startsWith('ecr-pay-') || e.id.startsWith('ecr-train-'));
            return [...reloadedEcritures, ...systemEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          });
        }
      } catch (reloadErr) {
        captureMessage("Failed to reload ecritures from Supabase:", { detail: reloadErr });
      }
    } else {
      setEcritures(prev => [...newEcrituresList, ...prev]);
    }

    // Reset modal form
    setShowExpenseModal(false);
    setExpLibelle('');
    setExpReference('');
    setExpAmount('');
    setExpAmountPaye('');
    setExpPartenaire('');
    setExpTva(false);
    triggerToast(savedToSupabase ? "Opération enregistrée dans le cloud !" : "Opération enregistrée !");
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccNum || !newAccLibelle) return;
    
    // Check duplication
    if (planComptable.some(c => c.numero === newAccNum)) {
      alert("Ce numéro de compte existe déjà.");
      return;
    }

    const newAcc: CompteOHADA = {
      numero: newAccNum,
      libelle: newAccLibelle,
      classe: newAccClasse as any
    };

    let savedToSupabase = false;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('comptes_comptables')
        .insert([{
          numero: newAccNum,
          libelle: newAccLibelle,
          classe: newAccClasse,
          etablissement_id: etablissementId
        }]);

      if (!error) {
        savedToSupabase = true;
      }
    } catch (err) {
      captureMessage("Compte comptable non persisté dans le cloud (fallback local):", { detail: err });
    }

    const updated = [...planComptable, newAcc].sort((a,b) => a.numero.localeCompare(b.numero));
    setPlanComptable(updated);
    localStorage.setItem('mboaschool_plancomptable', JSON.stringify(updated));
    setShowAddAccountModal(false);
    setNewAccNum('');
    setNewAccLibelle('');
    triggerToast(savedToSupabase ? "Compte comptable créé dans le cloud !" : "Compte comptable créé !");
  };

  const handleAddBudgetLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBudgetPoste || !newBudgetPrevu) return;
    const newLine: BudgetPrevisionnel = {
      poste: newBudgetPoste,
      categorie: newBudgetCategorie,
      budgetPrevu: Number(newBudgetPrevu) || 0,
      realiseReel: newBudgetRealise !== '' ? Number(newBudgetRealise) : undefined
    };
    const updated = [...budgetLines, newLine];
    setBudgetLines(updated);
    localStorage.setItem('mboaschool_budget_lines', JSON.stringify(updated));
    setShowAddBudgetModal(false);
    setNewBudgetPoste('');
    setNewBudgetPrevu('');
    setNewBudgetRealise('');
    triggerToast("Ligne budgétaire ajoutée !");
  };

  const handleEditBudgetLine = (index: number) => {
    const line = budgetLines[index];
    if (!line) return;
    setEditingBudgetIndex(index);
    setEditBudgetPoste(line.poste);
    setEditBudgetCategorie(line.categorie);
    setEditBudgetPrevu(String(line.budgetPrevu));
    setEditBudgetRealise(line.realiseReel !== undefined && line.realiseReel !== null ? String(line.realiseReel) : '');
  };

  const handleSaveBudgetLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBudgetIndex === null || !editBudgetPoste || !editBudgetPrevu) return;
    const updated = [...budgetLines];
    updated[editingBudgetIndex] = {
      poste: editBudgetPoste,
      categorie: editBudgetCategorie,
      budgetPrevu: Number(editBudgetPrevu) || 0,
      realiseReel: editBudgetRealise !== '' ? Number(editBudgetRealise) : undefined
    };
    setBudgetLines(updated);
    localStorage.setItem('mboaschool_budget_lines', JSON.stringify(updated));
    setEditingBudgetIndex(null);
    triggerToast("Ligne budgétaire modifiée !");
  };

  const handleDeleteBudgetLine = (index: number) => {
    if (confirm('Voulez-vous vraiment supprimer cette ligne budgétaire ?')) {
      const updated = budgetLines.filter((_, idx) => idx !== index);
      setBudgetLines(updated);
      localStorage.setItem('mboaschool_budget_lines', JSON.stringify(updated));
      triggerToast("Ligne budgétaire supprimée !");
    }
  };

  // accountBalances is already calculated at the top

  const getTiersForAccount = (compteNumero: string) => {
    const partners = new Set<string>();
    ecritures.forEach(ecr => {
      if (ecr.partenaire && ecr.lignes.some(l => l.compteNumero === compteNumero)) {
        partners.add(ecr.partenaire);
      }
    });
    return Array.from(partners).join(', ');
  };

  // handleDeleteEcriture: allowing admin accounts to delete ledger items
  const handleDeleteEcriture = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cette écriture comptable ?')) return;

    const supabase = createClient();
    let deletedFromSupabase = false;
    try {
      // Soft-delete atomique de l'écriture ET de ses lignes (récupérables) :
      // elles disparaissent de la balance et du journal via la RLS.
      const { error } = await supabase.rpc('soft_delete_ecriture', { p_id: id });
      if (!error) {
        deletedFromSupabase = true;
      }
    } catch (err) {
      captureMessage("Failed to delete from Supabase, relying on local registry:", { detail: err });
    }

    // Register the deleted ID in local storage to prevent dynamic mock entries from showing
    let deletedIds: string[] = [];
    const deletedStored = localStorage.getItem('mboaschool_deleted_ecritures');
    if (deletedStored) {
      try {
        deletedIds = JSON.parse(deletedStored);
      } catch (e) {
        captureError(e);
      }
    }
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      localStorage.setItem('mboaschool_deleted_ecritures', JSON.stringify(deletedIds));
    }

    // Update memory state
    setEcritures(prev => prev.filter(e => e.id !== id));

    // Update cached manual ecritures in localStorage
    const stored = localStorage.getItem('mboaschool_ecritures');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const filtered = parsed.filter((e: any) => e.id !== id);
        localStorage.setItem('mboaschool_ecritures', JSON.stringify(filtered));
      } catch (e) {
        captureError(e, { context: "Error updating cached ecritures:" });
      }
    }

    triggerToast(deletedFromSupabase ? "Écriture supprimée dans le cloud !" : "Écriture supprimée !");
  };

  // Bilan OHADA Calculations
  const assetImmobilise = planComptable
    .filter(c => c.numero.startsWith('2'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.debit - accountBalances[c.numero]?.credit || 0), 0);
    
  const assetCreances = planComptable
    .filter(c => c.numero.startsWith('41'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.debit - accountBalances[c.numero]?.credit || 0), 0);
    
  const assetTresor = planComptable
    .filter(c => c.numero.startsWith('5'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.debit - accountBalances[c.numero]?.credit || 0), 0);

  const totalActif = assetImmobilise + assetCreances + assetTresor;

  const passifEquity = planComptable
    .filter(c => c.numero.startsWith('1') && !c.numero.startsWith('16'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.credit - accountBalances[c.numero]?.debit || 0), 0);

  const passifDebtsFin = planComptable
    .filter(c => c.numero.startsWith('16'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.credit - accountBalances[c.numero]?.debit || 0), 0);

  const passifDebtsCirc = planComptable
    .filter(c => c.numero.startsWith('4') && !c.numero.startsWith('41'))
    .reduce((sum, c) => sum + (accountBalances[c.numero]?.credit - accountBalances[c.numero]?.debit || 0), 0);

  const totalPassif = passifEquity + netProfit2026 + passifDebtsFin + passifDebtsCirc;

  // DSF / Fiscal calculations
  const totalRevenuesDSF = totalCA2026;
  const totalChargesDSF = masseSalarialeAnnuelle2026 + totalChargesComptables2026 + totalTrainingCosts2026;
  const resultatComptableDSF = netProfit2026;
  
  // Tax adjustments
  const reintegrationsDSF = 0; // standard mock
  const deductionsDSF = 0;
  const resultatFiscalDSF = Math.max(0, resultatComptableDSF + reintegrationsDSF - deductionsDSF);
  
  // IS at 30.8% or Minimum Tax of 2.2% of CA
  const isSurResultat = resultatFiscalDSF * 0.308;
  const impotMinimum = totalRevenuesDSF * 0.022;
  const impotDufinal = Math.max(isSurResultat, impotMinimum);
  
  const netResultatApresImpot = resultatComptableDSF - impotDufinal;

  // TVA details
  const tvaCollectee = ecritures.reduce((sum, e) => {
    return sum + e.lignes.reduce((lSum, l) => l.compteNumero === '443' ? lSum + (l.credit - l.debit) : lSum, 0);
  }, 0);
  const tvaDeductible = ecritures.reduce((sum, e) => {
    return sum + e.lignes.reduce((lSum, l) => l.compteNumero === '445' ? lSum + (l.debit - l.credit) : lSum, 0);
  }, 0);
  const tvaNetReverser = Math.max(0, tvaCollectee - tvaDeductible);

  const exportJournalToExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const data: any[][] = [
        ["JOURNAL COMPTABLE OHADA"],
        ["Établissement", etablissementId || "Non défini"],
        ["Date d'exportation", new Date().toLocaleDateString('fr-FR')],
        ["Nombre d'écritures", ecritures.length],
        [],
        ["Date", "Référence", "Compte", "Tiers", "Libellé", "Débit", "Crédit"]
      ];

      let totalDebit = 0;
      let totalCredit = 0;

      ecritures.forEach(ecr => {
        ecr.lignes.forEach((ligne, idx) => {
          const compteDef = planComptable.find(c => c.numero === ligne.compteNumero);
          data.push([
            idx === 0 ? new Date(ecr.date).toLocaleDateString('fr-FR') : '',
            idx === 0 ? sanitizeExcelValue(ecr.reference) : '',
            ligne.compteNumero,
            idx === 0 && ligne.compteNumero.startsWith('4') && ecr.partenaire ? sanitizeExcelValue(ecr.partenaire) : '',
            idx === 0 ? sanitizeExcelValue(ecr.libelle) : '',
            ligne.debit,
            ligne.credit
          ]);
          totalDebit += ligne.debit;
          totalCredit += ligne.credit;
        });
      });

      data.push([]);
      data.push(["TOTAUX", "", "", "", "", totalDebit, totalCredit]);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [
        { wch: 14 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
        { wch: 35 },
        { wch: 15 },
        { wch: 15 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Journal");
      XLSX.writeFile(wb, `journal_comptable_${new Date().toISOString().slice(0, 10)}.xlsx`);
      triggerToast("Journal comptable exporté avec succès !");
    } catch (error) {
      captureError(error, { context: "Failed to export journal:" });
      alert("Erreur lors de l'exportation du journal.");
    }
  };

  const exportBalanceToExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const data: any[][] = [
        ["BALANCE COMPTABLE OHADA"],
        ["Établissement", etablissementId || "Non défini"],
        ["Date d'exportation", new Date().toLocaleDateString('fr-FR')],
        [],
        ["Compte", "Intitulé", "Mouvement Débit", "Mouvement Crédit", "Solde Débiteur", "Solde Créditeur"]
      ];

      let totalMovDebit = 0;
      let totalMovCredit = 0;
      let totalSoldeDebiteur = 0;
      let totalSoldeCredit = 0;

      planComptable
        .filter(c => accountBalances[c.numero]?.debit > 0 || accountBalances[c.numero]?.credit > 0)
        .forEach(compte => {
          const b = accountBalances[compte.numero];
          const soldeDebiteur = b.solde > 0 ? b.solde : 0;
          const soldeCredit = b.solde < 0 ? Math.abs(b.solde) : 0;

          data.push([
            compte.numero,
            compte.libelle,
            b.debit,
            b.credit,
            soldeDebiteur,
            soldeCredit
          ]);

          totalMovDebit += b.debit;
          totalMovCredit += b.credit;
          totalSoldeDebiteur += soldeDebiteur;
          totalSoldeCredit += soldeCredit;
        });

      data.push([]);
      data.push([
        "TOTAUX",
        "",
        totalMovDebit,
        totalMovCredit,
        totalSoldeDebiteur,
        totalSoldeCredit
      ]);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [
        { wch: 12 },
        { wch: 35 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Balance");
      XLSX.writeFile(wb, `balance_comptable_${new Date().toISOString().slice(0, 10)}.xlsx`);
      triggerToast("Balance comptable exportée avec succès !");
    } catch (error) {
      captureError(error, { context: "Failed to export balance:" });
      alert("Erreur lors de l'exportation de la balance.");
    }
  };

  // exportDSFToExcel: generate and download the statistical & fiscal liasse
  const exportDSFToExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      
      // Sheet 1: Résultat Fiscal
      const dataFiscal = [
        ["DÉCLARATION STATISTIQUE ET FISCALE (DSF) PROVISOIRE"],
        ["Établissement ID", etablissementId || "Non défini"],
        ["Date d'exportation", new Date().toLocaleDateString('fr-FR')],
        [],
        ["1. DÉTERMINATION DU RÉSULTAT FISCAL", "Montant (XAF)"],
        ["Résultat Comptable Net de l'exercice", resultatComptableDSF],
        ["+ Réintégrations Fiscales (Charges non déductibles)", reintegrationsDSF],
        ["- Déductions Fiscales (Produits exonérés)", deductionsDSF],
        ["Résultat Fiscal Imposable (Base IS)", resultatFiscalDSF],
        [],
        ["2. CALCUL DE L'IMPÔT DÛ", "Montant (XAF)"],
        ["Taux standard IS (28% + 10% CAC = 30.8%)", isSurResultat],
        ["Impôt Minimum Légal (2.2% du CA total)", impotMinimum],
        ["Impôt Définitif Dû (Le plus élevé)", impotDufinal],
        ["Résultat Net après impôt", netResultatApresImpot]
      ];
      
      const wsFiscal = XLSX.utils.aoa_to_sheet(dataFiscal);
      XLSX.utils.book_append_sheet(wb, wsFiscal, "Résultat Fiscal");

      // Sheet 2: Autres Taxes et Déclarations
      const dataTaxes = [
        ["AUTRES TAXES ET DÉCLARATIONS PÉRIODIQUES"],
        ["Date d'exportation", new Date().toLocaleDateString('fr-FR')],
        [],
        ["Taxe / Cotisation", "Montant (XAF)", "Détails / Base de calcul"],
        ["TVA Net à Reverser", tvaNetReverser, `TVA Collectée: ${tvaCollectee} • Déductible: ${tvaDeductible}`],
        ["IRPP / IRSA (Retenue Salaires)", masseSalarialeAnnuelle2026 * 0.1, `Estimation 10% de la masse salariale brute (${masseSalarialeAnnuelle2026})`],
        ["Cotisations Sociales CNPS", masseSalarialeAnnuelle2026 * 0.22, `Base de calcul CNPS 22% (Part employeur + salarié)`]
      ];

      const wsTaxes = XLSX.utils.aoa_to_sheet(dataTaxes);
      XLSX.utils.book_append_sheet(wb, wsTaxes, "Taxes & Déclarations");

      // Save the workbook
      XLSX.writeFile(wb, `liasse_dsf_${etablissementId || 'etab'}.xlsx`);
      triggerToast("Liasse DSF exportée avec succès !");
    } catch (error) {
      captureError(error, { context: "Failed to export Excel:" });
      alert("Erreur lors de l'exportation de la liasse DSF.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3.5 rounded-control shadow-login z-50 flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-green flex items-center justify-center text-xs font-bold text-cream">✓</div>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-6 rounded-card border border-border shadow-sm">
        <div>
          <h1 className="text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-tight">Direction Financière</h1>
          <p className="text-sm text-ink-soft mt-1">Balanced Scorecard (BSC), rentabilité par segment, ratios financiers, budget & trésorerie</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/finance/rapport-tranches"
            className="px-4 py-2 bg-chip hover:bg-chip-hover text-ink text-sm font-bold rounded-control transition-colors border border-border flex items-center gap-1.5"
          >
            📊 Rapport Tranches (Relances)
          </Link>
          <button
            onClick={() => setShowAddAccountModal(true)}
            className="px-4 py-2 bg-chip hover:bg-chip text-ink-soft rounded-control text-sm font-bold transition-colors"
          >
            + Créer Compte
          </button>
          <button
            onClick={() => setShowExpenseModal(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-bold shadow-md transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><line x1="12" y1="6" x2="12" y2="18"/></svg>
            Saisir opération
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-surface p-2 rounded-control border border-border shadow-sm overflow-x-auto">
        {[
          { id: 'bsc', label: 'Balanced Scorecard (BSC)' },
          { id: 'productivity', label: 'Productivité par Segment' },
          { id: 'ratios', label: 'Compte de Résultat & Ratios' },
          { id: 'cash', label: 'CA vs Trésorerie' },
          { id: 'budget', label: 'Écart Budgétaire' },
          { id: 'accounting', label: 'Journal & Balance' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-control text-sm font-bold transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-chip text-ink shadow-sm' : 'text-ink-soft hover:bg-bg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* -------------------- TAB: BALANCED SCORECARD -------------------- */}
      {activeTab === 'bsc' && (
        <div className="space-y-6">
          <div className="bg-bg p-4 rounded-control border border-border shadow-sm">
            <p className="text-xs text-ink-soft font-medium">
              Indicateurs de l&apos;année en cours, calculés à partir des données réelles de l&apos;établissement.
              La comparaison historique multi-années n&apos;est pas encore disponible.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Perspective: Finances */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
              <h3 className="font-extrabold text-ink border-b border-border pb-3 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-accent block"></span>
                Perspective Financière
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-faint font-bold border-b border-border">
                    <th className="pb-2">Indicateur (KPI)</th>
                    <th className="pb-2 text-right">Valeur actuelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  <tr>
                    <td className="py-3 font-semibold">Chiffre d'Affaires</td>
                    <td className="text-right font-bold text-ink">{formatMoney(totalCA2026)}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Bénéfice Net</td>
                    <td className="text-right font-bold text-ink">{formatMoney(netProfit2026)}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Masse Salariale / mois</td>
                    <td className="text-right font-bold text-ink">{formatMoney(masseSalarialeMensuelle2026)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Perspective: Clients */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
              <h3 className="font-extrabold text-ink border-b border-border pb-3 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green block"></span>
                Perspective Clientèle (Parents & Élèves)
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-faint font-bold border-b border-border">
                    <th className="pb-2">Indicateur (KPI)</th>
                    <th className="pb-2 text-right">Valeur actuelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  <tr>
                    <td className="py-3 font-semibold">Effectif Élèves</td>
                    <td className="text-right font-bold text-green">{totalStudents2026}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Recouvrement Scolarités</td>
                    <td className="text-right font-bold text-green">{totalRecoveryRate2026.toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Satisfaction Parents</td>
                    <td className="text-right font-bold text-ink-soft">N/A</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Arriérés Échus (Retards)</td>
                    <td className="text-right font-bold text-accent">{formatMoney(totalArrieresEchus2026)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Perspective: Processus */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
              <h3 className="font-extrabold text-ink border-b border-border pb-3 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-accent block"></span>
                Perspective Processus Internes
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-faint font-bold border-b border-border">
                    <th className="pb-2">Indicateur (KPI)</th>
                    <th className="pb-2 text-right">Valeur actuelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  <tr>
                    <td className="py-3 font-semibold">Moyenne Générale</td>
                    <td className="text-right font-bold text-ink-soft">{avgMoyenneGenerale2026 !== null ? `${avgMoyenneGenerale2026.toFixed(2)}/20` : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Jours Absences Staff</td>
                    <td className="text-right font-bold text-ink-soft">{totalAbsences2026 !== null ? `${totalAbsences2026} j` : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Classe Moyenne (élèves)</td>
                    <td className="text-right font-bold text-ink-soft">{avgClassSize2026 !== null ? avgClassSize2026.toFixed(1) : 'N/A'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Perspective: Apprendre */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
              <h3 className="font-extrabold text-ink border-b border-border pb-3 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-ink block"></span>
                Perspective Apprentissage & Croissance
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-faint font-bold border-b border-border">
                    <th className="pb-2">Indicateur (KPI)</th>
                    <th className="pb-2 text-right">Valeur actuelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  <tr>
                    <td className="py-3 font-semibold">Investissement Formations</td>
                    <td className="text-right font-bold text-ink-soft">{trainingPayrollRatio2026.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Adhérence Job Role Staff</td>
                    <td className="text-right font-bold text-ink-soft">{avgTeacherJobRoleAdherence2026 !== null ? `${avgTeacherJobRoleAdherence2026.toFixed(1)}%` : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="py-3 font-semibold">Note d'évaluation stages</td>
                    <td className="text-right font-bold text-ink-soft">{avgTeacherTrainingScore2026 !== null ? `${avgTeacherTrainingScore2026.toFixed(1)}/20` : 'N/A'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* -------------------- TAB: PRODUCTIVITE PAR SEGMENT -------------------- */}
      {activeTab === 'productivity' && (
        <div className="space-y-6">
          {/* Global & Section Productivity Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-surface p-6 rounded-card shadow-sm border border-border">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">Rendement Global CA / Employé</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{formatMoney(globalProductivity)}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">Calculé sur {activeEmployeeCount} actifs</span>
            </div>
            
            <div className="bg-surface p-6 rounded-card shadow-sm border border-border border-l-4 border-l-emerald-500">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">CA / Employé Section Francophone (F)</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{secFrProductivity !== null ? formatMoney(secFrProductivity) : 'N/A'}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">{secFrProductivity !== null ? 'Basé sur les sections configurées' : 'Section non configurée'}</span>
            </div>

            <div className="bg-surface p-6 rounded-card shadow-sm border border-border border-l-4 border-l-amber-500">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">CA / Employé Section Anglophone (A)</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{secEnProductivity !== null ? formatMoney(secEnProductivity) : 'N/A'}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">{secEnProductivity !== null ? 'Basé sur les sections configurées' : 'Section non configurée'}</span>
            </div>

            <div className="bg-surface p-6 rounded-card shadow-sm border border-border border-l-4 border-l-violet-500">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">CA / Employé Section Bilingue & Communs (B)</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{secBiProductivity !== null ? formatMoney(secBiProductivity) : 'N/A'}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">{secBiProductivity !== null ? 'Basé sur les sections configurées' : 'Section non configurée'}</span>
            </div>
          </div>

          {/* Class productivity table */}
          <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
            <h3 className="font-bold text-ink mb-4">Productivité du Chiffre d'Affaires par Classe</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-xs font-bold text-ink-faint uppercase bg-bg/20">
                    <th className="px-6 py-4">Classe</th>
                    <th className="px-6 py-4">Enseignant Principal</th>
                    <th className="px-6 py-4 text-right">CA Collecté de la classe</th>
                    <th className="px-6 py-4 text-right">Ratio CA / Classe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  {classes.length > 0 ? (
                    classes.map((cls) => {
                      const classCA = getClassProductivity(cls.id);
                      const matchedTeacher = teachers.find(t => t.id === cls.enseignant_principal_id);
                      const teacherName = matchedTeacher 
                        ? `${matchedTeacher.prenom} ${matchedTeacher.nom}` 
                        : 'Non spécifié';
                      const percentage = totalCA2026 > 0 ? ((classCA / totalCA2026) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={cls.id} className="hover:bg-bg/50">
                          <td className="px-6 py-4 font-semibold">{cls.nom}</td>
                          <td className="px-6 py-4 text-ink-soft">{teacherName}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold">{formatMoney(classCA)}</td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-ink">{percentage}% du CA total</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-ink-faint text-sm">
                        Aucune classe configurée — configurez vos classes pour voir la productivité par classe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- TAB: COMPTE DE RESULTAT & RATIOS -------------------- */}
      {activeTab === 'ratios' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Income statement simplified */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm lg:col-span-2 space-y-4">
              <h3 className="font-bold text-ink border-b border-border pb-3">Compte de Résultat Simplifié (Annuel)</h3>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between font-semibold border-b border-border pb-2">
                  <span>Revenus (Chiffre d'Affaires constaté)</span>
                  <span className="font-mono font-bold text-green">{formatMoney(totalCA2026)}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-soft">
                  <span>Masse Salariale annuelle brute</span>
                  <span className="font-mono font-semibold">- {formatMoney(masseSalarialeAnnuelle2026)}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-soft">
                  <span>Charges de fonctionnement opérationnelles</span>
                  <span className="font-mono font-semibold">- {formatMoney(totalChargesComptables2026)}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-soft">
                  <span>Frais de formation du personnel</span>
                  <span className="font-mono font-semibold">- {formatMoney(totalTrainingCosts2026)}</span>
                </div>
                <div className="flex justify-between font-bold border-b-2 border-border py-3 text-base">
                  <span>Bénéfice Net</span>
                  <span className={`font-mono ${netProfit2026 >= 0 ? 'text-green' : 'text-accent'}`}>
                    {formatMoney(netProfit2026)}
                  </span>
                </div>

                <div className="pt-4 border-t border-border space-y-2">
                  <div className="flex justify-between text-xs text-ink-soft">
                    <span>Intérêts financiers (emprunts bancaires)</span>
                    <span className="font-mono font-bold">{formatMoney(simulatedInterestExpense)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-ink-soft">
                    <span>Dettes globales d'exploitation & bancaires</span>
                    <span className="font-mono font-bold">{formatMoney(simulatedDebts)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-ink-soft">
                    <span>Fonds Propres (Capital social)</span>
                    <span className="font-mono font-bold">{formatMoney(simulatedEquity)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Financial Ratios */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-6">
              <h3 className="font-bold text-ink border-b border-border pb-3">Ratios Financiers Clés</h3>
              
              <div className="space-y-4">
                {/* Margin */}
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-ink-soft">Rendement Ventes (Marge nette)</span>
                    <span className="text-ink font-extrabold">{ratioMargin.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-chip h-2 rounded-full overflow-hidden">
                    <div className="bg-accent h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ratioMargin))}%` }}></div>
                  </div>
                  <span className="text-[10px] text-ink-faint block mt-1">Capacité à transformer le CA en bénéfice</span>
                </div>

                {/* ROA / RCI */}
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-ink-soft">RCI (Rentabilité Capitaux Investis)</span>
                    <span className="text-green font-extrabold">{ratioROA.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-chip h-2 rounded-full overflow-hidden">
                    <div className="bg-green h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ratioROA))}%` }}></div>
                  </div>
                  <span className="text-[10px] text-ink-faint block mt-1">Performance des fonds propres engagés</span>
                </div>

                {/* Asset turnover */}
                <div className="flex justify-between items-center text-xs font-bold p-3 bg-bg rounded-control">
                  <span className="text-ink-soft">Rotation des Actifs</span>
                  <span className="text-ink font-extrabold text-sm">{ratioAssetTurnover.toFixed(2)} x</span>
                </div>

                {/* Leverage */}
                <div className="flex justify-between items-center text-xs font-bold p-3 bg-bg rounded-control">
                  <span className="text-ink-soft">Levier Financier</span>
                  <span className="text-ink font-extrabold text-sm">{ratioLeverage.toFixed(2)} x</span>
                </div>

                {/* Debt ratio */}
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-ink-soft">Ratio d'Endettement</span>
                    <span className="text-accent font-extrabold">{ratioDebt.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-chip h-2 rounded-full overflow-hidden">
                    <div className="bg-accent h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ratioDebt))}%` }}></div>
                  </div>
                  <span className="text-[10px] text-ink-faint block mt-1">Part des dettes dans le total bilan (seuil max : 50%)</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* -------------------- TAB: RAPPROCHEMENT & TRESORERIE -------------------- */}
      {activeTab === 'cash' && (
        <div className="space-y-6">
          {/* Summary reconciliation metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-surface p-6 rounded-card shadow-sm border border-border">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">Facturation Globale (CA Constaté)</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{formatMoney(totalCA2026)}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">Enregistré en engagement (Total frais attendus)</span>
            </div>

            <div className="bg-surface p-6 rounded-card shadow-sm border border-border">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">Trésorerie Perçue (Encaissements)</span>
              <h2 className="text-[40px] font-extrabold text-green tracking-[-2px] leading-none">{formatMoney(totalTresoreriePercue)}</h2>
              <span className="text-xs text-ink-faint font-semibold block mt-1.5">
                {totalCA2026 > 0 ? ((totalTresoreriePercue / totalCA2026) * 100).toFixed(1) : 0}% encaissé réellement
              </span>
            </div>

            <div className="bg-surface p-6 rounded-card shadow-sm border border-border">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">Écart de Rapprochement</span>
              <h2 className="text-[40px] font-extrabold text-ink tracking-[-2px] leading-none">{formatMoney(totalCA2026 - totalTresoreriePercue)}</h2>
              {totalCA2026 === totalTresoreriePercue ? (
                <span className="text-xs text-green font-bold block mt-1.5">✓ Livres parfaitement équilibrés</span>
              ) : (
                <span className="text-xs text-ink-soft font-bold block mt-1.5">
                  ⚠️ Reste à recouvrer ({totalCA2026 > 0 ? ((1 - totalTresoreriePercue / totalCA2026) * 100).toFixed(1) : 0}% en attente)
                </span>
              )}
            </div>
          </div>

          {/* Daily logs (7 last days) */}
          <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
            <div className="border-b border-border pb-3 mb-4 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-ink">Rapprochement CA vs Trésorerie Journalier</h3>
                <p className="text-xs text-ink-soft">Comparaison quotidienne entre amortissement scolarité (CA) et encaissements réels</p>
              </div>
              <span className="text-xs font-bold bg-chip text-ink px-3 py-1 rounded-full">Encaissements en direct</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-xs font-bold text-ink-faint uppercase bg-bg/20">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">CA Constaté (Théorique)</th>
                    <th className="px-4 py-3 text-right">Trésorerie Encaissements (Réel)</th>
                    <th className="px-4 py-3 text-right">Écart quotidien</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row font-medium">
                  {dailyData.map((d, idx) => (
                    <tr key={idx} className="hover:bg-bg/30">
                      <td className="px-4 py-3 font-mono text-xs">{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatMoney(d.caConstated)}</td>
                      <td className="px-4 py-3 text-right font-mono text-green">+{formatMoney(d.cashReceived)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${d.gap >= 0 ? 'text-green' : 'text-accent'}`}>
                        {d.gap > 0 ? '+' : ''}{formatMoney(d.gap)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.gap >= 0 ? 'bg-green-bg text-green' : 'bg-red-bg text-accent'}`}>
                          {d.gap >= 0 ? 'Surplus' : 'Manque'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- TAB: BUDGET VARIANCE -------------------- */}
      {activeTab === 'budget' && (
        <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-6">
          <div className="border-b border-border pb-3 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h3 className="font-bold text-ink">Analyse des Écarts Budgétaires</h3>
              <p className="text-xs text-ink-soft">Comparaison entre prévisions budgétaires et dépenses/revenus réels</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddBudgetModal(true)}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-md transition-colors"
              >
                + Ajouter une ligne
              </button>
              <button
                onClick={() => setShowBudgetReportModal(true)}
                className="px-4 py-2 bg-green hover:bg-green text-cream rounded-control text-xs font-bold shadow-md transition-colors"
              >
                📊 Rapport d'écart
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-xs font-bold text-ink-faint uppercase bg-bg/20">
                  <th className="px-4 py-3">Poste Budgétaire</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3 text-right">Budget Prévu</th>
                  <th className="px-4 py-3 text-right">Réalisé Réel</th>
                  <th className="px-4 py-3 text-right">Écart (FCFA)</th>
                  <th className="px-4 py-3 text-center">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-row font-medium">
                {budgetVariances.map((item, idx) => (
                  <tr key={idx} className="hover:bg-bg/30">
                    <td className="px-4 py-3 font-semibold">
                      {editingBudgetIndex === idx ? (
                        <input
                          type="text"
                          value={editBudgetPoste}
                          onChange={(e) => setEditBudgetPoste(e.target.value)}
                          className="px-2 py-1 border border-outline rounded text-sm w-full focus:outline-none"
                          required
                        />
                      ) : (
                        item.poste
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingBudgetIndex === idx ? (
                        <select
                          value={editBudgetCategorie}
                          onChange={(e) => setEditBudgetCategorie(e.target.value as any)}
                          className="px-2 py-1 border border-outline rounded text-sm bg-surface focus:outline-none"
                        >
                          <option value="Revenu">Revenu</option>
                          <option value="Charge">Charge</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.categorie === 'Revenu' ? 'bg-green-bg text-green' : 'bg-red-bg text-accent'}`}>
                          {item.categorie}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingBudgetIndex === idx ? (
                        <input
                          type="number"
                          value={editBudgetPrevu}
                          onChange={(e) => setEditBudgetPrevu(e.target.value)}
                          className="px-2 py-1 border border-outline rounded text-sm w-28 text-right font-mono focus:outline-none"
                          required
                          min="0"
                        />
                      ) : (
                        formatMoney(item.budgetPrevu)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingBudgetIndex === idx ? (
                        <input
                          type="number"
                          placeholder="Auto si vide"
                          value={editBudgetRealise}
                          onChange={(e) => setEditBudgetRealise(e.target.value)}
                          className="px-2 py-1 border border-outline rounded text-sm w-28 text-right font-mono focus:outline-none"
                          min="0"
                        />
                      ) : (
                        <div>
                          <span>{formatMoney(item.realise)}</span>
                          {item.realiseReel !== undefined && item.realiseReel !== null && (
                            <span className="text-[9px] text-accent font-semibold block">Saisi manuel</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${item.isFavorable ? 'text-green' : 'text-accent'}`}>
                      {item.diff > 0 ? '+' : ''}{formatMoney(item.diff)} ({item.pct.toFixed(1)}%)
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.isFavorable ? 'bg-green-bg text-green' : 'bg-red-bg text-accent'}`}>
                        {item.isFavorable ? 'Favorable' : 'Défavorable'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editingBudgetIndex === idx ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={handleSaveBudgetLine}
                            className="text-green hover:text-green font-bold text-xs"
                          >
                            Sauver
                          </button>
                          <button
                            onClick={() => setEditingBudgetIndex(null)}
                            className="text-ink-faint hover:text-ink-soft text-xs"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleEditBudgetLine(idx)}
                            className="text-ink hover:text-ink text-xs font-semibold"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => handleDeleteBudgetLine(idx)}
                            className="text-accent hover:text-accent text-xs font-semibold"
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -------------------- TAB: JOURNAL & BALANCE (OLD ACCOUNTING VIEW) -------------------- */}
      {activeTab === 'accounting' && (
        <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border bg-bg flex justify-between items-center">
            <div className="flex gap-2">
              <button
                onClick={() => setAccountingSubTab('journal')}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition-all ${
                  accountingSubTab === 'journal' ? 'bg-surface shadow text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                Journal Comptable
              </button>
              <button
                onClick={() => setAccountingSubTab('balance')}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition-all ${
                  accountingSubTab === 'balance' ? 'bg-surface shadow text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                Balance des Comptes
              </button>
              <button
                onClick={() => setAccountingSubTab('bilan')}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition-all ${
                  accountingSubTab === 'bilan' ? 'bg-surface shadow text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                Bilan Actif/Passif
              </button>
              <button
                onClick={() => setAccountingSubTab('dsf')}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition-all ${
                  accountingSubTab === 'dsf' ? 'bg-surface shadow text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                Déclaration DSF
              </button>
            </div>
            <span className="text-xs font-bold bg-chip text-ink px-2.5 py-1 rounded-full">
              {accountingSubTab === 'journal' && `${ecritures.length} écritures OHADA`}
              {accountingSubTab === 'balance' && `${planComptable.filter(c => accountBalances[c.numero]?.debit > 0 || accountBalances[c.numero]?.credit > 0).length} comptes mouvementés`}
              {accountingSubTab === 'bilan' && "Bilan Équilibré"}
              {accountingSubTab === 'dsf' && "Calcul IS & DSF"}
            </span>
          </div>

          {/* Subtab content: Journal */}
          {accountingSubTab === 'journal' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-ink-soft mb-2">Rechercher une écriture</label>
                  <input
                    type="text"
                    placeholder="Référence, libellé, compte, tiers, date, montant..."
                    value={journalSearchTerm}
                    onChange={(e) => setJournalSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <button
                  onClick={exportJournalToExcel}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-bold shadow-md transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Exporter
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-xs font-bold uppercase bg-bg/20">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Référence</th>
                    <th className="px-4 py-3">Compte</th>
                    <th className="px-4 py-3">Tiers</th>
                    <th className="px-4 py-3">Libellé</th>
                    <th className="px-4 py-3 text-right">Débit</th>
                    <th className="px-4 py-3 text-right">Crédit</th>
                    {isAdmin && <th className="px-4 py-3 text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row">
                  {filteredEcritures.length > 0 ? (
                    filteredEcritures.map(ecr => (
                      <React.Fragment key={ecr.id}>
                        {ecr.lignes.map((ligne, idx) => {
                          const compteDef = planComptable.find(c => c.numero === ligne.compteNumero);
                          return (
                            <tr key={`${ecr.id}-${idx}`} className="hover:bg-bg/50">
                              {idx === 0 && (
                                <>
                                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap align-top font-semibold" rowSpan={ecr.lignes.length}>{new Date(ecr.date).toLocaleDateString('fr-FR')}</td>
                                  <td className="px-4 py-3 font-mono text-xs font-semibold align-top" rowSpan={ecr.lignes.length}>{ecr.reference}</td>
                                </>
                              )}
                              <td className="px-4 py-3 font-bold text-ink">{ligne.compteNumero}</td>
                              <td className="px-4 py-3 text-ink-soft font-semibold">
                                {ligne.compteNumero.startsWith('4') && ecr.partenaire ? ecr.partenaire : ''}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-bold flex items-center gap-2 flex-wrap">
                                  <span>{ecr.libelle}</span>
                                </div>
                                <div className="text-xs text-ink-faint">{compteDef?.libelle || 'Compte inconnu'}</div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold">{ligne.debit > 0 ? formatMoney(ligne.debit) : ''}</td>
                              <td className="px-4 py-3 text-right font-mono font-bold">{ligne.credit > 0 ? formatMoney(ligne.credit) : ''}</td>
                              {idx === 0 && isAdmin && (
                                <td className="px-4 py-3 text-center align-middle" rowSpan={ecr.lignes.length}>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteEcriture(ecr.id)}
                                    className="px-2 py-1 bg-red-bg hover:bg-red-bg text-accent hover:text-accent rounded font-bold text-xs transition-all border border-transparent"
                                  >
                                    Supprimer
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={isAdmin ? 8 : 7} className="px-4 py-6 text-center text-ink-soft">
                        Aucune écriture ne correspond à votre recherche
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          )}

          {/* Subtab content: Balance */}
          {accountingSubTab === 'balance' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={exportBalanceToExcel}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-bold shadow-md transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Exporter
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-xs font-bold uppercase bg-bg/20">
                    <th className="px-4 py-3 w-24">Compte</th>
                    <th className="px-4 py-3">Tiers</th>
                    <th className="px-4 py-3">Intitulé</th>
                    <th className="px-4 py-3 text-right">Mouvement Débit</th>
                    <th className="px-4 py-3 text-right">Mouvement Crédit</th>
                    <th className="px-4 py-3 text-right">Solde Débiteur</th>
                    <th className="px-4 py-3 text-right">Solde Créditeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row">
                  {planComptable.filter(c => accountBalances[c.numero]?.debit > 0 || accountBalances[c.numero]?.credit > 0).map(compte => {
                    const b = accountBalances[compte.numero];
                    return (
                      <tr key={compte.numero} className="hover:bg-bg">
                        <td className="px-4 py-3 font-bold text-ink">{compte.numero}</td>
                        <td className="px-4 py-3 text-ink-soft font-semibold">{getTiersForAccount(compte.numero)}</td>
                        <td className="px-4 py-3 font-bold">{compte.libelle}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold">{formatMoney(b.debit)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold">{formatMoney(b.credit)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold">{b.solde > 0 ? formatMoney(b.solde) : ''}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold">{b.solde < 0 ? formatMoney(Math.abs(b.solde)) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
          )}

          {/* Subtab content: Bilan */}
          {accountingSubTab === 'bilan' && (
            <div className="p-6 space-y-6">
              <div className="bg-bg/50 p-4 rounded-control border border-border flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div>
                  <h4 className="font-bold text-ink text-sm">Bilan Comptable Système Minimal de Trésorerie (SMT) - OHADA</h4>
                  <p className="text-xs text-ink-soft font-medium">Bilan équilibré généré en temps réel basé sur les écritures comptables saisies et constatées.</p>
                </div>
                {Math.abs(totalActif - totalPassif) > 0.01 && (
                  <span className="bg-red-bg text-accent text-xs font-bold px-3 py-1 rounded-full border border-transparent">
                    ⚠️ Équilibre rompu (Écart: {formatMoney(Math.abs(totalActif - totalPassif))})
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Actif */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
                  <h4 className="text-base font-bold text-ink border-b border-border pb-2 flex justify-between">
                    <span>ACTIF (Emplois)</span>
                    <span className="text-xs text-ink-faint font-medium">Valeurs Brutes</span>
                  </h4>
                  <div className="space-y-3.5 text-sm">
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="font-semibold text-ink-soft">Actif Immobilisé (Classe 2)</span>
                      <span className="font-mono font-bold">{formatMoney(assetImmobilise)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Immobilisations corporelles & incorporelles</span>
                      <span>{formatMoney(assetImmobilise)}</span>
                    </div>
                    
                    <div className="flex justify-between border-b border-border pb-2 pt-2">
                      <span className="font-semibold text-ink-soft">Actif Circulant (Créances - Classe 4)</span>
                      <span className="font-mono font-bold">{formatMoney(assetCreances)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Créances Clients & Scolarités (Compte 411...)</span>
                      <span>{formatMoney(assetCreances)}</span>
                    </div>

                    <div className="flex justify-between border-b border-border pb-2 pt-2">
                      <span className="font-semibold text-ink-soft">Trésorerie Actif (Disponibilités - Classe 5)</span>
                      <span className="font-mono font-bold">{formatMoney(assetTresor)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Soldes Banques & Caisses (Comptes 52, 57...)</span>
                      <span>{formatMoney(assetTresor)}</span>
                    </div>

                    <div className="flex justify-between bg-accent text-cream font-black p-4 rounded-control text-base mt-6 shadow-md">
                      <span>TOTAL ACTIF</span>
                      <span className="font-mono">{formatMoney(totalActif)}</span>
                    </div>
                  </div>
                </div>

                {/* Passif */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
                  <h4 className="text-base font-bold text-ink border-b border-border pb-2 flex justify-between">
                    <span>PASSIF (Ressources)</span>
                    <span className="text-xs text-ink-faint font-medium">Capitaux & Dettes</span>
                  </h4>
                  <div className="space-y-3.5 text-sm">
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="font-semibold text-ink-soft">Capitaux Propres (Classe 1)</span>
                      <span className="font-mono font-bold">{formatMoney(passifEquity)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Capital Social & Réserves réglementaires</span>
                      <span>{formatMoney(passifEquity)}</span>
                    </div>

                    <div className="flex justify-between border-b border-border pb-2 pt-2">
                      <span className="font-semibold text-ink-soft">Résultat net de l'exercice</span>
                      <span className={`font-mono font-bold ${netProfit2026 >= 0 ? 'text-green' : 'text-accent'}`}>
                        {formatMoney(netProfit2026)}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Bénéfice de l'exercice (Solde Créditeur)</span>
                      <span>{formatMoney(netProfit2026)}</span>
                    </div>

                    <div className="flex justify-between border-b border-border pb-2 pt-2">
                      <span className="font-semibold text-ink-soft">Dettes Financières (Moyen/Long terme - Cl. 16)</span>
                      <span className="font-mono font-bold">{formatMoney(passifDebtsFin)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Emprunts et dettes financières assimilées</span>
                      <span>{formatMoney(passifDebtsFin)}</span>
                    </div>

                    <div className="flex justify-between border-b border-border pb-2 pt-2">
                      <span className="font-semibold text-ink-soft">Dettes Circulantes (Tiers Passif - Classe 4)</span>
                      <span className="font-mono font-bold">{formatMoney(passifDebtsCirc)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 pl-4 text-xs text-ink-faint">
                      <span>Dettes Fournisseurs, CNPS, État (Comptes 40, 42, 44...)</span>
                      <span>{formatMoney(passifDebtsCirc)}</span>
                    </div>

                    <div className="flex justify-between bg-accent text-cream font-black p-4 rounded-control text-base mt-6 shadow-md">
                      <span>TOTAL PASSIF</span>
                      <span className="font-mono">{formatMoney(totalPassif)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Subtab content: DSF */}
          {accountingSubTab === 'dsf' && (
            <div className="p-6 space-y-6">
              <div className="bg-bg/50 p-4 rounded-control border border-border flex justify-between items-center">
                <div>
                  <h4 className="font-bold text-ink text-sm">Déclaration Statistique et Fiscale (DSF) Provisoire</h4>
                  <p className="text-xs text-ink-soft font-medium">Formulaires de synthèse fiscale et détermination de l'Impôt sur les Sociétés (IS) - Cameroun / CEMAC.</p>
                </div>
                <button
                  type="button"
                  onClick={exportDSFToExcel}
                  className="px-4 py-2 bg-green hover:bg-green text-cream rounded-control text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer animate-pulse"
                >
                  📥 Télécharger Liasse DSF
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Resultat Fiscal Box */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4 md:col-span-2">
                  <h4 className="text-base font-bold text-ink border-b border-border pb-2">Détermination du Résultat Fiscal</h4>
                  <div className="space-y-3.5 text-sm">
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-ink-soft">Résultat Comptable Net de l'exercice</span>
                      <span className="font-mono font-bold">{formatMoney(resultatComptableDSF)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-xs">
                      <span className="text-ink-soft pl-4">+ Réintégrations Fiscales (Charges non déductibles)</span>
                      <span className="font-mono text-ink-soft">+{formatMoney(reintegrationsDSF)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-xs">
                      <span className="text-ink-soft pl-4">- Déductions Fiscales (Produits exonérés)</span>
                      <span className="font-mono text-ink-soft">-{formatMoney(deductionsDSF)}</span>
                    </div>
                    <div className="flex justify-between border-b-2 border-border pb-2 pt-2 text-base font-bold">
                      <span className="text-ink">Résultat Fiscal Imposable (Base IS)</span>
                      <span className="font-mono text-ink">{formatMoney(resultatFiscalDSF)}</span>
                    </div>
                  </div>
                </div>

                {/* Impot du Box */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
                  <h4 className="text-base font-bold text-ink border-b border-border pb-2">Calcul de l'Impôt Dû (Cameroun)</h4>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-ink-soft font-semibold">Taux standard IS (28% + 10% CAC = 30.8%)</span>
                      <span className="font-mono">{formatMoney(isSurResultat)}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-ink-soft font-semibold">Impôt Minimum Légal (2.2% du CA total)</span>
                      <span className="font-mono">{formatMoney(impotMinimum)}</span>
                    </div>
                    <div className="flex justify-between pt-2 text-sm font-bold text-accent">
                      <span>Impôt Définitif Dû (Le plus élevé)</span>
                      <span className="font-mono font-extrabold">{formatMoney(impotDufinal)}</span>
                    </div>
                    <div className="flex justify-between pt-3 border-t border-border text-sm font-bold text-green">
                      <span>Résultat Net après impôt</span>
                      <span className="font-mono font-extrabold">{formatMoney(netResultatApresImpot)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Other fiscal declarations summary */}
              <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-4">
                <h4 className="text-base font-bold text-ink border-b border-border pb-2">Autres Taxes et Déclarations Périodiques</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 bg-bg rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">TVA Net à Reverser</span>
                    <h4 className="text-lg font-black text-accent">{formatMoney(tvaNetReverser)}</h4>
                    <span className="text-[9px] text-ink-faint font-medium block mt-1">Calculé sur TVA Collectée: {formatMoney(tvaCollectee)} • Déductible: {formatMoney(tvaDeductible)}</span>
                  </div>
                  <div className="p-4 bg-bg rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">IRPP / IRSA (Retenue Salaires)</span>
                    <h4 className="text-lg font-black text-ink">{formatMoney(masseSalarialeAnnuelle2026 * 0.1)}</h4>
                    <span className="text-[9px] text-ink-faint font-medium block mt-1">Estimation 10% de la masse salariale brute ({formatMoney(masseSalarialeAnnuelle2026)})</span>
                  </div>
                  <div className="p-4 bg-bg rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block mb-1">Cotisations Sociales CNPS</span>
                    <h4 className="text-lg font-black text-ink">{formatMoney(masseSalarialeAnnuelle2026 * 0.22)}</h4>
                    <span className="text-[9px] text-ink-faint font-medium block mt-1">Base de calcul CNPS 22% (Part employeur + salarié)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------------------- MODAL: COMPTE COPTABLE -------------------- */}
      {showAddAccountModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login p-6 relative">
            <button onClick={() => setShowAddAccountModal(false)} className="absolute right-4 top-4 text-ink-faint hover:text-ink-soft font-bold">✕</button>
            <h3 className="text-lg font-bold text-ink border-b border-border pb-3 mb-4">Créer un Compte Plan OHADA</h3>
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Numéro de Compte</label>
                <input type="text" placeholder="Ex: 602" value={newAccNum} onChange={(e) => setNewAccNum(e.target.value)} required className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Libellé</label>
                <input type="text" placeholder="Ex: Fourniture papeterie" value={newAccLibelle} onChange={(e) => setNewAccLibelle(e.target.value)} required className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Classe OHADA</label>
                <select value={newAccClasse} onChange={(e) => setNewAccClasse(e.target.value)} className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold">
                  <option value="2">Classe 2 - Immobilisations</option>
                  <option value="4">Classe 4 - Tiers</option>
                  <option value="5">Classe 5 - Trésorerie</option>
                  <option value="6">Classe 6 - Charges</option>
                  <option value="7">Classe 7 - Produits</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddAccountModal(false)} className="px-4 py-2 bg-chip text-ink-soft rounded-control text-sm font-bold">Annuler</button>
                <button type="submit" className="px-6 py-2 bg-accent text-cream rounded-control text-sm font-bold shadow-md">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------- MODAL: SAISIE ECRITURE -------------------- */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-card w-full max-w-lg border border-border shadow-login p-6 relative">
            <button onClick={() => setShowExpenseModal(false)} className="absolute right-4 top-4 text-ink-faint hover:text-ink-soft font-bold">✕</button>
            <h3 className="text-lg font-bold text-ink border-b border-border pb-3 mb-4">Saisir une Opération financière</h3>
            <form onSubmit={handleSaveExpense} className="space-y-4">
              
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Type d'opération</label>
                <div className="flex bg-chip p-1 rounded-control">
                  <button type="button" onClick={() => setExpTypeSaisie('immediat')} className={`flex-1 text-xs py-2 px-2 rounded-md font-bold transition-colors ${expTypeSaisie === 'immediat' ? 'bg-surface shadow-sm text-ink' : 'text-ink-soft'}`}>Paiement Immédiat</button>
                  <button type="button" onClick={() => setExpTypeSaisie('credit')} className={`flex-1 text-xs py-2 px-2 rounded-md font-bold transition-colors ${expTypeSaisie === 'credit' ? 'bg-surface shadow-sm text-ink' : 'text-ink-soft'}`}>Facture à Crédit</button>
                  <button type="button" onClick={() => setExpTypeSaisie('reglement')} className={`flex-1 text-xs py-2 px-2 rounded-md font-bold transition-colors ${expTypeSaisie === 'reglement' ? 'bg-surface shadow-sm text-ink' : 'text-ink-soft'}`}>Règlement Tiers</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Date</label>
                  <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} required className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Référence Pièce</label>
                  <input type="text" placeholder="Ex: CHQ-882" value={expReference} onChange={(e) => setExpReference(e.target.value)} required className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono" />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Libellé</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Facture électricité mensuelle" 
                    value={expLibelle} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setExpLibelle(val);
                      
                      // Auto-selection of accounts based on detailed OHADA keywords (OHADA Referentiel de mots-clés)
                      const clean = val.toLowerCase().trim();
                      if (!clean) return;

                      // 1. Personnel (Salaires, Avances, Primes, CNPS)
                      const isSal = clean.includes('salaire') || clean.includes('rémunération') || clean.includes('remuneration') || clean.includes('paie') || clean.includes('bulletin') || clean.includes('prime') || clean.includes('traitement') || clean.includes('paie constatée');
                      const isAvance = clean.includes('avance') || clean.includes('acompte');
                      const isCnps = clean.includes('cnps') || clean.includes('cotisation sociale') || clean.includes('charge sociale');

                      if (isSal) {
                        if (isAvance) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '425') ? '425' : '661');
                          setExpCompteTiers('421');
                          setExpCompteCredit('521'); // Banque
                        } else {
                          setExpCompteDebit('661'); // Rémunérations directes
                          setExpCompteTiers('421'); // Personnel - Rémunérations dues
                          setExpCompteCredit('521'); // Banque
                        }
                        setExpTva(false);
                      } else if (isCnps) {
                        setExpCompteDebit('661'); // Fallback charges
                        setExpCompteTiers('431'); // Organismes sociaux
                        setExpCompteCredit('521');
                        setExpTva(false);
                      }
                      
                      // 2. Loyer & Crédit-bail
                      else if (clean.includes('loyer') || clean.includes('location') || clean.includes('bail') || clean.includes('leasing') || clean.includes('loa') || clean.includes('credit bail') || clean.includes('crédit-bail')) {
                        if (clean.includes('credit bail') || clean.includes('crédit-bail') || clean.includes('leasing') || clean.includes('loa')) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '612') ? '612' : '622');
                        } else {
                          setExpCompteDebit('622'); // Locations
                        }
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(true);
                      }

                      // 3. Entretien & réparations
                      else if (clean.includes('entretien') || clean.includes('reparation') || clean.includes('réparation') || clean.includes('maintenance') || clean.includes('revision') || clean.includes('vidange')) {
                        setExpCompteDebit('624'); // Entretien et réparations
                        setExpCompteTiers('401');
                        setExpCompteCredit('571'); // Caisse
                        setExpTva(true);
                      }

                      // 4. Assurances
                      else if (clean.includes('assurance') || clean.includes('prime assurance') || clean.includes('cotisation assurance')) {
                        setExpCompteDebit(planComptable.some(c => c.numero === '616') ? '616' : '61');
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(false);
                      }

                      // 5. Publicité et communication
                      else if (clean.includes('publicite') || clean.includes('publicité') || clean.includes('communication') || clean.includes('marketing') || clean.includes('pub')) {
                        setExpCompteDebit(planComptable.some(c => c.numero === '623') ? '623' : '601');
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(true);
                      }

                      // 6. Transports, carburant et déplacements
                      else if (clean.includes('transport') || clean.includes('carburant') || clean.includes('essence') || clean.includes('gasoil') || clean.includes('deplacement') || clean.includes('déplacement') || clean.includes('mission')) {
                        if (clean.includes('carburant') || clean.includes('essence') || clean.includes('gasoil')) {
                          setExpCompteDebit('605'); // combustibles
                        } else {
                          setExpCompteDebit('61'); // Transports
                        }
                        setExpCompteTiers('401');
                        setExpCompteCredit('571');
                        setExpTva(true);
                      }

                      // 7. Électricité, eau (ENEO, Camwater, etc.)
                      else if (clean.includes('electricite') || clean.includes('électricité') || clean.includes('eau') || clean.includes('camwater') || clean.includes('eneo') || clean.includes('cde') || clean.includes('sonel') || clean.includes('élec')) {
                        setExpCompteDebit('605'); // Eau et Électricité
                        setExpCompteTiers('401');
                        setExpCompteCredit('571');
                        setExpTva(true);
                      }

                      // 8. Télécommunications
                      else if (clean.includes('telephone') || clean.includes('téléphone') || clean.includes('internet') || clean.includes('orange') || clean.includes('mtn')) {
                        setExpCompteDebit(planComptable.some(c => c.numero === '626') ? '626' : '622');
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(true);
                      }

                      // 9. Honoraires (avocat, expert-comptable, etc.)
                      else if (clean.includes('honoraire') || clean.includes('avocat') || clean.includes('expert-comptable') || clean.includes('notaire') || clean.includes('consultant')) {
                        setExpCompteDebit(planComptable.some(c => c.numero === '621') ? '621' : '622');
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(true);
                      }

                      // 10. Frais bancaires, agios et commissions
                      else if (clean.includes('bancaire') || clean.includes('agios') || clean.includes('tenue compte') || clean.includes('commission') || clean.includes('virement')) {
                        setExpCompteDebit('631'); // Frais bancaires
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(false);
                      }

                      // 11. Impôts, taxes et patente
                      else if (clean.includes('impot') || clean.includes('impôt') || clean.includes('taxe') || clean.includes('patente') || clean.includes('dgi') || clean.includes('minfi') || clean.includes('is ') || clean === 'is' || clean.includes('imf')) {
                        setExpCompteDebit('64'); // Impôts et taxes
                        setExpCompteTiers('441'); // État
                        setExpCompteCredit('521');
                        setExpTva(false);
                      }

                      // 12. Immobilisations (matériel, informatique, bureau, bâtiment, terrain)
                      else if (clean.includes('achat matériel') || clean.includes('achat materiel') || clean.includes('acquisition') || clean.includes('ordinateur') || clean.includes('pc') || clean.includes('table') || clean.includes('banc') || clean.includes('terrain') || clean.includes('bâtiment') || clean.includes('batiment')) {
                        if (clean.includes('ordinateur') || clean.includes('pc') || clean.includes('informatique')) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '245') ? '245' : '24');
                        } else if (clean.includes('bureau') || clean.includes('scolaire') || clean.includes('table') || clean.includes('banc') || clean.includes('mobilier')) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '244') ? '244' : '24');
                        } else if (clean.includes('terrain')) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '22') ? '22' : '24');
                        } else if (clean.includes('bâtiment') || clean.includes('batiment')) {
                          setExpCompteDebit(planComptable.some(c => c.numero === '23') ? '23' : '24');
                        } else {
                          setExpCompteDebit('24');
                        }
                        setExpCompteTiers('401');
                        setExpCompteCredit('521');
                        setExpTva(true);
                      }

                      // 13. Achat de fournitures courantes / fournitures de bureau
                      else if (clean.includes('fourniture') || clean.includes('consommable') || clean.includes('papeterie') || clean.includes('toner') || clean.includes('cartouche')) {
                        setExpCompteDebit('601'); // Achats de fournitures
                        setExpCompteTiers('401');
                        setExpCompteCredit('571');
                        setExpTva(true);
                      }
                    }} 
                    required 
                    className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Nom du Tiers (Bénéficiaire / Client)</label>
                  <input 
                    type="text" 
                    placeholder="Ex: ENEO, CNPS, Nom du tiers..." 
                    value={expPartenaire} 
                    onChange={(e) => setExpPartenaire(e.target.value)} 
                    className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold" 
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {(expTypeSaisie === 'immediat' || expTypeSaisie === 'credit') && (
                  <div>
                    <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Compte Débit (Charge)</label>
                    <select value={expCompteDebit} onChange={(e) => setExpCompteDebit(e.target.value)} className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold">
                      {planComptable.filter(c => c.classe === 6 || c.classe === 2 || c.classe === 4).map(c => (
                        <option key={c.numero} value={c.numero}>{c.numero} - {c.libelle}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={expTypeSaisie === 'reglement' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Compte Tiers</label>
                  <select value={expCompteTiers} onChange={(e) => setExpCompteTiers(e.target.value)} className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold">
                    {planComptable.filter(c => c.classe === 4).map(c => (
                      <option key={c.numero} value={c.numero}>{c.numero} - {c.libelle}</option>
                    ))}
                  </select>
                </div>
              </div>

              {(expTypeSaisie === 'immediat' || expTypeSaisie === 'credit') && (
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Montant Facture TTC</label>
                    <input type="number" min="1" placeholder="Ex: 120000" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono" />
                  </div>
                  <div className="pb-2">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-ink-soft select-none">
                      <input type="checkbox" checked={expTva} onChange={(e) => setExpTva(e.target.checked)} className="rounded border-border text-ink focus:border-accent w-4 h-4" />
                      Soumis à TVA (19.25%)
                    </label>
                  </div>
                </div>
              )}

              {(expTypeSaisie === 'credit' || expTypeSaisie === 'reglement') && (
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Montant Payé</label>
                  <input type="number" min="0" placeholder="Ex: 50000" value={expAmountPaye} onChange={(e) => setExpAmountPaye(e.target.value)} required={expTypeSaisie === 'reglement'} className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono" />
                </div>
              )}

              {(expTypeSaisie === 'immediat' || (expTypeSaisie === 'credit' && Number(expAmountPaye) > 0) || expTypeSaisie === 'reglement') && (
                <div>
                  <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Compte Crédit (Trésorerie)</label>
                  <select value={expCompteCredit} onChange={(e) => setExpCompteCredit(e.target.value)} className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold bg-chip">
                    {planComptable.filter(c => c.classe === 5).map(c => (
                      <option key={c.numero} value={c.numero}>{c.numero} - {c.libelle}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3 border-t border-border">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="px-4 py-2 bg-chip text-ink-soft rounded-control text-sm font-bold">Annuler</button>
                <button type="submit" className="px-6 py-2 bg-accent text-cream rounded-control text-sm font-bold shadow-md">Valider</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* -------------------- MODAL: AJOUTER LIGNE BUDGETAIRE -------------------- */}
      {showAddBudgetModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login p-6 relative">
            <button onClick={() => setShowAddBudgetModal(false)} className="absolute right-4 top-4 text-ink-faint hover:text-ink-soft font-bold">✕</button>
            <h3 className="text-lg font-bold text-ink border-b border-border pb-3 mb-4">Ajouter un Poste Budgétaire</h3>
            <form onSubmit={handleAddBudgetLine} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Poste Budgétaire / Intitulé</label>
                <input
                  type="text"
                  placeholder="Ex: Achat fournitures de bureau"
                  value={newBudgetPoste}
                  onChange={(e) => setNewBudgetPoste(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Catégorie</label>
                <select
                  value={newBudgetCategorie}
                  onChange={(e) => setNewBudgetCategorie(e.target.value as any)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-semibold"
                >
                  <option value="Charge">Charge (Dépense)</option>
                  <option value="Revenu">Revenu (Recette)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">Montant Budgétisé (FCFA)</label>
                <input
                  type="number"
                  placeholder="Ex: 1500000"
                  value={newBudgetPrevu}
                  onChange={(e) => setNewBudgetPrevu(e.target.value)}
                  required
                  min="0"
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-faint uppercase mb-1.5">
                  Montant Réalisé Réel (FCFA) <span className="text-[10px] lowercase text-ink-soft font-normal">(Optionnel — calculé automatiquement si vide)</span>
                </label>
                <input
                  type="number"
                  placeholder="Laisser vide pour calcul automatique ou saisir le montant réel"
                  value={newBudgetRealise}
                  onChange={(e) => setNewBudgetRealise(e.target.value)}
                  min="0"
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent font-mono"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddBudgetModal(false)} className="px-4 py-2 bg-chip text-ink-soft rounded-control text-sm font-bold">Annuler</button>
                <button type="submit" className="px-6 py-2 bg-accent text-cream rounded-control text-sm font-bold shadow-md">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------- MODAL: RAPPORT D'ANALYSE DES ECARTS -------------------- */}
      {showBudgetReportModal && (() => {
        const variances = getBudgetVariance();
        const totRevenuPrevu = variances.filter(v => v.categorie === 'Revenu').reduce((sum, v) => sum + v.budgetPrevu, 0);
        const totRevenuRealise = variances.filter(v => v.categorie === 'Revenu').reduce((sum, v) => sum + v.realise, 0);
        const diffRevenu = totRevenuRealise - totRevenuPrevu;

        const totChargePrevu = variances.filter(v => v.categorie === 'Charge').reduce((sum, v) => sum + v.budgetPrevu, 0);
        const totChargeRealise = variances.filter(v => v.categorie === 'Charge').reduce((sum, v) => sum + v.realise, 0);
        const diffCharge = totChargePrevu - totChargeRealise; // Positive if spent less than budgeted

        const profitPrevu = totRevenuPrevu - totChargePrevu;
        const profitRealise = totRevenuRealise - totChargeRealise;
        const diffProfit = profitRealise - profitPrevu;

        const favorableLines = variances.filter(v => v.isFavorable);
        const unfavorableLines = variances.filter(v => !v.isFavorable);

        return (
          <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-surface rounded-card w-full max-w-2xl border border-border shadow-login p-6 relative max-h-[90vh] overflow-y-auto">
              <button onClick={() => setShowBudgetReportModal(false)} className="absolute right-4 top-4 text-ink-faint hover:text-ink-soft font-bold">✕</button>
              
              <div className="border-b border-border pb-3 mb-6">
                <span className="text-[10px] bg-green-bg text-green px-2.5 py-1 rounded-full font-bold uppercase tracking-wider animate-pulse">Génération Automatique</span>
                <h3 className="text-xl font-bold text-ink mt-2">Rapport d'Analyse des Écarts Budgétaires</h3>
                <p className="text-xs text-ink-faint">Date d'analyse : {new Date().toLocaleDateString('fr-FR')} • Année Académique Active : 2025/2026</p>
              </div>

              <div className="space-y-6 text-sm text-ink-soft">
                {/* Executive Summary Cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-bg p-4 rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Écart Recettes</span>
                    <span className={`text-lg font-black block mt-1 ${diffRevenu >= 0 ? 'text-green' : 'text-accent'}`}>
                      {diffRevenu > 0 ? '+' : ''}{formatMoney(diffRevenu)}
                    </span>
                    <span className="text-[9px] text-ink-faint font-semibold block mt-0.5">Budget réalisé à {totRevenuPrevu > 0 ? ((totRevenuRealise/totRevenuPrevu)*100).toFixed(0) : 0}%</span>
                  </div>
                  <div className="bg-bg p-4 rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Écart Dépenses</span>
                    <span className={`text-lg font-black block mt-1 ${diffCharge >= 0 ? 'text-green' : 'text-accent'}`}>
                      {diffCharge >= 0 ? 'Sous-consommé' : 'Sur-consommé'}
                    </span>
                    <span className={`text-[9px] font-semibold block mt-0.5 ${diffCharge >= 0 ? 'text-green' : 'text-accent'}`}>{formatMoney(Math.abs(totChargeRealise - totChargePrevu))}</span>
                  </div>
                  <div className="bg-bg p-4 rounded-control border border-border">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Écart Résultat Net</span>
                    <span className={`text-lg font-black block mt-1 ${diffProfit >= 0 ? 'text-green' : 'text-accent'}`}>
                      {diffProfit > 0 ? '+' : ''}{formatMoney(diffProfit)}
                    </span>
                    <span className="text-[9px] text-ink-faint font-semibold block mt-0.5">Performance globale</span>
                  </div>
                </div>

                {/* Analysis section */}
                <div className="space-y-3">
                  <h4 className="font-bold text-ink text-base">Faits Marquants & Éléments Favorables</h4>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    {favorableLines.length > 0 ? (
                      favorableLines.map((line, idx) => (
                        <li key={idx}>
                          <span className="font-semibold text-ink">{line.poste}</span> : 
                          Écart positif de <span className="text-green font-bold">+{formatMoney(Math.abs(line.diff))}</span>. Le réalisé ({formatMoney(line.realise)}) s'établit de manière favorable par rapport aux prévisions budgétaires ({formatMoney(line.budgetPrevu)}).
                        </li>
                      ))
                    ) : (
                      <li className="text-ink-faint italic">Aucun écart favorable constaté sur cette période.</li>
                    )}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h4 className="font-bold text-ink text-base">Points de Vigilance (Écarts Défavorables)</h4>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    {unfavorableLines.length > 0 ? (
                      unfavorableLines.map((line, idx) => (
                        <li key={idx}>
                          <span className="font-semibold text-ink">{line.poste}</span> : 
                          Écart négatif de <span className="text-accent font-bold">{formatMoney(line.diff)}</span>. Le réalisé ({formatMoney(line.realise)}) dépasse ou n'atteint pas l'objectif budgétaire initial ({formatMoney(line.budgetPrevu)}).
                        </li>
                      ))
                    ) : (
                      <li className="text-ink-faint italic">Excellent! Aucun point de vigilance ou écart négatif constaté.</li>
                    )}
                  </ul>
                </div>

                {/* Strategic Advice */}
                <div className="bg-chip p-4 rounded-control border border-outline space-y-2">
                  <h4 className="font-bold text-ink text-sm flex items-center gap-1.5">
                    💡 Recommandations Stratégiques
                  </h4>
                  <p className="text-xs text-ink leading-relaxed">
                    {diffProfit >= 0 
                      ? "La situation financière globale est satisfaisante. Le résultat net est supérieur aux prévisions. Il est recommandé de maintenir la discipline sur les charges fixes d'exploitation et de flécher l'excédent vers l'investissement dans les infrastructures numériques scolaires."
                      : "Un écart négatif global est observé sur le résultat net. Il convient de revoir en priorité les postes ayant subi des surconsommations (vérifier les charges de fluides et loyers) et d'intensifier le recouvrement des tranches de scolarité restantes auprès des familles d'élèves pour rétablir la balance."
                    }
                  </p>
                </div>
              </div>

              <div className="pt-6 border-t border-border mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowBudgetReportModal(false)}
                  className="px-5 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-md shadow-cta transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
