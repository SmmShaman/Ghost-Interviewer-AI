import { neon } from '@neondatabase/serverless';

interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  GOOGLE_TRANSLATE_KEY: string;
  // Anthropic auth: either a Claude subscription OAuth token (from `claude setup-token`)
  // or a console API key. The OAuth token takes precedence when both are set.
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  // Shared secret that lets the owner's other Workers (e.g. kapital) use the
  // Claude proxy server-to-server without a Google user token.
  AI_INTERNAL_KEY?: string;
  // HMAC key for app session tokens. Optional: falls back to AI_INTERNAL_KEY.
  SESSION_SECRET?: string;
  // Google OAuth client id of this app. When set, ID tokens minted for any
  // other app are rejected (set it: without it any Google sign-in is accepted).
  GOOGLE_CLIENT_ID?: string;
  // D1 database with the app's test logs (every recognized word, drafts, LLM
  // translations, answers). Optional: without the binding /api/logs answers 503.
  LOGS_DB?: D1Database;
}

type SqlFunction = ReturnType<typeof neon>;

// Google token verification response
interface GoogleTokenInfo {
  sub: string;       // Google user ID
  email: string;
  name?: string;
  picture?: string;
  email_verified?: string;
  aud?: string;
  exp?: string;
}

// ─── CORS ────────────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ─── Google OAuth helpers ───────────────────────────────────────────────────

async function verifyGoogleToken(idToken: string, env?: Env): Promise<GoogleTokenInfo | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!response.ok) return null;
    const data = await response.json() as GoogleTokenInfo;
    if (!data.sub || !data.email) return null;
    if (env?.GOOGLE_CLIENT_ID && data.aud !== env.GOOGLE_CLIENT_ID) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── App session tokens ──────────────────────────────────────────────────────
// A Google ID token lives one hour and verifying it costs a round trip to Google
// on every request. For a live interview that means (a) the LLM dies mid-session
// and (b) every translation waits on tokeninfo. After one Google verification we
// therefore issue our own HMAC-signed token, checked locally with no network.

const SESSION_PREFIX = 'gs1';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (text: string): Uint8Array => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

