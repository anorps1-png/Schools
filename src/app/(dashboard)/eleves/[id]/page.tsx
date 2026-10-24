'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeftIcon,
  DownloadIcon,
  PhoneIcon,
  MailIcon
} from '@/components/icons';
import { Eleve, Paiement, NoteMatiere, TransactionPaiement, Classe, DisciplineIncident } from '@/types/domain';
import { createClient } from '@/lib/supabase/client';
import { addPayment, updatePayment, softDeletePayment, updateStudent } from '@/lib/queries/eleves';
import { paiementSchema, validateOrThrow } from '@/lib/validation/schemas';
import { useEtablissement } from '@/contexts/etablissement-context';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function FicheElevePage({ params }: PageProps) {
  const resolvedParams = use(params);
  const studentId = resolvedParams.id;
  const { etablissementId } = useEtablissement();
  const supabase = useMemo(() => createClient(), []);

  const [students, setStudents] = useState<Eleve[]>([]);
  const [classesList, setClassesList] = useState<Classe[]>([]);
  const [teachersMap, setTeachersMap] = useState<Record<string, string>>({});
  const [tranches, setTranches] = useState<any[]>([]);
  const [student, setStudent] = useState<Eleve | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'finance' | 'grades' | 'discipline'>('info');

  useEffect(() => {
    if (!etablissementId) return;
    const fetchData = async () => {
      // Fetch classes
      const { data: classesData } = await supabase
        .from('classes')
        .select('*')
        .eq('etablissement_id', etablissementId);
      if (classesData) setClassesList(classesData);

      // Fetch teachers (for displaying names instead of raw ids on notes)
      const { data: teachersData } = await supabase
        .from('enseignants')
        .select('id, nom, prenom')
        .eq('etablissement_id', etablissementId);
      if (teachersData) {
        const map: Record<string, string> = {};
        teachersData.forEach((t: any) => {
          map[t.id] = `${t.prenom || ''} ${t.nom || ''}`.trim();
        });
        setTeachersMap(map);
      }

      // Fetch student with payments, notes, and discipline
      const { data: studentData } = await supabase
        .from('eleves')
        .select('*, paiements(*), notes(*), discipline(*)')
        .eq('id', studentId)
        .eq('etablissement_id', etablissementId)
        .single();

      if (studentData) {
        // Fetch all students in the same class to calculate rank
        const { data: classmatesData } = await supabase
          .from('eleves')
          .select('id, notes(*)')
          .eq('classe_id', studentData.classe_id)
          .eq('etablissement_id', etablissementId);
          
        if (classmatesData) {
          // Transform notes if needed to match interface
          const mappedClassmates = classmatesData.map(c => ({
            id: c.id,
            classeId: studentData.classe_id,
            notes: c.notes?.map((n: any) => ({
              id: n.id,
              note: Number(n.note),
              trimestre: n.trimestre,
              matiereId: n.matiere || n.matiere_id,
              evaluationMaternelle: n.evaluation_maternelle,
              coefficient: n.coefficient !== null && n.coefficient !== undefined ? Number(n.coefficient) : undefined
            })) || []
          }));
          setStudents(mappedClassmates as any);
        }

        // Fetch tranches scolarite — propres à la classe de l'élève (chaque
        // classe a son propre prix, donc ses propres montants de tranche).
        if (studentData.annee_scolaire_id && studentData.classe_id) {
          const { data: tranchesData } = await supabase
            .from('tranches_scolarite')
            .select('*')
            .eq('etablissement_id', etablissementId)
            .eq('annee_scolaire_id', studentData.annee_scolaire_id)
            .eq('classe_id', studentData.classe_id)
            .order('ordre', { ascending: true });
          if (tranchesData) {
            setTranches(tranchesData);
          }
        }

        const mappedStudent = {
          id: studentData.id,
          matricule: studentData.matricule,
          nom: studentData.nom,
          prenom: studentData.prenom,
          sexe: studentData.sexe,
          classeId: studentData.classe_id,
          nomParent: studentData.nom_parent,
          telephoneParent: studentData.telephone_parent,
          emailParent: studentData.email_parent || 'N/A',
          dateNaissance: studentData.date_naissance || '2012-01-01',
          lieuNaissance: studentData.lieu_naissance || 'Yaoundé',
          dateInscription: studentData.date_inscription,
          statut: studentData.statut,
          paiements: studentData.paiements?.map((p: any) => ({
            id: p.id,
            eleveId: p.eleve_id,
            montant: Number(p.montant),
            date: p.date,
            typeFrais: p.type_frais,
            statut: p.statut,
            reference: p.reference,
            modePaiement: p.mode_paiement,
            trancheId: p.tranche_id
          })) || [],
          notes: studentData.notes?.map((n: any) => ({
            id: n.id,
            note: Number(n.note),
            trimestre: n.trimestre,
            matiereId: n.matiere || n.matiere_id,
            evaluationMaternelle: n.evaluation_maternelle,
            enseignantId: n.enseignant_id,
            coefficient: n.coefficient !== null && n.coefficient !== undefined ? Number(n.coefficient) : undefined
          })) || [],
          discipline: studentData.discipline?.map((d: any) => ({
            id: d.id,
            eleveId: d.eleve_id,
            dateIncident: d.date_incident,
            typeIncident: d.type_incident,
            motif: d.motif,
            sanction: d.sanction,
            statut: d.statut
          })) || []
        };
        setStudent(mappedStudent as any);
      }
      setIsLoaded(true);
    };

    if (typeof window !== 'undefined') {
      fetchData();
    }
  }, [studentId, etablissementId, supabase]);

  // Form states for adding payment
  const [payAmount, setPayAmount] = useState('');
  const [payType, setPayType] = useState<Paiement['typeFrais']>('Scolarité');
  const [payMethod, setPayMethod] = useState('Orange Money');
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [payDate, setPayDate] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payTrancheId, setPayTrancheId] = useState('');

  // Form states for editing/adding grades
  const [selectedTrimestre, setSelectedTrimestre] = useState('Trimestre 1');
  const [showAddGradeModal, setShowAddGradeModal] = useState(false);
  const [newGradeMatiere, setNewGradeMatiere] = useState('');
  const [newGradeValue, setNewGradeValue] = useState('');
  const [newGradeCoef, setNewGradeCoef] = useState('1');
  const [newGradeType, setNewGradeType] = useState('Classique'); // Classique ou Maternelle
  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  const [editingGradeValue, setEditingGradeValue] = useState<number | string>('');

  // Form states for adding discipline
  const [showAddDisciplineModal, setShowAddDisciplineModal] = useState(false);
  const [newDisciplineType, setNewDisciplineType] = useState('Absence');
  const [newDisciplineMotif, setNewDisciplineMotif] = useState('');
  const [newDisciplineSanction, setNewDisciplineSanction] = useState('');
  const [newDisciplineStatut, setNewDisciplineStatut] = useState('Non notifié');

  // Form states for editing student general info
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editNom, setEditNom] = useState('');
  const [editPrenom, setEditPrenom] = useState('');
  const [editMatricule, setEditMatricule] = useState('');
  const [editSexe, setEditSexe] = useState<'M' | 'F'>('M');
  const [editClasseId, setEditClasseId] = useState('');
  const [editDateNaissance, setEditDateNaissance] = useState('');
  const [editLieuNaissance, setEditLieuNaissance] = useState('');
  const [editNomParent, setEditNomParent] = useState('');
  const [editTelephoneParent, setEditTelephoneParent] = useState('');
  const [editEmailParent, setEditEmailParent] = useState('');
  const [editStatut, setEditStatut] = useState<'actif' | 'suspendu'>('actif');

  const handleOpenEditInfo = () => {
    if (!student) return;
    setEditNom(student.nom || '');
    setEditPrenom(student.prenom || '');
    setEditMatricule(student.matricule || '');
    setEditSexe((student.sexe as 'M' | 'F') || 'M');
    setEditClasseId(student.classeId || '');
    setEditDateNaissance(student.dateNaissance || '');
    setEditLieuNaissance(student.lieuNaissance || '');
    setEditNomParent(student.nomParent || '');
    setEditTelephoneParent(student.telephoneParent || '');
    setEditEmailParent(student.emailParent === 'N/A' ? '' : (student.emailParent || ''));
    setEditStatut((student.statut as any) === 'suspendu' ? 'suspendu' : 'actif');
    setShowEditInfoModal(true);
  };

  const handleSaveEditInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;

    if (!editNom.trim() || !editPrenom.trim() || !editMatricule.trim()) {
      alert("Le nom, prénom et matricule sont obligatoires.");
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const payload: Record<string, any> = {
        nom: editNom.trim(),
        prenom: editPrenom.trim(),
        matricule: editMatricule.trim(),
        sexe: editSexe,
        classe_id: editClasseId || null,
        date_naissance: editDateNaissance || null,
        lieu_naissance: editLieuNaissance.trim() || null,
        nom_parent: editNomParent.trim() || null,
        telephone_parent: editTelephoneParent.trim() || null,
        email_parent: editEmailParent.trim() || null,
        statut: editStatut,
      };

      await updateStudent(student.id, payload);

      setStudent({
        ...student,
        nom: payload.nom,
        prenom: payload.prenom,
        matricule: payload.matricule,
        sexe: payload.sexe,
        classeId: payload.classe_id,
        dateNaissance: payload.date_naissance,
        lieuNaissance: payload.lieu_naissance,
        nomParent: payload.nom_parent,
        telephoneParent: payload.telephone_parent,
        emailParent: payload.email_parent || 'N/A',
        statut: payload.statut,
      });

      setShowEditInfoModal(false);
      triggerToast("Informations de l'élève modifiées avec succès !");
    } catch (err: any) {
      alert("Erreur lors de la modification : " + (err?.message || err));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleSaveGrade = async (gradeId: string, isMaternelle: boolean) => {
    if (!student) return;

    const updatedNotes = [...(student.notes || [])];
    const gradeIndex = updatedNotes.findIndex(g => g.id === gradeId);
    
    if (gradeIndex !== -1) {
      const updatePayload: any = {};

      if (isMaternelle) {
        updatePayload.evaluation_maternelle = editingGradeValue;
        updatedNotes[gradeIndex] = { ...updatedNotes[gradeIndex], evaluationMaternelle: editingGradeValue as any };
      } else {
        const numVal = Number(editingGradeValue);
        if (numVal >= 0 && numVal <= 20) {
          updatePayload.note = numVal;
          updatedNotes[gradeIndex] = { ...updatedNotes[gradeIndex], note: numVal };
        } else {
          alert('La note doit être comprise entre 0 et 20.');
          return;
        }
      }
      
      const { error } = await supabase.from('notes').update(updatePayload).eq('id', gradeId);
      
      if (error) {
        alert("Erreur lors de la mise à jour de la note : " + error.message);
        return;
      }

      const updatedStudent = { ...student, notes: updatedNotes };
      setStudent(updatedStudent);
      triggerToast("Note mise à jour avec succès");
    }
    setEditingGradeId(null);
  };

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  if (!isLoaded) {
    return (
      <div className="text-center py-16 bg-surface border border-border rounded-card shadow-sm">
        <p className="text-ink-soft">Chargement de la fiche élève...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="text-center py-16 bg-surface border border-border rounded-card shadow-sm space-y-4">
        <h2 className="text-xl font-bold text-ink">Élève introuvable</h2>
        <p className="text-ink-soft">L&apos;identifiant fourni ne correspond à aucun élève de notre base.</p>
        <Link
          href="/eleves"
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-sm font-semibold transition-colors"
        >
          Retourner à la liste
        </Link>
      </div>
    );
  }

  // Financial calculations
  const classObj = classesList.find(c => c.nom === student.classeId || c.id === student.classeId);
  const fraisInscription = classObj ? (Number((classObj as any).frais_inscription) || 0) : 0;

  // Les frais totaux annuels incluent les frais d'inscription
  let rawTotalDue: number | null = null;
  if (classObj && typeof classObj.prix === 'number') {
    const tranchesTotal = tranches.reduce((sum, t) => sum + (Number(t.montant) || 0), 0);
    // Si classObj.prix correspond uniquement à la somme des tranches de scolarité, on y ajoute l'inscription
    if (tranchesTotal > 0 && Math.abs(classObj.prix - tranchesTotal) < 10) {
      rawTotalDue = classObj.prix + fraisInscription;
    } else {
      // Sinon prix englobe déjà le tarif global annuel (incluant l'inscription)
      rawTotalDue = classObj.prix;
    }
  }

  const feeConfigured = rawTotalDue !== null && rawTotalDue > 0;
  const totalDue = feeConfigured ? rawTotalDue : null;

  // Le montant payé inclut à la fois la Scolarité ET les frais d'Inscription
  const totalPaid = (student.paiements || [])
    .filter(p => p.statut === 'paid' && (p.typeFrais === 'Scolarité' || p.typeFrais === 'Inscription'))
    .reduce((sum, p) => sum + p.montant, 0);
  const pendingAmount = totalDue !== null ? Math.max(0, totalDue - totalPaid) : null;
  const paymentProgressPct = totalDue !== null && totalDue > 0 ? (totalPaid / totalDue) * 100 : 0;

  // Calcul des tranches échues
  const currentDate = new Date().toISOString().split('T')[0];
  const tranchesEchues = tranches.filter(t => t.date_limite < currentDate);
  const montantTranchesEchues = tranchesEchues.reduce((sum, t) => sum + (Number(t.montant) || 0), 0);
  const pctEchu = tranchesEchues.reduce((sum, t) => sum + Number(t.pourcentage || 0), 0) / 100;
  
  const expectedPaid = montantTranchesEchues > 0
    ? montantTranchesEchues
    : (totalDue !== null ? totalDue * pctEchu : 0);
  const resteAPayerEchu = Math.max(0, expectedPaid - totalPaid);
  
  let financialStatus: 'paid' | 'partial' | 'late' | 'unpaid' = 'unpaid';
  if (totalDue !== null && totalPaid >= totalDue && totalDue > 0) {
    financialStatus = 'paid';
  } else if (totalDue !== null && totalPaid < expectedPaid && totalDue > 0) {
    financialStatus = 'late';
  } else if (totalPaid > 0) {
    financialStatus = 'partial';
  }

  // Grade calculations — filtrées sur le trimestre sélectionné (avant, la
  // page entière était câblée en dur sur 'Trimestre 1', y compris le
  // formulaire d'ajout de note : une note saisie en Trimestre 2/3 polluait
  // silencieusement la moyenne du Trimestre 1).
  const currentTermGrades = (student.notes || []).filter(g => g.trimestre === selectedTrimestre);

  const calculateWeightedAverage = (gradesList: NoteMatiere[]) => {
    if (gradesList.length === 0) return 0;
    const totalPoints = gradesList.reduce((sum, g) => sum + ((g.note || 0) * (g.coefficient || 1)), 0);
    const totalCoefs = gradesList.reduce((sum, g) => sum + (g.coefficient || 1), 0);
    return totalCoefs > 0 ? totalPoints / totalCoefs : 0;
  };

  const avgCurrentTerm = calculateWeightedAverage(currentTermGrades);

  // NOUVEAUX CALCULS (Rang, Points, Mention)
  const classmates = students.filter(s => s.classeId === student.classeId);
  const getStudentAvg = (s: Eleve) => calculateWeightedAverage((s.notes || []).filter(g => g.trimestre === selectedTrimestre));
  const allAvgs = classmates.map(getStudentAvg).sort((a,b) => b - a);
  const myRank = avgCurrentTerm > 0 ? allAvgs.indexOf(avgCurrentTerm) + 1 : '--';
  const totalPointsCurrentTerm = currentTermGrades.filter(g => ((g.note || 0) || 0) !== undefined).reduce((sum, g) => sum + ((((g.note || 0) || 0) || 0) * 1), 0);
  const mentionCurrentTerm = avgCurrentTerm >= 16 ? 'Très Bien' : avgCurrentTerm >= 14 ? 'Bien' : avgCurrentTerm >= 12 ? 'Assez Bien' : avgCurrentTerm >= 10 ? 'Passable' : 'Insuffisant';

  // Handle report card download (print page)
  const handleDownloadBulletin = () => {
    if (student?.classeId) {
      window.open(`/evaluations/${student.classeId}/bulletin/${student.id}?term=${encodeURIComponent(selectedTrimestre)}`, '_blank');
    } else {
      triggerToast("Classe de l'élève introuvable.");
    }
  };

  // Handle adding/editing payment initialization
  const handleOpenAddPayment = () => {
    setEditingPaymentId(null);
    setPayAmount('');
    setPayType('Scolarité');
    setPayMethod('Orange Money');
    setPayDate(new Date().toISOString().split('T')[0]);
    // paiements.reference est UNIQUE globalement (toute la plateforme, pas
    // seulement cet établissement) : espace élargi à 6 chiffres pour limiter
    // la probabilité de collision inter-écoles, au-delà des 9000 valeurs
    // précédentes.
    setPayReference(`REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`);
    setPayTrancheId('');
    setShowAddPaymentModal(true);
  };

  const handleStartEditPayment = (pay: Paiement) => {
    setEditingPaymentId(pay.id);
    setPayAmount(String(pay.montant));
    setPayType(pay.typeFrais);
    setPayMethod(pay.modePaiement);
    setPayDate(pay.date);
    setPayReference(pay.reference);
    setPayTrancheId(pay.trancheId || '');
    setShowAddPaymentModal(true);
  };

  const handleDeletePayment = async (payId: string) => {
    if (!confirm("Voulez-vous vraiment annuler ce paiement ? Il sera retiré des totaux et des rapports, mais restera récupérable.")) {
      return;
    }

    // Soft-delete : le paiement est masqué et restaurable, jamais détruit. Un
    // encaissement effacé physiquement rendait tout rapprochement comptable
    // faux sans laisser de trace. Passe transparemment par le miroir SQLite
    // local en Electron (src/lib/supabase/client.ts + localAggregates.ts).
    try {
      await softDeletePayment(payId);
    } catch (err: any) {
      alert("Erreur lors de l'annulation du paiement : " + err.message);
      return;
    }

    if (student) {
      const updatedPayments = (student.paiements || []).filter(p => p.id !== payId);
      setStudent({
        ...student,
        paiements: updatedPayments
      });
    }

    triggerToast("Paiement annulé.");
  };

  // Handle adding payment
  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;

    const amountVal = Number(payAmount);
    if (!amountVal || amountVal <= 0) {
      alert("Veuillez saisir un montant valide.");
      return;
    }

    const reference = payReference.trim() || `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const dateVal = payDate || new Date().toISOString().split('T')[0];
    const trancheIdVal = payType === 'Scolarité' && payTrancheId ? payTrancheId : null;

    const paymentPayload = {
      eleve_id: student.id,
      montant: amountVal,
      date: dateVal,
      type_frais: payType,
      statut: 'paid',
      reference: reference,
      mode_paiement: payMethod,
      tranche_id: trancheIdVal,
    };

    // Même validation qu'en ligne, appliquée avant la mise en file d'attente
    // hors-ligne : un paiement invalide ne doit pas non plus pouvoir être mis
    // en attente (la file rejoue les paiements bruts, sans revalidation).
    try {
      validateOrThrow(paiementSchema, paymentPayload, 'Paiement invalide');
    } catch (err: any) {
      alert("Erreur : " + err.message);
      return;
    }

    let newPaymentObj: Paiement | null = null;

    // addPayment applique paiementSchema (montant positif et fini, date et
    // référence obligatoires, mode et type en enum) et passe transparemment
    // par le miroir SQLite local en Electron.
    try {
      const payData = await addPayment(paymentPayload, etablissementId!);
      if (payData && payData.length > 0) {
        const p = payData[0];
        newPaymentObj = {
          id: p.id,
          eleveId: p.eleve_id,
          montant: Number(p.montant),
          date: p.date,
          typeFrais: p.type_frais as any,
          statut: p.statut as any,
          reference: p.reference,
          modePaiement: p.mode_paiement as any,
          trancheId: p.tranche_id
        };
      }
    } catch (err: any) {
      alert("Erreur lors de l'enregistrement du paiement : " + err.message);
      return;
    }

    if (newPaymentObj) {
      const updatedStudent: Eleve = {
        ...student,
        paiements: [newPaymentObj, ...(student.paiements || [])]
      };
      setStudent(updatedStudent);
    }

    // Cleanup form and close modal
    setPayAmount('');
    setPayDate('');
    setPayReference('');
    setPayTrancheId('');
    setShowAddPaymentModal(false);
    triggerToast(`Paiement de ${new Intl.NumberFormat('fr-FR').format(amountVal)} FCFA validé.`);
  };

  // Handle editing payment
  const handleEditPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student || !editingPaymentId) return;

    const amountVal = Number(payAmount);
    if (!amountVal || amountVal <= 0) {
      alert("Veuillez saisir un montant valide.");
      return;
    }

    const dateVal = payDate || new Date().toISOString().split('T')[0];
    const trancheIdVal = payType === 'Scolarité' && payTrancheId ? payTrancheId : null;
    const paymentFields = {
      montant: amountVal,
      type_frais: payType,
      mode_paiement: payMethod,
      date: dateVal,
      reference: payReference,
      tranche_id: trancheIdVal,
    };

    // Même validation qu'à la création : l'édition acceptait auparavant une
    // date ou une référence vides.
    try {
      validateOrThrow(paiementSchema, { ...paymentFields, eleve_id: student.id }, 'Paiement invalide');
    } catch (err: any) {
      alert("Erreur : " + err.message);
      return;
    }

    try {
      await updatePayment(editingPaymentId, { ...paymentFields, eleve_id: student.id });
    } catch (err: any) {
      alert("Erreur lors de la modification du paiement : " + err.message);
      return;
    }

    const updatedPayments = (student.paiements || []).map(p => {
      if (p.id === editingPaymentId) {
        return {
          ...p,
          montant: amountVal,
          typeFrais: payType,
          modePaiement: payMethod as any,
          date: dateVal,
          reference: payReference,
          trancheId: trancheIdVal
        };
      }
      return p;
    });

    setStudent({
      ...student,
      paiements: updatedPayments
    });

    // Cleanup form and close modal
    setPayAmount('');
    setPayDate('');
    setPayReference('');
    setPayTrancheId('');
    setEditingPaymentId(null);
    setShowAddPaymentModal(false);
    triggerToast("Paiement modifié avec succès.");
  };

  // Handle adding grade
  const handleAddGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;

    if (!newGradeMatiere.trim()) {
      alert("Veuillez saisir le nom de la matière.");
      return;
    }

    const payload: any = {
      eleve_id: student.id,
      matiere: newGradeMatiere,
      trimestre: selectedTrimestre,
      coefficient: Number(newGradeCoef) || 1,
      etablissement_id: etablissementId
    };

    if (newGradeType === 'Maternelle') {
      payload.evaluation_maternelle = newGradeValue;
    } else {
      const n = Number(newGradeValue);
      if (n < 0 || n > 20) {
        alert("La note doit être entre 0 et 20");
        return;
      }
      payload.note = n;
    }

    const { data: gradeData, error } = await supabase.from('notes').insert([payload]).select();

    if (error) {
      alert("Erreur lors de l'ajout de la note: " + error.message);
      return;
    }

    if (gradeData && gradeData.length > 0) {
      const g = gradeData[0];
      const newGradeObj = {
        id: g.id,
        note: Number(g.note),
        trimestre: g.trimestre,
        matiereId: g.matiere || g.matiere_id,
        evaluationMaternelle: g.evaluation_maternelle,
        enseignantId: g.enseignant_id
      };

      const updatedStudent = {
        ...student,
        notes: [...(student.notes || []), newGradeObj]
      };
      setStudent(updatedStudent as any);
    }

    setNewGradeMatiere('');
    setNewGradeValue('');
    setShowAddGradeModal(false);
    triggerToast(`Note ajoutée avec succès !`);
  };

  // Handle adding discipline incident
  const handleAddDiscipline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;

    if (!newDisciplineMotif.trim()) {
      alert("Veuillez saisir un motif.");
      return;
    }

    const payload = {
      eleve_id: student.id,
      date_incident: new Date().toISOString().split('T')[0],
      type_incident: newDisciplineType,
      motif: newDisciplineMotif,
      sanction: newDisciplineSanction,
      statut: newDisciplineStatut,
      etablissement_id: etablissementId
    };

    const { data: discData, error } = await supabase.from('discipline').insert([payload]).select();

    if (error) {
      alert("Erreur lors de l'ajout de l'incident: " + error.message);
      return;
    }

    if (discData && discData.length > 0) {
      const d = discData[0];
      const newDiscObj: DisciplineIncident = {
        id: d.id,
        eleveId: d.eleve_id,
        dateIncident: d.date_incident,
        typeIncident: d.type_incident,
        motif: d.motif,
        sanction: d.sanction,
        statut: d.statut
      };

      const updatedStudent = {
        ...student,
        discipline: [newDiscObj, ...(student.discipline || [])]
      };
      setStudent(updatedStudent as any);
    }

    setNewDisciplineMotif('');
    setNewDisciplineSanction('');
    setNewDisciplineStatut('Non notifié');
    setShowAddDisciplineModal(false);
    triggerToast(`Incident ajouté avec succès !`);
  };

  const formatFCFA = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
  };

  const displayClasse = classesList.find(c => c.id === student.classeId)?.nom || student.classeId;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3.5 rounded-control shadow-login z-50 flex items-center gap-3 animate-fade-up">
          <div className="w-5 h-5 rounded-full bg-green flex items-center justify-center text-xs font-bold text-cream">✓</div>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Back button and title */}
      <div className="flex items-center gap-4">
        <Link
          href="/eleves"
          className="p-2 bg-surface border border-border hover:border-border rounded-control text-ink-soft transition-colors"
        >
          <ChevronLeftIcon size={20} />
        </Link>
        <div>
          <h1 className="text-[26px] lg:text-[32px] font-extrabold text-ink tracking-[-1px] leading-tight">
            Fiche Élève : {student.nom} {student.prenom}
          </h1>
          <p className="text-xs text-ink-soft">
            Matricule : <span className="font-mono font-semibold">{student.matricule}</span> • Classe : <span className="font-semibold">{displayClasse}</span>
          </p>
        </div>
      </div>

      {/* Main Student Header Card */}
      <div className="bg-surface rounded-card border border-border p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full font-black text-2xl flex items-center justify-center border shadow-inner ${
            student.sexe === 'F' 
              ? 'bg-red-bg text-accent border-transparent'
              : 'bg-chip text-ink-soft border-transparent'
          }`}>
            {(student.prenom || '')[0] || ''}{(student.nom || '')[0] || ''}
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">{student.nom} {student.prenom}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-ink-soft font-medium">
              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                student.sexe === 'F' ? 'bg-chip text-ink-soft' : 'bg-chip text-ink-soft'
              }`}>
                {student.sexe}
              </span>
              <span>• Né(e) le {student.dateNaissance} à {student.lieuNaissance}</span>
              <span>• Inscrit(e) le {student.dateInscription}</span>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <span className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold border ${
          student.statut === 'actif'
            ? 'bg-green-bg text-green border-transparent'
            : student.statut === 'suspendu'
            ? 'bg-red-bg text-accent border-transparent'
            : 'bg-chip text-ink-soft border-border'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            student.statut === 'actif' ? 'bg-green' : 'bg-accent'
          }`}></span>
          {student.statut === 'actif' ? 'Inscrit / Actif' : 'Suspendu'}
        </span>
      </div>

      {/* Tabs list */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('info')}
          className={`px-5 py-3.5 text-sm font-bold border-b-2 transition-all -mb-px ${
            activeTab === 'info'
              ? 'border-accent text-ink'
              : 'border-transparent text-ink-soft hover:text-ink hover:border-border'
          }`}
        >
          Informations Générales
        </button>
        <button
          onClick={() => setActiveTab('finance')}
          className={`px-5 py-3.5 text-sm font-bold border-b-2 transition-all -mb-px ${
            activeTab === 'finance'
              ? 'border-accent text-ink'
              : 'border-transparent text-ink-soft hover:text-ink hover:border-border'
          }`}
        >
          Scolarité & Finance
        </button>
        <button
          onClick={() => setActiveTab('grades')}
          className={`px-5 py-3.5 text-sm font-bold border-b-2 transition-all -mb-px ${
            activeTab === 'grades'
              ? 'border-accent text-ink'
              : 'border-transparent text-ink-soft hover:text-ink hover:border-border'
          }`}
        >
          Notes & Bulletins
        </button>
        <button
          onClick={() => setActiveTab('discipline')}
          className={`px-5 py-3.5 text-sm font-bold border-b-2 transition-all -mb-px ${
            activeTab === 'discipline'
              ? 'border-accent text-accent'
              : 'border-transparent text-ink-soft hover:text-ink hover:border-border'
          }`}
        >
          Discipline & Absences
        </button>
      </div>

      {/* Tab Panels */}
      <div className="min-h-96">
        {/* Tab 1: Informations Panel */}
        {activeTab === 'info' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-end">
              <button
                onClick={handleOpenEditInfo}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-cream text-xs font-bold rounded-control shadow-cta transition-colors cursor-pointer"
              >
                ✏️ Modifier les informations
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Identity Info Card */}
              <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-4">
                <h3 className="text-[12px] font-bold text-ink-faint uppercase tracking-[1px] border-b border-border pb-2">
                  Fiche d&apos;Identité de l&apos;élève
                </h3>
              
              <div className="grid grid-cols-2 gap-4 text-sm leading-relaxed">
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Nom complet</span>
                  <span className="font-semibold text-ink">{student.nom} {student.prenom}</span>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Matricule</span>
                  <span className="font-mono font-bold text-ink">{student.matricule}</span>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Genre</span>
                  <span className="font-semibold text-ink">{student.sexe === 'M' ? 'Masculin' : 'Féminin'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Classe</span>
                  <span className="font-semibold text-ink">{displayClasse}</span>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Date de naissance</span>
                  <span className="font-semibold text-ink">{student.dateNaissance}</span>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Lieu de naissance</span>
                  <span className="font-semibold text-ink">{student.lieuNaissance}</span>
                </div>
              </div>
            </div>

            {/* Parent contact card */}
            <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-4">
              <h3 className="text-[12px] font-bold text-ink-faint uppercase tracking-[1px] border-b border-border pb-2">
                Responsable Légal (Parent)
              </h3>
              
              <div className="space-y-3.5">
                <div>
                  <span className="text-[10px] text-ink-faint font-bold block uppercase">Nom du parent</span>
                  <span className="font-semibold text-ink">{student.nomParent}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-ink-soft">
                  <PhoneIcon size={14} className="text-ink-faint" />
                  <span>Téléphone : </span>
                  <a href={`tel:${student.telephoneParent}`} className="font-semibold text-ink hover:underline">
                    {student.telephoneParent}
                  </a>
                </div>
                <div className="flex items-center gap-2 text-sm text-ink-soft">
                  <MailIcon size={14} className="text-ink-faint" />
                  <span>Email : </span>
                  {student.emailParent !== 'N/A' ? (
                    <a href={`mailto:${student.emailParent}`} className="font-semibold text-ink hover:underline">
                      {student.emailParent}
                    </a>
                  ) : (
                    <span className="text-ink-faint italic">Non communiqué</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

        {/* Tab 2: Finance Panel */}
        {activeTab === 'finance' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Financial indicators card */}
            <div className="bg-surface rounded-card border border-border p-6 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Frais Totaux Annuel</span>
                <span className="text-xl font-extrabold text-ink block mt-1">
                  {totalDue !== null ? formatFCFA(totalDue) : <span className="text-ink-faint italic text-sm">Non configuré</span>}
                </span>
                <span className="text-[10px] text-ink-faint mt-1 block">
                  Classe : {displayClasse}
                  {fraisInscription > 0 && totalDue !== null && (
                    <span className="font-semibold text-ink-soft"> (dont Inscription : {formatFCFA(fraisInscription)})</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Montant Payé</span>
                <span className="text-xl font-extrabold text-green block mt-1">{formatFCFA(totalPaid)}</span>

                {/* Progress bar */}
                {totalDue !== null && (
                  <div className="w-full bg-chip h-1.5 rounded-full overflow-hidden mt-2 max-w-[200px]">
                    <div
                      className="h-full bg-green rounded-full transition-all duration-300"
                      style={{ width: `${paymentProgressPct}%` }}
                    ></div>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center sm:block">
                <div>
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Reste à recouvrer</span>
                  <span className={`text-xl font-extrabold block mt-1 ${pendingAmount !== null && pendingAmount > 0 ? 'text-ink' : 'text-ink-soft'}`}>
                    {pendingAmount !== null ? formatFCFA(pendingAmount) : <span className="text-ink-faint italic text-sm">Non configuré</span>}
                  </span>
                  {resteAPayerEchu > 0 && (
                    <span className="text-[10px] font-bold text-accent mt-1 block">
                      Arriérés (tranches échues): {formatFCFA(resteAPayerEchu)}
                    </span>
                  )}
                </div>
                {(pendingAmount === null || pendingAmount > 0) && (
                  <button
                    onClick={handleOpenAddPayment}
                    className="mt-3.5 px-4 py-2 bg-accent hover:bg-accent-hover text-cream text-xs font-bold rounded-control shadow-cta transition-colors"
                  >
                    Enregistrer un paiement
                  </button>
                )}
              </div>
            </div>

            {/* Payments history table */}
            <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-bg/50">
                <span className="text-xs font-bold text-ink uppercase tracking-wider block">Historique des versements</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-[12px] font-bold text-ink-faint uppercase tracking-[1px] bg-bg/20">
                      <th className="px-6 py-3">Réf / Reçu</th>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Montant</th>
                      <th className="px-6 py-3">Mode</th>
                      <th className="px-6 py-3">Statut</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-border-row">
                    {((student.paiements || []) || [])?.length > 0 ? (
                      ((student.paiements || []) || [])?.map((pay) => (
                        <tr key={pay.id} className="hover:bg-row-hover transition-colors">
                          <td className="px-6 py-4 font-mono text-xs font-semibold text-ink-soft">{pay.reference}</td>
                          <td className="px-6 py-4 text-ink-soft text-xs">{pay.date}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              pay.typeFrais === 'Inscription' ? 'bg-chip text-ink-soft border border-transparent' : 'bg-chip text-ink-soft border border-transparent'
                            }`}>
                              {pay.typeFrais}
                            </span>
                            {pay.trancheId && (
                              <span className="block text-[10px] text-ink-faint font-semibold mt-1">
                                {tranches.find(t => t.id === pay.trancheId)?.nom || 'Tranche'}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 font-bold text-ink">{formatFCFA(pay.montant)}</td>
                          <td className="px-6 py-4 text-ink-soft text-xs">{pay.modePaiement}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                              pay.statut === 'paid' ? 'text-green bg-green-bg border-transparent' : 'text-ink-soft bg-chip border-transparent'
                            } px-2 py-0.5 rounded-full border`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                pay.statut === 'paid' ? 'bg-green' : 'bg-accent'
                              }`}></span>
                              {pay.statut === 'paid' ? 'Validé' : 'En attente'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => handleStartEditPayment(pay)}
                                className="text-ink-soft hover:text-ink hover:bg-chip p-1.5 rounded-control transition-colors cursor-pointer"
                                title="Modifier"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeletePayment(pay.id)}
                                className="text-accent hover:text-accent-hover hover:bg-chip p-1.5 rounded-control transition-colors cursor-pointer"
                                title="Supprimer"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-ink-faint text-sm">
                          Aucun paiement enregistré pour le moment.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Grades Panel */}
        {activeTab === 'grades' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Average summaries card */}
            <div className="bg-surface rounded-card border border-border p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap gap-8 w-full">
                <div>
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Moyenne {selectedTrimestre}</span>
                  <span className={`text-3xl font-extrabold block ${avgCurrentTerm >= 10 ? 'text-ink' : 'text-accent'}`}>
                    {avgCurrentTerm > 0 ? avgCurrentTerm.toFixed(2) : '--'} <span className="text-sm text-ink-soft font-semibold">/ 20</span>
                  </span>
                  {avgCurrentTerm > 0 && <span className="text-xs font-bold text-ink-soft mt-1 block">Mention: {mentionCurrentTerm}</span>}
                </div>

                <div className="border-l border-border pl-8">
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Rang / Effectif</span>
                  <span className="text-3xl font-extrabold block text-ink">
                    {myRank} <span className="text-sm text-ink-soft font-semibold">/ {classmates.length}</span>
                  </span>
                  <span className="text-xs font-bold text-ink-soft mt-1 block">Dans la classe {displayClasse}</span>
                </div>

                <div className="border-l border-border pl-8">
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Total des points</span>
                  <span className="text-3xl font-extrabold block text-ink">
                    {totalPointsCurrentTerm}
                  </span>
                </div>
              </div>
              <button
                onClick={handleDownloadBulletin}
                className="px-4 py-2 border border-border hover:border-ink hover:bg-chip/20 hover:text-ink text-ink-soft rounded-control text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <DownloadIcon size={14} />
                Télécharger bulletin
              </button>
            </div>

            {/* Grades list by Term */}
            <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-bg/50 flex items-center justify-between">
                <span className="text-xs font-bold text-ink uppercase tracking-wider block">Détails des notes par matière</span>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedTrimestre}
                    onChange={(e) => setSelectedTrimestre(e.target.value)}
                    className="px-2 py-1 border border-border rounded-control text-xs font-semibold text-ink bg-bg focus:outline-none focus:ring-2 focus:border-accent"
                  >
                    <option value="Trimestre 1">Trimestre 1</option>
                    <option value="Trimestre 2">Trimestre 2</option>
                    <option value="Trimestre 3">Trimestre 3</option>
                  </select>
                  <button
                    onClick={() => setShowAddGradeModal(true)}
                    className="px-3 py-1.5 bg-chip hover:bg-chip-hover text-ink text-xs font-bold rounded-control transition-colors"
                  >
                    + Ajouter une note
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-[12px] font-bold text-ink-faint uppercase tracking-[1px] bg-bg/20">
                      <th className="px-6 py-3">Matière</th>
                      <th className="px-6 py-3 text-center">Coefficient</th>
                      <th className="px-6 py-3 text-center">Évaluation / Note</th>
                      <th className="px-6 py-3">Enseignant</th>
                      <th className="px-6 py-3">Appréciation</th>
                      <th className="px-6 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-border-row">
                    {currentTermGrades.length > 0 ? (
                      currentTermGrades.map((g, idx) => (
                        <tr key={idx} className="hover:bg-row-hover transition-colors">
                          <td className="px-6 py-4 font-semibold text-ink">{g.matiereId}</td>
                          <td className="px-6 py-4 text-center text-ink-soft font-medium">{g.evaluationMaternelle ? '-' : 1}</td>
                          <td className={`px-6 py-4 text-center font-bold ${editingGradeId === g.id ? '' : (g.evaluationMaternelle ? (g.evaluationMaternelle === 'Acquis' ? 'text-green' : g.evaluationMaternelle === 'En cours' ? 'text-ink-soft' : 'text-accent') : (((g.note || 0)) >= 12 ? 'text-green' : ((g.note || 0)) >= 10 ? 'text-ink' : 'text-accent'))}`}>
                            {editingGradeId === g.id ? (
                              g.evaluationMaternelle ? (
                                <select 
                                  value={editingGradeValue} 
                                  onChange={(e) => setEditingGradeValue(e.target.value)}
                                  className="border border-outline rounded px-2 py-1 text-xs w-full"
                                >
                                  <option value="Acquis">Acquis</option>
                                  <option value="En cours">En cours</option>
                                  <option value="Non acquis">Non acquis</option>
                                </select>
                              ) : (
                                <input 
                                  type="number" 
                                  min="0" max="20" step="0.25"
                                  value={editingGradeValue} 
                                  onChange={(e) => setEditingGradeValue(e.target.value)}
                                  className="border border-outline rounded px-2 py-1 text-xs w-20 text-center"
                                />
                              )
                            ) : (
                              g.evaluationMaternelle ? g.evaluationMaternelle : `${((g.note || 0))} / 20`
                            )}
                          </td>
                          <td className="px-6 py-4 text-ink-soft font-medium">{g.enseignantId ? (teachersMap[g.enseignantId] || g.enseignantId) : '--'}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              g.evaluationMaternelle ? (g.evaluationMaternelle === 'Acquis' ? 'bg-green-bg text-green' : g.evaluationMaternelle === 'En cours' ? 'bg-chip text-ink' : 'bg-red-bg text-accent') : (((g.note || 0)) >= 14 ? 'bg-green-bg text-green' : ((g.note || 0)) >= 10 ? 'bg-chip text-ink' : 'bg-red-bg text-accent')
                            }`}>
                              {g.evaluationMaternelle ? (g.evaluationMaternelle === 'Acquis' ? 'Très Bien' : g.evaluationMaternelle === 'En cours' ? 'En Progression' : 'A Renforcer') : (((g.note || 0)) >= 16 ? 'Très Bien' : ((g.note || 0)) >= 14 ? 'Bien' : ((g.note || 0)) >= 12 ? 'Assez Bien' : ((g.note || 0)) >= 10 ? 'Passable' : 'Insuffisant')}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {editingGradeId === g.id ? (
                              <div className="flex items-center justify-center gap-2">
                                <button onClick={() => handleSaveGrade(g.id, !!g.evaluationMaternelle)} className="text-green hover:text-green font-bold text-xs">Enregistrer</button>
                                <button onClick={() => setEditingGradeId(null)} className="text-ink-faint hover:text-ink-soft text-xs">Annuler</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingGradeId(g.id);
                                  setEditingGradeValue(g.evaluationMaternelle || g.note || 0);
                                }}
                                className="text-ink hover:text-ink text-xs font-semibold"
                              >
                                Modifier
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-ink-faint text-sm">
                          Aucune note enregistrée pour ce trimestre.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {currentTermGrades.length > 0 && (
                    <tfoot className="bg-bg font-bold border-t border-border">
                      <tr>
                        <td colSpan={2} className="px-6 py-4 text-right uppercase text-xs tracking-wider">Bilan du Trimestre :</td>
                        <td className="px-6 py-4 text-center text-ink text-base">
                          {currentTermGrades.some(g => g.evaluationMaternelle) ? 'N/A' : (currentTermGrades.reduce((sum, g) => sum + (g.note || 0), 0) / currentTermGrades.length).toFixed(2) + ' / 20'}
                        </td>
                        <td colSpan={3} className="px-6 py-4 text-sm text-ink-soft">
                          {currentTermGrades.some(g => g.evaluationMaternelle) ? (
                            <span className="text-green font-medium">Évaluation par compétences (Maternelle)</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span>Total des points: {currentTermGrades.reduce((sum, g) => sum + (g.note || 0), 0)}</span>
                              <span>Rang: {myRank} / {classmates.length}</span>
                              <span className="text-xs font-semibold text-accent">Mention: {(currentTermGrades.reduce((sum, g) => sum + (g.note || 0), 0) / currentTermGrades.length) >= 12 ? 'Tableau d\'Honneur' : 'Encouragements'}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Discipline Panel */}
        {activeTab === 'discipline' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Summary cards */}
            <div className="bg-surface rounded-card border border-border p-6 shadow-sm grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Absences</span>
                <span className="text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-none block mt-1">{(student.discipline || []).filter(d => d.typeIncident === 'Absence').length}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Retards</span>
                <span className="text-[44px] font-extrabold text-ink tracking-[-1.5px] leading-none block mt-1">{(student.discipline || []).filter(d => d.typeIncident === 'Retard').length}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Avertissements</span>
                <span className="text-2xl font-extrabold text-accent block mt-1">{(student.discipline || []).filter(d => d.typeIncident === 'Avertissement').length}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider block">Exclusions</span>
                <span className="text-2xl font-extrabold text-accent block mt-1">{(student.discipline || []).filter(d => d.typeIncident === 'Exclusion').length}</span>
              </div>
            </div>

            {/* Discipline History List */}
            <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-bg/50 flex items-center justify-between">
                <span className="text-xs font-bold text-ink uppercase tracking-wider block">Historique Disciplinaire</span>
                <button
                  onClick={() => setShowAddDisciplineModal(true)}
                  className="px-3 py-1.5 bg-red-bg hover:bg-red-bg text-accent text-xs font-bold rounded-control transition-colors"
                >
                  + Signaler un incident
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-[12px] font-bold text-ink-faint uppercase tracking-[1px] bg-bg/20">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Motif détaillé</th>
                      <th className="px-6 py-3">Sanction</th>
                      <th className="px-6 py-3">Statut Parent</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-border-row">
                    {student.discipline && student.discipline.length > 0 ? (
                      student.discipline.map((disc, idx) => (
                        <tr key={disc.id || idx} className="hover:bg-row-hover transition-colors">
                          <td className="px-6 py-4 text-ink-soft font-medium whitespace-nowrap">{disc.dateIncident}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ['Avertissement', 'Blâme', 'Exclusion'].includes(disc.typeIncident) ? 'bg-red-bg text-accent border border-transparent' : 'bg-chip text-ink-soft border border-transparent'
                            }`}>
                              {disc.typeIncident}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-ink font-medium">{disc.motif}</td>
                          <td className="px-6 py-4 text-ink-soft italic">{disc.sanction || '-'}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                              disc.statut === 'Notifié au parent' ? 'text-green bg-green-bg border-transparent' : 
                              disc.statut === 'Convoqué' ? 'text-accent bg-red-bg border-transparent' : 
                              disc.statut === 'Clos' ? 'text-ink-soft bg-bg border-border' : 
                              'text-ink-soft bg-chip border-transparent'
                            } px-2 py-0.5 rounded-full border`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                disc.statut === 'Notifié au parent' ? 'bg-green' : 
                                disc.statut === 'Convoqué' ? 'bg-accent' : 
                                disc.statut === 'Clos' ? 'bg-ink-faint' : 
                                'bg-accent'
                              }`}></span>
                              {disc.statut}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-ink-faint text-sm">
                          Aucun incident disciplinaire ni absence à signaler.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Simulated Add/Edit Payment Modal */}
      {showAddPaymentModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login p-6 relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => { setShowAddPaymentModal(false); setEditingPaymentId(null); }}
              className="absolute right-4 top-4 p-1.5 rounded-control text-ink-faint hover:text-ink-soft hover:bg-chip transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
 
            <h3 className="text-lg font-bold text-ink border-b border-border pb-3 mb-4">
              {editingPaymentId ? "Modifier le paiement" : "Enregistrer un paiement"}
            </h3>
 
            <form onSubmit={editingPaymentId ? handleEditPayment : handleAddPayment} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Montant (FCFA)
                </label>
                <input
                  type="number"
                  placeholder="Saisissez le montant"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                  required
                />
              </div>
 
              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Type de frais
                </label>
                <select
                  value={payType}
                  onChange={(e) => setPayType(e.target.value as Paiement['typeFrais'])}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                >
                  <option value="Scolarité">Frais de Scolarité</option>
                  <option value="Inscription">Frais d&apos;Inscription</option>
                  <option value="Examen">Frais d&apos;Examen</option>
                </select>
              </div>

              {payType === 'Scolarité' && (
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                    Tranche concernée
                  </label>
                  {tranches.length > 0 ? (
                    <select
                      value={payTrancheId}
                      onChange={(e) => setPayTrancheId(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                    >
                      <option value="">Non précisée</option>
                      {[...tranches].sort((a, b) => a.ordre - b.ordre).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nom} ({new Intl.NumberFormat('fr-FR').format(Number(t.montant) || 0)} FCFA — échéance {new Date(t.date_limite).toLocaleDateString('fr-FR')})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-ink-faint italic">
                      Aucune tranche configurée pour la classe de cet élève (module Classes).
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Mode de règlement
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                >
                  <option value="Orange Money">Orange Money</option>
                  <option value="MTN Mobile Money">MTN Mobile Money</option>
                  <option value="Espèces">Espèces (Guichet)</option>
                  <option value="Virement Bancaire">Virement Bancaire</option>
                </select>
              </div>

              {editingPaymentId && (
                <>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Date de paiement
                    </label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Référence du reçu
                    </label>
                    <input
                      type="text"
                      placeholder="Référence unique"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                      required
                    />
                  </div>
                </>
              )}
 
              <div className="flex gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => { setShowAddPaymentModal(false); setEditingPaymentId(null); }}
                  className="flex-1 px-4 py-2 border border-border hover:bg-bg rounded-control text-xs font-bold text-ink-soft transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-cta transition-colors"
                >
                  {editingPaymentId ? "Modifier" : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Grade Modal */}
      {showAddGradeModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login p-6 relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowAddGradeModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-control text-ink-faint hover:text-ink-soft hover:bg-chip transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-lg font-bold text-ink border-b border-border pb-3 mb-4">
              Ajouter une note ({selectedTrimestre})
            </h3>

            <form onSubmit={handleAddGrade} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Matière
                </label>
                <input
                  type="text"
                  placeholder="ex: Mathématiques"
                  value={newGradeMatiere}
                  onChange={(e) => setNewGradeMatiere(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                  required
                />
              </div>

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Type d'évaluation
                </label>
                <select
                  value={newGradeType}
                  onChange={(e) => {
                    setNewGradeType(e.target.value);
                    setNewGradeValue('');
                  }}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                >
                  <option value="Classique">Note sur 20 (Classique)</option>
                  <option value="Maternelle">Compétence (Maternelle)</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Évaluation / Note
                </label>
                {newGradeType === 'Maternelle' ? (
                  <select
                    value={newGradeValue}
                    onChange={(e) => setNewGradeValue(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                    required
                  >
                    <option value="">Sélectionnez...</option>
                    <option value="Acquis">Acquis</option>
                    <option value="En cours">En cours de cycle</option>
                    <option value="Non acquis">Non acquis</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    min="0" max="20" step="0.25"
                    placeholder="Note sur 20"
                    value={newGradeValue}
                    onChange={(e) => setNewGradeValue(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                    required
                  />
                )}
              </div>

              {newGradeType === 'Classique' && (
                <div>
                  <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                    Coefficient
                  </label>
                  <input
                    type="number"
                    min="1" max="10"
                    value={newGradeCoef}
                    onChange={(e) => setNewGradeCoef(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                    required
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddGradeModal(false)}
                  className="flex-1 px-4 py-2 border border-border hover:bg-bg rounded-control text-xs font-bold text-ink-soft transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-cta transition-colors"
                >
                  Ajouter la note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Discipline Modal */}
      {showAddDisciplineModal && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-surface rounded-card w-full max-w-md border border-border shadow-login p-6 relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowAddDisciplineModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-control text-ink-faint hover:text-ink-soft hover:bg-chip transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-lg font-bold text-accent border-b border-border pb-3 mb-4">
              Signaler un incident / Absence
            </h3>

            <form onSubmit={handleAddDiscipline} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Type d'incident *
                </label>
                <select
                  value={newDisciplineType}
                  onChange={(e) => setNewDisciplineType(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                >
                  <option value="Absence">Absence</option>
                  <option value="Retard">Retard</option>
                  <option value="Avertissement">Avertissement</option>
                  <option value="Blâme">Blâme</option>
                  <option value="Exclusion">Exclusion temporaire</option>
                  <option value="Autre">Autre incident</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Motif détaillé *
                </label>
                <textarea
                  placeholder="Expliquez la situation..."
                  value={newDisciplineMotif}
                  onChange={(e) => setNewDisciplineMotif(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface resize-none"
                  rows={3}
                  required
                />
              </div>

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Sanction (Optionnelle)
                </label>
                <input
                  type="text"
                  placeholder="ex: 2h de colle, Mise à pied de 2 jours..."
                  value={newDisciplineSanction}
                  onChange={(e) => setNewDisciplineSanction(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                />
              </div>

              <div>
                <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                  Statut vis-à-vis des parents
                </label>
                <select
                  value={newDisciplineStatut}
                  onChange={(e) => setNewDisciplineStatut(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg outline-none focus:border-accent focus:bg-surface"
                >
                  <option value="Non notifié">Non notifié au parent</option>
                  <option value="Notifié au parent">Notifié (SMS/Email/Carnet)</option>
                  <option value="Convoqué">Parent convoqué</option>
                  <option value="Clos">Dossier clos</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddDisciplineModal(false)}
                  className="flex-1 px-4 py-2 border border-border hover:bg-bg rounded-control text-xs font-bold text-ink-soft transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-cta transition-colors"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de modification des informations générales de l'élève */}
      {showEditInfoModal && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center p-4 z-50 animate-fade-in overflow-y-auto">
          <div className="bg-surface rounded-card w-full max-w-xl border border-border shadow-login overflow-hidden my-8">
            <div className="bg-bg p-6 border-b border-border flex justify-between items-center">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Modifier la fiche élève</h3>
                <p className="text-xs text-ink-soft mt-1">Mettez à jour les informations générales et les coordonnées du responsable</p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditInfoModal(false)}
                className="w-8 h-8 flex items-center justify-center bg-surface border border-border rounded-full text-ink-faint hover:text-ink hover:bg-chip transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditInfo} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Section 1 : Identité élève */}
              <div>
                <h4 className="text-xs font-bold text-ink-faint uppercase tracking-wider mb-3 pb-1 border-b border-border">
                  Identité de l'élève
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Nom de famille *
                    </label>
                    <input
                      type="text"
                      value={editNom}
                      onChange={(e) => setEditNom(e.target.value)}
                      required
                      placeholder="Ex: KAMGA"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm font-semibold outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Prénom(s) *
                    </label>
                    <input
                      type="text"
                      value={editPrenom}
                      onChange={(e) => setEditPrenom(e.target.value)}
                      required
                      placeholder="Ex: Jean Paul"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm font-semibold outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Matricule *
                    </label>
                    <input
                      type="text"
                      value={editMatricule}
                      onChange={(e) => setEditMatricule(e.target.value)}
                      required
                      placeholder="Ex: 2026-6A-001"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm font-mono font-semibold outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Genre *
                    </label>
                    <select
                      value={editSexe}
                      onChange={(e) => setEditSexe(e.target.value as 'M' | 'F')}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg font-semibold outline-none focus:border-accent focus:bg-surface"
                    >
                      <option value="M">Masculin (Garçon)</option>
                      <option value="F">Féminin (Fille)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Classe *
                    </label>
                    <select
                      value={editClasseId}
                      onChange={(e) => setEditClasseId(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg font-semibold outline-none focus:border-accent focus:bg-surface"
                    >
                      <option value="">Sélectionner une classe</option>
                      {classesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nom} {(c as any).section ? `(${(c as any).section})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Statut de l'élève
                    </label>
                    <select
                      value={editStatut}
                      onChange={(e) => setEditStatut(e.target.value as 'actif' | 'suspendu')}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm bg-bg font-semibold outline-none focus:border-accent focus:bg-surface"
                    >
                      <option value="actif">Inscrit / Actif</option>
                      <option value="suspendu">Suspendu</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Date de naissance
                    </label>
                    <input
                      type="date"
                      value={editDateNaissance}
                      onChange={(e) => setEditDateNaissance(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Lieu de naissance
                    </label>
                    <input
                      type="text"
                      value={editLieuNaissance}
                      onChange={(e) => setEditLieuNaissance(e.target.value)}
                      placeholder="Ex: Douala, Yaoundé..."
                      className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2 : Responsable légal */}
              <div>
                <h4 className="text-xs font-bold text-ink-faint uppercase tracking-wider mb-3 pb-1 border-b border-border">
                  Responsable Légal (Parent / Tuteur)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Nom complet du parent / tuteur
                    </label>
                    <input
                      type="text"
                      value={editNomParent}
                      onChange={(e) => setEditNomParent(e.target.value)}
                      placeholder="Ex: M. KAMGA Pierre"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm font-semibold outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Numéro de téléphone
                    </label>
                    <input
                      type="tel"
                      value={editTelephoneParent}
                      onChange={(e) => setEditTelephoneParent(e.target.value)}
                      placeholder="Ex: +237 699 00 11 22"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm font-semibold outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-ink-faint uppercase tracking-[1px] mb-1.5">
                      Adresse Email
                    </label>
                    <input
                      type="email"
                      value={editEmailParent}
                      onChange={(e) => setEditEmailParent(e.target.value)}
                      placeholder="Ex: parent@gmail.com"
                      className="w-full px-3 py-2 border border-border rounded-control text-sm outline-none focus:border-accent focus:bg-surface"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowEditInfoModal(false)}
                  className="flex-1 px-4 py-2.5 border border-border hover:bg-bg rounded-control text-xs font-bold text-ink-soft transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-cream rounded-control text-xs font-bold shadow-cta transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
