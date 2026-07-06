/**
 * AniVerse - Centralized Supabase Client
 * Single source of truth for all database operations
 */

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================

// Replace with your actual Supabase credentials
const SUPABASE_URL = 'https://qmcisykwfyjbjluqdthv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_P1NWw77Jrucazh4qozx2oQ_fcU0skIh';

// Initialize the single Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// AUTHENTICATION MODULE
// ============================================================

const Auth = {
    /**
     * Sign up a new user
     * @param {Object} credentials - { email, password, username, displayName, country, birthDate }
     * @returns {Promise<Object>} - { user, session, error, profileError }
     */
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            // Validate inputs
            if (!email || !password || !username || !displayName) {
                throw new Error('All fields are required');
            }
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }
            if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
                throw new Error('Username must be 3-30 characters, alphanumeric and underscore only');
            }

            // 1. Sign up with Supabase Auth
            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        username,
                        display_name: displayName
                    }
                }
            });

            if (authError) {
                if (authError.message.includes('User already registered')) {
                    throw new Error('An account with this email already exists');
                }
                throw new Error(authError.message);
            }

            // If user creation succeeded, attempt to create profile
            let profileError = null;
            if (authData.user) {
                try {
                    // Use upsert to handle any race conditions
                    const { error: upsertError } = await supabaseClient
                        .from('profiles')
                        .upsert({
                            id: authData.user.id,
                            username: username,
                            display_name: displayName,
                            email: email,
                            country: country || null,
                            birth_date: birthDate || null,
                            created_at: new Date().toISOString()
                        }, { onConflict: 'id' });

                    if (upsertError) {
                        console.error('[Auth] Profile upsert error:', upsertError);
                        profileError = upsertError.message;
                    }
                } catch (err) {
                    console.error('[Auth] Profile insertion error:', err);
                    profileError = err.message;
                }
            }

            return {
                user: authData.user,
                session: authData.session,
                error: null,
                profileError
            };

        } catch (error) {
            return {
                user: null,
                session: null,
                error: error.message,
                profileError: null
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

            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                if (error.message.includes('Invalid login credentials')) {
                    throw new Error('Invalid email or password');
                }
                throw new Error(error.message);
            }

            // Update last seen and online status
            if (data.user) {
                await supabaseClient
                    .from('profiles')
                    .update({
                        last_seen_at: new Date().toISOString(),
                        is_online: true
                    })
                    .eq('id', data.user.id);
            }

            return { user: data.user, session: data.session, error: null };
        } catch (error) {
            return { user: null, session: null, error: error.message };
        }
    },

    /**
     * Sign out the current user
     */
    async signOut() {
        try {
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw new Error(error.message);
            return { error: null };
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Get current user with profile
     */
    async getCurrentUser() {
        try {
            const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

            if (userError) throw new Error(userError.message);
            if (!user) return { user: null, profile: null, error: null };

            const { data: profile, error: profileError } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (profileError && profileError.code !== 'PGRST116') {
                console.error('[Auth] Profile fetch error:', profileError);
            }

            return {
                user,
                profile: profile || null,
                error: null
            };
        } catch (error) {
            return { user: null, profile: null, error: error.message };
        }
    },

    /**
     * Get current session
     */
    async getSession() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw new Error(error.message);
            return { session, error: null };
        } catch (error) {
            return { session: null, error: error.message };
        }
    },

    /**
     * Listen to auth state changes
     */
    onAuthStateChange(callback) {
        return supabaseClient.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
};

// ============================================================
// DATABASE MODULE (simplified for brevity)
// ============================================================

const DB = {
    // ... (keep existing DB methods)
};

// ============================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================

const Realtime = {
    // ... (keep existing)
};

// ============================================================
// STORAGE MODULE
// ============================================================

const Storage = {
    // ... (keep existing)
};

// ============================================================
// EXPOSE GLOBALLY
// ============================================================

window.AniVerse = {
    client: supabaseClient,
    auth: Auth,
    db: DB,
    realtime: Realtime,
    storage: Storage
};

// Also expose individual functions for backward compatibility
window.signUp = Auth.signUp.bind(Auth);
window.signIn = Auth.signIn.bind(Auth);
window.signOut = Auth.signOut.bind(Auth);
window.getCurrentUser = Auth.getCurrentUser.bind(Auth);
window.getSession = Auth.getSession.bind(Auth);
window.isAuthenticated = Auth.isAuthenticated.bind(Auth);
window.updateUserProfile = Auth.updateProfile.bind(Auth);
window.sendFriendRequest = Auth.sendFriendRequest.bind(Auth);
window.sendMessage = Auth.sendMessage.bind(Auth);
window.onAuthStateChange = Auth.onAuthStateChange.bind(Auth);

console.log('[AniVerse] Supabase client initialized successfully');