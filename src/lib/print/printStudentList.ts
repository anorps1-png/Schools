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

    return `
      <tr>
        <td style="text-align: center; font-weight: bold; width: 32px;">${idx + 1}</td>
        <td style="font-family: monospace; font-size: 11px; white-space: nowrap; width: 90px;">${escapeHtml(s.matricule || '—')}</td>
        <td style="font-weight: 600; color: #0f172a;">${escapeHtml(s.nom.toUpperCase())} ${escapeHtml(s.prenom || '')}</td>
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
    Document officiel généré par School's • ${schoolName} • Page 1/1
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
      console.error("Erreur lors de l'impression :", err);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 400);
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
