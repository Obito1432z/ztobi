/**
 * AniVerse - Centralized Supabase Client
 * Version: 1.0.0
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
     * Sign up a new user with duplicate username check
     */
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            if (!email || !password) {
                throw new Error('Email and password are required');
            }
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }
            if (!username || username.length < 3) {
                throw new Error('Username must be at least 3 characters');
            }

            console.log('[Auth] Signing up user:', email);
            console.log('[Auth] Username:', username);

            // ✅ CHECK DUPLICATE USERNAME
            try {
                const { data: existingUser, error: checkError } = await supabaseClient
                    .from('profiles')
                    .select('username')
                    .eq('username', username)
                    .maybeSingle();

                if (checkError) {
                    console.warn('[Auth] Username check error (RLS may be blocking):', checkError);
                    // If RLS is blocking, try using RPC function
                    try {
                        const { data: exists, error: rpcError } = await supabaseClient.rpc('check_username_exists', {
                            username: username
                        });
                        if (rpcError) {
                            console.warn('[Auth] RPC username check failed:', rpcError);
                        } else if (exists === true) {
                            throw new Error('Username already taken. Please choose another.');
                        }
                    } catch (rpcErr) {
                        console.warn('[Auth] RPC username check error:', rpcErr);
                        // If RPC also fails, proceed with signup but handle duplicate later
                    }
                } else if (existingUser) {
                    throw new Error('Username already taken. Please choose another.');
                }
            } catch (checkErr) {
                if (checkErr.message.includes('Username already taken')) {
                    throw checkErr;
                }
                console.warn('[Auth] Username check warning:', checkErr);
                // Continue with signup if check fails due to RLS
            }

            clearSupabaseStorage();

            const response = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        username: username,
                        display_name: displayName || username,
                        country: country || null,
                        birth_date: birthDate || null
                    }
                }
            });

            console.log('[Auth] Signup response:', {
                hasData: !!response.data,
                hasError: !!response.error,
                user: response.data?.user?.id || 'none',
                errorMessage: response.error?.message || 'none'
            });

            if (response.error) {
                let errorMessage = response.error.message || 'Signup failed. Please try again.';
                if (errorMessage.includes('User already registered')) {
                    errorMessage = 'An account with this email already exists. Please log in instead.';
                }
                if (errorMessage.includes('duplicate key value violates unique constraint')) {
                    errorMessage = 'Username already taken. Please choose another.';
                }
                throw new Error(errorMessage);
            }

            if (!response.data || !response.data.user) {
                throw new Error('Signup failed. No user data returned.');
            }

            console.log('[Auth] User created successfully:', response.data.user.id);

            // Fallback: manually create profile if trigger failed
            try {
                await new Promise(resolve => setTimeout(resolve, 500));
                const { data: existing } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .eq('id', response.data.user.id)
                    .maybeSingle();

                if (!existing) {
                    await supabaseClient
                        .from('profiles')
                        .insert({
                            id: response.data.user.id,
                            username: username,
                            display_name: displayName || username,
                            email: email,
                            created_at: new Date().toISOString()
                        });
                    console.log('[Auth] Profile created (fallback)');
                }
            } catch (profileError) {
                console.warn('[Auth] Manual profile creation fallback failed:', profileError);
            }

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

            // Update last seen
            try {
                await supabaseClient
                    .from('profiles')
                    .update({ last_seen_at: new Date().toISOString(), is_online: true })
                    .eq('id', response.data.user.id);
            } catch (e) { /* ignore */ }

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
     * Get current user with profile
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

            // Load profile
            let profile = null;
            try {
                const { data, error: pErr } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                if (!pErr && data) {
                    profile = data;
                }
            } catch (e) {
                console.warn('[Auth] Profile fetch error:', e);
            }

            return { user, profile, error: null };
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
     * Update user profile
     */
    async updateProfile(updates) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            // Update auth metadata
            const { error: metaError } = await supabaseClient.auth.updateUser({
                data: updates
            });
            if (metaError) throw new Error(metaError.message);

            // Update profiles table
            const allowed = ['display_name', 'bio', 'country', 'birth_date', 'preferred_language',
                'avatar_url', 'banner_url', 'favorite_genres', 'favorite_anime', 'favorite_character',
                'favorite_studio', 'favorite_quote', 'social_links'
            ];
            const sanitized = {};
            Object.keys(updates).forEach(key => {
                if (allowed.includes(key)) sanitized[key] = updates[key];
            });
            sanitized.updated_at = new Date().toISOString();

            const { data, error } = await supabaseClient
                .from('profiles')
                .update(sanitized)
                .eq('id', user.id)
                .select()
                .single();

            if (error) throw new Error(error.message);
            return { data, error: null };
        } catch (error) {
            console.error('[Auth] Update profile error:', error);
            return { data: null, error: error.message };
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

window.signUp = Auth.signUp.bind(Auth);
window.signIn = Auth.signIn.bind(Auth);
window.signOut = Auth.signOut.bind(Auth);
window.getCurrentUser = Auth.getCurrentUser.bind(Auth);
window.getSession = Auth.getSession.bind(Auth);
window.updateProfile = Auth.updateProfile.bind(Auth);
window.onAuthStateChange = Auth.onAuthStateChange.bind(Auth);
window.clearSupabaseStorage = clearSupabaseStorage;

console.log('[AniVerse] Supabase client initialized successfully');