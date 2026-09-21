'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useEtablissement } from '@/contexts/etablissement-context';
import { getClassRankings, type ClassRanking } from '@/lib/queries/evaluations';
import { captureError, captureMessage } from '@/lib/observability/logger';

interface PageProps {
  params: Promise<{ classeId: string; eleveId: string }>;
}

export default function BulletinImpressionPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const term = searchParams.get('term') || 'Trimestre 1';
  const { etablissementId } = useEtablissement();

  const [student, setStudent] = useState<any | null>(null);
  const [classInfo, setClassInfo] = useState<any | null>(null);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [notesList, setNotesList] = useState<any[]>([]);
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [etabInfo, setEtabInfo] = useState<any | null>(null);
  const [teachersMap, setTeachersMap] = useState<Record<string, string>>({});
  const [absencesCount, setAbsencesCount] = useState(0);
  const [retardsCount, setRetardsCount] = useState(0);
  const [sanctionsCount, setSanctionsCount] = useState(0);
  const [yearName, setYearName] = useState('2025/2026');
  const [isLoaded, setIsLoaded] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!etablissementId) return;
    const loadData = async () => {
      try {
        const classeId = decodeURIComponent(resolvedParams.classeId);
        const eleveId = decodeURIComponent(resolvedParams.eleveId);

        // 1. Fetch class details
        const { data: clsData } = await supabase
          .from('classes')
          .select('*')
          .eq('id', classeId)
          .eq('etablissement_id', etablissementId)
          .single();

        if (clsData) {
          setClassInfo(clsData);
          // Fetch year details
          const { data: yrData } = await supabase
            .from('annees_scolaires')
            .select('nom')
            .eq('id', clsData.annee_scolaire_id)
            .single();
          if (yrData) setYearName(yrData.nom);
        }

        // 2. Fetch all students in this class
        const { data: studsData } = await supabase
          .from('eleves')
          .select('*')
          .eq('classe_id', classeId)
          .eq('etablissement_id', etablissementId);

        if (studsData) {
          setAllStudents(studsData);
          const foundStudent = studsData.find(s => s.id === eleveId);
          if (foundStudent) setStudent(foundStudent);
        }

        // 3. Fetch notes for all students in this class for the current trimester
        const studsIds = (studsData || []).map(s => s.id);
        if (studsIds.length > 0) {
          const { data: notesData } = await supabase
            .from('notes')
            .select('*')
            .in('eleve_id', studsIds)
            .eq('trimestre', term)
            .eq('etablissement_id', etablissementId);
          if (notesData) setNotesList(notesData);
        }

        // 3b. Fetch class rankings
        try {
          const rk = await getClassRankings(classeId, term);
          setRankings(rk);
        } catch (rkErr) {
          captureMessage('Classement serveur indisponible, repli client:', { detail: rkErr });
          setRankings([]);
        }

        // 4. Fetch teachers map
        const { data: teachersData } = await supabase
          .from('enseignants')
          .select('id, nom, prenom');
        if (teachersData) {
          const map: Record<string, string> = {};
          teachersData.forEach(t => {
            map[t.id] = `M. ${t.prenom} ${t.nom}`;
          });
          setTeachersMap(map);
        }

        // 5. Fetch discipline incidents
        // Table réelle 'discipline' (pas 'discipline_incidents' — nom présent
        // dans schema.sql mais jamais celui utilisé par l'écriture applicative,
        // src/app/(dashboard)/eleves/[id]/page.tsx). Lire le mauvais nom faisait
        // que le bulletin n'affichait jamais les incidents réellement enregistrés.
        const { data: discData } = await supabase
          .from('discipline')
          .select('*')
          .eq('eleve_id', eleveId);
        if (discData) {
          const abs = discData.filter(d => d.type_incident?.toLowerCase().includes('absence')).length;
          const ret = discData.filter(d => d.type_incident?.toLowerCase().includes('retard')).length;
          const sanc = discData.filter(d => d.sanction && d.sanction !== '').length;
          setAbsencesCount(abs);
          setRetardsCount(ret);
          setSanctionsCount(sanc);
        }

        // 6. Fetch establishment details
        const { data: etabData } = await supabase
          .from('etablissements')
          .select('*')
          .eq('id', etablissementId)
          .single();
        if (etabData) setEtabInfo(etabData);

      } catch (err) {
        captureError(err, { context: "Error fetching bulletin data:" });
      } finally {
        setIsLoaded(true);
        // Trigger print after rendering
        setTimeout(() => {
          window.print();
        }, 800);
      }
    };
    loadData();
  }, [resolvedParams.classeId, resolvedParams.eleveId, term, etablissementId, supabase]);

  if (!isLoaded || !student || !classInfo || !etabInfo) {
    return <div className="fixed inset-0 z-[100] bg-surface flex items-center justify-center text-ink font-semibold">Préparation du bulletin officiel MINESEC...</div>;
  }

  const logoUrl = etabInfo.logo_url || '';
  const schoolNameLabel = etabInfo.nom || 'École Privée Bilingue Mboa';
  const SloganLabel = etabInfo.bulletin_slogan || 'Discipline — Travail — Succès';
  const delegateLeft = etabInfo.bulletin_header_left || 'Délégation Régionale du Centre';
  const delegateRight = etabInfo.bulletin_header_right || 'Centre Regional Delegation';

  const termNotes = notesList.filter(n => n.eleve_id === student.id);

  // Client calculations
  const calculateStudentAvg = (stud: any) => {
    const tNotes = notesList.filter(n => n.eleve_id === stud.id && n.note !== null && n.note !== undefined);
    if (tNotes.length === 0) return 0;

    let totalPoints = 0;
    let totalCoefs = 0;
    tNotes.forEach(n => {
      const coef = n.coefficient || 1;
      totalPoints += (n.note || 0) * coef;
      totalCoefs += coef;
    });
    return totalCoefs > 0 ? totalPoints / totalCoefs : 0;
  };

  const calculateStudentTotalPoints = (stud: any) => {
    const tNotes = notesList.filter(n => n.eleve_id === stud.id && n.note !== null && n.note !== undefined);
    return tNotes.reduce((sum, n) => sum + ((n.note || 0) * (n.coefficient || 1)), 0);
  };

  const getSubjectAverage = (subjectName: string) => {
    const subjectNotes = notesList.filter(n => n.matiere === subjectName && n.note !== null && n.note !== undefined);
    if (subjectNotes.length === 0) return 0;
    const sum = subjectNotes.reduce((acc, n) => acc + Number(n.note), 0);
    return sum / subjectNotes.length;
  };

  // Rank / Class Avg Calculations
  const serverRow = rankings.find(r => r.eleve_id === student.id);
  const clientAvg = calculateStudentAvg(student);
  const clientAllAvgs = allStudents.map(calculateStudentAvg).sort((a, b) => b - a);
  const clientRank = clientAvg > 0 ? clientAllAvgs.indexOf(clientAvg) + 1 : '-';

  const myAvg = serverRow ? Number(serverRow.moyenne) : clientAvg;
  const myRank = serverRow ? (serverRow.rang ?? '-') : clientRank;
  const classeEffectif = serverRow ? serverRow.effectif : allStudents.length;
  const totalPoints = serverRow ? Number(serverRow.total_points) : calculateStudentTotalPoints(student);

  // Total Coefficients
  const totalCoef = termNotes.reduce((sum, n) => sum + (n.coefficient || 1), 0);

  // Overall Class Average
  const classAvg = allStudents.length > 0
    ? allStudents.reduce((sum, s) => sum + calculateStudentAvg(s), 0) / allStudents.length
    : 0;

  const getMention = (avg: number) => {
    if (avg >= 16) return 'Très Bien';
    if (avg >= 14) return 'Bien';
    if (avg >= 12) return 'Assez Bien';
    if (avg >= 10) return 'Passable';
    return 'Insuffisant';
  };

  const getCouncilAppreciation = (avg: number) => {
    if (avg >= 16) return "Excellent trimestre. Félicitations du conseil de classe.";
    if (avg >= 14) return "Très bon trimestre. Élève sérieux et appliqué.";
    if (avg >= 12) return "Trimestre satisfaisant. Poursuivez vos efforts.";
    if (avg >= 10) return "Ensemble convenable mais peut mieux faire.";
    return "Trimestre insuffisant. Travail personnel à intensifier.";
  };

  const formatTermBilingual = (termStr: string) => {
    if (termStr.includes('1')) return { fr: '1er TRIMESTRE', en: 'First Term' };
    if (termStr.includes('2')) return { fr: '2ème TRIMESTRE', en: 'Second Term' };
    return { fr: '3ème TRIMESTRE', en: 'Third Term' };
  };

  const termBilingual = formatTermBilingual(term);

  return (
    <div className="fixed inset-0 z-[100] bg-[#f8f4eb] overflow-y-auto print:overflow-visible print:bg-white text-[#2b2318]">
      {/* Back button (hidden on print) */}
      <div className="absolute top-4 left-4 print:hidden z-[110]">
        <Link href={`/evaluations/${resolvedParams.classeId}?term=${encodeURIComponent(term)}`} className="px-4 py-2 bg-[#f3ecdb] text-[#6b5f4a] font-bold rounded-control hover:bg-[#ece3cc] transition-colors border border-[#dfd6c0]">
          ← Retour à la classe
        </Link>
      </div>

      {/* Printable Area A4 */}
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-[#fffdf8] print:bg-white font-sans p-8 sm:p-11 text-sm shadow-login print:shadow-none box-sizing: border-box relative">
        {/* Bande kenté signature on top of page, hidden on print for standard paper */}
        <div className="absolute top-0 left-0 right-0 h-[6px] kente-band print:hidden" />

        {/* Header - Cameroonian Official Bilingual Structure */}
        <div className="grid grid-cols-3 gap-4 items-start text-center text-[8.5px] font-bold uppercase tracking-wide leading-relaxed border-b border-[#2b2318] pb-4 mb-4">
          <div>
            République du Cameroun<br />
            <span className="font-medium italic text-[7.5px] capitalize font-serif text-[#6b5f4a]">Paix — Travail — Patrie</span><br />
            Ministère des Enseignements Secondaires<br />
            <span className="font-semibold text-[7.5px] capitalize text-[#6b5f4a]">{delegateLeft}</span>
          </div>

          <div className="flex flex-col items-center gap-1.5 pt-1">
            <div className="w-11 h-11 rounded-[14px] bg-[#2b2318] text-[#fdf3e3] flex items-center justify-center font-extrabold text-xl">M</div>
            <div className="font-extrabold text-[12px] tracking-tight text-[#2b2318] capitalize leading-none mt-1">{schoolNameLabel}</div>
            <div className="text-[6.5px] font-medium text-[#6b5f4a] capitalize leading-normal">
              BP 1234 Yaoundé · Devise: {SloganLabel}
            </div>
          </div>

          <div>
            Republic of Cameroon<br />
            <span className="font-medium italic text-[7.5px] capitalize font-serif text-[#6b5f4a]">Peace — Work — Fatherland</span><br />
            Ministry of Secondary Education<br />
            <span className="font-semibold text-[7.5px] capitalize text-[#6b5f4a]">{delegateRight}</span>
          </div>
        </div>

        {/* Title Block */}
        <div className="text-center mb-5">
          <div className="font-extrabold text-[15px] text-[#2b2318] tracking-tight">
            BULLETIN DE NOTES — {termBilingual.fr}
          </div>
          <div className="text-[10px] font-semibold text-[#6b5f4a] mt-0.5">
            Année scolaire {yearName} · Report Card — {termBilingual.en}
          </div>
        </div>

        {/* Identity Grid (4 Columns) */}
        <div className="grid grid-cols-4 gap-y-3.5 gap-x-5 mb-5 text-[11.5px] bg-[#fdfaf2] border border-[#e9e1cf] p-4 rounded-card">
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Nom et prénom</span>
            <span className="font-extrabold text-[#2b2318] uppercase">{student.nom} {student.prenom}</span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Matricule</span>
            <span className="font-bold text-[#2b2318] font-mono">{student.matricule}</span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Classe</span>
            <span className="font-bold text-[#2b2318]">{classInfo.nom} · {classeEffectif} élèves</span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Professeur Titulaire</span>
            <span className="font-bold text-[#2b2318]">{teachersMap[classInfo.enseignant_principal_id] || 'Non spécifié'}</span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Né le</span>
            <span className="font-bold text-[#2b2318]">
              {student.dateNaissance ? new Date(student.dateNaissance).toLocaleDateString('fr-FR') : 'N/A'} à {student.lieuNaissance || 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Genre / Sex</span>
            <span className="font-bold text-[#2b2318]">{student.sexe === 'M' ? 'Masculin / Male' : 'Féminin / Female'}</span>
          </div>
          <div>
            {/* Aucun champ de redoublement n'existe sur eleves — affichait "Non" en dur pour tous. */}
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Redoublant / Repeater</span>
            <span className="font-bold text-[#2b2318]">N/A</span>
          </div>
          <div>
            <span className="text-[8px] font-bold text-[#a3947a] uppercase tracking-[1px] block">Parent Responsable</span>
            <span className="font-bold text-[#2b2318]">{student.nomParent || 'N/A'}</span>
          </div>
        </div>

        {/* Grades Table */}
        <table className="w-full text-left border-collapse border border-[#2b2318] mb-5 text-[11px]">
          <thead>
            <tr className="bg-[#2b2318] text-[#fdf3e3] text-[9.5px] uppercase tracking-wide">
              <th className="border border-[#2b2318] px-4 py-2.5 font-bold">Matière / Subject</th>
              <th className="border border-[#2b2318] px-3 py-2.5 font-bold">Enseignant</th>
              <th className="border border-[#2b2318] px-3 py-2.5 font-bold text-center">Note /20</th>
              <th className="border border-[#2b2318] px-3 py-2.5 font-bold text-center">Coef</th>
              <th className="border border-[#2b2318] px-3 py-2.5 font-bold text-center">Note × Coef</th>
              <th className="border border-[#2b2318] px-3 py-2.5 font-bold text-center">Moy. classe</th>
              <th className="border border-[#2b2318] px-4 py-2.5 font-bold">Appréciation</th>
            </tr>
          </thead>
          <tbody>
            {termNotes.map((note, index) => {
              const coef = note.coefficient || 1;
              const grade = note.note !== null && note.note !== undefined ? Number(note.note) : 0;
              const product = grade * coef;
              const subjAvg = getSubjectAverage(note.matiere);
              const rowBg = index % 2 === 1 ? 'bg-[#faf7ef]' : 'bg-white';

              return (
                <tr key={note.id} className={`${rowBg} border-b border-[#e5ddc9]`}>
                  <td className="border border-[#e9e1cf] px-4 py-2 font-extrabold uppercase">{note.matiere}</td>
                  <td className="border border-[#e9e1cf] px-3 py-2 text-[#6b5f4a] font-medium">{teachersMap[note.enseignant_id] || 'Non spécifié'}</td>
                  <td className={`border border-[#e9e1cf] px-3 py-2 text-center font-extrabold ${grade >= 10 ? 'text-[#1a5c3f]' : 'text-[#b5502f]'}`}>
                    {grade.toFixed(2).replace('.', ',')}
                  </td>
                  <td className="border border-[#e9e1cf] px-3 py-2 text-center font-semibold">{coef}</td>
                  <td className="border border-[#e9e1cf] px-3 py-2 text-center font-bold">{product.toFixed(2).replace('.', ',')}</td>
                  <td className="border border-[#e9e1cf] px-3 py-2 text-center text-[#6b5f4a] font-medium">{subjAvg.toFixed(2).replace('.', ',')}</td>
                  <td className="border border-[#e9e1cf] px-4 py-2 text-[#4a4232] font-semibold">{getMention(grade)}</td>
                </tr>
              );
            })}
            {termNotes.length === 0 && (
              <tr>
                <td colSpan={7} className="border border-[#e9e1cf] px-4 py-10 text-center text-[#6b5f4a] italic">
                  Aucune note enregistrée pour ce trimestre.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#2b2318] bg-[#f3ecdb] font-extrabold text-[11.5px]">
              <td className="border border-[#2b2318] px-4 py-2" colSpan={3}>TOTAUX</td>
              <td className="border border-[#2b2318] px-3 py-2 text-center">{totalCoef}</td>
              <td className="border border-[#2b2318] px-3 py-2 text-center">{totalPoints.toFixed(2).replace('.', ',')}</td>
              <td className="border border-[#2b2318] px-3 py-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>

        {/* 4 Summary Boxes Grid */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="border border-[#2b2318] rounded-control p-2.5 text-center bg-white shadow-sm">
            <div className="text-[7.5px] font-bold text-[#a3947a] uppercase tracking-wide">Moyenne trimestrielle</div>
            <div className="text-[17px] font-extrabold text-[#2b2318] mt-0.5 tracking-tight">
              {myAvg.toFixed(2).replace('.', ',')} <span className="text-[10px] text-[#a3947a] font-bold">/20</span>
            </div>
          </div>
          <div className="border border-[#2b2318] rounded-control p-2.5 text-center bg-white shadow-sm">
            <div className="text-[7.5px] font-bold text-[#a3947a] uppercase tracking-wide">Rang</div>
            <div className="text-[17px] font-extrabold text-[#2b2318] mt-0.5 tracking-tight">
              {myRank === 1 ? (
                <>1<sup>er</sup></>
              ) : (
                <>{myRank}</>
              )} <span className="text-[10px] text-[#a3947a] font-bold">/ {classeEffectif}</span>
            </div>
          </div>
          <div className="border border-[#2b2318] rounded-control p-2.5 text-center bg-white shadow-sm">
            <div className="text-[7.5px] font-bold text-[#a3947a] uppercase tracking-wide">Mention</div>
            <div className={`text-[17px] font-extrabold mt-0.5 tracking-tight ${myAvg >= 10 ? 'text-[#1a5c3f]' : 'text-[#b5502f]'}`}>
              {/* Priorité à la mention RPC, calculée avec le seuil_reussite
                  réel de l'établissement — getMention (seuil 10 en dur) ne
                  sert que de repli quand la RPC est indisponible. */}
              {serverRow?.mention ?? getMention(myAvg)}
            </div>
          </div>
          <div className="border border-[#2b2318] rounded-control p-2.5 text-center bg-white shadow-sm">
            <div className="text-[7.5px] font-bold text-[#a3947a] uppercase tracking-wide">Moyenne de la classe</div>
            <div className="text-[17px] font-extrabold text-[#2b2318] mt-0.5 tracking-tight">
              {classAvg.toFixed(2).replace('.', ',')} <span className="text-[10px] text-[#a3947a] font-bold">/20</span>
            </div>
          </div>
        </div>

        {/* Discipline & Council Remarks */}
        <div className="grid grid-cols-2 gap-4 mb-5 text-[11.5px]">
          <div className="border border-[#d9cfb5] rounded-control p-3 bg-[#fdfaf2]">
            <div className="text-[8px] font-bold text-[#a3947a] uppercase tracking-wide mb-1.5">Discipline / Assiduité</div>
            {/* discipline_incidents ne trace pas de durée : compte d'incidents réel,
                pas de conversion en heures (auparavant absencesCount * 2, un facteur inventé). */}
            Absences non justifiées : <strong>{absencesCount} incident(s)</strong> · Retards : <strong>{retardsCount}</strong> · Sanctions : <strong>{sanctionsCount > 0 ? `${sanctionsCount} sanction(s)` : 'Aucune'}</strong>
          </div>
          <div className="border border-[#d9cfb5] rounded-control p-3 bg-[#fdfaf2]">
            <div className="text-[8px] font-bold text-[#a3947a] uppercase tracking-wide mb-1.5">Appréciation du conseil de classe</div>
            <p className="font-semibold italic text-[#4a4232] leading-relaxed">
              {student.bulletins?.[0]?.appreciationEnseignant || getCouncilAppreciation(myAvg)}
            </p>
          </div>
        </div>

        {/* Signatures Block (3 columns) */}
        <div className="grid grid-cols-3 gap-6 text-center text-[10px] font-bold uppercase tracking-wide pt-2 mb-12">
          <div>
            Le Titulaire <br />
            <span className="text-[8px] font-medium text-[#6b5f4a] capitalize">The Class Master</span>
            <div className="h-14 border-b border-dotted border-[#a3947a] mt-1"></div>
          </div>
          <div>
            Le Parent / Tuteur <br />
            <span className="text-[8px] font-medium text-[#6b5f4a] capitalize">The Parent / Guardian</span>
            <div className="h-14 border-b border-dotted border-[#a3947a] mt-1"></div>
          </div>
          <div>
            La Directrice <br />
            <span className="text-[8px] font-medium text-[#6b5f4a] capitalize">The Principal</span>
            <div className="h-14 border-b border-dotted border-[#a3947a] mt-1"></div>
          </div>
        </div>

        {/* Print Page Footer */}
        <div className="absolute bottom-5 left-8 right-8 border-t border-[#e9e1cf] pt-3 flex justify-between text-[8px] font-semibold text-[#a3947a]">
          <span>Fait à Yaoundé, le {new Date().toLocaleDateString('fr-FR')}</span>
          <span>Généré par School's · document officiel de l'établissement</span>
        </div>

      </div>
    </div>
  );
}
