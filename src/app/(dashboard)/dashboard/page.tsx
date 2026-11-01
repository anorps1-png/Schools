'use client';
import { captureError, captureMessage } from '@/lib/observability/logger';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Eleve, Classe } from '@/types/domain';
import { getDashboardData, getDashboardStats, type DashboardStats } from '@/lib/queries/dashboard';
import { downloadExcel } from '@/lib/excel';
import { DownloadIcon, SearchIcon } from '@/components/icons';
import { useEtablissement } from '@/contexts/etablissement-context';
import { createClient } from '@/lib/supabase/client';
import { printSubventionnesList, type PrintableSubventionneStudent } from '@/lib/print/printStudentList';

export default function Dashboard() {
  const { etablissementId, academicYearId, academicYear } = useEtablissement();
  const [students, setStudents] = useState<Eleve[]>([]);
  const [classesList, setClassesList] = useState<Classe[]>([]);
  const [teachersList, setTeachersList] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [serverStats, setServerStats] = useState<DashboardStats | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Date range filter states
  const [dateFilterType, setDateFilterType] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Modale interactive : Liste des élèves subventionnés
  const [showSubventionnesModal, setShowSubventionnesModal] = useState(false);
  const [subventionSearch, setSubventionSearch] = useState('');
  const [subventionClasseFilter, setSubventionClasseFilter] = useState('All');
  const [subventionStatutFilter, setSubventionStatutFilter] = useState('All');
  const [isPrintingSubventionnes, setIsPrintingSubventionnes] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && etablissementId) {
      const fetchData = async () => {
        try {
          // Indicateurs globaux calculés en base (agrégats SQL) en parallèle
          // du chargement détaillé nécessaire aux vues filtrées par date.
          const [{ classes, students: studentsData, teachers }, stats] = await Promise.all([
            getDashboardData(etablissementId, academicYearId || null),
            getDashboardStats(etablissementId, academicYearId || null).catch((e) => {
              captureError(e, { context: 'Dashboard stats RPC error:' });
              return null;
            }),
          ]);
          setClassesList((classes || []) as unknown as Classe[]);
          setTeachersList(teachers);
          setServerStats(stats);

          const mappedStudents = studentsData.map((d: any) => ({
            id: d.id,
            matricule: d.matricule,
            nom: d.nom,
            prenom: d.prenom,
            sexe: d.sexe,
            classeId: d.classe_id,
            statut: d.statut,
            estSubventionne: Boolean(d.est_subventionne),
            est_subventionne: Boolean(d.est_subventionne),
            nomParent: d.nom_parent || '',
            telephoneParent: d.telephone_parent || '',
            dateInscription: d.date_inscription ? d.date_inscription.split('T')[0] : '',
            paiements: d.paiements?.map((p: any) => ({
              id: p.id,
              eleveId: p.eleve_id,
              montant: Number(p.montant),
              date: p.date,
              typeFrais: p.type_frais,
              statut: p.statut,
              reference: p.reference,
              modePaiement: p.mode_paiement
            })) || []
          }));
          setStudents(mappedStudents as any);

          // Build transactions list from all payments
          const allTx: any[] = [];
          studentsData.forEach((student: any) => {
            if (student.paiements) {
              student.paiements.forEach((p: any) => {
                const classObj = classes.find(c => c.id === student.classe_id);
                allTx.push({
                  id: p.id,
                  eleveId: student.id,
                  nomEleve: `${student.nom} ${student.prenom}`,
                  matriculeEleve: student.matricule,
                  classeId: student.classe_id,
                  classeNom: classObj?.nom || student.classe_id,
                  montant: Number(p.montant),
                  date: p.date,
                  typeFrais: p.type_frais,
                  modePaiement: p.mode_paiement,
                  statut: p.statut,
                  reference: p.reference
                });
              });
            }
          });
          setTransactions(allTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        } catch (error) {
          captureError(error, { context: "Dashboard fetch error:" });
        } finally {
          setIsLoaded(true);
        }
      };

      fetchData();
    }
  }, [etablissementId, academicYearId]);

  // Helper to parse dates locally without timezone shift issues (noon normalization)
  const parseLocalDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const cleanStr = dateStr.split('T')[0];
    const parts = cleanStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day, 12, 0, 0, 0);
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  };

  // Helper to get start and end boundaries for the current local timezone
  const getDateRange = (type: string, start: string, end: string) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    switch (type) {
      case 'today':
        return { start: startOfToday, end: endOfToday };
      case 'week': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
        return { start: monday, end: endOfToday };
      }
      case 'month': {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        return { start: startOfMonth, end: endOfToday };
      }
      case 'quarter': {
        const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
        const startOfQuarter = new Date(now.getFullYear(), currentQuarterMonth, 1, 0, 0, 0, 0);
        return { start: startOfQuarter, end: endOfToday };
      }
      case 'year': {
        const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        return { start: startOfYear, end: endOfToday };
      }
      case 'custom': {
        let startDate = new Date(0);
        if (start) {
          const parts = start.split('-');
          startDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
        }
        let endDate = new Date(9999, 11, 31, 23, 59, 59, 999);
        if (end) {
          const parts = end.split('-');
          endDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 23, 59, 59, 999);
        }
        return { start: startDate, end: endDate };
      }
      case 'all':
      default:
        return { start: new Date(0), end: new Date(9999, 11, 31, 23, 59, 59, 999) };
    }
  };

  const dateRange = useMemo(() => {
    return getDateRange(dateFilterType, customStartDate, customEndDate);
  }, [dateFilterType, customStartDate, customEndDate]);

  // Filtered students (registrations) during the period
  const filteredStudentsForExpected = useMemo(() => {
    if (dateFilterType === 'all') {
      return students;
    }
    return students.filter(s => {
      const d = parseLocalDate(s.dateInscription);
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [students, dateRange, dateFilterType]);

  const newInscriptionsCount = useMemo(() => {
    return filteredStudentsForExpected.length;
  }, [filteredStudentsForExpected]);

  // 1. Calculations
  const totalStudents = students.length;
  const activeStudents = students.filter(s => s.statut === 'actif').length;
  const totalTeachers = teachersList.length;
  const activeTeachers = teachersList.filter(t => t.statut === 'actif').length;
  const onLeaveTeachers = teachersList.filter(t => t.statut === 'en_conge').length;

  // Taux de Réussite Global : calculé en base (getDashboardStats) plutôt que
  // sur les notes chargées côté client.
  const globalSuccessRate = serverStats?.success_rate != null
    ? serverStats.success_rate.toFixed(1)
    : '--';

  // Total attendu global (Scolarité + Frais d'inscription)
  // Aligné sur la facturation globale (CA Constaté) du module Finance.
  // Règle métier : tout élève subventionné paie 55 000 FCFA.
  const totalExpected = useMemo(() => {
    const activeList = dateFilterType === 'all' ? students : filteredStudentsForExpected;
    return activeList.reduce((sum, student) => {
      const isSub = Boolean(student.estSubventionne ?? (student as any).est_subventionne);
      if (isSub) return sum + 55000;
      const classObj = classesList.find(c => c.id === student.classeId);
      return sum + (classObj?.prix || 0);
    }, 0);
  }, [students, filteredStudentsForExpected, classesList, dateFilterType]);

  // Sous-détails Scolarité / Inscription pour affichage informatif
  const totalScolariteExpected = useMemo(() => {
    const activeList = dateFilterType === 'all' ? students : filteredStudentsForExpected;
    return activeList.reduce((sum, student) => {
      const isSub = Boolean(student.estSubventionne ?? (student as any).est_subventionne);
      if (isSub) return sum + 55000;
      const classObj = classesList.find(c => c.id === student.classeId);
      return sum + ((classObj?.prix || 0) - (Number((classObj as any)?.frais_inscription) || 0));
    }, 0);
  }, [students, filteredStudentsForExpected, classesList, dateFilterType]);

  const totalInscriptionsExpected = useMemo(() => {
    const activeList = dateFilterType === 'all' ? students : filteredStudentsForExpected;
    return activeList.reduce((sum, student) => {
      const isSub = Boolean(student.estSubventionne ?? (student as any).est_subventionne);
      if (isSub) return sum;
      const classObj = classesList.find(c => c.id === student.classeId);
      return sum + (Number((classObj as any)?.frais_inscription) || 0);
    }, 0);
  }, [students, filteredStudentsForExpected, classesList, dateFilterType]);

  // Frais perçus sur la période (tous encaissements réels validés : Scolarité + Inscription).
  // Aligné sur le périmètre de totalExpected et la Trésorerie Perçue du module Finance.
  const totalPaid = useMemo(() => {
    return students.reduce((sum, student) => {
      const studentPaid = (student.paiements || [])
        .filter(p => {
          if (p.statut !== 'paid') return false;
          if (dateFilterType === 'all') return true;
          const pd = parseLocalDate(p.date);
          return pd && pd >= dateRange.start && pd <= dateRange.end;
        })
        .reduce((s, p) => s + p.montant, 0);
      return sum + studentPaid;
    }, 0);
  }, [students, dateRange, dateFilterType]);

  const totalScolaritePaid = useMemo(() => {
    return students.reduce((sum, student) => {
      const studentPaid = (student.paiements || [])
        .filter(p => {
          if (p.statut !== 'paid' || p.typeFrais !== 'Scolarité') return false;
          if (dateFilterType === 'all') return true;
          const pd = parseLocalDate(p.date);
          return pd && pd >= dateRange.start && pd <= dateRange.end;
        })
        .reduce((s, p) => s + p.montant, 0);
      return sum + studentPaid;
    }, 0);
  }, [students, dateRange, dateFilterType]);

  const totalInscriptionsPaid = useMemo(() => {
    return students.reduce((sum, student) => {
      const studentPaid = (student.paiements || [])
        .filter(p => {
          if (p.statut !== 'paid' || p.typeFrais !== 'Inscription') return false;
          if (dateFilterType === 'all') return true;
          const pd = parseLocalDate(p.date);
          return pd && pd >= dateRange.start && pd <= dateRange.end;
        })
        .reduce((s, p) => s + p.montant, 0);
      return sum + studentPaid;
    }, 0);
  }, [students, dateRange, dateFilterType]);

  // Payments made by the filtered (new) students in the period
  const totalPaidByFilteredStudents = useMemo(() => {
    return filteredStudentsForExpected.reduce((sum, student) => {
      const studentPaid = (student.paiements || [])
        .filter(p => {
          if (p.statut !== 'paid') return false;
          if (dateFilterType === 'all') return true;
          const pd = parseLocalDate(p.date);
          return pd && pd >= dateRange.start && pd <= dateRange.end;
        })
        .reduce((s, p) => s + p.montant, 0);
      return sum + studentPaid;
    }, 0);
  }, [filteredStudentsForExpected, dateRange, dateFilterType]);

  // Montant en attente
  const totalPending = useMemo(() => {
    if (dateFilterType === 'all') {
      const allPaid = students.reduce((sum, student) => {
        const studentPaid = (student.paiements || [])
          .filter(p => p.statut === 'paid')
          .reduce((s, p) => s + p.montant, 0);
        return sum + studentPaid;
      }, 0);
      return Math.max(0, totalExpected - allPaid);
    }
    return Math.max(0, totalExpected - totalPaidByFilteredStudents);
  }, [dateFilterType, students, totalExpected, totalPaidByFilteredStudents]);

  const subventionnesCount = useMemo(() => {
    return serverStats?.subventionnes_count ?? students.filter(s => Boolean(s.estSubventionne ?? (s as any).est_subventionne)).length;
  }, [serverStats, students]);

  const totalSubventions = useMemo(() => {
    if (serverStats?.total_subventions !== undefined && serverStats?.total_subventions !== null) {
      return Number(serverStats.total_subventions);
    }
    return students.reduce((sum, s) => {
      const isSub = Boolean(s.estSubventionne ?? (s as any).est_subventionne);
      if (!isSub) return sum;
      const classObj = classesList.find(c => c.id === s.classeId);
      const standardDue = Math.max(0, (classObj?.prix || 0) - (Number((classObj as any)?.frais_inscription) || 0));
      return sum + Math.max(0, standardDue - 55000);
    }, 0);
  }, [serverStats, students, classesList]);

  // Recovery Rate
  const recoveryRate = useMemo(() => {
    return totalExpected > 0 ? (totalPaid / totalExpected) * 100 : 0;
  }, [totalPaid, totalExpected]);

  // Format currency helper (shortens large numbers for cleaner dashboard readability)
  const formatFCFA = (amount: number) => {
    if (amount >= 1000000) {
      const millions = amount / 1000000;
      return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(millions) + ' M FCFA';
    }
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
  };

  // Formatage FCFA exact (sans abréviation en Millions) pour les tableaux et reçus détaillés
  const formatFCFAExact = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
  };

  // Liste enrichie des élèves subventionnés
  const allSubventionnes = useMemo(() => {
    return students
      .filter(s => Boolean(s.estSubventionne ?? (s as any).est_subventionne))
      .map(s => {
        const classeObj = classesList.find(c => c.id === s.classeId);
        const classeNom = classeObj?.nom || s.classeId || 'Non assignée';
        const totalPaid = (s.paiements || [])
          .filter(p => p.statut === 'paid')
          .reduce((sum, p) => sum + p.montant, 0);
        const forfait = 55000;
        const resteDu = Math.max(0, forfait - totalPaid);
        const statutPaiement: 'Soldé' | 'Partiel' | 'Non payé' = totalPaid >= forfait ? 'Soldé' : totalPaid > 0 ? 'Partiel' : 'Non payé';
        return {
          id: s.id,
          matricule: s.matricule || '—',
          nom: s.nom || '',
          prenom: s.prenom || '',
          sexe: s.sexe || '—',
          classeId: s.classeId,
          classeNom,
          forfait,
          totalPaid,
          resteDu,
          statutPaiement,
          nomParent: (s as any).nomParent || (s as any).nom_parent || '',
          telephoneParent: (s as any).telephoneParent || (s as any).telephone_parent || '',
        };
      })
      .sort((a, b) => {
        const c = a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
        if (c !== 0) return c;
        return (a.prenom || '').localeCompare(b.prenom || '', 'fr', { sensitivity: 'base' });
      });
  }, [students, classesList]);

  const filteredSubventionnes = useMemo(() => {
    return allSubventionnes.filter(s => {
      const q = subventionSearch.trim().toLowerCase();
      const matchSearch = !q || `${s.nom} ${s.prenom} ${s.matricule} ${s.classeNom}`.toLowerCase().includes(q);
      const matchClasse = subventionClasseFilter === 'All' || s.classeId === subventionClasseFilter;
      const matchStatut = subventionStatutFilter === 'All' || s.statutPaiement === subventionStatutFilter;
      return matchSearch && matchClasse && matchStatut;
    });
  }, [allSubventionnes, subventionSearch, subventionClasseFilter, subventionStatutFilter]);

  const subventionnesSummary = useMemo(() => {
    const total = allSubventionnes.length;
    const totalForfait = allSubventionnes.reduce((sum, s) => sum + s.forfait, 0);
    const totalPaid = allSubventionnes.reduce((sum, s) => sum + s.totalPaid, 0);
    const totalReste = allSubventionnes.reduce((sum, s) => sum + s.resteDu, 0);
    const soldes = allSubventionnes.filter(s => s.statutPaiement === 'Soldé').length;
    const partiels = allSubventionnes.filter(s => s.statutPaiement === 'Partiel').length;
    const nonPayes = allSubventionnes.filter(s => s.statutPaiement === 'Non payé').length;
    return { total, totalForfait, totalPaid, totalReste, soldes, partiels, nonPayes };
  }, [allSubventionnes]);

  const handlePrintSubventionnes = async () => {
    setIsPrintingSubventionnes(true);
    try {
      let etabInfo: any = null;
      if (etablissementId) {
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
      }

      const listToPrint: PrintableSubventionneStudent[] = (filteredSubventionnes.length > 0 ? filteredSubventionnes : allSubventionnes).map(s => ({
        matricule: s.matricule,
        nom: s.nom,
        prenom: s.prenom,
        sexe: s.sexe,
        classeNom: s.classeNom,
        forfait: s.forfait,
        totalPaid: s.totalPaid,
        resteDu: s.resteDu,
        statutPaiement: s.statutPaiement,
        nomParent: s.nomParent,
        telephoneParent: s.telephoneParent,
      }));

      printSubventionnesList({
        schoolName: etabInfo?.nom,
        schoolLogo: etabInfo?.logo_url,
        schoolAddress: etabInfo?.adresse,
        schoolPhone: etabInfo?.telephone,
        schoolEmail: etabInfo?.email,
        academicYear: academicYear || undefined,
        totalSubventionsPrisesEnCharge: totalSubventions,
        students: listToPrint
      });
    } finally {
      setIsPrintingSubventionnes(false);
    }
  };

  const handleExportSubventionnesExcel = () => {
    const listToExport = filteredSubventionnes.length > 0 ? filteredSubventionnes : allSubventionnes;
    const dataToExport = listToExport.map((s, idx) => ({
      'N°': idx + 1,
      'Matricule': s.matricule,
      'Nom': s.nom,
      'Prénom': s.prenom,
      'Sexe': s.sexe,
      'Classe': s.classeNom,
      'Forfait Annuel (FCFA)': s.forfait,
      'Montant Encaissé (FCFA)': s.totalPaid,
      'Reste à Payer (FCFA)': s.resteDu,
      'Statut': s.statutPaiement,
      'Parent / Tuteur': s.nomParent,
      'Téléphone Parent': s.telephoneParent
    }));
    downloadExcel(dataToExport, `Registre_Eleves_Subventionnes_${new Date().toISOString().split('T')[0]}`);
  };

  // Group by class for charts
  const classStats = useMemo(() => {
    return classesList.map(c => {
      // Filter students in class by registration date if period active
      const studentsInClass = students.filter(s => {
        if (s.classeId !== c.id) return false;
        if (dateFilterType === 'all') return true;
        const d = parseLocalDate(s.dateInscription);
        return d && d >= dateRange.start && d <= dateRange.end;
      });

      const count = studentsInClass.length;
      const expected = studentsInClass.reduce((acc, s) => {
        const isSub = Boolean(s.estSubventionne ?? (s as any).est_subventionne);
        if (isSub) return acc + 55000;
        return acc + (c.prix || 0);
      }, 0);

      // Payments received in the period for all students in this class (all fees to match class expected price)
      const studentsAllInClass = students.filter(s => s.classeId === c.id);
      const paid = studentsAllInClass.reduce((sum, s) => {
        const studentPaidInPeriod = (s.paiements || [])
          .filter(p => {
            if (p.statut !== 'paid') return false;
            if (dateFilterType === 'all') return true;
            const pd = parseLocalDate(p.date);
            return pd && pd >= dateRange.start && pd <= dateRange.end;
          })
          .reduce((ps, p) => ps + p.montant, 0);
        return sum + studentPaidInPeriod;
      }, 0);

      // Payments made by the new students in the period for pending calculation
      const paidByNewStudentsInPeriod = studentsInClass.reduce((sum, s) => {
        const studentPaidInPeriod = (s.paiements || [])
          .filter(p => {
            if (p.statut !== 'paid') return false;
            if (dateFilterType === 'all') return true;
            const pd = parseLocalDate(p.date);
            return pd && pd >= dateRange.start && pd <= dateRange.end;
          })
          .reduce((ps, p) => ps + p.montant, 0);
        return sum + studentPaidInPeriod;
      }, 0);

      const pending = dateFilterType === 'all' ? Math.max(0, expected - paid) : Math.max(0, expected - paidByNewStudentsInPeriod);

      return {
        classeName: c.nom,
        studentCount: count,
        expected,
        paid,
        pending,
        rate: expected > 0 ? (paid / expected) * 100 : 0
      };
    });
  }, [classesList, students, dateFilterType, dateRange]);

  const activeClassStats = useMemo(() => {
    return classStats.filter(c => c.expected > 0);
  }, [classStats]);

  const displayStats = useMemo(() => {
    return activeClassStats.length > 0 ? activeClassStats : classStats;
  }, [activeClassStats, classStats]);

  // Filtered transactions for active period
  const filteredTransactions = useMemo(() => {
    if (dateFilterType === 'all') return transactions;
    return transactions.filter(tx => {
      const d = parseLocalDate(tx.date);
      return d && d >= dateRange.start && d <= dateRange.end;
    });
  }, [transactions, dateFilterType, dateRange]);

  const recentTransactions = useMemo(() => {
    return filteredTransactions.slice(0, 5);
  }, [filteredTransactions]);

  // Denominator for student percentage distribution in level charts
  const totalStudentsInPeriod = useMemo(() => {
    if (dateFilterType === 'all') return students.length;
    return filteredStudentsForExpected.length;
  }, [students, filteredStudentsForExpected, dateFilterType]);

  // Gender statistics for the active period
  const genderStats = useMemo(() => {
    const activeList = dateFilterType === 'all' ? students : filteredStudentsForExpected;
    const total = activeList.length;
    const girls = activeList.filter(s => s.sexe === 'F').length;
    const boys = activeList.filter(s => s.sexe === 'M').length;
    return {
      girlsPct: total > 0 ? ((girls / total) * 100).toFixed(0) : '0',
      boysPct: total > 0 ? ((boys / total) * 100).toFixed(0) : '0'
    };
  }, [students, filteredStudentsForExpected, dateFilterType]);

  const handleExportTransactions = () => {
    const dataToExport = filteredTransactions.map(tx => ({
      Référence: tx.reference,
      Date: tx.date,
      'Élève': tx.nomEleve,
      Matricule: tx.matriculeEleve,
      Classe: tx.classeNom,
      'Type de Frais': tx.typeFrais,
      'Montant (FCFA)': tx.montant,
      'Mode de Paiement': tx.modePaiement,
      Statut: tx.statut === 'paid' ? 'Payé' : tx.statut === 'pending' ? 'En attente' : 'Échoué'
    }));
    downloadExcel(dataToExport, 'Liste_Transactions');
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm font-semibold text-ink-faint">Chargement du tableau de bord depuis Supabase...</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-7">
      {/* En-tête */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[32px] lg:text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-[1.05]">L&apos;école aujourd&apos;hui</h1>
          <p className="mt-2 text-base text-ink-soft font-medium">
            Statistiques clés et aperçu financier de l&apos;établissement en temps réel.
          </p>
        </div>

        {/* Filtre par période */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-surface p-3 rounded-card border border-border w-full md:w-auto">
          <div className="flex items-center gap-2">
            <span className="text-ink-faint p-1.5 bg-bg rounded-control">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <select
              value={dateFilterType}
              onChange={(e) => setDateFilterType(e.target.value)}
              className="text-sm font-bold text-ink-soft bg-transparent border-0 focus:outline-none cursor-pointer pr-8"
            >
              <option value="all">Toutes les périodes</option>
              <option value="today">Aujourd&apos;hui</option>
              <option value="week">Cette semaine</option>
              <option value="month">Ce mois-ci</option>
              <option value="quarter">Ce trimestre</option>
              <option value="year">Cette année</option>
              <option value="custom">Période personnalisée</option>
            </select>
          </div>

          {dateFilterType === 'custom' && (
            <div className="flex items-center gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-border-row">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-semibold text-ink-soft bg-bg border border-border rounded-control px-2.5 py-1.5 outline-none focus:border-accent focus:bg-surface"
              />
              <span className="text-xs text-ink-faint font-bold">au</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-semibold text-ink-soft bg-bg border border-border rounded-control px-2.5 py-1.5 outline-none focus:border-accent focus:bg-surface"
              />
            </div>
          )}
        </div>
      </div>

      {/* Cartes KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Élèves */}
        <div className="bg-surface rounded-card p-6 border border-border animate-fade-up">
          <div className="text-[13px] font-bold text-ink-soft">Élèves inscrits</div>
          <div className="text-[44px] font-extrabold text-ink tracking-[-2px] leading-none mt-3">{totalStudents}</div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <span className="text-[13px] font-bold text-green bg-green-bg rounded-pill px-3 py-1">{activeStudents} actifs</span>
            {globalSuccessRate !== '--' && (
              <span className="text-[13px] font-bold text-ink-soft bg-chip rounded-pill px-3 py-1">Réussite {globalSuccessRate}%</span>
            )}
            {subventionnesCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSubventionnesModal(true)}
                className="text-[13px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-pill px-3 py-1 inline-flex items-center gap-1.5 transition-all shadow-sm cursor-pointer group"
                title="Cliquer pour afficher et imprimer la liste des élèves subventionnés"
              >
                <span>★ {subventionnesCount} subventionné{subventionnesCount > 1 ? 's' : ''}</span>
                <span className="text-[10px] text-blue-500 group-hover:translate-x-0.5 transition-transform">↗</span>
              </button>
            )}
          </div>
          {dateFilterType !== 'all' && (
            <div className="mt-2">
              <span className="text-[13px] font-bold text-accent bg-red-bg rounded-pill px-3 py-1 inline-block">
                dont {newInscriptionsCount} nouveau{newInscriptionsCount !== 1 ? 'x' : ''} inscrit{newInscriptionsCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Enseignants */}
        <div className="bg-surface rounded-card p-6 border border-border animate-fade-up [animation-delay:0.08s]">
          <div className="text-[13px] font-bold text-ink-soft">Enseignants</div>
          <div className="text-[44px] font-extrabold text-ink tracking-[-2px] leading-none mt-3">{totalTeachers}</div>
          <div className="mt-3.5">
            <span className="text-[13px] font-bold text-green bg-green-bg rounded-pill px-3 py-1 inline-block">
              {activeTeachers} actifs · {onLeaveTeachers} en congé · {totalTeachers - activeTeachers - onLeaveTeachers} quittés
            </span>
          </div>
        </div>

        {/* Frais perçus */}
        <div className="bg-surface rounded-card p-6 border border-border animate-fade-up [animation-delay:0.16s]">
          <div className="text-[13px] font-bold text-ink-soft">Frais perçus</div>
          <div className="text-[30px] font-extrabold text-ink tracking-[-1.5px] leading-tight mt-3 truncate">{formatFCFA(totalPaid)}</div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-ink-faint font-semibold mb-1.5">
              <span>Recouvrement {dateFilterType !== 'all' ? 'sur la période' : ''}</span>
              <span className="font-extrabold text-ink-soft">{recoveryRate.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-chip rounded-pill overflow-hidden mt-4">
              <div 
                className="h-full rounded-pill transition-all duration-1000" 
                style={{ width: `${Math.min(100, recoveryRate)}%`, background: recoveryRate >= 75 ? 'var(--color-ink)' : 'var(--color-accent)' }}
              ></div>
            </div>
            {totalInscriptionsPaid > 0 && (
              <div className="text-[11px] text-ink-faint font-medium mt-2 flex flex-wrap gap-x-2">
                <span>Scolarité : {formatFCFA(totalScolaritePaid)}</span>
                <span>·</span>
                <span>Inscriptions : {formatFCFA(totalInscriptionsPaid)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Reste à percevoir — carte accent sombre */}
        <div className="bg-ink rounded-card p-6 text-cream animate-fade-up [animation-delay:0.24s]">
          <div className="text-[13px] font-bold opacity-80">Reste à percevoir</div>
          <div className="text-[30px] font-extrabold tracking-[-1.5px] leading-tight mt-3 truncate">{formatFCFA(totalPending)}</div>
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold bg-cream/15 rounded-pill px-3 py-1 inline-block">
              Sur {formatFCFA(totalExpected)} attendus
            </span>
            {totalInscriptionsExpected > 0 && (
              <div className="text-[11px] opacity-75 font-medium mt-1.5 flex flex-wrap gap-x-2">
                <span>Scolarité : {formatFCFA(totalScolariteExpected)}</span>
                <span>·</span>
                <span>Inscriptions : {formatFCFA(totalInscriptionsExpected)}</span>
              </div>
            )}
            {totalSubventions > 0 && (
              <button
                type="button"
                onClick={() => setShowSubventionnesModal(true)}
                className="text-[11px] text-cream/80 hover:text-white font-medium flex items-center justify-between gap-1 transition-colors text-left group cursor-pointer pt-1"
                title="Cliquer pour afficher et imprimer la liste des élèves subventionnés"
              >
                <span>Dont {formatFCFA(totalSubventions)} subventionnés pris en charge</span>
                <span className="underline opacity-80 group-hover:opacity-100 font-bold ml-1 shrink-0">Voir liste ↗</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recouvrement global & par classe */}
        <div className="bg-surface rounded-card border border-border p-7 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="text-xl font-extrabold text-ink tracking-[-0.5px]">Recouvrement global &amp; par classe</h3>
            <p className="text-xs text-ink-faint font-medium mt-1">Montants attendus (facturations) vs réellement perçus (encaissements)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center py-4">
            {/* Donut global */}
            <div className="md:col-span-5 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-border-row pb-6 md:pb-0 md:pr-6">
              <div className="relative w-40 h-40 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
                  <circle
                    cx="80"
                    cy="80"
                    r="70"
                    className="stroke-chip"
                    strokeWidth="14"
                    fill="transparent"
                  />
                  {recoveryRate > 0 && (
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      className={`transition-all duration-1000 ease-out ${recoveryRate >= 75 ? 'stroke-ink' : 'stroke-accent'}`}
                      strokeWidth="14"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 70}
                      strokeDashoffset={2 * Math.PI * 70 - (Math.min(100, recoveryRate) / 100) * (2 * Math.PI * 70)}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className="text-[28px] font-extrabold text-ink tracking-[-1px]">{recoveryRate.toFixed(1)}%</span>
                  <span className="text-[9px] font-bold text-ink-faint uppercase tracking-wider mt-0.5">Recouvré</span>
                </div>
              </div>

              <div className="w-full mt-4 space-y-2 text-xs">
                <div className="flex items-center justify-between text-ink-soft">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-ink"></span>Payé</span>
                  <span className="font-extrabold text-ink">{formatFCFA(totalPaid)}</span>
                </div>
                <div className="flex items-center justify-between text-ink-soft">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-accent"></span>En attente</span>
                  <span className="font-extrabold text-accent">{formatFCFA(totalPending)}</span>
                </div>
              </div>
            </div>

            {/* Détail par classe */}
            <div className="md:col-span-7 flex flex-col h-full justify-center">
              <h4 className="text-[11px] font-bold text-ink-faint uppercase tracking-wider mb-3">Taux de recouvrement par classe</h4>
              <div className="max-h-64 overflow-y-auto pr-2 space-y-2">
                {displayStats.map((stat) => (
                  <div key={stat.classeName} className="flex items-center justify-between p-2.5 hover:bg-row-hover rounded-chip transition-colors">
                    <div className="flex-1 min-w-0 pr-3">
                      <span className="font-bold text-sm text-ink block truncate">{stat.classeName}</span>
                      <span className="text-[10px] text-ink-faint font-medium block mt-0.5">
                        Payé : <span className="font-semibold text-ink-soft">{formatFCFA(stat.paid)}</span> / {formatFCFA(stat.expected)}
                      </span>
                    </div>

                    <div className="relative flex items-center justify-center w-10 h-10 flex-shrink-0">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 32 32">
                        <circle
                          cx="16"
                          cy="16"
                          r="13"
                          className="stroke-chip"
                          strokeWidth="3.5"
                          fill="transparent"
                        />
                        {stat.rate > 0 && (
                          <circle
                            cx="16"
                            cy="16"
                            r="13"
                            className={stat.rate >= 75 ? 'stroke-ink' : 'stroke-accent'}
                            strokeWidth="3.5"
                            fill="transparent"
                            strokeDasharray={2 * Math.PI * 13}
                            strokeDashoffset={2 * Math.PI * 13 - (Math.min(100, stat.rate) / 100) * (2 * Math.PI * 13)}
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                      <div className="absolute text-[8px] font-extrabold text-ink">
                        {stat.rate.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>


        {/* Répartition par niveau */}
        <div className="bg-surface rounded-card border border-border p-7 flex flex-col justify-between">
          <div>
            <h3 className="text-xl font-extrabold text-ink tracking-[-0.5px]">Élèves par niveau</h3>
            <p className="text-xs text-ink-faint font-medium mb-6">Répartition des effectifs</p>
          </div>

          <div className="space-y-4">
            {classStats.length > 0 ? classStats.map((stat) => {
              const pct = totalStudentsInPeriod > 0 ? (stat.studentCount / totalStudentsInPeriod) * 100 : 0;
              return (
                <div key={stat.classeName} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-ink-soft">
                    <span>{stat.classeName}</span>
                    <span className="font-extrabold text-ink">{stat.studentCount} élèves ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full bg-chip h-2.5 rounded-pill overflow-hidden">
                    <div
                      className="bg-ink h-full rounded-pill transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                </div>
              );
            }) : (
                <div className="text-sm text-ink-faint text-center py-8">Aucun élève inscrit</div>
            )}
          </div>

          <div className="border-t border-border-row pt-4 mt-6 flex justify-between text-[11px] font-semibold text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-accent"></span> Filles ({genderStats.girlsPct}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-ink"></span> Garçons ({genderStats.boysPct}%)
            </span>
          </div>
        </div>
      </div>

      {/* Transactions récentes */}
      <div className="bg-surface rounded-card border border-border overflow-hidden">
        <div className="px-6 py-5 border-b border-border-row flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-xl font-extrabold text-ink tracking-[-0.5px]">Paiements récents</h3>
            <p className="text-xs text-ink-faint font-medium mt-0.5">Derniers versements enregistrés dans l&apos;établissement</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportTransactions}
              className="text-[13px] font-bold text-ink-soft hover:text-ink hover:border-ink flex items-center gap-1.5 transition-colors bg-transparent border border-outline px-3.5 py-2 rounded-control"
            >
              <DownloadIcon size={14} />
              Exporter
            </button>
            <Link
              href="/eleves"
              className="text-[13px] font-bold text-accent hover:text-accent-hover flex items-center gap-1 transition-colors"
            >
              Tout voir →
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-bold text-ink-faint uppercase tracking-[1px] bg-bg">
                <th className="px-6 py-3.5 font-bold">Élève</th>
                <th className="px-4 py-3.5 font-bold">Classe</th>
                <th className="px-4 py-3.5 font-bold">Type</th>
                <th className="px-4 py-3.5 font-bold">Montant</th>
                <th className="px-4 py-3.5 font-bold">Mode</th>
                <th className="px-4 py-3.5 font-bold">Date</th>
                <th className="px-6 py-3.5 font-bold">Statut</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {recentTransactions.length > 0 ? recentTransactions.map((tx) => (
                <tr key={tx.id} className="border-t border-border-row hover:bg-row-hover transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-[38px] h-[38px] rounded-[12px] bg-chip text-ink-soft text-xs font-extrabold flex items-center justify-center shrink-0">
                        {String(tx.nomEleve || '').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span className="block font-bold text-ink truncate">{tx.nomEleve}</span>
                        <span className="block text-[11px] text-ink-faint font-medium">{tx.matriculeEleve}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-ink-soft font-semibold">{tx.classeNom}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2.5 py-1 rounded-pill text-[11px] font-bold ${
                      tx.typeFrais === 'Inscription' ? 'bg-red-bg text-accent' : 'bg-chip text-ink-soft'
                    }`}>
                      {tx.typeFrais}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-extrabold text-ink">{formatFCFA(tx.montant)}</td>
                  <td className="px-4 py-3.5 text-ink-soft text-[13px] font-semibold">{tx.modePaiement}</td>
                  <td className="px-4 py-3.5 text-ink-faint text-[13px] font-medium">{tx.date}</td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-extrabold px-3 py-1 rounded-pill ${
                      tx.statut === 'paid' ? 'text-green bg-green-bg' : 'text-ink-soft bg-chip'
                    }`}>
                      {tx.statut === 'paid' ? 'Payé' : 'En attente'}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-ink-faint text-sm">
                    Aucune transaction récente enregistrée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modale interactive : Liste officielle des élèves subventionnés */}
      {showSubventionnesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface rounded-card border border-border shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-up">
            {/* Entête de la modale */}
            <div className="p-6 border-b border-border bg-bg/40 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="w-8 h-8 rounded-control bg-blue-100 text-blue-800 flex items-center justify-center font-extrabold text-sm border border-blue-200">
                    ★
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight">
                    Élèves au Régime Subventionné
                  </h2>
                  <span className="text-xs font-bold px-3 py-1 rounded-pill bg-blue-50 text-blue-700 border border-blue-200">
                    Forfait Spécial 55 000 FCFA
                  </span>
                </div>
                <p className="mt-1.5 text-xs sm:text-sm text-ink-soft">
                  Registre officiel des bénéficiaires de la convention de scolarité subventionnée (55 000 FCFA forfait annuel par élève).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubventionnesModal(false)}
                className="p-2 text-ink-faint hover:text-ink hover:bg-chip rounded-control transition-colors cursor-pointer"
                title="Fermer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Barre de métriques KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-6 bg-surface border-b border-border">
              <div className="bg-bg p-3.5 rounded-card border border-border">
                <span className="text-[11px] font-bold text-ink-faint uppercase block">Effectif subventionné</span>
                <span className="text-xl sm:text-2xl font-extrabold text-ink block mt-1">
                  {subventionnesSummary.total} élève{subventionnesSummary.total > 1 ? 's' : ''}
                </span>
                <span className="text-[11px] text-ink-faint font-medium mt-0.5 block">
                  {subventionnesSummary.soldes} soldé(s) · {subventionnesSummary.partiels} partiel(s)
                </span>
              </div>
              <div className="bg-bg p-3.5 rounded-card border border-border">
                <span className="text-[11px] font-bold text-ink-faint uppercase block">Forfait global attendu</span>
                <span className="text-xl sm:text-2xl font-extrabold text-blue-700 block mt-1">
                  {formatFCFAExact(subventionnesSummary.totalForfait)}
                </span>
                <span className="text-[11px] text-ink-faint font-medium mt-0.5 block">
                  55 000 FCFA × {subventionnesSummary.total}
                </span>
              </div>
              <div className="bg-bg p-3.5 rounded-card border border-border">
                <span className="text-[11px] font-bold text-ink-faint uppercase block">Total déjà encaissé</span>
                <span className="text-xl sm:text-2xl font-extrabold text-green block mt-1">
                  {formatFCFAExact(subventionnesSummary.totalPaid)}
                </span>
                <span className="text-[11px] text-green font-medium mt-0.5 block">
                  {subventionnesSummary.totalForfait > 0 ? ((subventionnesSummary.totalPaid / subventionnesSummary.totalForfait) * 100).toFixed(1) : '0'}% recouvré
                </span>
              </div>
              <div className="bg-bg p-3.5 rounded-card border border-border">
                <span className="text-[11px] font-bold text-ink-faint uppercase block">Reste à recouvrer</span>
                <span className={`text-xl sm:text-2xl font-extrabold block mt-1 ${subventionnesSummary.totalReste > 0 ? 'text-accent' : 'text-ink-soft'}`}>
                  {formatFCFAExact(subventionnesSummary.totalReste)}
                </span>
                <span className="text-[11px] text-ink-faint font-medium mt-0.5 block">
                  Subvention : {formatFCFA(totalSubventions)}
                </span>
              </div>
            </div>

            {/* Filtres et actions */}
            <div className="p-4 sm:px-6 bg-surface border-b border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                {/* Recherche */}
                <div className="relative flex-1 min-w-[200px]">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-faint pointer-events-none">
                    <SearchIcon size={14} />
                  </span>
                  <input
                    type="text"
                    placeholder="Rechercher par nom, matricule ou classe..."
                    value={subventionSearch}
                    onChange={(e) => setSubventionSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-border rounded-control bg-bg text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:bg-surface"
                  />
                </div>

                {/* Filtre classe */}
                <select
                  value={subventionClasseFilter}
                  onChange={(e) => setSubventionClasseFilter(e.target.value)}
                  className="bg-bg border border-border px-3 py-2 rounded-control text-xs font-bold text-ink-soft outline-none focus:border-accent cursor-pointer"
                >
                  <option value="All">Toutes les classes</option>
                  {classesList.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>

                {/* Filtre statut */}
                <select
                  value={subventionStatutFilter}
                  onChange={(e) => setSubventionStatutFilter(e.target.value)}
                  className="bg-bg border border-border px-3 py-2 rounded-control text-xs font-bold text-ink-soft outline-none focus:border-accent cursor-pointer"
                >
                  <option value="All">Tous les paiements</option>
                  <option value="Soldé">Soldé</option>
                  <option value="Partiel">Partiel</option>
                  <option value="Non payé">Non payé</option>
                </select>
              </div>

              {/* Boutons d'export et d'impression */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportSubventionnesExcel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-border text-ink-soft hover:text-ink text-xs font-bold rounded-control bg-bg hover:bg-chip transition-colors cursor-pointer"
                  title="Exporter au format Excel"
                >
                  <DownloadIcon size={13} />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={handlePrintSubventionnes}
                  disabled={isPrintingSubventionnes}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-control shadow transition-colors cursor-pointer disabled:opacity-50"
                  title="Imprimer la liste officielle pour visa et archives"
                >
                  <span>🖨️</span>
                  <span>{isPrintingSubventionnes ? 'Génération...' : 'Imprimer la liste'}</span>
                </button>
              </div>
            </div>

            {/* Tableau défilant */}
            <div className="flex-1 overflow-y-auto min-h-[260px] p-0">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-bg text-ink-faint font-bold uppercase tracking-wider border-b border-border z-10">
                  <tr>
                    <th className="px-4 py-3 text-center w-10">N°</th>
                    <th className="px-4 py-3 w-28">Matricule</th>
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3 text-center w-12">Genre</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3 text-right">Forfait</th>
                    <th className="px-4 py-3 text-right">Encaissé</th>
                    <th className="px-4 py-3 text-right">Reste</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row">
                  {filteredSubventionnes.length > 0 ? (
                    filteredSubventionnes.map((s, idx) => {
                      const isSolde = s.statutPaiement === 'Soldé';
                      const isPartiel = s.statutPaiement === 'Partiel';
                      return (
                        <tr key={s.id} className="hover:bg-row-hover transition-colors">
                          <td className="px-4 py-3 text-center font-bold text-ink-faint">{idx + 1}</td>
                          <td className="px-4 py-3 font-mono font-semibold text-ink-soft whitespace-nowrap">{s.matricule}</td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-ink">{s.nom} {s.prenom}</div>
                            {s.nomParent && (
                              <div className="text-[10px] text-ink-faint">Parent: {s.nomParent} {s.telephoneParent ? `(${s.telephoneParent})` : ''}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-ink-soft">{s.sexe}</td>
                          <td className="px-4 py-3 font-semibold text-ink-soft">{s.classeNom}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">{formatFCFAExact(s.forfait)}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-green">{formatFCFAExact(s.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-mono font-bold ${s.resteDu > 0 ? 'text-accent' : 'text-ink-faint'}`}>
                            {formatFCFAExact(s.resteDu)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-pill text-[10px] font-extrabold ${
                              isSolde
                                ? 'bg-green-bg text-green'
                                : isPartiel
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-bg text-accent'
                            }`}>
                              {s.statutPaiement}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Link
                              href={`/eleves/${s.id}`}
                              className="text-accent hover:underline font-bold text-[11px]"
                            >
                              Fiche →
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-ink-faint italic">
                        {allSubventionnes.length === 0
                          ? "Aucun élève n'est enregistré au régime subventionné."
                          : "Aucun élève ne correspond aux critères de recherche."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bas de modale */}
            <div className="p-4 sm:px-6 border-t border-border bg-bg/40 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-ink-soft font-medium">
                Affichage de {filteredSubventionnes.length} élève{filteredSubventionnes.length > 1 ? 's' : ''} sur {allSubventionnes.length} subventionné{allSubventionnes.length > 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSubventionnesModal(false)}
                  className="px-4 py-2 border border-border text-ink-soft hover:text-ink text-xs font-bold rounded-control bg-surface hover:bg-chip transition-colors cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  onClick={handlePrintSubventionnes}
                  disabled={isPrintingSubventionnes}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-control shadow transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>🖨️</span>
                  <span>Imprimer la liste officielle</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
