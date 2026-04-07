import { neon } from '@neondatabase/serverless';

interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  GOOGLE_TRANSLATE_KEY: string;
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

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenInfo | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!response.ok) return null;
    const data = await response.json() as GoogleTokenInfo;
    if (!data.sub || !data.email) return null;
    return data;
  } catch {
    return null;
  }
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
async function authenticateGoogle(sql: SqlFunction, request: Request): Promise<Response> {
  const body = await request.json() as { idToken?: string };
  if (!body.idToken) {
    return jsonResponse({ error: 'idToken is required' }, 400);
  }

  const profile = await verifyGoogleToken(body.idToken);
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

  return jsonResponse({
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

// ─── Health check ────────────────────────────────────────────────────────────

async function healthCheck(sql: SqlFunction): Promise<Response> {
  try {
    await sql`SELECT 1`;
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error: any) {
    return jsonResponse({ status: 'error', error: error.message }, 500);
  }
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
        return authenticateGoogle(sql, request);
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

      // Translation proxy (requires auth, uses server-side API key)
      if (method === 'POST' && path === '/api/translate') {
        // Lightweight auth: just verify token, don't need DB user
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return jsonResponse({ error: 'Authorization required' }, 401);
        }
        const tokenInfo = await verifyGoogleToken(authHeader.slice(7));
        if (!tokenInfo) {
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
