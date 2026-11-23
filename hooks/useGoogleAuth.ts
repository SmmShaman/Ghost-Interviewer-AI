// Hook for Google Sign-In integration
// Google auth is OPTIONAL — the app works without login (localStorage-only mode)

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, GoogleUser } from '../services/apiClient.ts';

declare global {
  interface Window {
    google: any;
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

interface UseGoogleAuthReturn {
  user: GoogleUser | null;
  isSignedIn: boolean;
  isLoading: boolean;
  error: string | null;
  signOut: () => void;
  /** Call when the backend answered 401: drops the dead session. */
  markExpired: () => void;
  renderButton: (elementId: string) => void;
}

export function useGoogleAuth(): UseGoogleAuthReturn {
  // Restore a still-valid session from a previous visit (no re-login after reload).
  const [user, setUser] = useState<GoogleUser | null>(() => apiClient.getStoredUser());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const handleCredentialResponse = useCallback(async (response: any) => {
    if (!response.credential) return;

    setIsLoading(true);
    setError(null);

    try {
      const authenticatedUser = await apiClient.authenticate(response.credential);
      setUser(authenticatedUser);
      console.log('[Auth] Google sign-in successful:', authenticatedUser.email);
    } catch (err: any) {
      console.error('[Auth] Authentication failed:', err);
      setError(err.message || 'Authentication failed');
      apiClient.clearAuth();
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize Google Identity Services
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || initializedRef.current) return;

    const initGoogle = () => {
      if (!window.google?.accounts?.id) {
        // GIS library not loaded yet, retry
        setTimeout(initGoogle, 200);
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      initializedRef.current = true;
    };

    initGoogle();
  }, [handleCredentialResponse]);

  const renderButton = useCallback((elementId: string) => {
    if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

    const element = document.getElementById(elementId);
    if (!element) return;

    window.google.accounts.id.renderButton(element, {
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 240,
    });
  }, []);

  const signOut = useCallback(() => {
    apiClient.clearAuth();
    setUser(null);
    setError(null);

    // Revoke Google session if available
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }

    console.log('[Auth] Signed out');
  }, []);

  // The session can expire (or be rejected by the backend) while the page stays
  // open; reflect that in the UI so the user is asked to sign in again.
  const markExpired = useCallback(() => {
    apiClient.clearAuth();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (!apiClient.getIdToken()) setUser(null);
    }, 30_000);
    return () => clearInterval(timer);
  }, [user]);

  return {
    user,
    markExpired,
    isSignedIn: user !== null,
    isLoading,
    error,
    signOut,
    renderButton,
  };
}
