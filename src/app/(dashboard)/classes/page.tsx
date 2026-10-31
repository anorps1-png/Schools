'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useEtablissement } from '@/contexts/etablissement-context';
import { getStudentsPerClass } from '@/lib/queries/classes';
import TranchesConfig from '@/components/settings/TranchesConfig';
import { printStudentList } from '@/lib/print/printStudentList';

interface SupabaseClasse {
  id: string;
  nom: string;
  niveau: string;
  section: string | null;
  prix: number | null;
  frais_inscription: number | null;
}

export default function ClassesPage() {
  const [classesList, setClassesList] = useState<SupabaseClasse[]>([]);
  const [elevesCount, setElevesCount] = useState<Record<string, number>>({});
  const [serverElevesCount, setServerElevesCount] = useState<Record<string, number> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form states
  const [nom, setNom] = useState('');
  const [niveau, setNiveau] = useState('');
  const [section, setSection] = useState('Francophone');
  const [prix, setPrix] = useState('');
  const [fraisInscription, setFraisInscription] = useState('');

  // Edit form states
  const [editingClass, setEditingClass] = useState<SupabaseClasse | null>(null);
  const [editNom, setEditNom] = useState('');
  const [editNiveau, setEditNiveau] = useState('');
  const [editSection, setEditSection] = useState('Francophone');
  const [editPrix, setEditPrix] = useState('');
  const [editFraisInscription, setEditFraisInscription] = useState('');

  const { etablissementId, academicYearId, academicYear } = useEtablissement();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (etablissementId) fetchData();
  }, [etablissementId, academicYearId]);

  // Comptage par classe calculé en base (get_students_per_class), pour éviter
  // le fetch complet ci-dessous. Repli automatique sur elevesCount (calcul
  // client) si la RPC échoue ou n'est pas encore appliquée.
  useEffect(() => {
    if (!etablissementId) return;
    getStudentsPerClass(etablissementId, academicYearId || null)
      .then(setServerElevesCount)
      .catch(() => setServerElevesCount(null));
  }, [etablissementId, academicYearId]);

  const effectiveElevesCount = serverElevesCount ?? elevesCount;

  const fetchData = async () => {
    if (!etablissementId) return;
    setIsLoading(true);
    
    // Fetch classes filtered by etablissement & academicYearId
    let query = supabase
      .from('classes')
      .select('*')
      .eq('etablissement_id', etablissementId);

    if (academicYearId) {
      query = query.eq('annee_scolaire_id', academicYearId);
    }

    const { data: classesData, error: classesError } = await query
      .order('niveau', { ascending: true })
      .order('nom', { ascending: true });

    if (classesData) {
      setClassesList(classesData);
    } else {
      setClassesList([]);
    }

    // Fetch eleves to count them per class (filtered by etablissement & active year) with pagination
    let allElevesData: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;
    while (hasMore) {
      let elevesQuery = supabase
        .from('eleves')
        .select('classe_id')
        .eq('etablissement_id', etablissementId);
      if (academicYearId) {
        elevesQuery = elevesQuery.eq('annee_scolaire_id', academicYearId);
      }
      const { data } = await elevesQuery
        .order('id', { ascending: true })
        .range(from, from + step - 1);
      if (data && data.length > 0) {
        allElevesData = allElevesData.concat(data);
        from += step;
        if (data.length < step) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    
    const counts: Record<string, number> = {};
    allElevesData.forEach(e => {
      if (e.classe_id) {
        counts[e.classe_id] = (counts[e.classe_id] || 0) + 1;
      }
    });
    setElevesCount(counts);

    setIsLoading(false);
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { data, error } = await supabase
      .from('classes')
      .insert([
        {
          nom,
          niveau,
          section,
          prix: Number(prix) || 0,
          frais_inscription: Number(fraisInscription) || 0,
          etablissement_id: etablissementId,
          annee_scolaire_id: academicYearId || null,
        }
      ])
      .select();

    if (error) {
      alert("Erreur lors de l'ajout de la classe: " + error.message);
    } else if (data) {
      setClassesList([...classesList, ...data]);
      setShowAddModal(false);
      setNom('');
      setNiveau('');
      setSection('Francophone');
      setPrix('');
      setFraisInscription('');
      triggerToast('Classe créée avec succès !');
    }
    
    setIsSubmitting(false);
  };

  const handleStartEdit = (cls: SupabaseClasse, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setEditingClass(cls);
    setEditNom(cls.nom || '');
    setEditNiveau(cls.niveau || '');
    setEditSection(cls.section || 'Francophone');
    setEditPrix(cls.prix ? cls.prix.toString() : '');
    setEditFraisInscription(cls.frais_inscription ? cls.frais_inscription.toString() : '');
  };

  const handleEditClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    setIsSubmitting(true);

    const { data, error } = await supabase
      .from('classes')
      .update({
        nom: editNom,
        niveau: editNiveau,
        section: editSection,
        prix: Number(editPrix) || 0,
        frais_inscription: Number(editFraisInscription) || 0
      })
      .eq('id', editingClass.id)
      .select();

    if (error) {
      alert("Erreur lors de la modification de la classe: " + error.message);
    } else if (data && data.length > 0) {
      setClassesList(classesList.map(c => c.id === editingClass.id ? data[0] : c));
      setEditingClass(null);
      triggerToast('Classe modifiée avec succès !');
    }
    
    setIsSubmitting(false);
  };

  const handlePrintClass = async (cls: SupabaseClasse, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      let elevesQuery = supabase
        .from('eleves')
        .select('*')
        .eq('classe_id', cls.id)
        .eq('etablissement_id', etablissementId);

      if (academicYearId) {
        elevesQuery = elevesQuery.eq('annee_scolaire_id', academicYearId);
      }

      const [{ data: elevesData }, { data: etabData }] = await Promise.all([
        elevesQuery,
        supabase
          .from('etablissements')
          .select('nom, adresse, telephone, email, logo_url')
          .eq('id', etablissementId)
          .single()
      ]);

      printStudentList({
        title: `LISTE OFFICIELLE DES ÉLÈVES`,
        classeNom: cls.nom,
        subtitle: `Section : ${cls.section || 'Francophone'} • Niveau : ${cls.niveau || '—'}`,
        schoolName: etabData?.nom,
        schoolAddress: etabData?.adresse,
        schoolPhone: etabData?.telephone,
        schoolEmail: etabData?.email,
        schoolLogo: etabData?.logo_url,
        academicYear: academicYear || undefined,
        students: (elevesData || []).map((s: any) => ({
          id: s.id,
          matricule: s.matricule,
          nom: s.nom,
          prenom: s.prenom,
          sexe: s.sexe,
          dateNaissance: s.date_naissance,
          lieuNaissance: s.lieu_naissance,
          nomParent: s.nom_parent,
          telephoneParent: s.telephone_parent,
          classeNom: cls.nom,
        })),
      });
    } catch (err: any) {
      alert("Erreur lors de la préparation de l'impression : " + (err?.message || err));
    }
  };

  const handleDeleteClass = async (id: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Check if there are students in this class
    if (effectiveElevesCount[id] > 0) {
      alert("Impossible de supprimer cette classe car elle contient des élèves. Réaffectez les élèves d'abord.");
      return;
    }

    // bulletins.classe_id et emploi_du_temps.classe_id sont en ON DELETE
    // CASCADE : une classe vide d'élèves ACTIFS de l'année en cours peut
    // encore porter un historique (bulletins, créneaux) d'années
    // précédentes, détruit silencieusement sans cet avertissement.
    const [{ count: bulletinsCount }, { count: creneauxCount }] = await Promise.all([
      supabase.from('bulletins').select('id', { count: 'exact', head: true }).eq('classe_id', id),
      supabase.from('emploi_du_temps').select('id', { count: 'exact', head: true }).eq('classe_id', id),
    ]);

    let confirmMessage = 'Voulez-vous vraiment supprimer cette classe définitivement ?';
    if ((bulletinsCount || 0) > 0 || (creneauxCount || 0) > 0) {
      const parts: string[] = [];
      if (bulletinsCount) parts.push(`${bulletinsCount} bulletin(s)`);
      if (creneauxCount) parts.push(`${creneauxCount} créneau(x) d'emploi du temps`);
      confirmMessage = `Cette classe a un historique lié (${parts.join(', ')}), y compris d'années précédentes, qui sera détruit définitivement avec elle. Voulez-vous vraiment continuer ?`;
    }

    if (confirm(confirmMessage)) {
      const { error } = await supabase.from('classes').delete().eq('id', id);
      if (error) {
        alert("Erreur lors de la suppression: " + error.message);
      } else {
        setClassesList(classesList.filter(c => c.id !== id));
        triggerToast('Classe supprimée !');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3.5 rounded-control shadow-login z-50 flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-green flex items-center justify-center text-xs font-bold text-cream">✓</div>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-surface p-6 rounded-card border border-border shadow-sm">
        <div>
          <h1 className="text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-tight">Configuration des Classes</h1>
          <p className="text-sm text-ink-soft mt-1">Gérez les niveaux, les sections et les frais de scolarité</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-accent hover:bg-accent-hover text-cream text-sm font-bold rounded-control shadow-md shadow-cta transition-all active:scale-95"
        >
          + Nouvelle Classe
        </button>
      </div>

      {/* Contenu */}
      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <svg className="animate-spin h-8 w-8 text-ink" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : classesList.length === 0 ? (
        <div className="bg-surface rounded-card border border-dashed border-border p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-chip rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">🏫</span>
          </div>
          <h3 className="text-lg font-bold text-ink mb-2">Aucune classe configurée</h3>
          <p className="text-ink-soft text-sm max-w-md mb-6">Créez votre première classe pour commencer à y inscrire des élèves et définir les frais de scolarité associés.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-5 py-2 bg-ink hover:bg-ink text-cream rounded-control text-sm font-bold transition-colors"
          >
            Créer ma première classe
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {classesList.map(cls => (
            <Link key={cls.id} href={`/classes/${encodeURIComponent(cls.id)}`} className="group block relative bg-surface p-6 rounded-card shadow-sm border border-border hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              {/* Bouton d'impression (visible au hover) */}
              <button
                onClick={(e) => handlePrintClass(cls, e)}
                className="absolute top-4 right-24 w-8 h-8 flex items-center justify-center bg-chip text-ink rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-chip-hover"
                title="Imprimer la liste des élèves de cette classe"
              >
                🖨️
              </button>
              {/* Bouton de modification (visible au hover) */}
              <button
                onClick={(e) => handleStartEdit(cls, e)}
                className="absolute top-4 right-14 w-8 h-8 flex items-center justify-center bg-chip text-ink rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-chip-hover"
                title="Modifier la classe"
              >
                ✏️
              </button>
              {/* Bouton de suppression (visible au hover) */}
              <button
                onClick={(e) => handleDeleteClass(cls.id, e)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-red-bg text-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-bg"
                title="Supprimer la classe"
              >
                ✕
              </button>
              
              <div className="flex justify-between items-start mb-4">
                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md ${
                  cls.section === 'Anglophone' ? 'bg-chip text-ink-soft' : 'bg-chip text-ink'
                }`}>
                  {cls.section || 'Francophone'}
                </span>
              </div>
              
              <h2 className="text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-tight mb-1">{cls.nom}</h2>
              <p className="text-sm font-medium text-ink-soft mb-4">{cls.niveau}</p>
              
              <div className="bg-bg rounded-control p-3 mb-4">
                <p className="text-xs text-ink-soft uppercase font-bold mb-1">Scolarité Annuelle</p>
                <p className="text-lg font-extrabold text-ink">
                  {cls.prix ? `${new Intl.NumberFormat('fr-FR').format(cls.prix)} FCFA` : '0 FCFA'}
                </p>
              </div>
              
              <div className="flex justify-between items-center text-sm border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green"></span>
                  <span className="text-ink-soft font-semibold">{effectiveElevesCount[cls.id] || 0} Élèves</span>
                </div>
                <span className="text-ink-faint font-bold group-hover:text-ink transition-colors">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Modal de modification */}
      {editingClass && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login overflow-hidden">
            <div className="bg-bg p-6 border-b border-border flex justify-between items-center">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Modifier la Classe</h3>
                <p className="text-xs text-ink-soft mt-1">Modifiez les détails de la classe</p>
              </div>
              <button onClick={() => setEditingClass(null)} className="w-8 h-8 flex items-center justify-center bg-surface border border-border rounded-full text-ink-faint hover:text-ink hover:bg-chip transition-colors">
                ✕
              </button>
            </div>
            
            <form onSubmit={handleEditClass} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Nom exact de la classe *</label>
                  <input type="text" value={editNom} onChange={(e) => setEditNom(e.target.value)} required placeholder="Ex: 6ème A" className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                </div>
                
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Niveau *</label>
                  <input type="text" value={editNiveau} onChange={(e) => setEditNiveau(e.target.value)} required placeholder="Ex: 6ème" className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                </div>
                
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Sous-système</label>
                  <select value={editSection} onChange={(e) => setEditSection(e.target.value)} className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all">
                    <option value="Francophone">Francophone</option>
                    <option value="Anglophone">Anglophone</option>
                    <option value="Bilingue">Bilingue</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Scolarité Globale (FCFA) *</label>
                <div className="relative">
                  <input type="number" value={editPrix} onChange={(e) => setEditPrix(e.target.value)} required placeholder="Ex: 250000" min="0" className="w-full px-4 py-3 pl-12 bg-bg border border-border rounded-control text-lg text-ink font-bold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint font-bold">💰</span>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Frais d'inscription (FCFA)</label>
                <div className="relative">
                  <input type="number" value={editFraisInscription} onChange={(e) => setEditFraisInscription(e.target.value)} placeholder="Ex: 25000" min="0" className="w-full px-4 py-3 pl-12 bg-bg border border-border rounded-control text-lg text-ink font-bold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint font-bold">🎫</span>
                </div>
                <p className="text-[11px] text-ink-faint mt-1.5">Utilisé par l'import Excel pour affecter les paiements à l'inscription avant les tranches de scolarité.</p>
              </div>

              {etablissementId && academicYearId && (
                <TranchesConfig
                  etablissementId={etablissementId}
                  anneeScolaireId={academicYearId}
                  classeId={editingClass.id}
                  classePrix={Number(editPrix) || undefined}
                />
              )}

              <div className="pt-6 flex gap-3">
                <button type="button" onClick={() => setEditingClass(null)} className="flex-1 px-4 py-3 bg-chip text-ink-soft rounded-control text-sm font-bold hover:bg-chip transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-3 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-bold shadow-md shadow-cta transition-all disabled:opacity-50">
                  {isSubmitting ? 'Modification...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal d'ajout */}
      {showAddModal && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login overflow-hidden">
            <div className="bg-bg p-6 border-b border-border flex justify-between items-center">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Nouvelle Classe</h3>
                <p className="text-xs text-ink-soft mt-1">Configurez une classe et son tarif</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center bg-surface border border-border rounded-full text-ink-faint hover:text-ink hover:bg-chip transition-colors">
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAddClass} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Nom exact de la classe *</label>
                  <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required placeholder="Ex: 6ème A" className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                </div>
                
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Niveau *</label>
                  <input type="text" value={niveau} onChange={(e) => setNiveau(e.target.value)} required placeholder="Ex: 6ème" className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                </div>
                
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Sous-système</label>
                  <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full px-4 py-3 bg-bg border border-border rounded-control text-sm text-ink font-semibold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all">
                    <option value="Francophone">Francophone</option>
                    <option value="Anglophone">Anglophone</option>
                    <option value="Bilingue">Bilingue</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Scolarité Globale (FCFA) *</label>
                <div className="relative">
                  <input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} required placeholder="Ex: 250000" min="0" className="w-full px-4 py-3 pl-12 bg-bg border border-border rounded-control text-lg text-ink font-bold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint font-bold">💰</span>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-2">Frais d'inscription (FCFA)</label>
                <div className="relative">
                  <input type="number" value={fraisInscription} onChange={(e) => setFraisInscription(e.target.value)} placeholder="Ex: 25000" min="0" className="w-full px-4 py-3 pl-12 bg-bg border border-border rounded-control text-lg text-ink font-bold focus:ring-2 focus:border-accent focus:border-accent outline-none transition-all" />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint font-bold">🎫</span>
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-3 bg-chip text-ink-soft rounded-control text-sm font-bold hover:bg-chip transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-3 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-bold shadow-md shadow-cta transition-all disabled:opacity-50">
                  {isSubmitting ? 'Création...' : 'Créer la classe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
