import type { SupabaseClient } from '@supabase/supabase-js';
import { captureMessage } from '@/lib/observability/logger';

// ============================================================================
// Cerveau IA — assistant multi-fournisseurs scopé à une seule école.
//
// Garde-fou central (identique dans les 3 chemins de fournisseur ci-dessous) :
// l'IA peut lire librement (outil `query_data`) mais ne peut JAMAIS écrire
// directement en base. Toute création/modification/suppression proposée par
// l'IA passe par l'outil `propose_action`, qui renvoie une proposition
// structurée (table + action + payload/filtres) affichée à l'utilisateur pour
// approbation explicite — l'exécution réelle se fait ailleurs
// (src/app/api/ai/apply-proposal/route.ts), avec le même client Supabase
// authentifié que l'utilisateur courant, donc soumis aux mêmes RLS que s'il
// avait fait l'action lui-même à la main. Aucune clé service-role, aucun SQL
// brut : uniquement des opérations de la forme .from(table).insert/update/
// delete(...), la même interface que le reste de l'application utilise déjà.
// ============================================================================

export interface AiSettings {
  default_provider: 'gemini' | 'openai' | 'deepseek' | 'anthropic';
  gemini_api_key: string | null;
  gemini_model: string | null;
  openai_api_key: string | null;
  openai_model: string | null;
  deepseek_api_key: string | null;
  deepseek_model: string | null;
  anthropic_api_key: string | null;
  anthropic_model: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Proposal {
  table: string;
  action: 'insert' | 'update' | 'delete' | 'upsert';
  payload?: any;
  filters?: { field: string; op: string; value: any }[];
  reason: string;
}

export interface AiResponse {
  text: string;
  proposal: Proposal | null;
}

// Tables sur lesquelles le cerveau IA peut lire/proposer une action. Volontairement
// une liste blanche : ni les tables d'authentification/compte (profiles,
// invitations, ai_settings lui-même) ni des tables hors du périmètre pédagogique/
// financier de l'école ne doivent être atteignables, même en lecture.
const ALLOWED_TABLES = new Set([
  'eleves', 'classes', 'sections', 'niveaux_classes', 'matieres', 'enseignants',
  'membres_personnel', 'notes', 'bulletins', 'paiements', 'tranches_scolarite',
  'fiches_de_paie', 'ecritures_comptables', 'lignes_ecritures', 'emploi_du_temps',
  'discipline', 'annees_scolaires', 'absences_personnel', 'mouvements_personnel',
  'evaluations_rh', 'formations_rh', 'qhse_incidents', 'qhse_reunions',
  'qhse_depenses', 'qhse_evaluations', 'enquetes', 'comptes_ohada',
]);

function buildSystemPrompt(fileContext?: string) {
  return `Tu es le Cerveau IA de gestion scolaire de l'établissement actuellement ouvert par l'utilisateur, sur l'application School's.

Tu as accès en LECTURE à toutes les données de CETTE école (élèves, classes, notes, bulletins, paiements, tranches de scolarité, personnel enseignant et RH, comptabilité, discipline, emploi du temps). Les autorisations d'accès (RLS) garantissent déjà que tu ne peux jamais voir les données d'une autre école, même si on te le demande.

RÈGLE ABSOLUE — AUCUNE ÉCRITURE DIRECTE : tu n'as pas le pouvoir de modifier la base toi-même. Pour toute création, modification ou suppression, tu DOIS appeler l'outil 'propose_action'. Un humain doit obligatoirement l'approuver avant toute exécution. N'annonce jamais qu'une action a été faite tant qu'elle n'a pas été explicitement approuvée.

Tables accessibles via 'query_data' : ${Array.from(ALLOWED_TABLES).join(', ')}.

Consignes :
- Réponds en français, de façon concise et professionnelle.
- Utilise des tableaux Markdown pour présenter des données chiffrées.
- Si une question porte sur des données que tu n'as pas encore consultées, appelle 'query_data' avant de répondre plutôt que de deviner.
- Si l'action demandée est ambiguë (quel élève, quelle classe, quel montant), demande une précision au lieu de proposer une action au hasard.
- Avant de proposer une suppression, vérifie via 'query_data' si d'autres enregistrements en dépendent encore (ex. des élèves rattachés à la classe ou à l'année scolaire à supprimer) : la base refusera la suppression tant que ces liens existent. Si des dépendances existent, explique-le à l'utilisateur et propose plutôt de les retirer/réaffecter d'abord.
${fileContext ? `\n--- DOCUMENT JOINT PAR L'UTILISATEUR (à analyser) ---\n${fileContext}\n--- FIN DU DOCUMENT ---\n` : ''}`;
}

const TOOL_DEFS = [
  {
    name: 'query_data',
    description: "Lit des données de l'école ouverte. Retourne au plus 50 lignes (utilise des filtres précis plutôt que de tout récupérer).",
    parameters: {
      table: { type: 'string', description: `Table à lire, parmi : ${Array.from(ALLOWED_TABLES).join(', ')}` },
      select: { type: 'string', description: "Colonnes à sélectionner, ex: 'id,nom,prenom'. Par défaut '*'." },
      filters: { type: 'array', description: "Filtres, ex: [{field:'classe_id', op:'eq', value:'...'}]. op parmi eq,neq,gt,gte,lt,lte,in." },
      limit: { type: 'number', description: 'Nombre max de lignes (50 par défaut, 50 max).' },
    },
    required: ['table'],
  },
  {
    name: 'propose_action',
    description: "Propose une création/modification/suppression. N'exécute RIEN : l'utilisateur doit approuver avant toute écriture réelle.",
    parameters: {
      table: { type: 'string', description: `Table concernée, parmi : ${Array.from(ALLOWED_TABLES).join(', ')}` },
      action: { type: 'string', description: "'insert', 'update', 'delete' ou 'upsert'." },
      payload: { type: 'object', description: 'Champs à insérer/modifier (objet ou tableau pour un insert multiple). Non requis pour delete.' },
      filters: { type: 'array', description: "Filtres pour update/delete, ex: [{field:'id', op:'eq', value:'...'}]." },
      reason: { type: 'string', description: 'Explication claire de cette action pour validation humaine.' },
    },
    required: ['table', 'action', 'reason'],
  },
];

async function execQueryData(supabase: SupabaseClient, args: any) {
  const table = String(args?.table || '');
  if (!ALLOWED_TABLES.has(table)) {
    return { error: `Table non autorisée : "${table}".` };
  }
  const select = typeof args?.select === 'string' && args.select.trim() ? args.select.trim() : '*';
  let query = supabase.from(table).select(select).limit(Math.min(50, Number(args?.limit) || 50));

  const filters = Array.isArray(args?.filters) ? args.filters : [];
  for (const f of filters) {
    if (!f || typeof f.field !== 'string') continue;
    const op = String(f.op || 'eq');
    if (op === 'in' && Array.isArray(f.value)) query = (query as any).in(f.field, f.value);
    else if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op)) query = (query as any)[op](f.field, f.value);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { data };
}

