// API client for Ghost Interviewer backend
// Uses Google OAuth for authentication (optional — app works without login)

import type { CandidateProfile, JobProfile, ViewMode, ModeConfig } from '../types.ts';

const API_BASE = import.meta.env.VITE_API_URL || 'https://ghost.vitalii.no';

// ─── Response types ──────────────────────────────────────────────────────────

interface GoogleUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

interface ApiCandidateProfile {
  id: string;
  name: string;
  resume: string;
  knowledgeBase: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiJobProfile {
  id: string;
  name: string;
  companyDescription: string;
  jobDescription: string;
  applicationLetter: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiSettings {
  targetLanguage: string;
  nativeLanguage: string;
  proficiencyLevel: string;
  tone: string;
  systemInstruction: string;
  stereoMode: boolean;
  viewMode: ViewMode;
  ghostModel: string;
  modeConfig: ModeConfig;
  activeCandidateProfileId: string | null;
  activeJobProfileId: string | null;
  createdAt?: string;
  updatedAt: string;
}

interface ApiSession {
  id: string;
  candidateProfileId: string | null;
  jobProfileId: string | null;
  viewMode: string;
  startedAt: string;
  endedAt: string | null;
  messageCount?: number;
  messages?: unknown[];
}

interface SyncData {
  candidateProfiles: ApiCandidateProfile[];
  jobProfiles: ApiJobProfile[];
  settings: ApiSettings | null;
  sessions: ApiSession[];
}

// ─── API Client ──────────────────────────────────────────────────────────────

class ApiClient {
  private idToken: string | null = null;
  private user: GoogleUser | null = null;

  // Set the Google ID token (called after Google Sign-In)
  setIdToken(token: string) {
    this.idToken = token;
  }

  // Clear auth state (sign out)
  clearAuth() {
    this.idToken = null;
    this.user = null;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.idToken !== null && this.user !== null;
  }

  // Get current user info
  getUser(): GoogleUser | null {
    return this.user;
  }

  // Get current ID token (for NMT proxy auth)
  getIdToken(): string | null {
    return this.idToken;
  }

  // ─── HTTP helpers ────────────────────────────────────────────────────────

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.idToken) throw new Error('Not authenticated');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.idToken}`,
    };

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        (body as any).error || `API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // ─── Google Authentication ─────────────────────────────────────────────

  async authenticate(idToken: string): Promise<GoogleUser> {
    this.idToken = idToken;
    try {
      const user = await this.request<GoogleUser>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      this.user = user;
      return user;
    } catch (err) {
      // If auth fails, clear the token
      this.idToken = null;
      throw err;
    }
  }

  // ─── Candidate Profiles ─────────────────────────────────────────────────

  async getCandidateProfiles(): Promise<ApiCandidateProfile[]> {
    return this.get<ApiCandidateProfile[]>('/api/profiles/candidates');
  }

  async createCandidateProfile(profile: {
    name: string;
    resume?: string;
    knowledgeBase?: string;
  }): Promise<ApiCandidateProfile> {
    return this.post<ApiCandidateProfile>('/api/profiles/candidates', profile);
  }

  async updateCandidateProfile(
    id: string,
    updates: Partial<{ name: string; resume: string; knowledgeBase: string }>
  ): Promise<ApiCandidateProfile> {
    return this.put<ApiCandidateProfile>(`/api/profiles/candidates/${id}`, updates);
  }

  async deleteCandidateProfile(id: string): Promise<void> {
    await this.delete(`/api/profiles/candidates/${id}`);
  }

  // ─── Job Profiles ───────────────────────────────────────────────────────

  async getJobProfiles(): Promise<ApiJobProfile[]> {
    return this.get<ApiJobProfile[]>('/api/profiles/jobs');
  }

  async createJobProfile(profile: {
    name: string;
    companyDescription?: string;
    jobDescription?: string;
    applicationLetter?: string;
  }): Promise<ApiJobProfile> {
    return this.post<ApiJobProfile>('/api/profiles/jobs', profile);
  }

  async updateJobProfile(
    id: string,
    updates: Partial<{
      name: string;
      companyDescription: string;
      jobDescription: string;
      applicationLetter: string;
    }>
  ): Promise<ApiJobProfile> {
    return this.put<ApiJobProfile>(`/api/profiles/jobs/${id}`, updates);
  }

  async deleteJobProfile(id: string): Promise<void> {
    await this.delete(`/api/profiles/jobs/${id}`);
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSettings(): Promise<ApiSettings> {
    return this.get<ApiSettings>('/api/settings');
  }

  async updateSettings(updates: Partial<ApiSettings>): Promise<ApiSettings> {
    return this.put<ApiSettings>('/api/settings', updates);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────

  async createSession(params: {
    candidateProfileId?: string;
    jobProfileId?: string;
    viewMode?: ViewMode;
  }): Promise<ApiSession> {
    return this.post<ApiSession>('/api/sessions', params);
  }

  async updateSession(
    id: string,
    updates: { messages?: unknown[]; endedAt?: string }
  ): Promise<ApiSession> {
    return this.put<ApiSession>(`/api/sessions/${id}`, updates);
  }

  async getSessions(limit = 20, offset = 0): Promise<ApiSession[]> {
    return this.get<ApiSession[]>(`/api/sessions?limit=${limit}&offset=${offset}`);
  }

  async getSession(id: string): Promise<ApiSession> {
    return this.get<ApiSession>(`/api/sessions/${id}`);
  }

  // ─── Sync ───────────────────────────────────────────────────────────────

  // Download all data from server
  async syncDown(): Promise<SyncData> {
    return this.get<SyncData>('/api/sync');
  }

  // Upload all data to server (upsert)
  async syncUp(data: {
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
    settings?: Partial<ApiSettings>;
  }): Promise<{ synced: { candidateProfiles: number; jobProfiles: number; settingsUpdated: boolean } }> {
    return this.post('/api/sync', data);
  }

  // ─── Health ─────────────────────────────────────────────────────────────

  async health(): Promise<{ status: string; timestamp: string }> {
    // Health check doesn't require auth
    const response = await fetch(`${API_BASE}/api/health`);
    return response.json();
  }
}

export const apiClient = new ApiClient();

// Re-export types for convenience
export type {
  GoogleUser,
  ApiCandidateProfile,
  ApiJobProfile,
  ApiSettings,
  ApiSession,
  SyncData,
};
