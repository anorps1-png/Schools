import { z } from 'zod';

/**
 * Schémas de validation des entrées (Zod).
 *
 * Objectif : refuser côté application les données incohérentes AVANT l'appel
 * réseau, avec des messages en français. La base reste la dernière ligne de
 * défense (contraintes CHECK, RLS), mais valider tôt évite des écritures
 * corrompues et donne un retour utilisateur immédiat.
 */

const uuid = z.string().uuid("Identifiant invalide.");

// ---------------------------------------------------------------------------
// Élève
// ---------------------------------------------------------------------------
export const eleveSchema = z.object({
  matricule: z.string().trim().min(1, 'Le matricule est obligatoire.').max(50),
  nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
  prenom: z.string().trim().min(1, 'Le prénom est obligatoire.').max(100),
  sexe: z.enum(['M', 'F'], { message: 'Le sexe doit être M ou F.' }).optional().nullable(),
  date_naissance: z.string().optional().nullable(),
  lieu_naissance: z.string().max(120).optional().nullable(),
  classe_id: uuid.optional().nullable(),
  annee_scolaire_id: uuid.optional().nullable(),
  telephone_parent: z.string().max(30).optional().nullable(),
  nom_parent: z.string().max(120).optional().nullable(),
  email_parent: z.string().email('Email du parent invalide.').optional().nullable().or(z.literal('')),
  statut: z.enum(['actif', 'suspendu', 'transfere']).optional(),
  est_subventionne: z.boolean().optional(),
}).passthrough(); // tolère les champs additionnels (photo_url, etc.)

// ---------------------------------------------------------------------------
// Paiement
// ---------------------------------------------------------------------------
export const paiementSchema = z.object({
  eleve_id: uuid,
  montant: z.coerce
    .number({ message: 'Le montant doit être un nombre.' })
    .positive('Le montant doit être strictement positif.')
    .finite(),
  date: z.string().min(1, 'La date est obligatoire.'),
  mode_paiement: z.enum(['Orange Money', 'MTN Mobile Money', 'Espèces', 'Virement Bancaire'], {
    message: 'Mode de paiement invalide.',
  }),
  type_frais: z.enum(['Scolarité', 'Inscription', 'Examen', 'Transport'], {
    message: 'Type de frais invalide.',
  }),
  statut: z.enum(['paid', 'pending', 'failed']).optional(),
  reference: z.string().trim().min(1, 'La référence de transaction est obligatoire.').max(100),
}).passthrough();

// ---------------------------------------------------------------------------
// Helper : valide et renvoie les données typées, ou lève une erreur lisible.
// ---------------------------------------------------------------------------
export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown, contexte: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join(' ');
    throw new Error(`${contexte} : ${messages}`);
  }
  return result.data;
}
