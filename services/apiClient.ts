// API client for the Ghost Interviewer backend (Cloudflare Worker).
//
// Auth: the user signs in with Google once; the Worker verifies the Google ID
// token and returns its own session token (valid ~12 h, verified locally on the
// Worker). We keep that token in localStorage so a page reload or an interview
// longer than Google's one-hour ID token does not silently kill the LLM.

const API_BASE = import.meta.env.VITE_API_URL || 'https://ghost.vitalii.no';
const STORAGE_KEY = 'ghost_interviewer_auth_v1';
// Google ID tokens live one hour; used only when the Worker is too old to issue session tokens.
const GOOGLE_TOKEN_TTL_MS = 55 * 60 * 1000;

export interface GoogleUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

interface StoredAuth {
  token: string;
  expiresAt: number;
  user: GoogleUser;
}

class ApiClient {
  private auth: StoredAuth | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredAuth;
        if (parsed?.token && parsed.expiresAt > Date.now()) this.auth = parsed;
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* storage unavailable: stay signed out */ }
  }

  clearAuth() {
    this.auth = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /** Bearer token for Worker calls, or null when signed out / expired. */
  getIdToken(): string | null {
    if (!this.auth) return null;
    if (this.auth.expiresAt <= Date.now()) {
      this.clearAuth();
      return null;
    }
    return this.auth.token;
  }

  /** User restored from a previous visit (still-valid session), if any. */
  getStoredUser(): GoogleUser | null {
    return this.getIdToken() ? this.auth!.user : null;
  }

  /** Milliseconds until the current token expires (0 when signed out). */
  getRemainingMs(): number {
    return this.auth ? Math.max(0, this.auth.expiresAt - Date.now()) : 0;
  }

  async authenticate(idToken: string): Promise<GoogleUser> {
    const response = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      this.clearAuth();
      throw new Error(
        (body as any).error || `API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as GoogleUser & { sessionToken?: string | null; sessionExpiresAt?: number | null };
    const user: GoogleUser = { id: data.id, email: data.email, name: data.name, picture: data.picture };
    this.auth = data.sessionToken && data.sessionExpiresAt
      ? { token: data.sessionToken, expiresAt: data.sessionExpiresAt, user }
      : { token: idToken, expiresAt: Date.now() + GOOGLE_TOKEN_TTL_MS, user };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.auth)); } catch { /* ignore */ }
    return user;
  }
}

export const apiClient = new ApiClient();
