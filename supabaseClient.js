/**
 * AniVerse - Centralized Supabase Client
 * Version: 1.0.0 - NO PROFILE TABLE
 */

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================

const SUPABASE_URL = 'https://qmcisykwfyjbjluqdthv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_P1NWw77Jrucazh4qozx2oQ_fcU0skIh';

console.log('[AniVerse] Initializing Supabase client...');

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

console.log('[AniVerse] Supabase client initialized');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function clearSupabaseStorage() {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.includes('supabase') || 
                key.includes('sb-') || 
                key.includes('aniverse') ||
                key.includes('auth.token') ||
                key.includes('refresh_token')) {
                localStorage.removeItem(key);
            }
        });
        sessionStorage.clear();
        console.log('[AniVerse] Storage cleared');
    } catch (error) {
        console.error('[AniVerse] Error clearing storage:', error);
    }
}

// ============================================================
// AUTHENTICATION MODULE
// ============================================================

const Auth = {
    /**
     * Sign up a new user - NO PROFILE CREATION
     */
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            if (!email || !password) {
                throw new Error('Email and password are required');
            }
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }

            console.log('[Auth] Signing up user:', email);

            clearSupabaseStorage();

            const response = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        username: username || email.split('@')[0],
                        display_name: displayName || username || email.split('@')[0],
                        country: country || null,
                        birth_date: birthDate || null
                    }
                }
            });

            console.log('[Auth] Signup response:', {
                hasData: !!response.data,
                hasError: !!response.error,
                user: response.data?.user?.id || 'none',
                errorMessage: response.error?.message || 'none',
                errorStatus: response.error?.status || 'none'
            });

            if (response.error) {
                console.error('[Auth] Signup error:', response.error);
                let errorMessage = response.error.message || 'Signup failed. Please try again.';
                if (errorMessage.includes('User already registered')) {
                    errorMessage = 'An account with this email already exists. Please log in instead.';
                }
                throw new Error(errorMessage);
            }

            if (!response.data || !response.data.user) {
                throw new Error('Signup failed. No user data returned.');
            }

            console.log('[Auth] User created successfully:', response.data.user.id);

            clearSupabaseStorage();

            return {
                user: response.data.user,
                session: response.data.session,
                error: null
            };

        } catch (error) {
            console.error('[Auth] Signup error:', error);
            return {
                user: null,
                session: null,
                error: error.message || 'Signup failed. Please try again.'
            };
        }
    },

    /**
     * Sign in a user
     */
    async signIn({ email, password }) {
        try {
            if (!email || !password) {
                throw new Error('Email and password are required');
            }

            console.log('[Auth] Signing in user:', email);

            clearSupabaseStorage();

            const response = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            console.log('[Auth] Login response:', {
                hasData: !!response.data,
                hasError: !!response.error,
                user: response.data?.user?.id || 'none'
            });

            if (response.error) {
                console.error('[Auth] Login error:', response.error);
                let errorMessage = response.error.message || 'Login failed. Please try again.';
                if (errorMessage.includes('Invalid login credentials')) {
                    errorMessage = 'Invalid email or password';
                }
                if (errorMessage.includes('Email not confirmed')) {
                    errorMessage = 'Please verify your email address before logging in. Check your inbox.';
                }
                throw new Error(errorMessage);
            }

            if (!response.data || !response.data.user) {
                throw new Error('Login failed. No user data returned.');
            }

            console.log('[Auth] Login successful for:', response.data.user.id);

            return {
                user: response.data.user,
                session: response.data.session,
                error: null
            };
        } catch (error) {
            console.error('[Auth] Login error:', error);
            return { user: null, session: null, error: error.message || 'Login failed. Please try again.' };
        }
    },

    /**
     * Sign out the current user
     */
    async signOut() {
        try {
            console.log('[Auth] Signing out');
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw new Error(error.message);
            clearSupabaseStorage();
            return { error: null };
        } catch (error) {
            console.error('[Auth] Signout error:', error);
            return { error: error.message };
        }
    },

    /**
     * Get current user - NO PROFILE
     */
    async getCurrentUser() {
        try {
            console.log('[Auth] Getting current user...');
            const { data: { user }, error } = await supabaseClient.auth.getUser();

            if (error) {
                console.error('[Auth] Get user error:', error);
                return { user: null, profile: null, error: error.message };
            }

            if (!user) {
                console.log('[Auth] No user logged in');
                return { user: null, profile: null, error: null };
            }

            console.log('[Auth] User found:', user.id);

            // No profile loading - just return the user
            return { user, profile: null, error: null };
        } catch (error) {
            console.error('[Auth] Get current user error:', error);
            return { user: null, profile: null, error: error.message };
        }
    },

    /**
     * Get current session
     */
    async getSession() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) {
                console.error('[Auth] Get session error:', error);
                return { session: null, error: error.message };
            }
            return { session, error: null };
        } catch (error) {
            console.error('[Auth] Get session error:', error);
            return { session: null, error: error.message };
        }
    },

    /**
     * Check if user is authenticated
     */
    async isAuthenticated() {
        try {
            const { session, error } = await this.getSession();
            if (error) return false;
            return !!session;
        } catch (error) {
            return false;
        }
    },

    /**
     * Listen to auth state changes
     */
    onAuthStateChange(callback) {
        return supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log('[Auth] State change:', event);
            if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
                clearSupabaseStorage();
            }
            callback(event, session);
        });
    }
};

// ============================================================
// EXPOSE GLOBALLY
// ============================================================

window.AniVerse = {
    client: supabaseClient,
    auth: Auth,
    clearStorage: clearSupabaseStorage
};

// Individual functions
window.signUp = Auth.signUp.bind(Auth);
window.signIn = Auth.signIn.bind(Auth);
window.signOut = Auth.signOut.bind(Auth);
window.getCurrentUser = Auth.getCurrentUser.bind(Auth);
window.getSession = Auth.getSession.bind(Auth);
window.isAuthenticated = Auth.isAuthenticated.bind(Auth);
window.onAuthStateChange = Auth.onAuthStateChange.bind(Auth);
window.clearSupabaseStorage = clearSupabaseStorage;

console.log('[AniVerse] Supabase client initialized successfully');