// Certains fournisseurs (observé avec DeepSeek) renvoient parfois, au lieu
// d'un vrai appel de fonction structuré, le pseudo-format XML/tokens spéciaux
// de leur propre gabarit d'appel d'outil directement dans le texte de
// réponse (ex. des tokens `｜tool_calls｜`/`<invoke name=...>`). Ce texte brut
// ne doit JAMAIS être affiché tel quel à l'utilisateur : il ressemble à une
// action (parfois destructrice) déjà décidée alors qu'aucun outil réel n'a
// été invoqué et qu'aucune proposition structurée n'a été créée.
const TOOL_LEAK_PATTERN = /[｜]|<\/?invoke\b|<\/?parameter\b|tool[_▁]calls?\s*>/i;

function isLeakedToolSyntax(text: string): boolean {
  return typeof text === 'string' && TOOL_LEAK_PATTERN.test(text);
}

const SAFE_FALLBACK_TEXT = "Le fournisseur IA a renvoyé une réponse mal formée (une syntaxe d'appel d'outil brute au lieu d'une réponse ou d'un appel de fonction valide). Aucune action n'a été proposée ni exécutée. Merci de reformuler votre demande, ou de réessayer.";

function sanitizeFinalText(text: string, provider: string): string {
  if (!isLeakedToolSyntax(text)) return text;
  captureMessage('AI brain: réponse texte contenant une syntaxe d\'appel d\'outil non structurée, filtrée avant affichage', { provider, rawText: text.slice(0, 2000) });
  return SAFE_FALLBACK_TEXT;
}

function buildProposalFromArgs(args: any): Proposal | null {
  const table = String(args?.table || '');
  if (!ALLOWED_TABLES.has(table)) return null;
  const action = args?.action;
  if (!['insert', 'update', 'delete', 'upsert'].includes(action)) return null;
  return {
    table,
    action,
    payload: args?.payload,
    filters: Array.isArray(args?.filters) ? args.filters : undefined,
    reason: String(args?.reason || 'Action proposée par le Cerveau IA.'),
  };
}