async function sessionKey(env: Env): Promise<CryptoKey | null> {
  const secret = env.SESSION_SECRET || env.AI_INTERNAL_KEY;
  if (!secret) return null;
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`ghost-session:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function issueSessionToken(env: Env, sub: string, email: string): Promise<{ token: string; expiresAt: number } | null> {
  const key = await sessionKey(env);
  if (!key) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ sub, email, exp })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return { token: `${SESSION_PREFIX}.${payload}.${b64url(sig)}`, expiresAt: exp * 1000 };
}

async function verifySessionToken(env: Env, token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const [prefix, payload, sig] = token.split('.');
    if (prefix !== SESSION_PREFIX || !payload || !sig) return null;
    const key = await sessionKey(env);
    if (!key) return null;
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), new TextEncoder().encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { sub: string; email: string; exp: number };
    if (!data.sub || !data.exp || data.exp * 1000 < Date.now()) return null;
    return { sub: data.sub, email: data.email };
  } catch {
    return null;
  }
}

// Bearer auth for the stateless endpoints (AI proxy, translate proxy):
// app session token (local check) or, as before, a raw Google ID token.
async function verifyBearer(request: Request, env: Env): Promise<{ sub: string; email: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith(`${SESSION_PREFIX}.`)) return verifySessionToken(env, token);
  const info = await verifyGoogleToken(token, env);
  return info ? { sub: info.sub, email: info.email } : null;
}

async function getOrCreateUser(
  sql: SqlFunction,
  profile: GoogleTokenInfo
): Promise<{ id: string; googleId: string; email: string; name: string | null; picture: string | null }> {
  // Upsert: insert or update last_login_at, name, picture, email
  const rows = await sql`
    INSERT INTO users (google_id, email, name, picture)
    VALUES (${profile.sub}, ${profile.email}, ${profile.name || null}, ${profile.picture || null})
    ON CONFLICT (google_id) DO UPDATE SET
      last_login_at = NOW(),
      name = COALESCE(EXCLUDED.name, users.name),
      picture = COALESCE(EXCLUDED.picture, users.picture),
      email = EXCLUDED.email
    RETURNING id, google_id, email, name, picture
  `;

  return {
    id: rows[0].id,
    googleId: rows[0].google_id,
    email: rows[0].email,
    name: rows[0].name,
    picture: rows[0].picture,
  };
}

// Extract and verify user from Authorization header
async function getUserFromRequest(
  sql: SqlFunction,
  request: Request
): Promise<{ id: string; googleId: string; email: string; name: string | null; picture: string | null } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice(7);
  const profile = await verifyGoogleToken(idToken);
  if (!profile) return null;

  return getOrCreateUser(sql, profile);
}

function requireAuth(user: unknown): Response | null {
  if (!user) {
    return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
  }
  return null;
}

// ─── Route matching ──────────────────────────────────────────────────────────

function matchRoute(method: string, path: string, pattern: string): Record<string, string> | null {
  // Convert pattern like /api/profiles/candidates/:id to regex
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:(\w+)/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  const match = path.match(regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1];
  });
  return params;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

// POST /api/auth/google
async function authenticateGoogle(sql: SqlFunction, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { idToken?: string };
  if (!body.idToken) {
    return jsonResponse({ error: 'idToken is required' }, 400);
  }

  const profile = await verifyGoogleToken(body.idToken, env);
  if (!profile) {
    return jsonResponse({ error: 'Invalid Google ID token' }, 401);
  }

  const user = await getOrCreateUser(sql, profile);

  // Ensure default settings exist for this user
  const existingSettings = await sql`
    SELECT id FROM settings WHERE user_id = ${user.id}
  `;
  if (existingSettings.length === 0) {
    await sql`
      INSERT INTO settings (user_id) VALUES (${user.id})
    `;
  }

  const session = await issueSessionToken(env, profile.sub, profile.email);

  return jsonResponse({
    sessionToken: session?.token ?? null,
    sessionExpiresAt: session?.expiresAt ?? null,
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  });
}

// ─── Candidate Profiles ──────────────────────────────────────────────────────

// GET /api/profiles/candidates
async function listCandidateProfiles(sql: SqlFunction, userId: string): Promise<Response> {
  const rows = await sql`
    SELECT id, name, resume, knowledge_base, created_at, updated_at
    FROM candidate_profiles
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return jsonResponse(rows.map(r => ({
    id: r.id,
    name: r.name,
    resume: r.resume,
    knowledgeBase: r.knowledge_base,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
}

// POST /api/profiles/candidates
async function createCandidateProfile(sql: SqlFunction, userId: string, request: Request): Promise<Response> {
  const body = await request.json() as {
    name: string;
    resume?: string;
    knowledgeBase?: string;
  };

  if (!body.name) {
    return jsonResponse({ error: 'Name is required' }, 400);
  }

  const rows = await sql`
    INSERT INTO candidate_profiles (user_id, name, resume, knowledge_base)
    VALUES (${userId}, ${body.name}, ${body.resume || ''}, ${body.knowledgeBase || ''})
    RETURNING id, name, resume, knowledge_base, created_at, updated_at
  `;

  return jsonResponse({
    id: rows[0].id,
    name: rows[0].name,
    resume: rows[0].resume,
    knowledgeBase: rows[0].knowledge_base,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  }, 201);
}

// PUT /api/profiles/candidates/:id
async function updateCandidateProfile(
  sql: SqlFunction,
  userId: string,
  profileId: string,
  request: Request
): Promise<Response> {
  const body = await request.json() as {
    name?: string;
    resume?: string;
    knowledgeBase?: string;
  };

  const rows = await sql`
    UPDATE candidate_profiles
    SET
      name = COALESCE(${body.name ?? null}, name),
      resume = COALESCE(${body.resume ?? null}, resume),
      knowledge_base = COALESCE(${body.knowledgeBase ?? null}, knowledge_base),
      updated_at = NOW()
    WHERE id = ${profileId} AND user_id = ${userId}
    RETURNING id, name, resume, knowledge_base, created_at, updated_at
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Profile not found' }, 404);
  }

  return jsonResponse({
    id: rows[0].id,
    name: rows[0].name,
    resume: rows[0].resume,
    knowledgeBase: rows[0].knowledge_base,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  });
}

// DELETE /api/profiles/candidates/:id
async function deleteCandidateProfile(
  sql: SqlFunction,
  userId: string,
  profileId: string
): Promise<Response> {
  const rows = await sql`
    DELETE FROM candidate_profiles
    WHERE id = ${profileId} AND user_id = ${userId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Profile not found' }, 404);
  }

  return jsonResponse({ deleted: true });
}

// ─── Job Profiles ────────────────────────────────────────────────────────────

// GET /api/profiles/jobs
async function listJobProfiles(sql: SqlFunction, userId: string): Promise<Response> {
  const rows = await sql`
    SELECT id, name, company_description, job_description, application_letter, created_at, updated_at
    FROM job_profiles
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return jsonResponse(rows.map(r => ({
    id: r.id,
    name: r.name,
    companyDescription: r.company_description,
    jobDescription: r.job_description,
    applicationLetter: r.application_letter,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
}

// POST /api/profiles/jobs
async function createJobProfile(sql: SqlFunction, userId: string, request: Request): Promise<Response> {
  const body = await request.json() as {
    name: string;
    companyDescription?: string;
    jobDescription?: string;
    applicationLetter?: string;
  };

  if (!body.name) {
    return jsonResponse({ error: 'Name is required' }, 400);
  }

  const rows = await sql`
    INSERT INTO job_profiles (user_id, name, company_description, job_description, application_letter)
    VALUES (
      ${userId},
      ${body.name},
      ${body.companyDescription || ''},
      ${body.jobDescription || ''},
      ${body.applicationLetter || ''}
    )
    RETURNING id, name, company_description, job_description, application_letter, created_at, updated_at
  `;

  return jsonResponse({
    id: rows[0].id,
    name: rows[0].name,
    companyDescription: rows[0].company_description,
    jobDescription: rows[0].job_description,
    applicationLetter: rows[0].application_letter,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  }, 201);
}

// PUT /api/profiles/jobs/:id
async function updateJobProfile(
  sql: SqlFunction,
  userId: string,
  profileId: string,
  request: Request
): Promise<Response> {
  const body = await request.json() as {
    name?: string;
    companyDescription?: string;
    jobDescription?: string;
    applicationLetter?: string;
  };

  const rows = await sql`
    UPDATE job_profiles
    SET
      name = COALESCE(${body.name ?? null}, name),
      company_description = COALESCE(${body.companyDescription ?? null}, company_description),
      job_description = COALESCE(${body.jobDescription ?? null}, job_description),
      application_letter = COALESCE(${body.applicationLetter ?? null}, application_letter),
      updated_at = NOW()
    WHERE id = ${profileId} AND user_id = ${userId}
    RETURNING id, name, company_description, job_description, application_letter, created_at, updated_at
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Profile not found' }, 404);
  }

  return jsonResponse({
    id: rows[0].id,
    name: rows[0].name,
    companyDescription: rows[0].company_description,
    jobDescription: rows[0].job_description,
    applicationLetter: rows[0].application_letter,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  });
}

// DELETE /api/profiles/jobs/:id
async function deleteJobProfile(
  sql: SqlFunction,
  userId: string,
  profileId: string
): Promise<Response> {
  const rows = await sql`
    DELETE FROM job_profiles
    WHERE id = ${profileId} AND user_id = ${userId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Profile not found' }, 404);
  }

  return jsonResponse({ deleted: true });
}

// ─── Settings ────────────────────────────────────────────────────────────────

// GET /api/settings
async function getSettings(sql: SqlFunction, userId: string): Promise<Response> {
  const rows = await sql`
    SELECT
      target_language, native_language, proficiency_level, tone,
      system_instruction, stereo_mode, view_mode, ghost_model,
      mode_config, active_candidate_profile_id, active_job_profile_id,
      created_at, updated_at
    FROM settings
    WHERE user_id = ${userId}
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Settings not found' }, 404);
  }

  const s = rows[0];
  return jsonResponse({
    targetLanguage: s.target_language,
    nativeLanguage: s.native_language,
    proficiencyLevel: s.proficiency_level,
    tone: s.tone,
    systemInstruction: s.system_instruction,
    stereoMode: s.stereo_mode,
    viewMode: s.view_mode,
    ghostModel: s.ghost_model,
    modeConfig: s.mode_config,
    activeCandidateProfileId: s.active_candidate_profile_id,
    activeJobProfileId: s.active_job_profile_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  });
}

// PUT /api/settings
async function updateSettings(sql: SqlFunction, userId: string, request: Request): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const rows = await sql`
    UPDATE settings
    SET
      target_language = COALESCE(${(body.targetLanguage as string) ?? null}, target_language),
      native_language = COALESCE(${(body.nativeLanguage as string) ?? null}, native_language),
      proficiency_level = COALESCE(${(body.proficiencyLevel as string) ?? null}, proficiency_level),
      tone = COALESCE(${(body.tone as string) ?? null}, tone),
      system_instruction = COALESCE(${(body.systemInstruction as string) ?? null}, system_instruction),
      stereo_mode = COALESCE(${(body.stereoMode as boolean) ?? null}, stereo_mode),
      view_mode = COALESCE(${(body.viewMode as string) ?? null}, view_mode),
      ghost_model = COALESCE(${(body.ghostModel as string) ?? null}, ghost_model),
      mode_config = COALESCE(${body.modeConfig ? JSON.stringify(body.modeConfig) : null}::jsonb, mode_config),
      active_candidate_profile_id = COALESCE(${(body.activeCandidateProfileId as string) ?? null}, active_candidate_profile_id),
      active_job_profile_id = COALESCE(${(body.activeJobProfileId as string) ?? null}, active_job_profile_id),
      updated_at = NOW()
    WHERE user_id = ${userId}
    RETURNING
      target_language, native_language, proficiency_level, tone,
      system_instruction, stereo_mode, view_mode, ghost_model,
      mode_config, active_candidate_profile_id, active_job_profile_id,
      updated_at
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Settings not found' }, 404);
  }

  const s = rows[0];
  return jsonResponse({
    targetLanguage: s.target_language,
    nativeLanguage: s.native_language,
    proficiencyLevel: s.proficiency_level,
    tone: s.tone,
    systemInstruction: s.system_instruction,
    stereoMode: s.stereo_mode,
    viewMode: s.view_mode,
    ghostModel: s.ghost_model,
    modeConfig: s.mode_config,
    activeCandidateProfileId: s.active_candidate_profile_id,
    activeJobProfileId: s.active_job_profile_id,
    updatedAt: s.updated_at,
  });
}

// ─── Interview Sessions ──────────────────────────────────────────────────────

// POST /api/sessions
async function createSession(sql: SqlFunction, userId: string, request: Request): Promise<Response> {
  const body = await request.json() as {
    candidateProfileId?: string;
    jobProfileId?: string;
    viewMode?: string;
  };

  const rows = await sql`
    INSERT INTO interview_sessions (user_id, candidate_profile_id, job_profile_id, view_mode)
    VALUES (
      ${userId},
      ${body.candidateProfileId || null},
      ${body.jobProfileId || null},
      ${body.viewMode || 'FOCUS'}
    )
    RETURNING id, candidate_profile_id, job_profile_id, view_mode, started_at, messages
  `;

  return jsonResponse({
    id: rows[0].id,
    candidateProfileId: rows[0].candidate_profile_id,
    jobProfileId: rows[0].job_profile_id,
    viewMode: rows[0].view_mode,
    startedAt: rows[0].started_at,
    messages: rows[0].messages,
  }, 201);
}

// PUT /api/sessions/:id
async function updateSession(
  sql: SqlFunction,
  userId: string,
  sessionId: string,
  request: Request
): Promise<Response> {
  const body = await request.json() as {
    messages?: unknown[];
    endedAt?: string;
  };

  if (body.messages !== undefined) {
    const rows = await sql`
      UPDATE interview_sessions
      SET
        messages = ${JSON.stringify(body.messages)}::jsonb,
        ended_at = COALESCE(${body.endedAt || null}::timestamptz, ended_at)
      WHERE id = ${sessionId} AND user_id = ${userId}
      RETURNING id, candidate_profile_id, job_profile_id, view_mode, started_at, ended_at, messages
    `;

    if (rows.length === 0) {
      return jsonResponse({ error: 'Session not found' }, 404);
    }

    return jsonResponse({
      id: rows[0].id,
      candidateProfileId: rows[0].candidate_profile_id,
      jobProfileId: rows[0].job_profile_id,
      viewMode: rows[0].view_mode,
      startedAt: rows[0].started_at,
      endedAt: rows[0].ended_at,
      messages: rows[0].messages,
    });
  }

  // If only ending the session
  const rows = await sql`
    UPDATE interview_sessions
    SET ended_at = COALESCE(${body.endedAt || null}::timestamptz, NOW())
    WHERE id = ${sessionId} AND user_id = ${userId}
    RETURNING id, candidate_profile_id, job_profile_id, view_mode, started_at, ended_at, messages
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  return jsonResponse({
    id: rows[0].id,
    candidateProfileId: rows[0].candidate_profile_id,
    jobProfileId: rows[0].job_profile_id,
    viewMode: rows[0].view_mode,
    startedAt: rows[0].started_at,
    endedAt: rows[0].ended_at,
    messages: rows[0].messages,
  });
}

// GET /api/sessions
async function listSessions(sql: SqlFunction, userId: string, url: URL): Promise<Response> {
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const rows = await sql`
    SELECT id, candidate_profile_id, job_profile_id, view_mode, started_at, ended_at,
           jsonb_array_length(messages) as message_count
    FROM interview_sessions
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return jsonResponse(rows.map(r => ({
    id: r.id,
    candidateProfileId: r.candidate_profile_id,
    jobProfileId: r.job_profile_id,
    viewMode: r.view_mode,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    messageCount: r.message_count,
  })));
}

// GET /api/sessions/:id
async function getSession(sql: SqlFunction, userId: string, sessionId: string): Promise<Response> {
  const rows = await sql`
    SELECT id, candidate_profile_id, job_profile_id, view_mode, started_at, ended_at, messages
    FROM interview_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;

  if (rows.length === 0) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  return jsonResponse({
    id: rows[0].id,
    candidateProfileId: rows[0].candidate_profile_id,
    jobProfileId: rows[0].job_profile_id,
    viewMode: rows[0].view_mode,
    startedAt: rows[0].started_at,
    endedAt: rows[0].ended_at,
    messages: rows[0].messages,
  });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

// GET /api/sync — Download all data for this user
async function syncDown(sql: SqlFunction, userId: string): Promise<Response> {
  const [candidates, jobs, settings, sessions] = await Promise.all([
    sql`
      SELECT id, name, resume, knowledge_base, created_at, updated_at
      FROM candidate_profiles WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `,
    sql`
      SELECT id, name, company_description, job_description, application_letter, created_at, updated_at
      FROM job_profiles WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `,
    sql`
      SELECT target_language, native_language, proficiency_level, tone,
             system_instruction, stereo_mode, view_mode, ghost_model,
             mode_config, active_candidate_profile_id, active_job_profile_id
      FROM settings WHERE user_id = ${userId}
    `,
    sql`
      SELECT id, candidate_profile_id, job_profile_id, view_mode, started_at, ended_at,
             jsonb_array_length(messages) as message_count
      FROM interview_sessions WHERE user_id = ${userId}
      ORDER BY started_at DESC LIMIT 50
    `,
  ]);

  return jsonResponse({
    candidateProfiles: candidates.map(r => ({
      id: r.id,
      name: r.name,
      resume: r.resume,
      knowledgeBase: r.knowledge_base,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    jobProfiles: jobs.map(r => ({
      id: r.id,
      name: r.name,
      companyDescription: r.company_description,
      jobDescription: r.job_description,
      applicationLetter: r.application_letter,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    settings: settings.length > 0 ? {
      targetLanguage: settings[0].target_language,
      nativeLanguage: settings[0].native_language,
      proficiencyLevel: settings[0].proficiency_level,
      tone: settings[0].tone,
      systemInstruction: settings[0].system_instruction,
      stereoMode: settings[0].stereo_mode,
      viewMode: settings[0].view_mode,
      ghostModel: settings[0].ghost_model,
      modeConfig: settings[0].mode_config,
      activeCandidateProfileId: settings[0].active_candidate_profile_id,
      activeJobProfileId: settings[0].active_job_profile_id,
    } : null,
    sessions: sessions.map(r => ({
      id: r.id,
      candidateProfileId: r.candidate_profile_id,
      jobProfileId: r.job_profile_id,
      viewMode: r.view_mode,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      messageCount: r.message_count,
    })),
  });
}

// POST /api/sync — Upload all data from client (upsert)
async function syncUp(sql: SqlFunction, userId: string, request: Request): Promise<Response> {
  const body = await request.json() as {
    candidateProfiles?: Array<{
      id?: string;
      name: string;
      resume?: string;
      knowledgeBase?: string;
    }>;
    jobProfiles?: Array<{
      id?: string;
      name: string;
      companyDescription?: string;
      jobDescription?: string;
      applicationLetter?: string;
    }>;
    settings?: Record<string, unknown>;
  };

  const results = {
    candidateProfiles: 0,
    jobProfiles: 0,
    settingsUpdated: false,
  };

  // Upsert candidate profiles
  if (body.candidateProfiles) {
    for (const cp of body.candidateProfiles) {
      if (cp.id) {
        // Try update first
        const updated = await sql`
          UPDATE candidate_profiles
          SET name = ${cp.name}, resume = ${cp.resume || ''}, knowledge_base = ${cp.knowledgeBase || ''}, updated_at = NOW()
          WHERE id = ${cp.id} AND user_id = ${userId}
          RETURNING id
        `;
        if (updated.length === 0) {
          // Insert with provided ID
          await sql`
            INSERT INTO candidate_profiles (id, user_id, name, resume, knowledge_base)
            VALUES (${cp.id}, ${userId}, ${cp.name}, ${cp.resume || ''}, ${cp.knowledgeBase || ''})
          `;
        }
      } else {
        await sql`
          INSERT INTO candidate_profiles (user_id, name, resume, knowledge_base)
          VALUES (${userId}, ${cp.name}, ${cp.resume || ''}, ${cp.knowledgeBase || ''})
        `;
      }
      results.candidateProfiles++;
    }
  }

  // Upsert job profiles
  if (body.jobProfiles) {
    for (const jp of body.jobProfiles) {
      if (jp.id) {
        const updated = await sql`
          UPDATE job_profiles
          SET name = ${jp.name}, company_description = ${jp.companyDescription || ''},
              job_description = ${jp.jobDescription || ''}, application_letter = ${jp.applicationLetter || ''},
              updated_at = NOW()
          WHERE id = ${jp.id} AND user_id = ${userId}
          RETURNING id
        `;
        if (updated.length === 0) {
          await sql`
            INSERT INTO job_profiles (id, user_id, name, company_description, job_description, application_letter)
            VALUES (${jp.id}, ${userId}, ${jp.name}, ${jp.companyDescription || ''},
                    ${jp.jobDescription || ''}, ${jp.applicationLetter || ''})
          `;
        }
      } else {
        await sql`
          INSERT INTO job_profiles (user_id, name, company_description, job_description, application_letter)
          VALUES (${userId}, ${jp.name}, ${jp.companyDescription || ''},
                  ${jp.jobDescription || ''}, ${jp.applicationLetter || ''})
        `;
      }
      results.jobProfiles++;
    }
  }

  // Update settings
  if (body.settings) {
    const s = body.settings;
    await sql`
      UPDATE settings
      SET
        target_language = COALESCE(${(s.targetLanguage as string) ?? null}, target_language),
        native_language = COALESCE(${(s.nativeLanguage as string) ?? null}, native_language),
        proficiency_level = COALESCE(${(s.proficiencyLevel as string) ?? null}, proficiency_level),
        tone = COALESCE(${(s.tone as string) ?? null}, tone),
        system_instruction = COALESCE(${(s.systemInstruction as string) ?? null}, system_instruction),
        stereo_mode = COALESCE(${(s.stereoMode as boolean) ?? null}, stereo_mode),
        view_mode = COALESCE(${(s.viewMode as string) ?? null}, view_mode),
        ghost_model = COALESCE(${(s.ghostModel as string) ?? null}, ghost_model),
        mode_config = COALESCE(${s.modeConfig ? JSON.stringify(s.modeConfig) : null}::jsonb, mode_config),
        active_candidate_profile_id = COALESCE(${(s.activeCandidateProfileId as string) ?? null}, active_candidate_profile_id),
        active_job_profile_id = COALESCE(${(s.activeJobProfileId as string) ?? null}, active_job_profile_id),
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;
    results.settingsUpdated = true;
  }

  return jsonResponse({ synced: results });
}

// ─── Anthropic (Claude) AI Proxy ─────────────────────────────────────────────
// Credentials never leave the Worker. Auth is either a Claude subscription OAuth
// token (Authorization: Bearer + oauth beta header) or a console API key.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ALLOWED_MODEL = /^claude-[a-z0-9-]+$/;
// Subscription OAuth tokens are rate-limited per model tier; when the main model
// answers 429 we retry once on the fast model so the interview aid keeps working.
const FALLBACK_MODEL = 'claude-haiku-4-5';

async function callAnthropic(headers: Record<string, string>, body: AiRequestBody, stream: boolean): Promise<Response> {
  const attempt = (model: string) => fetch(ANTHROPIC_API, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildAnthropicBody({ ...body, model }, stream)),
  });
  let resp = await attempt(body.model);
  if (resp.status === 429 && body.model !== FALLBACK_MODEL) {
    console.warn(`Anthropic 429 on ${body.model}, retrying with ${FALLBACK_MODEL}`);
    resp = await attempt(FALLBACK_MODEL);
  }
  return resp;
}

interface AiRequestBody {
  model: string;
  prompt: string;
  systemInstruction?: string;
  // Mark the system instruction as a prompt-cache breakpoint. Used for the
  // answer prompt, whose system part (candidate documents + briefing) is
  // identical for every question of a session.
  cacheSystem?: boolean;
  // `thinking: false` turns extended thinking off: live translation needs the
  // first token as early as possible and gains nothing from deliberation.
  config?: { maxOutputTokens?: number; effort?: 'low' | 'medium' | 'high'; thinking?: boolean };
}

function anthropicHeaders(env: Env): Record<string, string> | null {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      ...base,
      'Authorization': `Bearer ${env.CLAUDE_CODE_OAUTH_TOKEN}`,
      'anthropic-beta': 'oauth-2025-04-20',
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { ...base, 'x-api-key': env.ANTHROPIC_API_KEY };
  }
  return null;
}

// Subscription OAuth tokens only unlock Opus/Sonnet when the FIRST system block is
// exactly the Claude Code identity line (verified 2026-08-22: without it every
// non-Haiku model answers an instant `rate_limit_error`). The app prompt follows
// as a second block. Harmless with an API key, so it is always sent.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

function buildAnthropicBody(body: AiRequestBody, stream: boolean): Record<string, unknown> {
  const system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }];
  if (body.systemInstruction) {
    system.push({
      type: 'text',
      text: body.systemInstruction,
      ...(body.cacheSystem ? { cache_control: { type: 'ephemeral' as const } } : {}),
    });
  }
  const out: Record<string, unknown> = {
    model: body.model,
    max_tokens: body.config?.maxOutputTokens ?? 4096,
    system,
    messages: [{ role: 'user', content: body.prompt }],
    stream,
  };
  // Haiku 4.5 predates adaptive thinking; every newer model runs adaptive thinking
  // with a low default effort — this is a real-time interview aid, latency matters.
  if (!body.model.includes('haiku-4-5') && body.config?.thinking !== false) {
    out.thinking = { type: 'adaptive' };
    out.output_config = { effort: body.config?.effort ?? 'low' };
  }
  return out;
}

function internalKeyOk(request: Request, env: Env): boolean {
  const given = request.headers.get('X-Internal-Key');
  if (!given || !env.AI_INTERNAL_KEY || given.length !== env.AI_INTERNAL_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ env.AI_INTERNAL_KEY.charCodeAt(i);
  return diff === 0;
}

async function authorizeAiRequest(request: Request, env: Env): Promise<{ headers: Record<string, string>; body: AiRequestBody } | Response> {
  if (!internalKeyOk(request, env)) {
    if (!request.headers.get('Authorization')) {
      return jsonResponse({ error: 'Authorization required' }, 401);
    }
    if (!(await verifyBearer(request, env))) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }
  }
  const headers = anthropicHeaders(env);
  if (!headers) {
    return jsonResponse({ error: 'AI service not configured' }, 503);
  }
  const body = await request.json() as AiRequestBody;
  if (!body.model || !body.prompt) {
    return jsonResponse({ error: 'model and prompt are required' }, 400);
  }
  if (!ALLOWED_MODEL.test(body.model)) {
    return jsonResponse({ error: 'Unsupported model' }, 400);
  }
  return { headers, body };
}

// POST /api/ai/generate — non-streaming Claude proxy
async function claudeGenerate(request: Request, env: Env): Promise<Response> {
  const auth = await authorizeAiRequest(request, env);
  if (auth instanceof Response) return auth;

  const resp = await callAnthropic(auth.headers, auth.body, false);

  const data = await resp.json() as any;
  if (!resp.ok) {
    return jsonResponse({ error: 'Anthropic API error', details: data?.error?.message }, resp.status);
  }

  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return jsonResponse({ text, stop_reason: data.stop_reason });
}

// POST /api/ai/stream — streaming Claude proxy, re-emitted as `data: {"text"}` SSE
async function claudeStream(request: Request, env: Env): Promise<Response> {
  const auth = await authorizeAiRequest(request, env);
  if (auth instanceof Response) return auth;

  const resp = await callAnthropic(auth.headers, auth.body, true);

  if (!resp.ok || !resp.body) {
    const errData = await resp.json().catch(() => ({})) as any;
    return jsonResponse({ error: 'Anthropic stream failed', details: errData?.error?.message }, resp.status);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const reader = resp.body!.getReader();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const evt = JSON.parse(jsonStr);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`));
            } else if (evt.type === 'error') {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ error: evt.error?.message || 'stream error' })}\n\n`));
            }
          } catch {}
        }
      }
    } finally {
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders() },
  });
}

// ─── Health check ────────────────────────────────────────────────────────────

async function healthCheck(sql: SqlFunction): Promise<Response> {
  try {
    await sql`SELECT 1`;
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error: any) {
    return jsonResponse({ status: 'error', error: error.message }, 500);
  }
}

// ─── Test logs (D1) ──────────────────────────────────────────────────────────
// The app streams each listening session's events here every few seconds
// (append-only, idempotent by seq) and the full readable text when it stops.

const MAX_LOG_EVENTS_PER_REQUEST = 500;
const MAX_LOG_BODY_BYTES = 2_000_000;

interface LogUpload {
  session: { id: string; startedAt: number; endedAt?: number | null; meta?: Record<string, string> };
  events?: Array<{ seq: number; t: number; k: string; [key: string]: unknown }>;
  fullText?: string;
}

async function saveLogs(request: Request, env: Env, user: { email: string }): Promise<Response> {
  const db = env.LOGS_DB;
  if (!db) return jsonResponse({ error: 'Logs storage not configured' }, 503);
  const raw = await request.text();
  if (raw.length > MAX_LOG_BODY_BYTES) return jsonResponse({ error: 'Payload too large' }, 413);
  let body: LogUpload;
  try { body = JSON.parse(raw); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
  const s = body.session;
  if (!s || typeof s.id !== 'string' || !/^[\w-]{1,64}$/.test(s.id) || typeof s.startedAt !== 'number') {
    return jsonResponse({ error: 'session.id and session.startedAt are required' }, 400);
  }
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length > MAX_LOG_EVENTS_PER_REQUEST) return jsonResponse({ error: 'Too many events' }, 413);

  const owner = await db.prepare('SELECT user_email FROM log_sessions WHERE id = ?').bind(s.id).first<{ user_email: string }>();
  if (owner && owner.user_email !== user.email) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO log_sessions (id, user_email, started_at, ended_at, meta, full_text, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         ended_at = COALESCE(excluded.ended_at, log_sessions.ended_at),
         meta = COALESCE(excluded.meta, log_sessions.meta),
         full_text = COALESCE(excluded.full_text, log_sessions.full_text),
         updated_at = excluded.updated_at`
    ).bind(s.id, user.email, s.startedAt, s.endedAt ?? null, s.meta ? JSON.stringify(s.meta) : null,
      typeof body.fullText === 'string' ? body.fullText : null, now),
  ];
  for (const e of events) {
    if (typeof e?.seq !== 'number' || typeof e.t !== 'number' || typeof e.k !== 'string') continue;
    const { seq, t, k, ...data } = e;
    stmts.push(db.prepare('INSERT OR IGNORE INTO log_events (session_id, seq, t, kind, data) VALUES (?, ?, ?, ?, ?)')
      .bind(s.id, seq, t, k.slice(0, 32), JSON.stringify(data)));
  }
  await db.batch(stmts);
  return jsonResponse({ ok: true, saved: stmts.length - 1 });
}

async function listLogs(env: Env, user: { email: string }): Promise<Response> {
  const db = env.LOGS_DB;
  if (!db) return jsonResponse({ error: 'Logs storage not configured' }, 503);
  const { results } = await db.prepare(
    `SELECT s.id, s.started_at, s.ended_at, s.meta, (SELECT COUNT(*) FROM log_events e WHERE e.session_id = s.id) AS events
     FROM log_sessions s WHERE s.user_email = ? ORDER BY s.started_at DESC LIMIT 50`
  ).bind(user.email).all();
  return jsonResponse({ sessions: results });
}

async function getLogText(env: Env, user: { email: string }, id: string): Promise<Response> {
  const db = env.LOGS_DB;
  if (!db) return jsonResponse({ error: 'Logs storage not configured' }, 503);
  const s = await db.prepare('SELECT user_email, full_text FROM log_sessions WHERE id = ?').bind(id).first<{ user_email: string; full_text: string | null }>();
  if (!s || s.user_email !== user.email) return jsonResponse({ error: 'Not found' }, 404);
  let text = s.full_text;
  if (!text) {
    // Session still running (or the app was killed): raw event list.
    const { results } = await db.prepare('SELECT t, kind, data FROM log_events WHERE session_id = ? ORDER BY seq').bind(id).all<{ t: number; kind: string; data: string }>();
    text = results.map(r => `${(r.t / 1000).toFixed(1)}s\t${r.kind}\t${r.data}`).join('\n');
  }
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() } });
}

