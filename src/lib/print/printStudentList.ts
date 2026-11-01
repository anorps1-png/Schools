import { captureError } from '../observability/logger';

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface PrintableStudent {
  id?: string | null;
  matricule?: string | null;
  nom: string;
  prenom?: string | null;
  sexe?: string | null;
  classeNom?: string | null;
  dateNaissance?: string | null;
  lieuNaissance?: string | null;
  nomParent?: string | null;
  telephoneParent?: string | null;
  statut?: string | null;
  estSubventionne?: boolean;
}

export interface PrintStudentListOptions {
  title: string;
  subtitle?: string;
  schoolName?: string;
  schoolLogo?: string;
  schoolPhone?: string;
  schoolEmail?: string;
  schoolAddress?: string;
  academicYear?: string;
  classeNom?: string;
  students: PrintableStudent[];
  showParentContact?: boolean;
  additionalInfo?: { label: string; value: string }[];
}

export function printStudentList(options: PrintStudentListOptions): void {
  if (typeof window === 'undefined') return;

  // Tri alphabétique strict (Nom puis Prénom, insensible à la casse et aux accents)
  const sorted = [...options.students].sort((a, b) => {
    const nomA = (a.nom || '').trim();
    const nomB = (b.nom || '').trim();
    const cmpNom = nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    if (cmpNom !== 0) return cmpNom;
    const prenomA = (a.prenom || '').trim();
    const prenomB = (b.prenom || '').trim();
    return prenomA.localeCompare(prenomB, 'fr', { sensitivity: 'base' });
  });

  const total = sorted.length;
  const garcons = sorted.filter(s => s.sexe === 'M' || s.sexe === 'Garçon').length;
  const filles = sorted.filter(s => s.sexe === 'F' || s.sexe === 'Fille').length;
  const pctG = total > 0 ? Math.round((garcons / total) * 100) : 0;
  const pctF = total > 0 ? Math.round((filles / total) * 100) : 0;

  const schoolName = options.schoolName || 'ÉTABLISSEMENT SCOLAIRE';
  const schoolPhone = options.schoolPhone ? `Tél : ${options.schoolPhone}` : '';
  const schoolEmail = options.schoolEmail ? `Email : ${options.schoolEmail}` : '';
  const schoolAddress = options.schoolAddress || '';
  const academicYear = options.academicYear ? `Année Scolaire : ${options.academicYear}` : '';
  const printDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const showParent = options.showParentContact !== false;
  const showClasseCol = !options.classeNom;

  const rowsHtml = sorted.map((s, idx) => {
    const birth = [s.dateNaissance, s.lieuNaissance ? `à ${s.lieuNaissance}` : ''].filter(Boolean).join(' ');
    const parent = [s.nomParent, s.telephoneParent].filter(Boolean).join(' - ');
    const sexeDisplay = (s.sexe === 'M' || s.sexe === 'Garçon') ? 'M' : (s.sexe === 'F' || s.sexe === 'Fille') ? 'F' : (s.sexe || '—');
    const isSub = Boolean(s.estSubventionne);
    const subvBadge = isSub ? ` <span style="display:inline-block; font-size:9px; font-weight:bold; background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; padding:1px 5px; border-radius:999px; vertical-align:middle; margin-left:4px;">★ Subventionné</span>` : '';

    return `
      <tr style="${isSub ? 'background-color: #f0f7ff;' : ''}">
        <td style="text-align: center; font-weight: bold; width: 32px;">${idx + 1}</td>
        <td style="font-family: monospace; font-size: 11px; white-space: nowrap; width: 90px;">${escapeHtml(s.matricule || '—')}</td>
        <td style="font-weight: 600; color: #0f172a;">${escapeHtml(s.nom.toUpperCase())} ${escapeHtml(s.prenom || '')}${subvBadge}</td>
        <td style="text-align: center; font-weight: bold; width: 45px;">${sexeDisplay}</td>
        <td style="font-size: 11px; color: #334155;">${escapeHtml(birth || '—')}</td>
        ${showClasseCol ? `<td style="font-size: 11px; font-weight: 600;">${escapeHtml(s.classeNom || '—')}</td>` : ''}
        ${showParent ? `<td style="font-size: 11px; color: #475569;">${escapeHtml(parent || '—')}</td>` : ''}
      </tr>
    `;
  }).join('');

  const emptyRowHtml = total === 0 ? `
    <tr>
      <td colspan="${showClasseCol ? (showParent ? 7 : 6) : (showParent ? 6 : 5)}" style="text-align: center; padding: 24px; color: #64748b; font-style: italic;">
        Aucun élève dans cette liste.
      </td>
    </tr>
  ` : '';

  const additionalInfoHtml = (options.additionalInfo || []).map(info => `
    <span style="display: inline-block; margin-right: 16px;"><strong>${escapeHtml(info.label)} :</strong> ${escapeHtml(info.value)}</span>
  `).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 10px;
      font-size: 12px;
      line-height: 1.35;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .header-box {
      font-size: 9px;
      line-height: 1.3;
      text-align: center;
      width: 32%;
    }
    .header-box.right {
      text-align: center;
    }
    .header-box.center {
      width: 36%;
    }
    .school-title {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
      text-transform: uppercase;
    }
    .school-sub {
      font-size: 10px;
      color: #475569;
    }
    .title-banner {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 12px;
      text-align: center;
    }
    .main-title {
      font-size: 16px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .sub-title {
      font-size: 11px;
      color: #334155;
      font-weight: 600;
      margin: 0;
    }
    .stats-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f1f5f9;
      border-left: 4px solid #4f46e5;
      padding: 6px 12px;
      margin-bottom: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #1e293b;
      color: #ffffff;
      padding: 6px 8px;
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid #1e293b;
    }
    td {
      padding: 5px 7px;
      border: 1px solid #cbd5e1;
      font-size: 11px;
      vertical-align: middle;
    }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    .signature-section {
      margin-top: 25px;
      display: flex;
      justify-content: space-between;
      page-break-inside: avoid;
    }
    .signature-box {
      width: 40%;
      text-align: center;
      font-size: 11px;
    }
    .signature-line {
      margin-top: 55px;
      border-top: 1px solid #94a3b8;
      padding-top: 4px;
      color: #64748b;
      font-size: 10px;
      font-weight: 600;
    }
    .footer-note {
      margin-top: 20px;
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      border-top: 1px dotted #cbd5e1;
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-box">
      <strong>RÉPUBLIQUE DU CAMEROUN</strong><br />
      <em>Paix — Travail — Patrie</em><br />
      MINISTÈRE DES ENSEIGNEMENTS SECONDAIRES
    </div>
    <div class="header-box center">
      <div class="school-title">${escapeHtml(schoolName)}</div>
      <div class="school-sub">${escapeHtml(schoolAddress)}</div>
      <div class="school-sub">${escapeHtml(schoolPhone)} ${schoolPhone && schoolEmail ? '•' : ''} ${escapeHtml(schoolEmail)}</div>
    </div>
    <div class="header-box right">
      <strong>REPUBLIC OF CAMEROON</strong><br />
      <em>Peace — Work — Fatherland</em><br />
      MINISTRY OF SECONDARY EDUCATION
    </div>
  </div>

  <div class="title-banner">
    <h1 class="main-title">${escapeHtml(options.title)}</h1>
    <p class="sub-title">
      ${options.classeNom ? `Classe : <strong>${escapeHtml(options.classeNom)}</strong> • ` : ''}
      ${academicYear ? `${escapeHtml(academicYear)} • ` : ''}
      Édité le ${printDate}
      ${options.subtitle ? `<br />${escapeHtml(options.subtitle)}` : ''}
    </p>
    ${additionalInfoHtml ? `<div style="margin-top: 6px; font-size: 11px; color: #475569;">${additionalInfoHtml}</div>` : ''}
  </div>

  <div class="stats-bar">
    <div><strong>Effectif total :</strong> ${total} élève${total > 1 ? 's' : ''}</div>
    <div><strong>Garçons :</strong> ${garcons} (${pctG}%) &nbsp;|&nbsp; <strong>Filles :</strong> ${filles} (${pctF}%)</div>
    <div><strong>Ordre :</strong> Alphabétique (Nom, Prénom)</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align: center; width: 32px;">N°</th>
        <th style="width: 90px;">Matricule</th>
        <th>Nom et Prénoms</th>
        <th style="text-align: center; width: 45px;">Sexe</th>
        <th>Date & Lieu de Naissance</th>
        ${showClasseCol ? `<th>Classe</th>` : ''}
        ${showParent ? `<th>Responsable Légal & Contact</th>` : ''}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      ${emptyRowHtml}
    </tbody>
  </table>

  <div class="signature-section">
    <div class="signature-box">
      <p style="font-weight: 700; color: #334155; margin-bottom: 0;">L'Enseignant / Le Titulaire</p>
      <div class="signature-line">Nom & Signature</div>
    </div>
    <div class="signature-box">
      <p style="font-weight: 700; color: #334155; margin-bottom: 0;">La Direction / Le Chef d'Établissement</p>
      <div class="signature-line">Cachet et Signature</div>
    </div>
  </div>

  <div class="footer-note">
    Document officiel généré par School's • ${escapeHtml(schoolName)} • Page 1/1
  </div>
</body>
</html>`;

  // Utilisation d'un iframe invisible pour compatibilité parfaite Web et Electron
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(htmlContent);
  doc.close();

  iframe.contentWindow?.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } catch (err) {
      captureError(err, { context: "printStudentList" });
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 400);
}

// ============================================================================
// IMPRESSION DÉDIÉE : LISTE DES ÉLÈVES AU RÉGIME SUBVENTIONNÉ
// ============================================================================

export interface PrintableSubventionneStudent {
  matricule?: string | null;
  nom: string;
  prenom?: string | null;
  sexe?: string | null;
  classeNom?: string | null;
  forfait: number; // 55000
  totalPaid: number;
  resteDu: number;
  statutPaiement: string; // 'Soldé' | 'Partiel' | 'Non payé' | 'En retard'
  nomParent?: string | null;
  telephoneParent?: string | null;
}

export interface PrintSubventionnesOptions {
  schoolName?: string;
  schoolLogo?: string;
  schoolPhone?: string;
  schoolEmail?: string;
  schoolAddress?: string;
  academicYear?: string;
  totalSubventionsPrisesEnCharge?: number;
  students: PrintableSubventionneStudent[];
}

export function printSubventionnesList(options: PrintSubventionnesOptions): void {
  if (typeof window === 'undefined') return;

  const sorted = [...options.students].sort((a, b) => {
    const nomA = (a.nom || '').trim();
    const nomB = (b.nom || '').trim();
    const cmpNom = nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    if (cmpNom !== 0) return cmpNom;
    const prenomA = (a.prenom || '').trim();
    const prenomB = (b.prenom || '').trim();
    return prenomA.localeCompare(prenomB, 'fr', { sensitivity: 'base' });
  });

  const total = sorted.length;
  const totalAttendu = sorted.reduce((sum, s) => sum + (s.forfait || 55000), 0);
  const totalPaye = sorted.reduce((sum, s) => sum + (s.totalPaid || 0), 0);
  const totalReste = sorted.reduce((sum, s) => sum + (s.resteDu || 0), 0);
  const totalSubvention = options.totalSubventionsPrisesEnCharge || 0;

  const soldeCount = sorted.filter(s => s.statutPaiement === 'Soldé' || s.statutPaiement === 'Payé').length;
  const partielCount = sorted.filter(s => s.statutPaiement === 'Partiel' || s.statutPaiement === 'En retard').length;
  const impayeCount = sorted.filter(s => s.statutPaiement === 'Non payé' || s.statutPaiement === 'Impayé').length;

  const schoolName = options.schoolName || 'ÉTABLISSEMENT SCOLAIRE';
  const schoolPhone = options.schoolPhone ? `Tél : ${options.schoolPhone}` : '';
  const schoolEmail = options.schoolEmail ? `Email : ${options.schoolEmail}` : '';
  const schoolAddress = options.schoolAddress || '';
  const academicYear = options.academicYear ? `Année Scolaire : ${options.academicYear}` : '';
  const printDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const formatFCFA = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
  };

  const rowsHtml = sorted.map((s, idx) => {
    const sexeDisplay = (s.sexe === 'M' || s.sexe === 'Garçon') ? 'M' : (s.sexe === 'F' || s.sexe === 'Fille') ? 'F' : (s.sexe || '—');
    const isSolde = s.statutPaiement === 'Soldé' || s.statutPaiement === 'Payé';
    const isPartiel = s.statutPaiement === 'Partiel' || s.statutPaiement === 'En retard';
    const statutColor = isSolde ? '#15803d' : isPartiel ? '#b45309' : '#b91c1c';
    const statutBg = isSolde ? '#dcfce7' : isPartiel ? '#fef3c7' : '#fee2e2';

    return `
      <tr>
        <td style="text-align: center; font-weight: bold; width: 32px;">${idx + 1}</td>
        <td style="font-family: monospace; font-size: 11px; white-space: nowrap; width: 90px;">${escapeHtml(s.matricule || '—')}</td>
        <td style="font-weight: 700; color: #0f172a;">${escapeHtml(s.nom.toUpperCase())} ${escapeHtml(s.prenom || '')}</td>
        <td style="text-align: center; font-weight: bold; width: 45px;">${sexeDisplay}</td>
        <td style="font-weight: 600; color: #1e293b;">${escapeHtml(s.classeNom || '—')}</td>
        <td style="text-align: right; font-family: monospace; font-weight: bold; color: #1d4ed8;">${formatFCFA(s.forfait || 55000)}</td>
        <td style="text-align: right; font-family: monospace; font-weight: bold; color: #15803d;">${formatFCFA(s.totalPaid || 0)}</td>
        <td style="text-align: right; font-family: monospace; font-weight: bold; color: ${s.resteDu > 0 ? '#b91c1c' : '#64748b'};">${formatFCFA(s.resteDu || 0)}</td>
        <td style="text-align: center; width: 90px;">
          <span style="display: inline-block; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: ${statutBg}; color: ${statutColor};">
            ${escapeHtml(s.statutPaiement || 'En cours')}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const emptyRowHtml = total === 0 ? `
    <tr>
      <td colspan="9" style="text-align: center; padding: 32px; color: #64748b; font-style: italic;">
        Aucun élève inscrit au régime subventionné pour le moment.
      </td>
    </tr>
  ` : '';

  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>RÉPERTOIRE DES ÉLÈVES AU RÉGIME SUBVENTIONNÉ</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.35;
    }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .header-table td { vertical-align: top; }
    .school-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin: 0; letter-spacing: 0.5px; }
    .school-meta { font-size: 10px; color: #475569; margin-top: 2px; }
    .doc-banner {
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 12px;
      text-align: center;
    }
    .doc-title { font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin: 0; }
    .doc-subtitle { font-size: 11px; font-weight: 500; opacity: 0.95; margin-top: 3px; }
    .kpi-grid { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .kpi-grid td {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      text-align: center;
      width: 20%;
    }
    .kpi-label { font-size: 9px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block; }
    .kpi-value { font-size: 13px; font-weight: 800; color: #0f172a; margin-top: 2px; display: block; font-family: monospace; }
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .data-table th {
      background: #0f172a;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 7px 8px;
      border: 1px solid #0f172a;
    }
    .data-table td {
      padding: 5px 8px;
      border: 1px solid #cbd5e1;
      font-size: 11px;
    }
    .data-table tbody tr:nth-child(even) { background-color: #f8fafc; }
    .signature-grid { width: 100%; border-collapse: collapse; margin-top: 24px; page-break-inside: avoid; }
    .signature-grid td { vertical-align: top; width: 50%; font-size: 11px; }
    .signature-box { border-top: 1px dashed #94a3b8; width: 85%; margin-top: 50px; }
    .footer-note {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 4px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <table class="header-table">
    <tr>
      ${options.schoolLogo ? `<td style="width: 60px; padding-right: 12px;"><img src="${escapeHtml(options.schoolLogo)}" style="max-width: 55px; max-height: 55px; object-fit: contain;" alt="Logo" /></td>` : ''}
      <td>
        <h1 class="school-title">${escapeHtml(schoolName)}</h1>
        <div class="school-meta">
          ${[schoolAddress, schoolPhone, schoolEmail].filter(Boolean).map(escapeHtml).join(' • ')}
        </div>
      </td>
      <td style="text-align: right; font-size: 10px; color: #475569;">
        <strong>${escapeHtml(academicYear)}</strong><br />
        Édité le : ${escapeHtml(printDate)}
      </td>
    </tr>
  </table>

  <div class="doc-banner">
    <div class="doc-title">★ LISTE OFFICIELLE DES ÉLÈVES AU RÉGIME SUBVENTIONNÉ ★</div>
    <div class="doc-subtitle">Dispositif Spécial de Scolarité • Forfait Conventionné de 55 000 FCFA par Élève</div>
  </div>

  <table class="kpi-grid">
    <tr>
      <td>
        <span class="kpi-label">Effectif Subventionné</span>
        <span class="kpi-value">${total} élève${total > 1 ? 's' : ''}</span>
      </td>
      <td>
        <span class="kpi-label">Forfait Global Attendu</span>
        <span class="kpi-value">${formatFCFA(totalAttendu)}</span>
      </td>
      <td>
        <span class="kpi-label">Total Déjà Encaissé</span>
        <span class="kpi-value" style="color: #15803d;">${formatFCFA(totalPaye)}</span>
      </td>
      <td>
        <span class="kpi-label">Reste à Recouvrer</span>
        <span class="kpi-value" style="color: ${totalReste > 0 ? '#b91c1c' : '#0f172a'};">${formatFCFA(totalReste)}</span>
      </td>
      <td>
        <span class="kpi-label">Subvention Prise en Charge</span>
        <span class="kpi-value" style="color: #1d4ed8;">${formatFCFA(totalSubvention)}</span>
      </td>
    </tr>
  </table>

  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 32px; text-align: center;">N°</th>
        <th style="width: 90px;">Matricule</th>
        <th>Nom &amp; Prénom</th>
        <th style="width: 45px; text-align: center;">Sexe</th>
        <th style="width: 90px;">Classe</th>
        <th style="width: 95px; text-align: right;">Forfait Dû</th>
        <th style="width: 95px; text-align: right;">Encaissé</th>
        <th style="width: 95px; text-align: right;">Reste</th>
        <th style="width: 90px; text-align: center;">Statut</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      ${emptyRowHtml}
    </tbody>
    <tfoot>
      <tr style="background-color: #f1f5f9; font-weight: 800;">
        <td colspan="5" style="text-align: right; padding-right: 12px; font-weight: 800; text-transform: uppercase;">TOTAUX GÉNÉRAUX (${total} élèves) :</td>
        <td style="text-align: right; font-family: monospace; color: #1d4ed8;">${formatFCFA(totalAttendu)}</td>
        <td style="text-align: right; font-family: monospace; color: #15803d;">${formatFCFA(totalPaye)}</td>
        <td style="text-align: right; font-family: monospace; color: ${totalReste > 0 ? '#b91c1c' : '#0f172a'};">${formatFCFA(totalReste)}</td>
        <td style="text-align: center; font-size: 10px; color: #475569;">${soldeCount} Soldé(s)</td>
      </tr>
    </tfoot>
  </table>

  <table class="signature-grid">
    <tr>
      <td>
        <strong>Le Responsable Administratif / Financier</strong><br />
        <span style="font-size: 10px; color: #64748b;">Visa pour conformité du registre</span>
        <div class="signature-box"></div>
      </td>
      <td style="text-align: right;">
        <strong>Le Chef d'Établissement</strong><br />
        <span style="font-size: 10px; color: #64748b;">Signature et Cachet Officiel</span>
        <div class="signature-box" style="margin-left: auto;"></div>
      </td>
    </tr>
  </table>

  <div class="footer-note">
    Document officiel généré par School's • ${escapeHtml(schoolName)} • Régime des Élèves Subventionnés (Forfait 55 000 FCFA)
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(htmlContent);
  doc.close();

  iframe.contentWindow?.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } catch (err) {
      captureError(err, { context: "printSubventionnesList" });
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 400);
}