// ----------------------------------------------------------------------------
// Chemin OpenAI-compatible (OpenAI / DeepSeek — même SDK, baseURL différente)
// ----------------------------------------------------------------------------
async function askOpenAiCompatible(
  supabase: SupabaseClient,
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  systemPrompt: string,
  history: ChatMessage[],
  prompt: string
): Promise<AiResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL });

  const tools = TOOL_DEFS.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.parameters, required: t.required } },
  }));

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  history.slice(-8).forEach(m => messages.push({ role: m.role, content: m.content }));
  if (messages[messages.length - 1]?.content !== prompt) messages.push({ role: 'user', content: prompt });

  let proposal: Proposal | null = null;
  let finalText: string | null = null;
  let iteration = 0;
  const maxIterations = 6;

  while (iteration < maxIterations && finalText === null) {
    iteration++;
    const isLast = iteration >= maxIterations - 1;
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: isLast ? undefined : tools,
      tool_choice: isLast ? undefined : 'auto',
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg) throw new Error("L'API IA n'a retourné aucune réponse valide.");

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);
      // Tous les outils déclarés ci-dessus sont de type 'function' : seul ce
      // variant possède `.function` (le SDK inclut aussi un type "custom tool"
      // qu'on n'utilise jamais ici).
      for (const call of msg.tool_calls as any[]) {
        const args = JSON.parse(call.function.arguments || '{}');
        let toolResult: any;
        if (call.function.name === 'query_data') {
          toolResult = await execQueryData(supabase, args);
        } else if (call.function.name === 'propose_action') {
          const p = buildProposalFromArgs(args);
          if (p) { proposal = p; finalText = p.reason; }
          toolResult = { success: true, note: 'Proposition enregistrée pour approbation humaine.' };
        } else {
          toolResult = { error: 'Outil inconnu.' };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    } else if (isLeakedToolSyntax(msg.content || '')) {
      // Le modèle a renvoyé en texte brut une syntaxe d'appel d'outil non
      // structurée au lieu d'un vrai tool_call — on ne la fait JAMAIS suivre
      // à l'utilisateur. On retire le message fautif de l'historique envoyé
      // au modèle (pour ne pas propager ses tokens spéciaux) et on lui
      // demande explicitement de se corriger, avant de reboucler.
      captureMessage("AI brain: syntaxe d'appel d'outil non structurée reçue en texte brut (DeepSeek/OpenAI-compatible), correction demandée", { model, rawText: (msg.content || '').slice(0, 2000) });
      messages.push({ role: 'assistant', content: '[réponse invalide ignorée : format non conforme]' });
      messages.push({
        role: 'user',
        content: "Ta réponse précédente contenait une syntaxe d'appel d'outil écrite en texte brut au lieu d'un vrai appel de fonction structuré. Ne reproduis jamais ce format en texte : réponds normalement en français, ou appelle correctement l'un des outils disponibles (query_data, propose_action) via le mécanisme standard d'appel de fonction.",
      });
      if (isLast) finalText = SAFE_FALLBACK_TEXT;
    } else {
      messages.push(msg);
      finalText = msg.content || 'Analyse terminée.';
    }
  }

  return { text: sanitizeFinalText(finalText || 'Analyse terminée.', model), proposal };
}