// ─── Main router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sql = neon(env.DATABASE_URL);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // Health check (no auth needed)
      if (method === 'GET' && path === '/api/health') {
        return healthCheck(sql);
      }

      // Google auth endpoint (no auth needed — this IS the auth)
      if (method === 'POST' && path === '/api/auth/google') {
        return authenticateGoogle(sql, request, env);
      }

      // Non-API routes — proxy to Netlify frontend
      if (!path.startsWith('/api/')) {
        const netlifyUrl = new URL(request.url);
        netlifyUrl.hostname = 'ghost-interviewer-ai.netlify.app';
        netlifyUrl.port = '';
        const proxyReq = new Request(netlifyUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: 'follow',
        });
        return fetch(proxyReq);
      }

      // Claude AI proxy (requires auth, credentials stay server-side)
      if (method === 'POST' && path === '/api/ai/generate') {
        return claudeGenerate(request, env);
      }
      if (method === 'POST' && path === '/api/ai/stream') {
        return claudeStream(request, env);
      }

      // Test logs (requires auth; stored per Google account)
      if (path === '/api/logs' || path.startsWith('/api/logs/')) {
        const user = await verifyBearer(request, env);
        if (!user) return jsonResponse({ error: 'Authorization required' }, 401);
        if (method === 'POST' && path === '/api/logs') return saveLogs(request, env, user);
        if (method === 'GET' && path === '/api/logs') return listLogs(env, user);
        const m = path.match(/^\/api\/logs\/([\w-]{1,64})\.txt$/);
        if (method === 'GET' && m) return getLogText(env, user, m[1]);
        return jsonResponse({ error: 'Not found', path, method }, 404);
      }

      // Translation proxy (requires auth, uses server-side API key)
      if (method === 'POST' && path === '/api/translate') {
        // Lightweight auth: just verify token, don't need DB user
        if (!request.headers.get('Authorization')) {
          return jsonResponse({ error: 'Authorization required' }, 401);
        }
        if (!(await verifyBearer(request, env))) {
          return jsonResponse({ error: 'Invalid token' }, 401);
        }

        const body = await request.json() as { q: string; source?: string; target?: string };
        if (!body.q) {
          return jsonResponse({ error: 'Missing "q" parameter' }, 400);
        }

        const translateKey = env.GOOGLE_TRANSLATE_KEY;
        if (!translateKey) {
          return jsonResponse({ error: 'Translation service not configured' }, 503);
        }

        const googleResp = await fetch(
          `https://translation.googleapis.com/language/translate/v2?key=${translateKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              q: body.q,
              source: body.source || 'no',
              target: body.target || 'uk',
              format: 'text',
            }),
          }
        );

        const googleData = await googleResp.json() as any;

        if (!googleResp.ok) {
          return jsonResponse({ error: 'Translation failed', details: googleData?.error?.message }, googleResp.status);
        }

        const translatedText = googleData?.data?.translations?.[0]?.translatedText || '';
        return jsonResponse({ translatedText });
      }

      // All other /api/ routes require auth
      const user = await getUserFromRequest(sql, request);
      const authError = requireAuth(user);
      if (authError) return authError;
      const userId = user!.id;

      // --- Candidate Profiles ---
      if (method === 'GET' && path === '/api/profiles/candidates') {
        return listCandidateProfiles(sql, userId);
      }
      if (method === 'POST' && path === '/api/profiles/candidates') {
        return createCandidateProfile(sql, userId, request);
      }
      let params = matchRoute(method, path, '/api/profiles/candidates/:id');
      if (params && method === 'PUT') {
        return updateCandidateProfile(sql, userId, params.id, request);
      }
      if (params && method === 'DELETE') {
        return deleteCandidateProfile(sql, userId, params.id);
      }

      // --- Job Profiles ---
      if (method === 'GET' && path === '/api/profiles/jobs') {
        return listJobProfiles(sql, userId);
      }
      if (method === 'POST' && path === '/api/profiles/jobs') {
        return createJobProfile(sql, userId, request);
      }
      params = matchRoute(method, path, '/api/profiles/jobs/:id');
      if (params && method === 'PUT') {
        return updateJobProfile(sql, userId, params.id, request);
      }
      if (params && method === 'DELETE') {
        return deleteJobProfile(sql, userId, params.id);
      }

      // --- Settings ---
      if (method === 'GET' && path === '/api/settings') {
        return getSettings(sql, userId);
      }
      if (method === 'PUT' && path === '/api/settings') {
        return updateSettings(sql, userId, request);
      }

      // --- Sessions ---
      if (method === 'GET' && path === '/api/sessions') {
        return listSessions(sql, userId, url);
      }
      if (method === 'POST' && path === '/api/sessions') {
        return createSession(sql, userId, request);
      }
      params = matchRoute('GET', path, '/api/sessions/:id');
      if (params && method === 'GET') {
        return getSession(sql, userId, params.id);
      }
      if (params && method === 'PUT') {
        return updateSession(sql, userId, params.id, request);
      }

      // --- Sync ---
      if (method === 'GET' && path === '/api/sync') {
        return syncDown(sql, userId);
      }
      if (method === 'POST' && path === '/api/sync') {
        return syncUp(sql, userId, request);
      }

      // No matching API route
      return jsonResponse({ error: 'Not found', path, method }, 404);
    } catch (error: any) {
      console.error('Worker error:', error);
      return jsonResponse({
        error: 'Internal server error',
        message: env.ENVIRONMENT !== 'production' ? error.message : undefined,
      }, 500);
    }
  },
};
