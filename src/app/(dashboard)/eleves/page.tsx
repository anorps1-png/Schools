'use client';
import { captureError, captureMessage } from '@/lib/observability/logger';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { SearchIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, DownloadIcon } from '@/components/icons';
import { Eleve, Classe } from '@/types/domain';
import { downloadExcel } from '@/lib/excel';
import { getStudents, createStudent, addPayment, getStudentsWidgetStats, getStudentsPaginated, type StudentsWidgetStats, type StudentPage } from '@/lib/queries/eleves';
import { getClasses } from '@/lib/queries/classes';
import { useEtablissement } from '@/contexts/etablissement-context';
import { createClient, isRunningInElectron } from '@/lib/supabase/client';
import { printStudentList, type PrintableStudent } from '@/lib/print/printStudentList';

export default function ElevesPage() {
  const isElectron = isRunningInElectron();
  const { etablissementId, academicYearId, setAcademicYearId, academicYear } = useEtablissement();
  const [students, setStudents] = useState<Eleve[]>([]);
  const [classesList, setClassesList] = useState<Classe[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  // Cartes KPI : calculées en base via RPC (get_students_widget_stats) quand
  // disponible, sinon repli sur le calcul client (widgetStats plus bas) qui
  // reste toujours actif en parallèle. Ne remplace jamais students/setStudents,
  // utilisé nulle part ailleurs que dans les 4 cartes d'affichage.
  const [serverWidgetStats, setServerWidgetStats] = useState<StudentsWidgetStats | null>(null);

  // Tableau : recherche + filtres + pagination calculés en base (RPC
  // get_students_paginated) quand disponible. N'affecte QUE l'affichage du
  // tableau — students/setStudents (CRUD, export, bootstrap année scolaire)
  // reste la source de vérité inchangée pour tout le reste de la page.
  const [serverTableStudents, setServerTableStudents] = useState<StudentPage[] | null>(null);
  const [serverTableTotal, setServerTableTotal] = useState(0);
  const [serverModeAvailable, setServerModeAvailable] = useState<boolean | null>(null);

  // Filter students and classes by active academic year
  const studentsOfActiveYear = useMemo(() => {
    if (!academicYearId) return students;
    return students.filter(s => s.anneeScolaireId === academicYearId);
  }, [students, academicYearId]);

  const classesOfActiveYear = useMemo(() => {
    if (!academicYearId) return classesList;
    // getClasses() renvoie les lignes Supabase brutes (annee_scolaire_id en
    // snake_case) alors que le type Classe déclare anneeScolaireId : sans ce
    // fallback, ce filtre ne matchait jamais rien dès que academicYearId
    // était renseigné, vidant la liste des classes à l'inscription.
    return classesList.filter(c => ((c as any).annee_scolaire_id || c.anneeScolaireId) === academicYearId);
  }, [classesList, academicYearId]);

  // Form states for adding student
  const [showAddModal, setShowAddModal] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [className, setClassName] = useState(''); // This will store the UUID of the class
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [matricule, setMatricule] = useState('');
  const [initialPayment, setInitialPayment] = useState('');

  // Re-enrollment modal states
  const [showReenrollModal, setShowReenrollModal] = useState(false);
  const [reenrollSearch, setReenrollSearch] = useState('');
  const [selectedReenrollStudent, setSelectedReenrollStudent] = useState<Eleve | null>(null);
  const [reenrollClassId, setReenrollClassId] = useState('');
  const [reenrollYearId, setReenrollYearId] = useState('');
  const [reenrollInitialPayment, setReenrollInitialPayment] = useState('');
  const [availableYears, setAvailableYears] = useState<any[]>([]);
  // Candidats de la recherche de réinscription. Alimentés par la RPC serveur
  // (toutes années confondues) quand elle est disponible : la liste `students`
  // n'est remplie qu'en repli client, donc le modal était vide sur le chemin
  // nominal en production.
  const [reenrollCandidates, setReenrollCandidates] = useState<any[]>([]);
  // Classes de l'année de destination : le menu affichait les classes de
  // l'année ACTIVE, ce qui permettait d'affecter un élève réinscrit en
  // 2026/2027 à une classe de 2025/2026.
  const [reenrollClassesList, setReenrollClassesList] = useState<Classe[]>([]);

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // File input ref for Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('All');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('All');
  const [selectedGender, setSelectedGender] = useState('All');

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Load from Supabase
  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      const fetchClassesAndYears = async () => {
        try {
          const data = await getClasses(etablissementId, academicYearId || null);
          setClassesList(data);
          // reenrollClassId est géré par l'effet dédié aux classes de l'année
          // de destination, pas par la liste de l'année active.
          if (data.length > 0) {
            setClassName(data[0].id);
          } else {
            setClassName('');
          }
        } catch (error) {
          captureError(error, { context: "Error fetching classes:" });
          setClassesList([]);
        }

        try {
          const supabase = createClient();
          const { data: years } = await supabase
            .from('annees_scolaires')
            .select('*')
            .eq('etablissement_id', etablissementId)
            .order('nom', { ascending: false });
          if (years && years.length > 0) {
            setAvailableYears(years);
            setReenrollYearId(academicYearId || years[0].id);
          }
        } catch (err) {
          captureError(err, { context: "Error fetching academic years:" });
        }
      };

      fetchClassesAndYears();
    }
  }, [etablissementId, academicYearId]);

  // Classes de l'année de destination de la réinscription : rechargées quand
  // l'année cible change, pour interdire l'affectation croisée classe/année.
  useEffect(() => {
    if (!etablissementId || !reenrollYearId) {
      setReenrollClassesList([]);
      return;
    }
    getClasses(etablissementId, reenrollYearId)
      .then((data) => {
        setReenrollClassesList(data);
        setReenrollClassId(data.length > 0 ? data[0].id : '');
      })
      .catch((error) => {
        captureError(error, { context: 'Error fetching reenroll classes:' });
        setReenrollClassesList([]);
        setReenrollClassId('');
      });
  }, [etablissementId, reenrollYearId]);

  // Recherche des candidats à la réinscription. En mode serveur, la liste
  // `students` reste vide (elle n'alimente que le repli client) : on cherche
  // donc en base via la RPC paginée, toutes années confondues, sinon le modal
  // ne renvoyait jamais aucun résultat en production.
  useEffect(() => {
    if (!showReenrollModal || !reenrollSearch || selectedReenrollStudent) {
      setReenrollCandidates([]);
      return;
    }

    if (serverModeAvailable !== true) {
      const q = reenrollSearch.toLowerCase();
      setReenrollCandidates(
        students
          .filter(s => `${s.nom || ''} ${s.prenom || ''} ${s.matricule || ''}`.toLowerCase().includes(q))
          .slice(0, 10)
      );
      return;
    }

    const timer = setTimeout(() => {
      getStudentsPaginated({
        etablissementId: etablissementId!,
        anneeScolaireId: null,
        search: reenrollSearch,
        page: 1,
        pageSize: 10,
      })
        .then(({ students: rows }) => {
          setReenrollCandidates(rows.map((r: any) => ({
            id: r.id,
            matricule: r.matricule,
            nom: r.nom,
            prenom: r.prenom,
            sexe: r.sexe,
            classeId: r.classe_id,
            anneeScolaireId: r.annee_scolaire_id,
            nomParent: r.nom_parent,
            telephoneParent: r.telephone_parent,
            emailParent: r.email_parent,
            dateNaissance: r.date_naissance,
            lieuNaissance: r.lieu_naissance,
          })));
        })
        .catch((error) => {
          captureError(error, { context: 'Error searching reenroll candidates:' });
          setReenrollCandidates([]);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [showReenrollModal, reenrollSearch, selectedReenrollStudent, serverModeAvailable, students, etablissementId]);

  // Fetch complet des élèves (avec historique de paiements) — nécessaire
  // uniquement en repli client (tableau serveur paginé indisponible/hors-ligne)
  // pour alimenter le tableau de repli, la CRUD locale et les KPI de repli.
  // Ne s'exécute plus systématiquement à chaque montage (voir effet
  // ci-dessous, déclenché par serverModeAvailable). L'export Excel a sa
  // propre source de données indépendante (handleExportExcel).
  const fetchAllStudentsFallback = useCallback(async () => {
    if (typeof window === 'undefined' || !etablissementId) return;
    try {
      const data = await getStudents(etablissementId);
      const mapped = data.map(d => ({
        id: d.id,
        matricule: d.matricule,
        nom: d.nom,
        prenom: d.prenom,
        sexe: d.sexe,
        classeId: d.classe_id,
        anneeScolaireId: d.annee_scolaire_id,
        telephoneParent: d.telephone_parent,
        nomParent: d.nom_parent,
        emailParent: d.email_parent,
        dateNaissance: d.date_naissance,
        lieuNaissance: d.lieu_naissance,
        dateInscription: d.date_inscription,
        statut: d.statut,
        paiements: d.paiements?.map((p: any) => ({
          id: p.id,
          eleveId: p.eleve_id,
          montant: Number(p.montant),
          date: p.date,
          typeFrais: p.type_frais,
          statut: p.statut,
          reference: p.reference,
          modePaiement: p.mode_paiement
        })) || [],
        notes: []
      }));
      setStudents(mapped as any);
    } catch (error) {
      captureError(error, { context: "Error fetching students:" });
      setStudents([]);
    } finally {
      setIsLoaded(true);
    }
  }, [etablissementId]);

  // Cartes KPI via RPC serveur (léger, pas de transfert des lignes). Échoue
  // silencieusement (migration non appliquée, hors-ligne...) : les cartes
  // retombent alors sur widgetStats calculé côté client, déjà présent.
  const fetchWidgetStats = useCallback(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      getStudentsWidgetStats(etablissementId, academicYearId || null)
        .then(setServerWidgetStats)
        .catch(() => setServerWidgetStats(null));
    }
  }, [etablissementId, academicYearId]);

  useEffect(() => {
    fetchWidgetStats();
  }, [fetchWidgetStats]);

  // Recherche débouncée (300ms) pour ne pas déclencher un appel RPC à chaque frappe.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fetchTablePage = useCallback(async () => {
    if (typeof window === 'undefined' || !etablissementId) return;
    try {
      const { students: rows, totalCount } = await getStudentsPaginated({
        etablissementId,
        anneeScolaireId: academicYearId || null,
        search: debouncedSearch,
        classeId: selectedClass === 'All' ? null : selectedClass,
        statutPaiement: selectedPaymentStatus === 'All' ? null : (selectedPaymentStatus as 'paid' | 'partial' | 'unpaid'),
        sexe: selectedGender === 'All' ? null : (selectedGender as 'M' | 'F'),
        page: currentPage,
        pageSize,
      });
      setServerTableStudents(rows);
      setServerTableTotal(totalCount);
      setServerModeAvailable(true);
    } catch {
      // Migration RPC non appliquée, ou hors-ligne : repli sur le calcul
      // client existant (filteredStudents/paginatedStudents plus bas).
      setServerModeAvailable(false);
      setServerTableStudents(null);
    }
  }, [etablissementId, academicYearId, debouncedSearch, selectedClass, selectedPaymentStatus, selectedGender, currentPage, pageSize]);

  useEffect(() => {
    fetchTablePage();
  }, [fetchTablePage]);

  // Ne déclenche le fetch complet (repli client) qu'une fois qu'on sait que
  // le tableau serveur paginé est indisponible. Si le serveur est disponible,
  // la liste complète n'est pas nécessaire pour l'affichage.
  useEffect(() => {
    if (serverModeAvailable === false) {
      fetchAllStudentsFallback();
    } else if (serverModeAvailable === true) {
      setIsLoaded(true);
    }
  }, [serverModeAvailable, fetchAllStudentsFallback]);

  /** À appeler après toute mutation réussie (ajout/suppression/import) pour
   * garder le tableau serveur et les cartes KPI synchro avec students. */
  const refreshServerViews = useCallback(() => {
    fetchTablePage();
    fetchWidgetStats();
  }, [fetchTablePage, fetchWidgetStats]);

  // Helper: Get student payment stats
  const getStudentPaymentStats = useCallback((student: Eleve) => {
    if (!student) return { totalDue: null as number | null, totalPaid: 0, status: 'unpaid' as const };
    const classObj = classesList.find(c => c.nom === student.classeId || c.id === student.classeId);
    // prix inclut les frais d'inscription : totalDue ne doit couvrir que la
    // scolarité, comme totalPaid ci-dessous (paiements type_frais='Scolarité').
    const totalDue: number | null = classObj && typeof classObj.prix === 'number'
      ? classObj.prix - (Number((classObj as any).frais_inscription) || 0)
      : null;
    const totalPaid = (student.paiements || [])
      .filter(p => p.statut === 'paid' && p.typeFrais === 'Scolarité')
      .reduce((sum, p) => sum + p.montant, 0);

    let status: 'paid' | 'partial' | 'unpaid' = 'unpaid';
    if (totalDue !== null && totalPaid >= totalDue && totalDue > 0) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partial';
    }

    return { totalDue, totalPaid, status };
  }, [classesList]);

  // Filter and alphabetically sort students
  const filteredStudents = useMemo(() => {
    if (!isLoaded) return [];
    return studentsOfActiveYear
      .filter(student => {
        if (!student) return false;
        // 1. Search term (Name or Matricule)
        const fullName = `${student.nom || ''} ${student.prenom || ''}`.toLowerCase();
        const matriculeVal = (student.matricule || '').toLowerCase();
        const matchesSearch = fullName.includes(searchTerm.toLowerCase()) || matriculeVal.includes(searchTerm.toLowerCase());

        // 2. Class
        const matchesClass = selectedClass === 'All' || student.classeId === selectedClass;

        // 3. Payment Status
        const stats = getStudentPaymentStats(student);
        const matchesPayment = selectedPaymentStatus === 'All' || stats.status === selectedPaymentStatus;

        // 4. Gender
        const matchesGender = selectedGender === 'All' || student.sexe === selectedGender;

        return matchesSearch && matchesClass && matchesPayment && matchesGender;
      })
      .sort((a, b) => {
        const nomA = (a.nom || '').trim();
        const nomB = (b.nom || '').trim();
        const cmpNom = nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
        if (cmpNom !== 0) return cmpNom;
        const prenomA = (a.prenom || '').trim();
        const prenomB = (b.prenom || '').trim();
        return prenomA.localeCompare(prenomB, 'fr', { sensitivity: 'base' });
      });
  }, [studentsOfActiveYear, searchTerm, selectedClass, selectedPaymentStatus, selectedGender, isLoaded, getStudentPaymentStats]);

  // Total counts for widgets
  // lateCount reste à 0 : ce repli client n'a pas la notion d'échéance des
  // tranches (contrairement à get_students_widget_stats). La carte « Partiel »
  // additionne les deux, donc le total reste juste dans les deux modes.
  const widgetStats = useMemo(() => {
    if (!isLoaded) return { paidCount: 0, partialCount: 0, lateCount: 0, unpaidCount: 0, total: 0 };
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;

    studentsOfActiveYear.forEach(s => {
      if (!s) return;
      const { status } = getStudentPaymentStats(s);
      if (status === 'paid') paidCount++;
      else if (status === 'partial') partialCount++;
      else unpaidCount++;
    });

    return { paidCount, partialCount, lateCount: 0, unpaidCount, total: studentsOfActiveYear.length };
  }, [studentsOfActiveYear, isLoaded, getStudentPaymentStats]);


  // Pagination Logic (repli client — utilisé si la RPC serveur est indisponible)
  const legacyTotalItems = filteredStudents.length;
  const legacyTotalPages = Math.ceil(legacyTotalItems / pageSize) || 1;
  const legacyActivePage = Math.min(currentPage, legacyTotalPages);

  const legacyPaginatedStudents = useMemo(() => {
    const startIndex = (legacyActivePage - 1) * pageSize;
    return filteredStudents.slice(startIndex, startIndex + pageSize);
  }, [filteredStudents, legacyActivePage, pageSize]);

  // Source effective pour le tableau : serveur si disponible, sinon calcul
  // client ci-dessus. Ne change rien aux flux CRUD/export (students, inchangés).
  const useServerTable = serverModeAvailable === true && serverTableStudents !== null;
  const totalItems = useServerTable ? serverTableTotal : legacyTotalItems;
  const totalPages = useServerTable ? (Math.ceil(serverTableTotal / pageSize) || 1) : legacyTotalPages;
  const activePage = Math.min(currentPage, totalPages);

  interface DisplayRow {
    id: string;
    matricule: string;
    nom: string;
    prenom: string;
    sexe: string;
    classeId: string;
    nomParent: string | null | undefined;
    classeNomOverride: string | null;
    precomputedStats: { totalDue: number | null; totalPaid: number; status: 'paid' | 'partial' | 'unpaid' | 'late'; resteAPayerEchu?: number } | null;
  }

  const displayRows: DisplayRow[] = useMemo(() => {
    if (useServerTable) {
      return serverTableStudents!.map((s) => ({
        id: s.id,
        matricule: s.matricule,
        nom: s.nom,
        prenom: s.prenom,
        sexe: s.sexe,
        classeId: s.classe_id,
        nomParent: s.nom_parent,
        classeNomOverride: s.classe_nom,
        precomputedStats: { totalDue: Number(s.total_due), totalPaid: Number(s.total_paid), status: s.statut_paiement, resteAPayerEchu: s.reste_a_payer_echu !== undefined && s.reste_a_payer_echu !== null ? Number(s.reste_a_payer_echu) : undefined },
      }));
    }
    return legacyPaginatedStudents.map((s) => ({
      id: s.id,
      matricule: s.matricule,
      nom: s.nom,
      prenom: s.prenom,
      sexe: s.sexe,
      classeId: s.classeId,
      nomParent: s.nomParent,
      classeNomOverride: null,
      precomputedStats: getStudentPaymentStats(s),
    }));
  }, [useServerTable, serverTableStudents, legacyPaginatedStudents, getStudentPaymentStats]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !parentName || !parentPhone) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }

    if (!className) {
      alert("Veuillez d'abord configurer au moins une classe dans le menu 'Classes' avant de pouvoir inscrire un élève.");
      return;
    }

    // Resolve the active year UUID dynamically
    let resolvedAnneeScolaireId = null;

    // 1. Try to get it from the selected class in classesList (strongest source of truth for the student's year)
    const selectedClassObj = classesList.find(c => c.id === className);
    if (selectedClassObj) {
      resolvedAnneeScolaireId = (selectedClassObj as any).annee_scolaire_id || (selectedClassObj as any).anneeScolaireId;
    }

    // 2. Try online query if still not resolved
    const isOfflineMode = isElectron && (!navigator.onLine || (typeof window !== 'undefined' && (window as any).__forceOffline));
    if (!resolvedAnneeScolaireId && !isOfflineMode && etablissementId) {
      try {
        const supabase = createClient();
        const { data: etab } = await supabase
          .from('etablissements')
          .select('annee_scolaire_active_id')
          .eq('id', etablissementId)
          .single();

        if (etab?.annee_scolaire_active_id) {
          resolvedAnneeScolaireId = etab.annee_scolaire_active_id;
          if (setAcademicYearId) {
            setAcademicYearId(resolvedAnneeScolaireId);
          }
        } else {
          const { data: years } = await supabase
            .from('annees_scolaires')
            .select('id')
            .eq('etablissement_id', etablissementId)
            .limit(1);
          if (years && years.length > 0) {
            resolvedAnneeScolaireId = years[0].id;
          }
        }
      } catch (err) {
        captureError(err, { context: "Failed to dynamically fetch active year ID:" });
      }
    }

    // 3. Try to get it from localStorage cached ID
    if (!resolvedAnneeScolaireId && typeof window !== 'undefined') {
      const cachedYearId = localStorage.getItem('mboaschool_active_year_id');
      // Only use the cached year if we are offline or if it exists in years (i.e. not a random mock UUID)
      const isMockUuid = cachedYearId && (cachedYearId.startsWith('local_') || (cachedYearId.includes('-') && !isOfflineMode && classesList.length > 0 && !classesList.some(c => ((c as any).annee_scolaire_id || (c as any).anneeScolaireId) === cachedYearId)));
      if (!isMockUuid) {
        resolvedAnneeScolaireId = cachedYearId;
      }
    }

    // 4. Try offline cache for annees_scolaires if still missing
    if (!resolvedAnneeScolaireId && typeof window !== 'undefined') {
      const storedYears = localStorage.getItem('offline_cache_annees_scolaires');
      if (storedYears) {
        try {
          const parsed = JSON.parse(storedYears);
          if (Array.isArray(parsed) && parsed.length > 0) {
            resolvedAnneeScolaireId = parsed[0].id;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    if (!resolvedAnneeScolaireId) {
      alert("Erreur : Impossible de déterminer l'année scolaire active. Veuillez rafraîchir la page.");
      return;
    }

    // Espace élargi à 6 chiffres (900 valeurs auparavant, collision quasi
    // certaine dès quelques dizaines d'élèves sans matricule saisi) ; la
    // contrainte UNIQUE(etablissement_id, matricule, annee_scolaire_id)
    // reste le filet en cas de collision malgré tout.
    const generatedMatricule = matricule.trim() || `26YAE${Math.floor(100000 + Math.random() * 900000)}`;

    const studentData = {
      matricule: generatedMatricule,
      nom: lastName.toUpperCase(),
      prenom: firstName,
      sexe: gender,
      classe_id: className || null,
      annee_scolaire_id: resolvedAnneeScolaireId,
      nom_parent: parentName,
      telephone_parent: parentPhone,
      email_parent: parentEmail || null,
      date_naissance: dateOfBirth || null,
      lieu_naissance: birthPlace || null,
      statut: 'actif',
      etablissement_id: etablissementId
    };

    // createStudent/addPayment passent transparemment par le miroir SQLite
    // local en Electron (src/lib/supabase/client.ts) : plus besoin de
    // brancher sur la connectivité ici, un seul chemin pour web et desktop.
    try {
      const data = await createStudent(studentData, etablissementId!);

      if (data && data.length > 0) {
        const d = data[0];

        let newPaymentObj = null;
        const initialPayVal = Number(initialPayment);
        if (initialPayVal > 0) {
          const reference = `REC-INS-${Date.now()}`;
          const paymentData = {
            eleve_id: d.id,
            montant: initialPayVal,
            date: new Date().toISOString().split('T')[0],
            type_frais: 'Scolarité',
            mode_paiement: 'Espèces',
            statut: 'paid',
            reference: reference,
            etablissement_id: etablissementId
          };

          const payData = await addPayment(paymentData, etablissementId!);
          if (payData && payData.length > 0) {
            const pd = payData[0];
            newPaymentObj = {
              id: pd.id,
              eleveId: pd.eleve_id,
              montant: Number(pd.montant),
              date: pd.date,
              typeFrais: pd.type_frais,
              statut: pd.statut,
              reference: pd.reference,
              modePaiement: pd.mode_paiement
            };
          }
        }

        const newStudent: any = {
          id: d.id,
          matricule: d.matricule,
          prenom: d.prenom,
          nom: d.nom,
          sexe: d.sexe,
          classeId: className,
          nomParent: d.nom_parent,
          telephoneParent: d.telephone_parent,
          emailParent: d.email_parent || 'N/A',
          dateNaissance: d.date_naissance || '2012-01-01',
          lieuNaissance: d.lieu_naissance || 'Yaoundé',
          dateInscription: d.date_inscription,
          anneeScolaireId: d.annee_scolaire_id,
          statut: d.statut,
          paiements: newPaymentObj ? [newPaymentObj] : [],
          notes: []
        };

        setStudents([newStudent, ...students]);
        refreshServerViews();
      }
    } catch (error: any) {
      alert("Erreur lors de la création de l'élève : " + error.message);
      return;
    }

    setFirstName('');
    setLastName('');
    setGender('M');
    if (classesList.length > 0) setClassName(classesList[0].id);
    else setClassName('');
    setParentName('');
    setParentPhone('');
    setParentEmail('');
    setDateOfBirth('');
    setBirthPlace('');
    setMatricule('');
    setInitialPayment('');

    setShowAddModal(false);
    triggerToast(`L'élève ${lastName} ${firstName} a été inscrit avec succès dans Supabase.`);
  };

  const handleReenrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReenrollStudent) {
      alert("Veuillez sélectionner un élève à réinscrire.");
      return;
    }
    if (!reenrollClassId) {
      alert("Veuillez sélectionner la nouvelle classe d'affectation.");
      return;
    }
    const targetYearId = reenrollYearId || academicYearId;
    if (!targetYearId) {
      alert("Veuillez déterminer l'année scolaire de destination.");
      return;
    }
    // La classe choisie doit appartenir à l'année de destination : une classe
    // d'une autre année rendrait l'élève invisible dans sa nouvelle année et
    // gonflerait rétroactivement les effectifs de l'ancienne.
    if (!reenrollClassesList.some(c => c.id === reenrollClassId)) {
      alert("La classe sélectionnée n'appartient pas à l'année scolaire de destination.");
      return;
    }

    const reenrollData = {
      matricule: selectedReenrollStudent.matricule,
      nom: selectedReenrollStudent.nom,
      prenom: selectedReenrollStudent.prenom,
      sexe: selectedReenrollStudent.sexe,
      classe_id: reenrollClassId,
      annee_scolaire_id: targetYearId,
      nom_parent: selectedReenrollStudent.nomParent,
      telephone_parent: selectedReenrollStudent.telephoneParent,
      email_parent: selectedReenrollStudent.emailParent || null,
      date_naissance: selectedReenrollStudent.dateNaissance || null,
      lieu_naissance: selectedReenrollStudent.lieuNaissance || null,
      date_inscription: new Date().toISOString().split('T')[0],
      statut: 'actif',
      etablissement_id: etablissementId
    };

    try {
      const data = await createStudent(reenrollData, etablissementId!);
      if (data && data.length > 0) {
        const d = data[0];
        let newPayObj = null;
        const initPay = Number(reenrollInitialPayment);
        if (initPay > 0) {
          const reference = `REC-REINS-${Date.now()}`;
          const payPayload = {
            eleve_id: d.id,
            montant: initPay,
            date: new Date().toISOString().split('T')[0],
            type_frais: 'Scolarité',
            mode_paiement: 'Espèces',
            statut: 'paid',
            reference: reference,
            etablissement_id: etablissementId
          };
          const payRes = await addPayment(payPayload, etablissementId!);
          if (payRes && payRes.length > 0) {
            const pd = payRes[0];
            newPayObj = {
              id: pd.id,
              eleveId: pd.eleve_id,
              montant: Number(pd.montant),
              date: pd.date,
              typeFrais: pd.type_frais,
              statut: pd.statut,
              reference: pd.reference,
              modePaiement: pd.mode_paiement
            };
          }
        }

        const newStudentObj: any = {
          id: d.id,
          matricule: d.matricule,
          prenom: d.prenom,
          nom: d.nom,
          sexe: d.sexe,
          classeId: reenrollClassId,
          anneeScolaireId: d.annee_scolaire_id,
          nomParent: d.nom_parent,
          telephoneParent: d.telephone_parent,
          emailParent: d.email_parent || 'N/A',
          dateNaissance: d.date_naissance,
          lieuNaissance: d.lieu_naissance,
          dateInscription: d.date_inscription,
          statut: d.statut,
          paiements: newPayObj ? [newPayObj] : [],
          notes: []
        };

        setStudents([newStudentObj, ...students]);
        refreshServerViews();
        setShowReenrollModal(false);
        setSelectedReenrollStudent(null);
        setReenrollInitialPayment('');
        triggerToast(`Réinscription réussie pour ${selectedReenrollStudent.nom} ${selectedReenrollStudent.prenom} (Matricule: ${d.matricule}) !`);
      }
    } catch (err: any) {
      alert("Erreur lors de la réinscription : " + err.message);
    }
  };

  const handleDeleteStudent = async (id: string, name: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (confirm(`Voulez-vous vraiment supprimer l'élève ${name} définitivement ? Cette action supprimera également ses paiements et ses notes.`)) {
      const supabase = createClient();
      // Soft-delete : l'élève et ses paiements/notes/bulletins sont marqués
      // supprimés (récupérables) plutôt que détruits. Ils disparaissent des
      // lectures via la RLS (ou son équivalent local en Electron, cf.
      // src/lib/db/localAggregates.ts).
      const { error } = await supabase.rpc('soft_delete_eleve', { p_id: id });
      if (error) {
        alert("Erreur lors de la suppression: " + error.message);
      } else {
        setStudents(prev => prev.filter(s => s.id !== id));
        refreshServerViews();
        triggerToast("Élève supprimé avec succès !");
      }
    }
  };

  const handleTriggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleExportExcel = async () => {
    if (useServerTable && etablissementId) {
      // Export dédié : boucle sur get_students_paginated (pageSize élevé) au
      // lieu de dépendre de `students` complet, qui n'est plus chargé en
      // entier quand le tableau serveur est disponible. La RPC calcule déjà
      // total_due/total_paid/statut_paiement à partir des vraies données.
      try {
        const EXPORT_PAGE_SIZE = 1000;
        let page = 1;
        let all: StudentPage[] = [];
        let totalCount = Infinity;
        while (all.length < totalCount) {
          const { students: rows, totalCount: tc } = await getStudentsPaginated({
            etablissementId,
            anneeScolaireId: academicYearId || null,
            search: searchTerm,
            classeId: selectedClass === 'All' ? null : selectedClass,
            statutPaiement: selectedPaymentStatus === 'All' ? null : (selectedPaymentStatus as 'paid' | 'partial' | 'unpaid'),
            sexe: selectedGender === 'All' ? null : (selectedGender as 'M' | 'F'),
            page,
            pageSize: EXPORT_PAGE_SIZE,
          });
          all = all.concat(rows);
          totalCount = tc;
          if (rows.length < EXPORT_PAGE_SIZE) break;
          page++;
        }

        const dataToExport = all.map(s => ({
          Matricule: s.matricule,
          Nom: s.nom,
          Prénom: s.prenom,
          Genre: s.sexe,
          Classe: s.classe_nom || classesList.find(c => c.id === s.classe_id)?.nom || s.classe_id,
          'Parent / Tuteur': s.nom_parent,
          Téléphone: s.telephone_parent,
          'Scolarité (FCFA)': s.total_due,
          'Montant Payé': s.total_paid,
          Statut: s.statut_paiement === 'paid' ? 'Payé' : s.statut_paiement === 'partial' ? 'Partiel' : 'Non Payé'
        }));
        downloadExcel(dataToExport, 'Liste_Eleves');
        triggerToast('Export Excel généré avec succès !');
      } catch (err) {
        captureError(err, { context: "Server-backed Excel export failed" });
        alert("Erreur lors de la génération de l'export.");
      }
      return;
    }

    // Repli client (RPC indisponible ou hors-ligne) : utilise la liste
    // complète déjà chargée localement (fetchAllStudentsFallback).
    const dataToExport = filteredStudents.map(s => {
      const { totalDue, totalPaid, status } = getStudentPaymentStats(s);
      return {
        Matricule: s.matricule,
        Nom: s.nom,
        Prénom: s.prenom,
        Genre: s.sexe,
        Classe: classesList.find(c => c.id === s.classeId)?.nom || s.classeId,
        'Parent / Tuteur': s.nomParent,
        Téléphone: s.telephoneParent,
        'Scolarité (FCFA)': totalDue !== null ? totalDue : 'Non configuré',
        'Montant Payé': totalPaid,
        Statut: status === 'paid' ? 'Payé' : status === 'partial' ? 'Partiel' : 'Non Payé'
      };
    });
    downloadExcel(dataToExport, 'Liste_Eleves');
    triggerToast('Export Excel généré avec succès !');
  };

  const handlePrintStudentList = async () => {
    let listToPrint: PrintableStudent[] = [];

    let etabInfo: any = null;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('etablissements')
        .select('nom, adresse, telephone, email, logo_url')
        .eq('id', etablissementId)
        .single();
      if (data) etabInfo = data;
    } catch {
      // ignore
    }

    const currentClassName = selectedClass !== 'All'
      ? classesList.find(c => c.id === selectedClass)?.nom || selectedClass
      : undefined;

    if (useServerTable && etablissementId) {
      try {
        const EXPORT_PAGE_SIZE = 1000;
        let page = 1;
        let all: StudentPage[] = [];
        let totalCount = Infinity;
        while (all.length < totalCount) {
          const { students: rows, totalCount: tc } = await getStudentsPaginated({
            etablissementId,
            anneeScolaireId: academicYearId || null,
            search: searchTerm,
            classeId: selectedClass === 'All' ? null : selectedClass,
            statutPaiement: selectedPaymentStatus === 'All' ? null : (selectedPaymentStatus as 'paid' | 'partial' | 'unpaid'),
            sexe: selectedGender === 'All' ? null : (selectedGender as 'M' | 'F'),
            page,
            pageSize: EXPORT_PAGE_SIZE,
          });
          all = all.concat(rows);
          totalCount = tc;
          if (rows.length < EXPORT_PAGE_SIZE) break;
          page++;
        }

        listToPrint = all.map(s => ({
          id: s.id,
          matricule: s.matricule,
          nom: s.nom,
          prenom: s.prenom,
          sexe: s.sexe,
          classeNom: s.classe_nom || classesList.find(c => c.id === s.classe_id)?.nom || s.classe_id,
          nomParent: s.nom_parent,
          telephoneParent: s.telephone_parent,
          dateNaissance: s.date_naissance,
          lieuNaissance: s.lieu_naissance,
        }));
      } catch (err) {
        captureError(err, { context: "Print list server-backed fetch failed" });
        alert("Erreur lors de la préparation de la liste.");
        return;
      }
    } else {
      listToPrint = filteredStudents.map(s => ({
        id: s.id,
        matricule: s.matricule,
        nom: s.nom,
        prenom: s.prenom,
        sexe: s.sexe,
        classeNom: classesList.find(c => c.id === s.classeId)?.nom || s.classeId,
        nomParent: s.nomParent,
        telephoneParent: s.telephoneParent,
        dateNaissance: s.dateNaissance,
        lieuNaissance: s.lieuNaissance,
      }));
    }

    printStudentList({
      title: currentClassName ? `LISTE OFFICIELLE DES ÉLÈVES — CLASSE : ${currentClassName}` : 'LISTE GÉNÉRALE DES ÉLÈVES',
      subtitle: currentClassName ? undefined : (selectedPaymentStatus !== 'All' ? `Filtre Statut : ${selectedPaymentStatus}` : undefined),
      classeNom: currentClassName,
      schoolName: etabInfo?.nom,
      schoolAddress: etabInfo?.adresse,
      schoolPhone: etabInfo?.telephone,
      schoolEmail: etabInfo?.email,
      schoolLogo: etabInfo?.logo_url,
      academicYear: academicYear || undefined,
      students: listToPrint,
    });
  };

  // Comparaison de nom de classe insensible aux accents et aux espaces
  // internes multiples ("École Maternelle" ~ "Ecole Maternelle",
  // "Terminale  D" ~ "Terminale D") : sans ça, une variante d'orthographe
  // légèrement différente crée une classe quasi-doublon en silence au lieu
  // de réutiliser l'existante. Utilisée à la fois par getOrCreateClass
  // (import hors-ligne) et par le chemin d'import en ligne, pour éviter que
  // les deux divergent comme avant (le hors-ligne ne filtrait pas par année
  // scolaire alors que les classes sont scopées par année).
  const normalizeClassLabel = (s: string): string =>
    (s || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');

  const classNameMatches = (c: Classe, nameStr: string, anneeId: string | null) => {
    const target = normalizeClassLabel(nameStr);
    const nameMatches = normalizeClassLabel(c.nom || '') === target || normalizeClassLabel(c.id || '') === target;
    const cAnneeId = (c as any).annee_scolaire_id || c.anneeScolaireId || null;
    return nameMatches && cAnneeId === (anneeId || null);
  };

  const getOrCreateClass = async (
    classNameStr: string,
    resolvedAnneeScolaireId: string,
    sectionStr: string = 'Francophone',
    localClassesRef?: Classe[]
  ) => {
    const listToSearch = localClassesRef || classesList;
    const existing = listToSearch.find(c => classNameMatches(c, classNameStr, resolvedAnneeScolaireId));
    if (existing) return existing.id;

    const newClassData = {
      nom: classNameStr,
      niveau: classNameStr,
      section: sectionStr,
      // annee_scolaire_id est NOT NULL en base : sans lui, la création d'une
      // classe manquante pendant l'import échouait (en ligne comme hors-ligne).
      annee_scolaire_id: resolvedAnneeScolaireId,
      etablissement_id: etablissementId
    };

    // .from('classes') passe transparemment par le miroir SQLite local en
    // Electron (src/lib/supabase/client.ts) : un seul chemin pour web et
    // desktop, plus de file SyncManager séparée à tenir à jour en parallèle.
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('classes')
        .insert([{ ...newClassData, etablissement_id: etablissementId }])
        .select();

      if (!error && data && data.length > 0) {
        const created = data[0];
        const newClassObj: Classe = {
          id: created.id,
          nom: created.nom,
          niveauId: created.niveau,
          anneeScolaireId: resolvedAnneeScolaireId,
          sectionId: created.section
        };
        if (localClassesRef) {
          localClassesRef.push(newClassObj);
        }
        setClassesList(prev => [...prev, newClassObj]);
        return created.id;
      } else if (error) {
        captureError(error, { context: "Supabase error creating class:" });
      }
    } catch (err) {
      captureError(err, { context: "Error creating class:" });
    }
    return classNameStr;
  };

  const parseImportDate = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'number') {
      try {
        const utc_days = Math.floor(val - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        const year = date_info.getFullYear();
        const month = String(date_info.getMonth() + 1).padStart(2, '0');
        const day = String(date_info.getDate()).padStart(2, '0');
        const formatted = `${year}-${month}-${day}`;
        if (!isNaN(date_info.getTime())) return formatted;
      } catch (e) {
        // ignore
      }
    }
    const str = val.toString().trim();
    if (!str) return null;
    // Le format ISO peut matcher syntaxiquement (ex: "2012-05-32", artefact
    // de formule Excel) sans être une date calendaire réelle. Un jour/mois
    // hors plage envoyé tel quel à Postgres fait échouer tout le lot
    // d'insertion (une seule instruction INSERT multi-lignes) sans qu'aucune
    // ligne ne soit importée, sans message clair pour l'admin. On valide donc
    // que la date construite correspond bien aux composants saisis (Date en
    // JS "roule" silencieusement les jours/mois hors plage vers le mois/l'année
    // suivante au lieu de rejeter).
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      const candidate = new Date(Number(y), Number(m) - 1, Number(d));
      const isValid = candidate.getFullYear() === Number(y)
        && candidate.getMonth() === Number(m) - 1
        && candidate.getDate() === Number(d);
      return isValid ? str : null;
    }
    // Convention JJ/MM/AAAA (saisie manuelle française/camerounaise), à
    // distinguer explicitement du repli générique ci-dessous : `new
    // Date("14/05/2012")` échoue (Invalid Date, jour hors plage MM/JJ) et
    // `new Date("01/12/2012")` est lu comme le 12 janvier (format
    // MM/JJ/AAAA US) au lieu du 1er décembre. Même validation de date
    // calendaire réelle que la branche ISO ci-dessus.
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      const candidate = new Date(Number(y), Number(m) - 1, Number(d));
      const isValid = candidate.getFullYear() === Number(y)
        && candidate.getMonth() === Number(m) - 1
        && candidate.getDate() === Number(d);
      return isValid ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
    }
    const parsedDate = new Date(str);
    if (!isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear();
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const day = String(parsedDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return null;
  };

  // Montants en FCFA (pas de sous-unité) : une saisie manuelle utilise
  // souvent un séparateur de milliers (point, virgule ou espace) —
  // Number("150.000") vaut 150 (division par 1000 silencieuse) et
  // Number("150 000") vaut NaN (paiement entier perdu en silence). On
  // retire donc tout caractère non numérique avant conversion.
  const parseImportAmount = (raw: any): number => {
    if (raw === null || raw === undefined || raw === '') return 0;
    if (typeof raw === 'number') return raw;
    const cleaned = raw.toString().replace(/[^\d-]/g, '');
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isOffline = isElectron && (!navigator.onLine || (typeof window !== 'undefined' && (window as any).__forceOffline));
    const supabase = createClient();

    if (!etablissementId) {
      alert("Erreur : Impossible de déterminer l'établissement actif.");
      return;
    }

    // Année scolaire de repli : utilisée telle quelle en mode hors-ligne. En
    // ligne, elle ne sert plus que de dernier recours — chaque ligne résout
    // ou crée désormais SA PROPRE année scolaire à partir de sa date
    // d'inscription (voir plus bas, après le parsing), au lieu de forcer une
    // seule année pour tout le fichier importé.
    let fallbackAnneeScolaireId = null;

    if (!isOffline) {
      try {
        const { data: etab } = await supabase
          .from('etablissements')
          .select('annee_scolaire_active_id')
          .eq('id', etablissementId)
          .single();
        if (etab?.annee_scolaire_active_id) {
          fallbackAnneeScolaireId = etab.annee_scolaire_active_id;
        }
      } catch (err) {
        captureError(err, { context: "Failed to fetch active year from DB:" });
      }

      if (!fallbackAnneeScolaireId) {
        try {
          const { data: years } = await supabase
            .from('annees_scolaires')
            .select('id')
            .eq('etablissement_id', etablissementId)
            .limit(1);
          if (years && years.length > 0) {
            fallbackAnneeScolaireId = years[0].id;
          }
        } catch (err) {
          captureError(err, { context: "Failed to fetch fallback year from DB:" });
        }
      }
    }

    if (!fallbackAnneeScolaireId && typeof window !== 'undefined') {
      fallbackAnneeScolaireId = localStorage.getItem('mboaschool_active_year_id');
    }
    if (!fallbackAnneeScolaireId && students.length > 0) {
      const studentWithYear = students.find(s => s && s.anneeScolaireId);
      if (studentWithYear) fallbackAnneeScolaireId = studentWithYear.anneeScolaireId;
    }
    if (isOffline && !fallbackAnneeScolaireId) {
      alert("Erreur : Impossible de déterminer l'année scolaire active. Créez d'abord au moins une classe ou une année scolaire.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (!data || data.length === 0) {
          alert("Le fichier Excel est vide ou invalide.");
          return;
        }

        let importedCount = 0;
        let errorsCount = 0;
        let skippedEmptyRows = 0;
        let skippedMissingNameRows = 0;
        let unresolvedClassCount = 0;
        let duplicatePaymentRefCount = 0;
        let firstBatchErrorMessage: string | null = null;

        const supabase = createClient();

        const normalizePaymentMode = (modeStr: string): string => {
          const cleaned = (modeStr || '').toString().toLowerCase().trim();
          if (cleaned.includes('orange')) return 'Orange Money';
          if (cleaned.includes('mtn') || cleaned.includes('momo') || cleaned.includes('mobile')) return 'MTN Mobile Money';
          if (cleaned.includes('virement') || cleaned.includes('banque')) return 'Virement Bancaire';
          return 'Espèces';
        };

        // 1) Parsing pur des lignes (aucun appel réseau ici) — évite de refaire
        // le parsing à chaque étape du traitement en lot ci-dessous.
        interface ParsedImportPayment {
          amount: number;
          date: string;
          mode: string;
          reference: string;
          usedFallbackReference: boolean;
          columnIndex: number | null; // N de "Paiement N - ..." (1-5), null pour l'ancien format à une seule colonne
        }
        interface ParsedImportRow {
          nom: string; prenom: string; sexe: 'M' | 'F'; classNameStr: string; sectionStr: string;
          nomParent: string; telephoneParent: string; emailParent: string;
          dateNaissance: string | null; lieuNaissance: string; dateInscriptionVal: string;
          matriculeVal: string; usedFallbackMatricule: boolean;
          payments: ParsedImportPayment[];
          resolvedAnneeScolaireId: string | null;
        }
        const parsedRows: ParsedImportRow[] = [];
        for (const row of data) {
          const nom = (row.Nom || row.nom || row.NOM || '').toString().trim();
          const prenom = (row.Prénom || row.prenom || row.Prenom || row.PRENOM || '').toString().trim();

          // Skip completely empty rows
          if (!nom && !prenom) { skippedEmptyRows++; continue; }
          // Nom OU prénom manquant (mais pas les deux) : très courant dans les
          // fichiers réels (nom complet mis dans "Nom", "Prénom" laissé vide) —
          // NE PAS rejeter la ligne pour autant (ça a déjà bloqué un import
          // réel de 164 élèves). On importe quand même, en signalant juste le
          // nombre de lignes concernées dans le résumé final, à titre
          // informatif (eleveSchema exige les deux pour la création manuelle,
          // mais l'import doit rester tolérant aux sources de données réelles).
          if (!nom || !prenom) { skippedMissingNameRows++; }

          const sexe = (row.Sexe || row.sexe || row.SEXE || 'M').toString().toUpperCase().trim() === 'F' ? 'F' : 'M';
          const classNameStr = (row.Classe || row.classe || row.CLASSE || 'Non classé').toString().trim();
          const sectionStr = (row.Section || row.section || row.SECTION || 'Francophone').toString().trim();
          const nomParent = (row["Nom Parent"] || row.nom_parent || row.Parent || row.parent || '').toString().trim();
          const telephoneParent = (row["Téléphone Parent"] || row.telephone_parent || row.Tel || row.tel || '').toString().trim();
          const emailParent = (row["Email Parent"] || row.email_parent || row.Email || row.email || '').toString().trim();
          const dateNaissance = parseImportDate(row["Date Naissance"] || row.date_naissance || row.Naissance || row.naissance);
          const lieuNaissance = (row["Lieu Naissance"] || row.lieu_naissance || row.Lieu || row.lieu || '').toString().trim();
          const dateInscriptionVal = parseImportDate(row["Date Inscription"] || row.date_inscription || row.inscription || row.Inscription) || new Date().toISOString().split('T')[0];

          // Generate a deterministic fallback matricule based on name/surname if missing, to prevent duplicates on re-import
          const rawMatricule = row.Matricule || row.matricule || row.MATRICULE || row["N° Matricule"];
          const cleanNom = nom.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cleanPrenom = prenom.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const usedFallbackMatricule = !rawMatricule;
          const fallbackMatricule = `MBOA-${cleanNom}-${cleanPrenom}`.substring(0, 50);
          const matriculeVal = (rawMatricule ? rawMatricule.toString().trim() : fallbackMatricule);

          const payments: ParsedImportPayment[] = [];
          for (let i = 1; i <= 5; i++) {
            const amountKey = `Paiement ${i} - Montant`;
            const dateKey = `Paiement ${i} - Date`;
            const modeKey = `Paiement ${i} - Mode`;
            const refKey = `Paiement ${i} - Référence`;

            const rawAmount = row[amountKey] || row[amountKey.toLowerCase()] || row[`Paiement ${i} - Montant`.normalize('NFD').replace(/[\u0300-\u036f]/g, "")];
            const amount = parseImportAmount(rawAmount);

            if (amount > 0) {
              const rawDate = row[dateKey] || row[dateKey.toLowerCase()] || row[`Paiement ${i} - Date`.normalize('NFD').replace(/[\u0300-\u036f]/g, "")];
              const date = parseImportDate(rawDate) || new Date().toISOString().split('T')[0];

              const rawMode = (row[modeKey] || row[modeKey.toLowerCase()] || 'Espèces').toString().trim();
              const mode = normalizePaymentMode(rawMode);

              const rawRef = row[refKey] || row[refKey.toLowerCase()] || row[`Paiement ${i} - Reference`] || row[`paiement ${i} - reference`];
              const usedFallbackReference = !rawRef;
              const reference = rawRef ? rawRef.toString().trim() : `REC-${matriculeVal}-P${i}`;

              payments.push({ amount, date, mode, reference, usedFallbackReference, columnIndex: i });
            }
          }

          // Backward compatibility for old single payment columns
          if (payments.length === 0) {
            const oldAmount = parseImportAmount(row["Frais Payes"] || row.frais_payes || row["Montant Payé"] || row.montant_paye);
            if (oldAmount > 0) {
              const oldDate = parseImportDate(row["Date Paiement"] || row.date_paiement || row["Date Payment"] || row.date_payment) || new Date().toISOString().split('T')[0];
              const oldMode = normalizePaymentMode(row["Mode Paiement"] || row.mode_paiement || 'Espèces');
              const oldRawRef = row.Reference || row.reference || row.REFERENCE;
              const usedFallbackReference = !oldRawRef;
              const oldRef = oldRawRef ? oldRawRef.toString().trim() : `REC-${matriculeVal}-SCOL`;
              payments.push({ amount: oldAmount, date: oldDate, mode: oldMode, reference: oldRef, usedFallbackReference, columnIndex: 1 });
            }
          }

          parsedRows.push({
            nom, prenom, sexe, classNameStr, sectionStr, nomParent, telephoneParent, emailParent,
            dateNaissance, lieuNaissance, dateInscriptionVal, matriculeVal, usedFallbackMatricule,
            payments, resolvedAnneeScolaireId: null
          });
        }

        if (parsedRows.length === 0) {
          alert("Aucune ligne valide trouvée dans le fichier.");
          return;
        }

        // 1a) Résolution de l'année scolaire PAR LIGNE, à partir de sa date
        // d'inscription : l'année scolaire d'une inscription est TOUJOURS
        // "année-civile-de-l'inscription / année-suivante", quel que soit le
        // mois (une inscription en janvier 2026 vaut 2026-2027, pas
        // 2025-2026) — règle métier confirmée par l'établissement, différente
        // d'un calcul "année scolaire en cours au 1er septembre-30 juin".
        // Un seul aller-retour réseau pour lire les années existantes, un
        // seul pour créer celles qui manquent — pas un aller-retour par
        // ligne du fichier.
        const computeSchoolYearBounds = (dateStr: string) => {
          const [yStr] = dateStr.split('-');
          const startY = Number(yStr);
          const endY = startY + 1;
          return { nom: `${startY}-${endY}`, date_debut: `${startY}-09-01`, date_fin: `${endY}-06-30` };
        };

        {
          // Clé de correspondance = date_debut (format ISO fiable), pas nom
          // (texte libre saisi par l'admin dans Paramètres — "2025/2026",
          // "2025-2026", etc. selon l'établissement, donc pas comparable de
          // façon fiable entre deux calculs indépendants).
          const yearsByStartDate = new Map<string, { id: string; nom: string; date_debut: string; date_fin: string }>();
          try {
            const { data: existingYears } = await supabase
              .from('annees_scolaires')
              .select('id,nom,date_debut,date_fin')
              .eq('etablissement_id', etablissementId);
            (existingYears || []).forEach((y: any) => { if (y.date_debut) yearsByStartDate.set(y.date_debut, y); });
          } catch (err) {
            captureError(err, { context: "Failed to load annees_scolaires for import" });
          }

          const missingYears = new Map<string, { nom: string; date_debut: string; date_fin: string }>();
          for (const r of parsedRows) {
            const bounds = computeSchoolYearBounds(r.dateInscriptionVal);
            if (!yearsByStartDate.has(bounds.date_debut) && !missingYears.has(bounds.date_debut)) {
              missingYears.set(bounds.date_debut, bounds);
            }
          }

          if (missingYears.size > 0) {
            const yearInsertPayload = Array.from(missingYears.values()).map(y => ({ ...y, etablissement_id: etablissementId }));
            const { data: createdYears, error: yearErr } = await supabase
              .from('annees_scolaires')
              .insert(yearInsertPayload)
              .select();
            if (yearErr) {
              captureError(yearErr, { context: "Batch année scolaire creation failed during Excel import" });
            } else {
              (createdYears || []).forEach((y: any) => { if (y.date_debut) yearsByStartDate.set(y.date_debut, y); });
            }
          }

          parsedRows.forEach(r => {
            const bounds = computeSchoolYearBounds(r.dateInscriptionVal);
            const match = yearsByStartDate.get(bounds.date_debut);
            r.resolvedAnneeScolaireId = match ? match.id : fallbackAnneeScolaireId;
          });

          if (parsedRows.some(r => !r.resolvedAnneeScolaireId)) {
            alert("Erreur : Impossible de déterminer ou créer l'année scolaire pour certaines lignes. Vérifiez la configuration de l'établissement.");
            return;
          }
        }

        // 1b) Désambiguïsation des matricules de repli en collision. Sans fichier
        // fournissant de vrai Matricule, plusieurs élèves DISTINCTS partageant le
        // même nom+prénom généraient le même matricule de repli et s'écrasaient
        // silencieusement les uns les autres (perte de données sans aucune erreur
        // remontée) avant même l'envoi réseau. Un seul élève par nom conserve son
        // matricule de repli exact (réimport idempotent inchangé) ; à partir de la
        // 2ᵉ occurrence, un suffixe numérique rend chaque élève distinct.
        let disambiguatedCount = 0;
        {
          const seenFallback = new Map<string, number>();
          for (const r of parsedRows) {
            if (!r.usedFallbackMatricule) continue;
            const occurrence = seenFallback.get(r.matriculeVal) || 0;
            seenFallback.set(r.matriculeVal, occurrence + 1);
            if (occurrence > 0) {
              r.matriculeVal = `${r.matriculeVal}-${occurrence + 1}`;
              // Ne régénère la référence de paiement que si elle était elle-même
              // auto-générée : une référence fournie explicitement par le client
              // ne doit jamais être réécrite.
              r.payments.forEach((p, idx) => {
                if (p.usedFallbackReference) {
                  p.reference = `REC-${r.matriculeVal}-P${idx + 1}`;
                }
              });
              disambiguatedCount++;
            }
          }
        }

        {
          // .from() passe transparemment par le miroir SQLite local en
          // Electron : le chemin par lots ci-dessous (autrefois "mode en
          // ligne" seulement) fonctionne maintenant aussi bien hors-ligne,
          // avec une résolution d'année scolaire par ligne plus précise que
          // l'ancien repli hors-ligne (une seule année pour tout le fichier).
          // (1) résout les classes manquantes en un seul insert,
          // (2) upsert tous les élèves en un seul appel (par lots), (3) upsert tous
          // les paiements initiaux en un seul appel — au lieu d'un aller-retour
          // réseau par ligne du fichier (potentiellement des milliers pour un
          // import de rentrée scolaire).
          const CHUNK_SIZE = 500;
          const chunkArray = <T,>(arr: T[], size: number): T[][] => {
            const out: T[][] = [];
            for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
            return out;
          };

          // Une seule ligne par matricule/reference : préserve le comportement
          // précédent où des lignes en doublon s'écrasaient séquentiellement
          // (upsert), tout en évitant l'erreur Postgres "ON CONFLICT... cannot
          // affect row a second time" si un même matricule/reference apparaît
          // plusieurs fois dans le même lot upsert.
          const studentMap = new Map<string, ParsedImportRow>();
          for (const r of parsedRows) {
            const existing = studentMap.get(r.matriculeVal);
            if (existing) {
              existing.payments.push(...r.payments);
            } else {
              studentMap.set(r.matriculeVal, r);
            }
          }
          const dedupedRows = Array.from(studentMap.values());

          // Re-generate references for fallback payments to ensure unique references (P1, P2...)
          dedupedRows.forEach(r => {
            r.payments.forEach((p, idx) => {
              if (p.usedFallbackReference) {
                p.reference = `REC-${r.matriculeVal}-P${idx + 1}`;
              }
            });
          });

          // Les classes sont scopées par année scolaire (classes.annee_scolaire_id) :
          // une même "Terminale D" doit avoir sa propre ligne classes par année,
          // exactement comme une réinscription crée une nouvelle ligne eleves par
          // année. La clé de correspondance/déduplication inclut donc l'année
          // scolaire résolue de la ligne, pas seulement le nom de la classe.
          const localClasses = [...classesList];
          const classKey = (nameStr: string, anneeId: string | null) => `${normalizeClassLabel(nameStr)}::${anneeId || ''}`;
          const distinctClasses = new Map<string, { classNameStr: string; sectionStr: string; anneeScolaireId: string | null }>();
          dedupedRows.forEach(r => {
            const key = classKey(r.classNameStr, r.resolvedAnneeScolaireId);
            if (!distinctClasses.has(key)) {
              distinctClasses.set(key, { classNameStr: r.classNameStr, sectionStr: r.sectionStr, anneeScolaireId: r.resolvedAnneeScolaireId });
            }
          });

          const missingClasses = Array.from(distinctClasses.entries()).filter(([, v]) =>
            !localClasses.some(c => classNameMatches(c, v.classNameStr, v.anneeScolaireId))
          );

          // Résout/crée les sections référencées par les classes manquantes.
          // La table `sections` existe et sert au calcul de productivité par
          // section en Finance, mais rien ne la peuplait jusqu'ici : les
          // classes n'écrivaient que le nom en texte libre (classes.section),
          // jamais classes.section_id. On peuple les deux désormais.
          const sectionIdByNom = new Map<string, string>();
          if (missingClasses.length > 0) {
            try {
              const { data: existingSections } = await supabase
                .from('sections')
                .select('id,nom')
                .eq('etablissement_id', etablissementId);
              (existingSections || []).forEach((s: any) => sectionIdByNom.set((s.nom || '').toLowerCase().trim(), s.id));
            } catch (err) {
              captureError(err, { context: "Failed to load sections for import" });
            }

            const neededSectionNoms = new Map<string, string>();
            missingClasses.forEach(([, v]) => {
              const key = v.sectionStr.toLowerCase().trim();
              if (!sectionIdByNom.has(key) && !neededSectionNoms.has(key)) neededSectionNoms.set(key, v.sectionStr);
            });

            if (neededSectionNoms.size > 0) {
              const sectionInsertPayload = Array.from(neededSectionNoms.values()).map(nom => ({ nom, etablissement_id: etablissementId }));
              const { data: createdSections, error: sectionErr } = await supabase
                .from('sections')
                .insert(sectionInsertPayload)
                .select();
              if (sectionErr) {
                captureError(sectionErr, { context: "Batch section creation failed during Excel import" });
              } else {
                (createdSections || []).forEach((s: any) => sectionIdByNom.set((s.nom || '').toLowerCase().trim(), s.id));
              }
            }
          }

          if (missingClasses.length > 0) {
            const classInsertPayload = missingClasses.map(([, v]) => ({
              nom: v.classNameStr, niveau: v.classNameStr, section: v.sectionStr,
              section_id: sectionIdByNom.get(v.sectionStr.toLowerCase().trim()) || null,
              etablissement_id: etablissementId, annee_scolaire_id: v.anneeScolaireId
            }));
            const { data: createdClasses, error: classErr } = await supabase
              .from('classes')
              .insert(classInsertPayload)
              .select();
            if (classErr) {
              captureError(classErr, { context: "Batch class creation failed during Excel import" });
            } else if (createdClasses) {
              const newClassObjs: Classe[] = createdClasses.map((c: any) => ({
                id: c.id, nom: c.nom, niveauId: c.niveau, anneeScolaireId: c.annee_scolaire_id, sectionId: c.section
              }));
              localClasses.push(...newClassObjs);
              setClassesList(prev => [...prev, ...newClassObjs]);
            }
          }

          // Ne JAMAIS retomber sur une classe arbitraire (ex: localClasses[0])
          // quand la résolution échoue : ça affecterait silencieusement la
          // ligne à une classe qui n'a rien à voir avec celle du fichier.
          // null (élève sans classe, visible et corrigeable) vaut mieux
          // qu'une mauvaise classe indétectable.
          const resolveClassId = (classNameStr: string, anneeId: string | null): string | null => {
            const found = localClasses.find(c => classNameMatches(c, classNameStr, anneeId));
            if (found) return found.id;
            const target = normalizeClassLabel(classNameStr);
            const anyYearMatch = localClasses.find(c => normalizeClassLabel(c.nom || '') === target);
            if (anyYearMatch) return anyYearMatch.id;
            return null;
          };

          const studentPayload = dedupedRows.map(r => {
            const classeId = resolveClassId(r.classNameStr, r.resolvedAnneeScolaireId);
            if (!classeId) unresolvedClassCount++;
            return {
            matricule: r.matriculeVal,
            nom: r.nom.toUpperCase(),
            prenom: r.prenom,
            sexe: r.sexe,
            classe_id: classeId,
            annee_scolaire_id: r.resolvedAnneeScolaireId,
            nom_parent: r.nomParent,
            telephone_parent: r.telephoneParent,
            email_parent: r.emailParent,
            date_naissance: r.dateNaissance,
            lieu_naissance: r.lieuNaissance,
            date_inscription: r.dateInscriptionVal,
            statut: 'actif',
            etablissement_id: etablissementId
            };
          });

          const createdStudentsByMatricule = new Map<string, any>();
          for (const batch of chunkArray(studentPayload, CHUNK_SIZE)) {
            const { data: createdData, error: createErr } = await supabase
              .from('eleves')
              .upsert(batch, { onConflict: 'etablissement_id,matricule,annee_scolaire_id' })
              .select();
            if (createErr) {
              captureError(createErr, { context: "Batch student upsert failed during Excel import" });
              if (!firstBatchErrorMessage) firstBatchErrorMessage = createErr.message;
              // Repli ligne par ligne : un INSERT multi-lignes est tout ou
              // rien côté Postgres, donc une seule ligne invalide (ex: date
              // hors plage) faisait perdre TOUT le lot de 500. On réessaie
              // chaque ligne individuellement pour ne perdre que les lignes
              // réellement fautives.
              for (const row of batch) {
                const { data: rowData, error: rowErr } = await supabase
                  .from('eleves')
                  .upsert([row], { onConflict: 'etablissement_id,matricule,annee_scolaire_id' })
                  .select();
                if (rowErr) {
                  errorsCount++;
                  continue;
                }
                (rowData || []).forEach((s: any) => createdStudentsByMatricule.set(s.matricule, s));
                importedCount += (rowData || []).length;
              }
              continue;
            }
            (createdData || []).forEach((s: any) => createdStudentsByMatricule.set(s.matricule, s));
            importedCount += (createdData || []).length;
          }

          // Répartit les montants payés d'une ligne (Paiement 1, 2, 3...) en
          // « cascade » : d'abord les frais d'inscription de la classe
          // (classes.frais_inscription, configuré par établissement), puis
          // les tranches de scolarité de cette classe dans leur ordre
          // configuré (tranches_scolarite.ordre). Un paiement du fichier qui
          // dépasse le panier courant est SCINDÉ entre autant de paniers que
          // nécessaire (ex. un versement de 90 000 avec une inscription à
          // 15 000 devient 15 000 d'inscription + 75 000 sur la/les
          // tranche(s) suivante(s)) : chaque morceau devient sa propre ligne
          // `paiements`, avec une référence dérivée (suffixe -S2, -S3...)
          // pour respecter la contrainte d'unicité. Si l'inscription n'est
          // pas configurée pour la classe (0 par défaut), son panier est
          // immédiatement considéré comme rempli et les paiements vont
          // directement aux tranches — dégradation gracieuse, comme pour un
          // paiement ajouté à la main sans tranche. Un seul aller-retour
          // réseau pour toutes les classes concernées par l'import.
          type PaymentBucket = { typeFrais: string; trancheId: string | null; target: number; filled: number };
          const bucketsByClasseId = new Map<string, PaymentBucket[]>();
          try {
            const distinctClasseIds = Array.from(new Set(
              dedupedRows.map(r => createdStudentsByMatricule.get(r.matriculeVal)?.classe_id).filter(Boolean)
            ));
            if (distinctClasseIds.length > 0) {
              const [{ data: classesData }, { data: tranchesData }] = await Promise.all([
                supabase.from('classes').select('id,frais_inscription').in('id', distinctClasseIds),
                supabase
                  .from('tranches_scolarite')
                  .select('id,classe_id,ordre,montant')
                  .eq('etablissement_id', etablissementId)
                  .in('classe_id', distinctClasseIds)
                  .order('ordre', { ascending: true })
              ]);

              const fraisInscriptionByClasse = new Map<string, number>();
              (classesData || []).forEach((c: any) => fraisInscriptionByClasse.set(c.id, Number(c.frais_inscription) || 0));

              const tranchesByClasse = new Map<string, { id: string; montant: number }[]>();
              (tranchesData || []).forEach((t: any) => {
                if (!tranchesByClasse.has(t.classe_id)) tranchesByClasse.set(t.classe_id, []);
                tranchesByClasse.get(t.classe_id)!.push({ id: t.id, montant: Number(t.montant) || 0 });
              });

              for (const classeId of distinctClasseIds) {
                const buckets: PaymentBucket[] = [
                  { typeFrais: 'Inscription', trancheId: null, target: fraisInscriptionByClasse.get(classeId!) || 0, filled: 0 },
                  ...(tranchesByClasse.get(classeId!) || []).map(t => ({
                    typeFrais: 'Scolarité', trancheId: t.id, target: t.montant, filled: 0
                  }))
                ];
                bucketsByClasseId.set(classeId!, buckets);
              }
            }
          } catch (err) {
            captureError(err, { context: "Failed to load frais_inscription/tranches_scolarite for import" });
          }

          type BucketPart = { typeFrais: string; trancheId: string | null; montant: number };
          const assignPaymentBuckets = (classeId: string | undefined, payments: ParsedImportPayment[]) => {
            const buckets = classeId ? bucketsByClasseId.get(classeId) : undefined;
            if (!buckets || buckets.length === 0) {
              return payments.map(p => ({ payment: p, parts: [{ typeFrais: 'Scolarité', trancheId: null as string | null, montant: p.amount }] }));
            }
            let bucketIndex = 0;
            return payments.map(p => {
              let remaining = p.amount;
              const parts: BucketPart[] = [];
              while (remaining > 0) {
                while (bucketIndex < buckets.length - 1 && buckets[bucketIndex].filled >= buckets[bucketIndex].target) {
                  bucketIndex++;
                }
                const bucket = buckets[bucketIndex];
                const isLastBucket = bucketIndex === buckets.length - 1;
                const take = isLastBucket ? remaining : Math.min(remaining, bucket.target - bucket.filled);
                bucket.filled += take;
                remaining -= take;
                parts.push({ typeFrais: bucket.typeFrais, trancheId: bucket.trancheId, montant: take });
              }
              return { payment: p, parts };
            });
          };

          // `paiements` a une contrainte UNIQUE (etablissement_id, reference) :
          // deux élèves différents ne peuvent physiquement pas partager la
          // même référence. Si le fichier en contient une (saisie manuelle
          // coïncidente), on le signale explicitement au lieu de laisser l'un
          // écraser l'autre en silence dans ce Map (et potentiellement, sans
          // ce contrôle, dans un upsert qui écraserait le paiement du premier
          // élève par celui du second au niveau de la base).
          const paymentPayload = new Map<string, any>();
          const paymentRefOwner = new Map<string, string>();
          dedupedRows.forEach(r => {
            if (!createdStudentsByMatricule.has(r.matriculeVal)) return;
            const s = createdStudentsByMatricule.get(r.matriculeVal);
            const assigned = assignPaymentBuckets(s.classe_id, r.payments);
            assigned.forEach(({ payment: p, parts }) => {
              const existingOwner = paymentRefOwner.get(p.reference);
              if (existingOwner && existingOwner !== s.id) {
                duplicatePaymentRefCount++;
                return;
              }
              paymentRefOwner.set(p.reference, s.id);
              parts.forEach((part, idx) => {
                // Un même versement scindé sur plusieurs paniers devient
                // plusieurs lignes : la première garde la référence saisie,
                // les suivantes reçoivent un suffixe pour rester uniques.
                const reference = idx === 0 ? p.reference : `${p.reference}-S${idx + 1}`;
                paymentPayload.set(reference, {
                  eleve_id: s.id,
                  montant: part.montant,
                  date: p.date,
                  type_frais: part.typeFrais,
                  mode_paiement: p.mode,
                  statut: 'paid',
                  reference,
                  etablissement_id: etablissementId,
                  tranche_id: part.trancheId
                });
              });
            });
          });

          const paymentsByEleveId = new Map<string, any[]>();
          for (const batch of chunkArray(Array.from(paymentPayload.values()), CHUNK_SIZE)) {
            const { data: payCreated, error: payErr } = await supabase
              .from('paiements')
              .upsert(batch, { onConflict: 'etablissement_id,reference' })
              .select();
            const applyPaymentResults = (rows: any[]) => {
              rows.forEach((p: any) => {
                const list = paymentsByEleveId.get(p.eleve_id) || [];
                list.push({
                  id: p.id, eleveId: p.eleve_id, montant: Number(p.montant), date: p.date,
                  typeFrais: p.type_frais, modePaiement: p.mode_paiement, statut: p.statut, reference: p.reference,
                  trancheId: p.tranche_id || undefined
                });
                paymentsByEleveId.set(p.eleve_id, list);
              });
            };
            if (payErr) {
              captureError(payErr, { context: "Batch payment upsert failed during Excel import" });
              if (!firstBatchErrorMessage) firstBatchErrorMessage = payErr.message;
              // Même repli ligne par ligne que pour les élèves : un seul
              // paiement invalide ne doit pas faire perdre tout le lot.
              for (const row of batch) {
                const { data: rowData, error: rowErr } = await supabase
                  .from('paiements')
                  .upsert([row], { onConflict: 'etablissement_id,reference' })
                  .select();
                if (rowErr) continue;
                applyPaymentResults(rowData || []);
              }
              continue;
            }
            applyPaymentResults(payCreated || []);
          }

          setStudents(prev => {
            let next = [...prev];
            createdStudentsByMatricule.forEach((createdStudent: any) => {
              const finalStudentObj: any = {
                id: createdStudent.id,
                matricule: createdStudent.matricule || '',
                nom: createdStudent.nom || '',
                prenom: createdStudent.prenom || '',
                sexe: createdStudent.sexe || 'M',
                classeId: createdStudent.classe_id,
                nomParent: createdStudent.nom_parent || '',
                telephoneParent: createdStudent.telephone_parent || '',
                emailParent: createdStudent.email_parent || '',
                dateNaissance: createdStudent.date_naissance || '',
                lieuNaissance: createdStudent.lieu_naissance || '',
                dateInscription: createdStudent.date_inscription,
                anneeScolaireId: createdStudent.annee_scolaire_id || fallbackAnneeScolaireId,
                statut: createdStudent.statut || 'actif',
                paiements: paymentsByEleveId.get(createdStudent.id) || [],
                notes: []
              };
              const existingIndex = next.findIndex(s => s.id === finalStudentObj.id);
              if (existingIndex > -1) {
                const existingStudent = next[existingIndex];
                const mergedPaiements = [...(existingStudent.paiements || [])];
                (finalStudentObj.paiements || []).forEach((newPay: any) => {
                  const payIndex = mergedPaiements.findIndex(p => p.id === newPay.id || p.reference === newPay.reference);
                  if (payIndex > -1) mergedPaiements[payIndex] = newPay; else mergedPaiements.push(newPay);
                });
                const copy = [...next];
                copy[existingIndex] = { ...finalStudentObj, paiements: mergedPaiements, notes: existingStudent.notes || [] };
                next = copy;
              } else {
                next = [finalStudentObj, ...next];
              }
            });
            return next;
          });
        }

        if (importedCount > 0) refreshServerViews();
        const notes: string[] = [];
        if (skippedEmptyRows > 0) notes.push(`${skippedEmptyRows} ligne(s) vide(s) ignorée(s)`);
        if (skippedMissingNameRows > 0) notes.push(`${skippedMissingNameRows} élève(s) importé(s) avec nom ou prénom vide`);
        if (disambiguatedCount > 0) notes.push(`${disambiguatedCount} élève(s) sans matricule partageaient un nom identique et ont reçu un identifiant distinct`);
        if (unresolvedClassCount > 0) notes.push(`⚠️ ${unresolvedClassCount} élève(s) importé(s) SANS classe (échec de création/résolution — à réaffecter manuellement)`);
        if (duplicatePaymentRefCount > 0) notes.push(`⚠️ ${duplicatePaymentRefCount} paiement(s) ignoré(s) (référence déjà utilisée par un autre élève du fichier)`);
        if (errorsCount > 0) notes.push(`${errorsCount} ligne(s) en erreur${firstBatchErrorMessage ? ` : ${firstBatchErrorMessage}` : ''}`);
        const suffix = notes.length > 0 ? ` (${notes.join(' · ')})` : '';
        triggerToast(`Importation réussie : ${importedCount} élèves importés.${suffix}`);
      } catch (err) {
        captureError(err, { context: "Error parsing excel:" });
        alert("Erreur lors de l'analyse du fichier Excel.");
      }
    };
    reader.onerror = () => {
      captureError(reader.error, { context: "FileReader error during Excel import" });
      alert("Impossible de lire le fichier sélectionné. Réessayez ou choisissez un autre fichier.");
    };
    reader.readAsBinaryString(file);
    if (e.target) e.target.value = '';
  };

  const downloadTemplate = () => {
    const headers = [
      {
        Matricule: '26YAE001',
        Nom: 'FOUDA',
        Prénom: 'Jean',
        Sexe: 'M',
        Classe: 'Terminale D',
        Section: 'Francophone',
        'Date Inscription': '2026-09-01',
        'Date Naissance': '2012-05-14',
        'Lieu Naissance': 'Yaoundé',
        'Nom Parent': 'Emmanuel Fouda',
        'Téléphone Parent': '+237 677 88 99 00',
        'Email Parent': 'parent.fouda@gmail.com',
        'Paiement 1 - Montant': 150000,
        'Paiement 1 - Date': '2026-09-01',
        'Paiement 1 - Mode': 'Espèces',
        'Paiement 1 - Référence': 'REC-INS-001',
        'Paiement 2 - Montant': 75000,
        'Paiement 2 - Date': '2026-11-15',
        'Paiement 2 - Mode': 'MTN Mobile Money',
        'Paiement 2 - Référence': 'REC-SCOL-002',
        'Paiement 3 - Montant': 50000,
        'Paiement 3 - Date': '2027-02-05',
        'Paiement 3 - Mode': 'Virement Bancaire',
        'Paiement 3 - Référence': 'REC-SCOL-003'
      }
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "Gabarit");
    XLSX.writeFile(wb, "gabarit_importation_eleves.xlsx");
    triggerToast("Gabarit d'importation Excel téléchargé !");
  };

  const formatFCFA = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' F';
  };

  const effectiveWidgetStats = serverWidgetStats ?? widgetStats;

  return (
    <div className="flex flex-col gap-6">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3.5 rounded-control shadow-login z-50 flex items-center gap-3 animate-fade-up">
          <div className="w-5 h-5 rounded-full bg-green flex items-center justify-center text-xs font-bold text-cream">✓</div>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[32px] lg:text-[40px] font-extrabold text-ink tracking-[-1.5px]">Liste des élèves</h1>
          <p className="text-[15px] text-ink-soft font-medium mt-2">
            Gérez les fiches, filtrez par statut de scolarité ou niveau académique.
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {/* Champ fichier caché pour l'import Excel */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportExcel}
            accept=".xlsx, .xls"
            className="hidden"
          />
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
          >
            Gabarit
          </button>
          <button
            onClick={handleTriggerFileInput}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
          >
            Importer
          </button>
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
          >
            <DownloadIcon size={14} />
            Exporter
          </button>
          <button
            onClick={handlePrintStudentList}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
            title="Imprimer la liste officielle des élèves"
          >
            🖨️ Imprimer la liste
          </button>
          <Link
            href="/finance/rapport-tranches"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
          >
            📊 Rapport Tranches
          </Link>
          <button
            onClick={() => setShowReenrollModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-chip hover:bg-chip-hover text-ink text-[13px] font-extrabold rounded-control transition-colors cursor-pointer border border-border"
          >
            🔄 Réinscrire un élève
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent-hover text-cream text-sm font-extrabold rounded-control shadow-cta transition-colors cursor-pointer"
          >
            <PlusIcon size={14} />
            Inscrire un élève
          </button>
        </div>
      </div>

      {/* Cartes statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-surface border border-border p-6 rounded-card">
          <span className="text-[13px] font-bold text-ink-soft block">Effectif total</span>
          <span className="text-[38px] font-extrabold text-ink tracking-[-1.5px] mt-2 block">{effectiveWidgetStats.total}</span>
        </div>
        <div className="bg-surface border border-border p-6 rounded-card">
          <span className="text-[13px] font-bold text-ink-soft block">Scolarité réglée</span>
          <span className="text-[38px] font-extrabold text-green tracking-[-1.5px] mt-2 block">{effectiveWidgetStats.paidCount}</span>
        </div>
        <div className="bg-surface border border-border p-6 rounded-card">
          <span className="text-[13px] font-bold text-ink-soft block">Tranche partielle</span>
          <span className="text-[38px] font-extrabold text-ink tracking-[-1.5px] mt-2 block">{effectiveWidgetStats.partialCount + (effectiveWidgetStats.lateCount ?? 0)}</span>
        </div>
        <div className="bg-surface border border-border p-6 rounded-card">
          <span className="text-[13px] font-bold text-ink-soft block">Non payé / attente</span>
          <span className="text-[38px] font-extrabold text-accent tracking-[-1.5px] mt-2 block">{effectiveWidgetStats.unpaidCount}</span>
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="bg-surface rounded-card border border-border px-6 py-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Recherche */}
          <div className="relative w-full lg:w-96">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-ink-faint pointer-events-none">
              <SearchIcon size={16} />
            </span>
            <input
              type="text"
              placeholder="Rechercher par nom ou matricule…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 border border-border rounded-control text-sm bg-bg text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
            />
          </div>

          {/* Filtres rapides */}
          <div className="flex flex-wrap gap-2.5 w-full lg:w-auto items-center justify-end">
            <select
              value={selectedClass}
              onChange={(e) => {
                setSelectedClass(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full sm:w-auto bg-bg border border-border px-3.5 py-2.5 rounded-control text-[13px] font-bold text-ink-soft outline-none focus:border-accent cursor-pointer"
            >
              <option value="All">Toutes les classes</option>
              {classesOfActiveYear.map(c => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>

            <select
              value={selectedPaymentStatus}
              onChange={(e) => {
                setSelectedPaymentStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full sm:w-auto bg-bg border border-border px-3.5 py-2.5 rounded-control text-[13px] font-bold text-ink-soft outline-none focus:border-accent cursor-pointer"
            >
              <option value="All">Tous les statuts</option>
              <option value="paid">Payé</option>
              <option value="partial">Partiel</option>
              <option value="late">En retard</option>
              <option value="unpaid">Non payé</option>
            </select>

            <select
              value={selectedGender}
              onChange={(e) => {
                setSelectedGender(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full sm:w-auto bg-bg border border-border px-3.5 py-2.5 rounded-control text-[13px] font-bold text-ink-soft outline-none focus:border-accent cursor-pointer"
            >
              <option value="All">Tous</option>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tableau des élèves */}
      <div className="bg-surface rounded-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-bold text-ink-faint uppercase tracking-[1px] bg-bg">
                <th className="px-6 py-3.5">Élève</th>
                <th className="px-4 py-3.5">Matricule</th>
                <th className="px-4 py-3.5">Classe</th>
                <th className="px-4 py-3.5 text-center">Genre</th>
                <th className="px-4 py-3.5">Scolarité (FCFA)</th>
                <th className="px-4 py-3.5">Statut</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {(useServerTable || isLoaded) && displayRows.length > 0 ? (
                displayRows.map((student) => {
                  const { totalDue, totalPaid, status } = student.precomputedStats!;
                  const progressPct = totalDue !== null && totalDue > 0 ? (totalPaid / totalDue) * 100 : 0;

                  return (
                    <tr key={student.id} className="border-t border-border-row hover:bg-row-hover transition-colors">
                      {/* Nom */}
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-[38px] h-[38px] rounded-[12px] bg-chip text-ink-soft font-extrabold text-xs flex items-center justify-center shrink-0">
                            {(student.prenom || '')[0] || ''}{(student.nom || '')[0] || ''}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-ink block truncate">
                              {student.nom} {student.prenom}
                            </span>
                            <span className="text-[11px] text-ink-faint block truncate">Parent : {student.nomParent}</span>
                          </div>
                        </div>
                      </td>

                      {/* Matricule */}
                      <td className="px-4 py-3.5 text-[13px] font-semibold text-ink-faint">
                        {student.matricule}
                      </td>

                      {/* Classe */}
                      <td className="px-4 py-3.5 text-ink-soft font-semibold">
                        {student.classeNomOverride || classesList.find(c => c.id === student.classeId)?.nom || student.classeId}
                      </td>

                      {/* Genre */}
                      <td className="px-4 py-3.5 text-center text-[13px] font-bold text-ink-soft">
                        {student.sexe}
                      </td>

                      {/* Barre de scolarité */}
                      <td className="px-4 py-3.5">
                        <div className="w-48">
                          <div className="text-[12px] font-semibold text-ink-soft mb-1.5 flex justify-between">
                            <span>{formatFCFA(totalPaid)} / {totalDue !== null ? formatFCFA(totalDue) : 'Non configuré'}</span>
                            {student.precomputedStats?.resteAPayerEchu !== undefined && student.precomputedStats.resteAPayerEchu > 0 && (
                              <span className="text-accent text-[10px] font-bold">Arriéré: {formatFCFA(student.precomputedStats.resteAPayerEchu)}</span>
                            )}
                          </div>
                          <div className="w-full bg-chip h-2 rounded-pill overflow-hidden">
                            <div
                              className="h-full rounded-pill transition-all duration-300"
                              style={{
                                width: `${progressPct}%`,
                                background: status === 'paid' ? 'var(--color-green)' : status === 'partial' ? 'var(--color-ink)' : status === 'late' ? 'var(--color-warning)' : 'var(--color-accent)',
                              }}
                            ></div>
                          </div>
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-3 py-1 rounded-pill text-[12px] font-extrabold ${
                          status === 'paid'
                            ? 'bg-green-bg text-green'
                            : status === 'late'
                            ? 'bg-warning/10 text-warning-dark'
                            : status === 'partial'
                            ? 'bg-chip text-ink-soft'
                            : 'bg-red-bg text-accent'
                        }`}>
                          {status === 'paid' ? 'Payé' : status === 'late' ? 'En retard' : status === 'partial' ? 'Partiel' : 'Non payé'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <Link
                            href={`/eleves/${student.id}`}
                            className="text-[13px] font-bold text-accent hover:text-accent-hover transition-colors"
                          >
                            Voir fiche →
                          </Link>
                          <button
                            onClick={(e) => handleDeleteStudent(student.id, `${student.nom} ${student.prenom}`, e)}
                            className="inline-flex items-center justify-center p-1.5 border border-outline hover:border-accent text-ink-faint hover:text-accent rounded-control transition-colors cursor-pointer"
                            title="Supprimer l'élève"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-ink-faint text-sm">
                    {(useServerTable || isLoaded) ? "Aucun élève ne correspond aux critères de recherche." : "Chargement des élèves…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-border-row flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[13px] text-ink-faint font-medium">
            <span>Afficher</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-bg border border-border px-2 py-1 rounded-control outline-none focus:border-accent text-ink font-semibold"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
            <span>lignes</span>
            <span className="ml-2 font-semibold text-ink-soft">
              {totalItems > 0 ? (activePage - 1) * pageSize + 1 : 0} - {Math.min(activePage * pageSize, totalItems)} sur {totalItems} élèves
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handlePageChange(activePage - 1)}
              disabled={activePage === 1}
              className={`p-2 rounded-control border transition-colors ${
                activePage === 1 ? 'opacity-40 cursor-not-allowed border-outline text-ink-faint' : 'border-outline text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              <ChevronLeftIcon size={16} />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`w-9 h-9 rounded-control text-[13px] font-bold border transition-colors ${
                  activePage === page
                    ? 'bg-ink border-ink text-cream'
                    : 'border-outline text-ink-soft hover:border-ink hover:text-ink'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => handlePageChange(activePage + 1)}
              disabled={activePage === totalPages}
              className={`p-2 rounded-control border transition-colors ${
                activePage === totalPages ? 'opacity-40 cursor-not-allowed border-outline text-ink-faint' : 'border-outline text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal : inscription d'un élève */}
      {showAddModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-up">
          <div className="bg-surface rounded-card-lg w-full max-w-lg border border-border shadow-login p-7 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-control text-ink-faint hover:text-ink hover:bg-chip transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-extrabold text-ink tracking-[-0.5px] border-b border-border-row pb-3 mb-5">
              Inscrire un nouvel élève
            </h3>

            <form onSubmit={handleAddStudent} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Nom *</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                    placeholder="ex: Fouda"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Prénom *</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                    placeholder="ex: Jean-Pierre"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Genre</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'M' | 'F')}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm font-semibold text-ink outline-none focus:border-accent focus:bg-surface transition-colors cursor-pointer"
                  >
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Classe *</label>
                  <select
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm font-semibold text-ink outline-none focus:border-accent focus:bg-surface transition-colors cursor-pointer"
                  >
                    {classesOfActiveYear.length === 0 && <option value="">Aucune classe disponible</option>}
                    {classesOfActiveYear.map(c => (
                      <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Matricule (vide = auto-généré)</label>
                  <input
                    type="text"
                    value={matricule}
                    onChange={(e) => setMatricule(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                    placeholder="ex: 26YAE011"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Date de naissance</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink outline-none focus:border-accent focus:bg-surface transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5">Lieu de naissance</label>
                <input
                  type="text"
                  value={birthPlace}
                  onChange={(e) => setBirthPlace(e.target.value)}
                  className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                  placeholder="ex: Yaoundé"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5">Montant payé à l&apos;inscription (FCFA)</label>
                <input
                  type="number"
                  value={initialPayment}
                  onChange={(e) => setInitialPayment(e.target.value)}
                  className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                  placeholder="ex: 150000"
                  min="0"
                />
              </div>

              <div className="border-t border-border-row pt-4">
                <span className="text-xs font-extrabold text-ink-faint uppercase tracking-[1px] block mb-3">Responsable légal (parent)</span>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-ink-soft mb-1.5">Nom complet du parent *</label>
                    <input
                      type="text"
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                      className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                      placeholder="ex: Emmanuel Fouda"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-ink-soft mb-1.5">Téléphone *</label>
                      <input
                        type="text"
                        value={parentPhone}
                        onChange={(e) => setParentPhone(e.target.value)}
                        className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                        placeholder="ex: +237 677 88 99 00"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-ink-soft mb-1.5">Email du parent</label>
                      <input
                        type="email"
                        value={parentEmail}
                        onChange={(e) => setParentEmail(e.target.value)}
                        className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface transition-colors"
                        placeholder="ex: parent.fouda@gmail.com"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border-row">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2.5 border border-outline text-ink-soft hover:border-ink hover:text-ink rounded-control text-[13px] font-bold transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-cream rounded-control text-[13px] font-extrabold shadow-cta transition-colors"
                >
                  Inscrire
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Réinscription d'un Élève Existant */}
      {showReenrollModal && (
        <div className="fixed inset-0 bg-ink/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-up">
          <div className="bg-surface rounded-card border border-border max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto shadow-login">
            <div className="flex justify-between items-start mb-5 pb-3 border-b border-border">
              <div>
                <h3 className="text-xl font-extrabold text-ink">🔄 Réinscrire un élève de l&apos;année précédente</h3>
                <p className="text-xs text-ink-soft mt-1">Le matricule et l&apos;état civil sont conservés intacts d&apos;une année sur l&apos;autre.</p>
              </div>
              <button
                onClick={() => {
                  setShowReenrollModal(false);
                  setSelectedReenrollStudent(null);
                  setReenrollSearch('');
                }}
                className="text-ink-faint hover:text-ink text-xl font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleReenrollStudent} className="space-y-4">
              {/* Recherche de l'élève existant */}
              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5">Rechercher l&apos;élève dans la base de l&apos;école *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={reenrollSearch}
                    onChange={(e) => setReenrollSearch(e.target.value)}
                    placeholder="Tapez le nom, prénom ou matricule..."
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink outline-none focus:border-accent"
                  />
                  {reenrollSearch && !selectedReenrollStudent && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded-control shadow-lg max-h-48 overflow-y-auto z-50">
                      {reenrollCandidates.length === 0 && (
                        <div className="px-4 py-2.5 text-xs text-ink-faint italic">
                          Aucun élève trouvé pour « {reenrollSearch} ».
                        </div>
                      )}
                      {reenrollCandidates
                        .map((s) => (
                          <div
                            key={s.id}
                            onClick={() => {
                              setSelectedReenrollStudent(s);
                              setReenrollSearch(`${s.nom} ${s.prenom} (${s.matricule})`);
                            }}
                            className="px-4 py-2.5 hover:bg-chip cursor-pointer border-b border-border-row last:border-b-0 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-bold text-sm text-ink">{s.nom} {s.prenom}</span>
                              <span className="text-xs text-ink-soft block">Parent : {s.nomParent || 'N/A'}</span>
                            </div>
                            <span className="text-xs font-mono font-bold text-ink-faint bg-bg px-2 py-1 rounded">
                              {s.matricule}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Fiche d'état civil (lecture seule quand sélectionné) */}
              {selectedReenrollStudent ? (
                <div className="bg-bg p-4 rounded-control border border-border space-y-3">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-xs font-extrabold text-ink uppercase tracking-wider">Fiche Élève (Éléments Inchangés)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReenrollStudent(null);
                        setReenrollSearch('');
                      }}
                      className="text-[11px] text-accent font-bold hover:underline"
                    >
                      Changer d&apos;élève
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-ink-faint block">Matricule :</span>
                      <span className="font-mono font-bold text-ink">{selectedReenrollStudent.matricule}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Nom & Prénom :</span>
                      <span className="font-bold text-ink">{selectedReenrollStudent.nom} {selectedReenrollStudent.prenom}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Genre :</span>
                      <span className="font-bold text-ink">{selectedReenrollStudent.sexe === 'M' ? 'Masculin' : 'Féminin'}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Né(e) le :</span>
                      <span className="font-semibold text-ink">{selectedReenrollStudent.dateNaissance || 'Non renseigné'} à {selectedReenrollStudent.lieuNaissance || '—'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-ink-faint block">Parent / Tuteur :</span>
                      <span className="font-semibold text-ink">{selectedReenrollStudent.nomParent || 'N/A'} ({selectedReenrollStudent.telephoneParent || 'N/A'})</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-bg border border-dashed border-border rounded-control text-center text-xs text-ink-faint italic">
                  Sélectionnez un élève ci-dessus pour afficher sa fiche d&apos;état civil verrouillée.
                </div>
              )}

              {/* Choix de la nouvelle classe et de l'année scolaire */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Nouvelle Classe *</label>
                  <select
                    value={reenrollClassId}
                    onChange={(e) => setReenrollClassId(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink outline-none focus:border-accent font-semibold"
                    required
                  >
                    <option value="">Sélectionner une classe</option>
                    {reenrollClassesList.map((c) => (
                      <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                  </select>
                  {reenrollYearId && reenrollClassesList.length === 0 && (
                    <p className="text-[11px] text-accent font-semibold mt-1.5">
                      Aucune classe n&apos;existe pour cette année scolaire. Créez d&apos;abord les classes de l&apos;année de destination.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink-soft mb-1.5">Année Scolaire de Destination *</label>
                  <select
                    value={reenrollYearId}
                    onChange={(e) => setReenrollYearId(e.target.value)}
                    className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink outline-none focus:border-accent font-semibold"
                    required
                  >
                    {availableYears.map((y) => (
                      <option key={y.id} value={y.id}>Année {y.nom}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5">Montant payé à la réinscription (FCFA)</label>
                <input
                  type="number"
                  value={reenrollInitialPayment}
                  onChange={(e) => setReenrollInitialPayment(e.target.value)}
                  className="w-full box-border px-3.5 py-2.5 bg-bg border border-border rounded-control text-sm text-ink outline-none focus:border-accent"
                  placeholder="ex: 50000 (Optionnel)"
                  min="0"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-border-row">
                <button
                  type="button"
                  onClick={() => {
                    setShowReenrollModal(false);
                    setSelectedReenrollStudent(null);
                    setReenrollSearch('');
                  }}
                  className="flex-1 px-4 py-2.5 border border-outline text-ink-soft hover:border-ink hover:text-ink rounded-control text-[13px] font-bold transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!selectedReenrollStudent}
                  className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-cream rounded-control text-[13px] font-extrabold shadow-cta transition-colors cursor-pointer"
                >
                  Valider la Réinscription
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