// ----------------------------------------------------------------------------
// Chemin Gemini
// ----------------------------------------------------------------------------
async function askGemini(
  supabase: SupabaseClient,
  apiKey: string,
  model: string,
  systemPrompt: string,
  history: ChatMessage[],
  prompt: string
): Promise<AiResponse> {
  const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  const toSchema = (props: Record<string, any>) => {
    const properties: Record<string, any> = {};
    for (const [k, v] of Object.entries(props)) {
      const typeMap: Record<string, any> = { string: SchemaType.STRING, number: SchemaType.NUMBER, array: SchemaType.ARRAY, object: SchemaType.OBJECT };
      properties[k] = { type: typeMap[v.type] || SchemaType.STRING, description: v.description };
    }
    return properties;
  };

  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    tools: [{
      functionDeclarations: TOOL_DEFS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: { type: SchemaType.OBJECT, properties: toSchema(t.parameters), required: t.required },
      })),
    }],
  });

  const chatHistory = history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const chat = geminiModel.startChat({ history: chatHistory });

  let proposal: Proposal | null = null;
  let finalText: string | null = null;
  let iteration = 0;
  let nextInput: any = prompt;

  while (iteration < 6 && finalText === null) {
    iteration++;
    const result = await chat.sendMessage(nextInput);
    const response = result.response;
    const calls = response.functionCalls();

    if (calls && calls.length > 0) {
      const parts: any[] = [];
      for (const call of calls) {
        let toolResult: any;
        if (call.name === 'query_data') {
          toolResult = await execQueryData(supabase, call.args);
        } else if (call.name === 'propose_action') {
          const p = buildProposalFromArgs(call.args);
          if (p) { proposal = p; finalText = p.reason; }
          toolResult = { success: true, note: 'Proposition enregistrée pour approbation humaine.' };
        } else {
          toolResult = { error: 'Outil inconnu.' };
        }
        parts.push({ functionResponse: { name: call.name, response: toolResult } });
      }
      nextInput = parts;
    } else {
      finalText = response.text() || 'Analyse terminée.';
    }
  }

  return { text: sanitizeFinalText(finalText || 'Analyse terminée.', model), proposal };
}

// ----------------------------------------------------------------------------
// Chemin Anthropic (Claude)
// ----------------------------------------------------------------------------
async function askAnthropic(
  supabase: SupabaseClient,
  apiKey: string,
  model: string,
  systemPrompt: string,
  history: ChatMessage[],
  prompt: string
): Promise<AiResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const tools = TOOL_DEFS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object' as const, properties: t.parameters, required: t.required },
  }));

  const messages: any[] = history.slice(-8).map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: prompt });

  let proposal: Proposal | null = null;
  let finalText: string | null = null;
  let iteration = 0;

  while (iteration < 6 && finalText === null) {
    iteration++;
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUses = response.content.filter((b: any) => b.type === 'tool_use');
    if (toolUses.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: any[] = [];
      for (const use of toolUses as any[]) {
        let toolResult: any;
        if (use.name === 'query_data') {
          toolResult = await execQueryData(supabase, use.input);
        } else if (use.name === 'propose_action') {
          const p = buildProposalFromArgs(use.input);
          if (p) { proposal = p; finalText = p.reason; }
          toolResult = { success: true, note: 'Proposition enregistrée pour approbation humaine.' };
        } else {
          toolResult = { error: 'Outil inconnu.' };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(toolResult) });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      const textBlock = response.content.find((b: any) => b.type === 'text') as any;
      finalText = textBlock?.text || 'Analyse terminée.';
    }
  }

  return { text: sanitizeFinalText(finalText || 'Analyse terminée.', model), proposal };
}

// ----------------------------------------------------------------------------
// Point d'entrée
// ----------------------------------------------------------------------------
export async function askBrain(
  supabase: SupabaseClient,
  settings: AiSettings,
  history: ChatMessage[],
  prompt: string,
  fileContext?: string,
  providerOverride?: string
): Promise<AiResponse> {
  const provider = providerOverride || settings.default_provider || 'gemini';
  const systemPrompt = buildSystemPrompt(fileContext);

  if (provider === 'gemini') {
    if (!settings.gemini_api_key) throw new Error("Clé API Gemini non configurée dans Paramètres.");
    return askGemini(supabase, settings.gemini_api_key, settings.gemini_model || 'gemini-2.0-flash', systemPrompt, history, prompt);
  }
  if (provider === 'anthropic') {
    if (!settings.anthropic_api_key) throw new Error("Clé API Claude (Anthropic) non configurée dans Paramètres.");
    return askAnthropic(supabase, settings.anthropic_api_key, settings.anthropic_model || 'claude-sonnet-5', systemPrompt, history, prompt);
  }
  if (provider === 'deepseek') {
    if (!settings.deepseek_api_key) throw new Error("Clé API DeepSeek non configurée dans Paramètres.");
    return askOpenAiCompatible(supabase, settings.deepseek_api_key, 'https://api.deepseek.com', settings.deepseek_model || 'deepseek-chat', systemPrompt, history, prompt);
  }
  if (provider === 'openai') {
    if (!settings.openai_api_key) throw new Error("Clé API OpenAI (ChatGPT) non configurée dans Paramètres.");
    return askOpenAiCompatible(supabase, settings.openai_api_key, undefined, settings.openai_model || 'gpt-4o-mini', systemPrompt, history, prompt);
  }
  throw new Error(`Fournisseur IA inconnu : "${provider}".`);
}

export { ALLOWED_TABLES };
