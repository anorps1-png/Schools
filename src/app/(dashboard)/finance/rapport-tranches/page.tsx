'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import { useEtablissement } from '@/contexts/etablissement-context';
import { downloadExcel } from '@/lib/excel';
import { captureError } from '@/lib/observability/logger';
import { SearchIcon, ChevronLeftIcon, DownloadIcon } from '@/components/icons';

interface TrancheStudent {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  sexe: string;
  classeId: string;
  classeNom: string;
  sectionNom: string;
  nomParent: string;
  telephoneParent: string;
  totalDue: number;
  totalPaid: number;
  tranche1Paid: boolean;
  tranche1Amount: number;
  tranche2Paid: boolean;
  tranche2Amount: number;
  tranche3Paid: boolean;
  tranche3Amount: number;
  pctToPay: number;
  estSubventionne?: boolean;
}

export default function RapportTranchesPage() {
  const { etablissementId, academicYearId } = useEtablissement();
  const [students, setStudents] = useState<TrancheStudent[]>([]);
  const [classesList, setClassesList] = useState<any[]>([]);
  const [sectionsList, setSectionsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters (Slicers like Excel)
  const [selectedClass, setSelectedClass] = useState<string>('All');
  const [selectedSection, setSelectedSection] = useState<string>('All');
  const [selectedRegime, setSelectedRegime] = useState<'All' | 'subventionne' | 'standard'>('All');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [relanceOnly, setRelanceOnly] = useState<boolean>(false);

  // Modal relance
  const [relanceTarget, setRelanceTarget] = useState<TrancheStudent | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    if (!etablissementId) return;

    const loadData = async () => {
      setLoading(true);
      const supabase = createClient();

      try {
        // 1. Fetch Sections
        const { data: sectionsData } = await supabase
          .from('sections')
          .select('*')
          .eq('etablissement_id', etablissementId);

        setSectionsList(sectionsData || []);

        // 2. Fetch Classes
        const { data: classesData } = await supabase
          .from('classes')
          .select('*, niveaus:niveaux_classes(section_id, sections(nom))')
          .eq('etablissement_id', etablissementId);

        setClassesList(classesData || []);

        // 3. Fetch Tranches de scolarité — désormais propres à chaque classe
        // (des classes différentes ont des prix, donc des tranches,
        // différents). Un seul aller-retour pour toutes les classes de
        // l'année, regroupées ensuite par classe_id.
        let tranchesQuery = supabase
          .from('tranches_scolarite')
          .select('*')
          .eq('etablissement_id', etablissementId);

        if (academicYearId) {
          tranchesQuery = tranchesQuery.eq('annee_scolaire_id', academicYearId);
        }

        const { data: tranchesData } = await tranchesQuery.order('ordre', { ascending: true });
        const tranchesByClasse = new Map<string, any[]>();
        (tranchesData || []).forEach((t: any) => {
          if (!t.classe_id) return;
          if (!tranchesByClasse.has(t.classe_id)) tranchesByClasse.set(t.classe_id, []);
          tranchesByClasse.get(t.classe_id)!.push(t);
        });

        // 4. Fetch Students & Payments
        let query = supabase
          .from('eleves')
          .select('*, classes(id, nom, prix, section), paiements(id, montant, statut, type_frais)')
          .eq('etablissement_id', etablissementId);

        if (academicYearId) {
          query = query.eq('annee_scolaire_id', academicYearId);
        }

        const { data: elevesData, error: elevesErr } = await query;

        if (elevesErr) throw elevesErr;

        if (elevesData) {
          const mapped: TrancheStudent[] = elevesData.map((e: any) => {
            const classObj = e.classes || {};
            const isSub = Boolean(e.est_subventionne);

            // Règle métier : l'élève subventionné paie le forfait conventionné de 55 000 FCFA
            const totalDue = isSub ? 55000 : (Number(classObj.prix) || 150000);
            
            // Calculate tranche limits based on real configured tranches if present
            let t1Limit = Math.round(totalDue * 0.33);
            let t2Limit = Math.round(totalDue * 0.66);
            let t1Amount = t1Limit;
            let t2Amount = Math.round(totalDue * 0.33);
            let t3Amount = totalDue - (t1Limit + t2Amount);

            const realTranches = tranchesByClasse.get(e.classe_id) || [];
            if (realTranches.length > 0) {
              const t1 = realTranches[0];
              const t2 = realTranches[1];
              const t3 = realTranches[2];

              if (t1 && Number(t1.montant) > 0) {
                t1Amount = Number(t1.montant);
                t1Limit = t1Amount;
              } else if (t1 && Number(t1.pourcentage) > 0) {
                t1Amount = Math.round(totalDue * (Number(t1.pourcentage) / 100));
                t1Limit = t1Amount;
              }

              if (t2 && Number(t2.montant) > 0) {
                t2Amount = Number(t2.montant);
                t2Limit = t1Limit + t2Amount;
              } else if (t2 && Number(t2.pourcentage) > 0) {
                t2Amount = Math.round(totalDue * (Number(t2.pourcentage) / 100));
                t2Limit = t1Limit + t2Amount;
              } else {
                t2Limit = t1Limit;
              }

              if (t3 && Number(t3.montant) > 0) {
                t3Amount = Number(t3.montant);
              } else {
                t3Amount = Math.max(0, totalDue - (t1Amount + t2Amount));
              }
            }

            const paidPayments = (e.paiements || []).filter((p: any) => p.statut === 'paid');
            const totalPaid = paidPayments.reduce((sum: number, p: any) => sum + Number(p.montant), 0);

            const tranche1Paid = totalPaid >= t1Limit;
            const tranche2Paid = totalPaid >= t2Limit;
            const tranche3Paid = totalPaid >= totalDue;

            const remaining = Math.max(0, totalDue - totalPaid);
            const pctToPay = totalDue > 0 ? Math.round((remaining / totalDue) * 100) : 0;

            return {
              id: e.id,
              matricule: e.matricule || 'N/A',
              nom: e.nom || '',
              prenom: e.prenom || '',
              sexe: e.sexe || 'M',
              classeId: e.classe_id,
              classeNom: classObj.nom || 'Sans classe',
              sectionNom: classObj.section || 'FRANCO',
              nomParent: e.nom_parent || 'Parent Non renseigné',
              telephoneParent: e.telephone_parent || '',
              totalDue,
              totalPaid,
              tranche1Paid,
              tranche1Amount: t1Amount,
              tranche2Paid,
              tranche2Amount: t2Amount,
              tranche3Paid,
              tranche3Amount: t3Amount,
              pctToPay,
              estSubventionne: isSub
            };
          });

          setStudents(mapped);
        }
      } catch (err) {
        captureError(err, { context: "Error loading tranche report data:" });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [etablissementId, academicYearId]);

  // Unique lists for Excel slicers
  const availableClasses = useMemo(() => {
    const list = Array.from(new Set(students.map(s => s.classeNom))).filter(Boolean);
    return list.sort();
  }, [students]);

  const availableSections = useMemo(() => {
    const list = Array.from(new Set(students.map(s => s.sectionNom))).filter(Boolean);
    return list.sort();
  }, [students]);

  // Filtered dataset
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchSearch = `${s.nom} ${s.prenom} ${s.matricule}`.toLowerCase().includes(searchTerm.toLowerCase());
      const matchClass = selectedClass === 'All' || s.classeNom === selectedClass;
      const matchSection = selectedSection === 'All' || s.sectionNom.toUpperCase().includes(selectedSection.toUpperCase());
      const matchRegime = selectedRegime === 'All'
        || (selectedRegime === 'subventionne' && s.estSubventionne)
        || (selectedRegime === 'standard' && !s.estSubventionne);
      const matchRelance = !relanceOnly || s.pctToPay > 0;

      return matchSearch && matchClass && matchSection && matchRegime && matchRelance;
    });
  }, [students, searchTerm, selectedClass, selectedSection, selectedRegime, relanceOnly]);

  // Totals for header KPI
  const stats = useMemo(() => {
    const totalCount = filteredStudents.length;
    const totalDue = filteredStudents.reduce((sum, s) => sum + s.totalDue, 0);
    const totalPaid = filteredStudents.reduce((sum, s) => sum + s.totalPaid, 0);
    const totalRemaining = totalDue - totalPaid;
    const t1NokCount = filteredStudents.filter(s => !s.tranche1Paid).length;
    const t2NokCount = filteredStudents.filter(s => !s.tranche2Paid && s.tranche1Paid).length;

    return { totalCount, totalDue, totalPaid, totalRemaining, t1NokCount, t2NokCount };
  }, [filteredStudents]);

  const handleExportExcelReport = () => {
    const dataToExport = filteredStudents.map(s => ({
      'FULL NAME': `${s.nom} ${s.prenom}`,
      'RÉGIME': s.estSubventionne ? 'Subventionné (55 000 FCFA)' : 'Standard',
      'CLASS': s.classeNom,
      'SECTION': s.sectionNom,
      'MATRICULE': s.matricule,
      'TRANCHE 1': s.tranche1Paid ? 'OK' : 'T1 NOK',
      'TRANCHE 2': s.tranche2Paid ? 'OK' : 'T2 NOK',
      'TRANCHE 3': s.tranche3Paid ? 'OK' : 'T3 NOK',
      'SCOLARITÉ TOTALE': s.totalDue,
      'MONTANT PAYÉ': s.totalPaid,
      'RESTE À PAYER': s.totalDue - s.totalPaid,
      '% TO PAY': `${s.pctToPay}%`,
      'PARENT': s.nomParent,
      'TÉLÉPHONE': s.telephoneParent
    }));

    downloadExcel(dataToExport, `Rapport_Suivi_Paiements_Tranches_${new Date().toISOString().split('T')[0]}`);
    triggerToast("Rapport Excel officiel généré !");
  };

  const handleSendWhatsAppRelance = (student: TrancheStudent) => {
    if (!student.telephoneParent) {
      alert("Aucun numéro de téléphone disponible pour ce parent.");
      return;
    }
    const cleanPhone = student.telephoneParent.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.startsWith('237') ? cleanPhone : `237${cleanPhone}`;
    const regimeTag = student.estSubventionne ? ' (Régime Subventionné)' : '';
    const msg = `Bonjour M./Mme ${student.nomParent}, nous vous rappellons que le solde de scolarité pour l'élève ${student.nom} ${student.prenom} (Matricule: ${student.matricule}, Classe: ${student.classeNom}${regimeTag}) présente un reste à payer de ${new Intl.NumberFormat('fr-FR').format(student.totalDue - student.totalPaid)} FCFA (${student.pctToPay}% restant). Merci de régulariser la tranche en trésorerie.`;

    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-ink-soft font-semibold">
        Chargement du rapport de suivi des tranches de paiement...
      </div>
    );
  }

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
          <div className="flex items-center gap-2 mb-1">
            <Link href="/finance" className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
              ← Retour au Dashboard Finance
            </Link>
          </div>
          <h1 className="text-[32px] font-extrabold text-ink tracking-[-1px] leading-tight">
            Rapport de Suivi des Paiements par Tranche
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Visualisation matricielle par élève, classe et section — Indicateurs de relance T1 / T2 / T3.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => window.print()}
            className="px-4 py-2.5 bg-transparent border border-outline text-ink-soft hover:border-ink hover:text-ink text-[13px] font-bold rounded-control transition-colors cursor-pointer"
          >
            🖨️ Imprimer
          </button>
          <button
            onClick={handleExportExcelReport}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-cream text-sm font-bold rounded-control shadow-cta transition-colors cursor-pointer"
          >
            <DownloadIcon size={14} />
            Exporter Excel (Gabarit Officiel)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface p-5 rounded-card border border-border shadow-sm">
          <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider block">Élèves sous filtre</span>
          <span className="text-[32px] font-extrabold text-ink tracking-tight mt-1 block">{stats.totalCount}</span>
        </div>

        <div className="bg-surface p-5 rounded-card border border-border shadow-sm">
          <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider block">Trésorerie Perçue</span>
          <span className="text-[28px] font-extrabold text-green tracking-tight mt-1 block">
            {new Intl.NumberFormat('fr-FR').format(stats.totalPaid)} <span className="text-xs font-semibold">FCFA</span>
          </span>
        </div>

        <div className="bg-surface p-5 rounded-card border border-border shadow-sm">
          <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider block">Reste à Recouvrer</span>
          <span className="text-[28px] font-extrabold text-accent tracking-tight mt-1 block">
            {new Intl.NumberFormat('fr-FR').format(stats.totalRemaining)} <span className="text-xs font-semibold">FCFA</span>
          </span>
        </div>

        <div className="bg-surface p-5 rounded-card border border-border shadow-sm">
          <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider block">Relances Prio (T1 / T2 NOK)</span>
          <span className="text-[32px] font-extrabold text-ink tracking-tight mt-1 block">
            {stats.t1NokCount} <span className="text-xs font-bold text-accent">(T1)</span> / {stats.t2NokCount} <span className="text-xs font-bold text-ink-soft">(T2)</span>
          </span>
        </div>
      </div>

      {/* Main Content Layout with Excel Slicers */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Side: Excel Style Slicers / Filters */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-surface p-5 rounded-card border border-border shadow-sm space-y-5">
            <h3 className="text-sm font-extrabold text-ink border-b border-border pb-2.5 flex items-center justify-between">
              <span>Slicers & Filtres (Excel)</span>
              {(selectedClass !== 'All' || selectedSection !== 'All' || selectedRegime !== 'All' || relanceOnly || searchTerm) && (
                <button
                  onClick={() => {
                    setSelectedClass('All');
                    setSelectedSection('All');
                    setSelectedRegime('All');
                    setSearchTerm('');
                    setRelanceOnly(false);
                  }}
                  className="text-[10px] text-accent font-bold hover:underline"
                >
                  Réinitialiser
                </button>
              )}
            </h3>

            {/* Search Input */}
            <div>
              <label className="block text-[11px] font-bold text-ink-faint uppercase tracking-wider mb-1.5">Rechercher Élève / Matr</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tapez nom, matricule..."
                  className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-control text-xs outline-none focus:border-accent"
                />
                <SearchIcon size={14} className="absolute left-2.5 top-2.5 text-ink-faint" />
              </div>
            </div>

            {/* Slicer 1: CLASS */}
            <div>
              <label className="block text-[11px] font-bold text-ink-faint uppercase tracking-wider mb-2">CLASS (Classe)</label>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedClass('All')}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                    selectedClass === 'All' ? 'bg-ink text-cream' : 'bg-bg text-ink-soft hover:bg-chip'
                  }`}
                >
                  <span>Toutes les classes</span>
                  <span className="text-[10px] opacity-80">{students.length}</span>
                </button>
                {availableClasses.map((cls) => {
                  const count = students.filter(s => s.classeNom === cls).length;
                  const isSelected = selectedClass === cls;
                  return (
                    <button
                      key={cls}
                      onClick={() => setSelectedClass(cls)}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                        isSelected ? 'bg-accent text-cream shadow-sm' : 'bg-bg text-ink hover:bg-chip'
                      }`}
                    >
                      <span>{cls}</span>
                      <span className="text-[10px] font-mono opacity-80">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slicer 2: SECTION */}
            <div>
              <label className="block text-[11px] font-bold text-ink-faint uppercase tracking-wider mb-2">SECTION (Sous-système)</label>
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedSection('All')}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                    selectedSection === 'All' ? 'bg-ink text-cream' : 'bg-bg text-ink-soft hover:bg-chip'
                  }`}
                >
                  <span>Toutes les sections</span>
                  <span className="text-[10px] opacity-80">{students.length}</span>
                </button>
                {availableSections.map((sec) => {
                  const count = students.filter(s => s.sectionNom === sec).length;
                  const isSelected = selectedSection === sec;
                  return (
                    <button
                      key={sec}
                      onClick={() => setSelectedSection(sec)}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                        isSelected ? 'bg-accent text-cream shadow-sm' : 'bg-bg text-ink hover:bg-chip'
                      }`}
                    >
                      <span>{sec}</span>
                      <span className="text-[10px] font-mono opacity-80">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slicer 3: RÉGIME */}
            <div>
              <label className="block text-[11px] font-bold text-ink-faint uppercase tracking-wider mb-2">RÉGIME SCOLAIRE</label>
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedRegime('All')}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                    selectedRegime === 'All' ? 'bg-ink text-cream' : 'bg-bg text-ink-soft hover:bg-chip'
                  }`}
                >
                  <span>Tous les régimes</span>
                  <span className="text-[10px] opacity-80">{students.length}</span>
                </button>
                <button
                  onClick={() => setSelectedRegime('subventionne')}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                    selectedRegime === 'subventionne' ? 'bg-blue-600 text-white shadow-sm' : 'bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200'
                  }`}
                >
                  <span>★ Subventionnés (55k)</span>
                  <span className="text-[10px] font-mono opacity-80">
                    {students.filter(s => s.estSubventionne).length}
                  </span>
                </button>
                <button
                  onClick={() => setSelectedRegime('standard')}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-between ${
                    selectedRegime === 'standard' ? 'bg-accent text-cream shadow-sm' : 'bg-bg text-ink hover:bg-chip'
                  }`}
                >
                  <span>Régime Standard</span>
                  <span className="text-[10px] font-mono opacity-80">
                    {students.filter(s => !s.estSubventionne).length}
                  </span>
                </button>
              </div>
            </div>

            {/* Checkbox filter for Relances */}
            <div className="pt-2 border-t border-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={relanceOnly}
                  onChange={(e) => setRelanceOnly(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent w-4 h-4"
                />
                <span className="text-xs font-bold text-ink">Afficher uniquement les impayés (% &gt; 0%)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Side: Matrix Table (Matching Excel Image) */}
        <div className="lg:col-span-3">
          <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-bg flex items-center justify-between">
              <span className="text-xs font-extrabold text-ink uppercase tracking-wider">
                Tableau de Suivi par Tranche ({filteredStudents.length} Élève(s))
              </span>
              <span className="text-[11px] text-ink-faint">
                Format matrice Excel — Coloration dynamique Tranches 1-2-3
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg border-b border-border text-[11px] font-extrabold text-ink-faint uppercase tracking-wider">
                    <th className="px-4 py-3">FULL NAME</th>
                    <th className="px-3 py-3">CLASS</th>
                    <th className="px-3 py-3">SECTION</th>
                    <th className="px-3 py-3">MATRICULE</th>
                    <th className="px-3 py-3 text-center">TRANCHE 1</th>
                    <th className="px-3 py-3 text-center">TRANCHE 2</th>
                    <th className="px-3 py-3 text-center">TRANCHE 3</th>
                    <th className="px-3 py-3 text-right">% TO PAY</th>
                    <th className="px-4 py-3 text-right">RELANCE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row text-xs">
                  {filteredStudents.length > 0 ? (
                    filteredStudents.map((s) => (
                      <tr
                        key={s.id}
                        className={`transition-colors ${
                          s.estSubventionne
                            ? 'bg-blue-50/40 hover:bg-blue-50/70 border-l-4 border-l-blue-600'
                            : 'hover:bg-row-hover'
                        }`}
                      >
                        {/* FULL NAME */}
                        <td className="px-4 py-3 font-extrabold text-ink whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{s.nom} {s.prenom}</span>
                            {s.estSubventionne && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                ★ Subv. (55k)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* CLASS */}
                        <td className="px-3 py-3 font-bold text-ink-soft whitespace-nowrap">
                          {s.classeNom}
                        </td>

                        {/* SECTION */}
                        <td className="px-3 py-3 font-semibold text-ink-faint uppercase text-[10px]">
                          {s.sectionNom}
                        </td>

                        {/* MATRICULE */}
                        <td className="px-3 py-3 font-mono font-semibold text-ink-soft text-[11px]">
                          {s.matricule}
                        </td>

                        {/* TRANCHE 1 */}
                        <td className="px-3 py-3 text-center">
                          {s.tranche1Paid ? (
                            <span className="inline-block w-full py-1 px-2 rounded bg-green-bg text-green font-bold text-[11px]">
                              OK
                            </span>
                          ) : (
                            <span className="inline-block w-full py-1 px-2 rounded bg-red-bg text-accent font-bold text-[11px]">
                              T1 NOK
                            </span>
                          )}
                        </td>

                        {/* TRANCHE 2 */}
                        <td className="px-3 py-3 text-center">
                          {s.tranche2Paid ? (
                            <span className="inline-block w-full py-1 px-2 rounded bg-green-bg text-green font-bold text-[11px]">
                              OK
                            </span>
                          ) : (
                            <span className="inline-block w-full py-1 px-2 rounded bg-red-bg text-accent font-bold text-[11px]">
                              T2 NOK
                            </span>
                          )}
                        </td>

                        {/* TRANCHE 3 */}
                        <td className="px-3 py-3 text-center">
                          {s.tranche3Paid ? (
                            <span className="inline-block w-full py-1 px-2 rounded bg-green-bg text-green font-bold text-[11px]">
                              OK
                            </span>
                          ) : (
                            <span className="inline-block w-full py-1 px-2 rounded bg-chip text-ink-soft font-bold text-[11px]">
                              T3 NOK
                            </span>
                          )}
                        </td>

                        {/* % TO PAY */}
                        <td className="px-3 py-3 text-right font-mono font-extrabold">
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            s.pctToPay === 0
                              ? 'bg-green-bg text-green'
                              : s.pctToPay > 50
                              ? 'bg-red-bg text-accent font-bold'
                              : 'bg-chip text-ink-soft'
                          }`}>
                            {s.pctToPay}%
                          </span>
                        </td>

                        {/* RELANCE ACTION */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {s.pctToPay > 0 ? (
                            <button
                              onClick={() => handleSendWhatsAppRelance(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-green hover:opacity-90 text-cream font-bold text-[11px] rounded transition-all cursor-pointer shadow-sm"
                              title={`Relancer M./Mme ${s.nomParent} (${s.telephoneParent})`}
                            >
                              📲 WhatsApp
                            </button>
                          ) : (
                            <span className="text-[10px] text-green font-bold">À jour ✓</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-ink-faint italic text-sm">
                        Aucun élève ne correspond aux critères des slicers/filtres sélectionnés.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
