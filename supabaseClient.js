/**
 * AniVerse - Centralized Supabase Client
 * Version: 1.0.0
 */

const SUPABASE_URL = 'https://qmcisykwfyjbjluqdthv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_P1NWw77Jrucazh4qozx2oQ_fcU0skIh';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

function clearSupabaseStorage() {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.includes('supabase') || key.includes('sb-') || key.includes('aniverse') || 
                key.includes('auth.token') || key.includes('refresh_token')) {
                localStorage.removeItem(key);
            }
        });
        sessionStorage.clear();
    } catch (e) { /* ignore */ }
}

const Auth = {
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            if (!email || !password) throw new Error('Email and password are required');
            if (password.length < 8) throw new Error('Password must be at least 8 characters');

            clearSupabaseStorage();

            const response = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        username: username || email.split('@')[0],
                        display_name: displayName || username || email.split('@')[0],
                        country: country || null,
                        birth_date: birthDate || null
                    }
                }
            });

            if (response.error) {
                let errorMessage = response.error.message || 'Signup failed. Please try again.';
                if (errorMessage.includes('User already registered')) {
                    errorMessage = 'An account with this email already exists. Please log in instead.';
                }
                throw new Error(errorMessage);
            }

            if (!response.data || !response.data.user) {
                throw new Error('Signup failed. No user data returned.');
            }

            // Fallback: manually create profile if trigger failed
            try {
                // Wait a moment for trigger to run, then check if profile exists
                await new Promise(resolve => setTimeout(resolve, 500));
                const { data: existing } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .eq('id', response.data.user.id)
                    .maybeSingle();

                if (!existing) {
                    // Manually insert profile
                    await supabaseClient
                        .from('profiles')
                        .insert({
                            id: response.data.user.id,
                            username: username || email.split('@')[0],
                            display_name: displayName || username || email.split('@')[0],
                            email: email,
                            created_at: new Date().toISOString()
                        });
                }
            } catch (profileError) {
                console.warn('[Auth] Manual profile creation fallback failed:', profileError);
            }

            clearSupabaseStorage();
            return { user: response.data.user, session: response.data.session, error: null };

        } catch (error) {
            return { user: null, session: null, error: error.message || 'Signup failed. Please try again.' };
        }
    },

    async signIn({ email, password }) {
        try {
            if (!email || !password) throw new Error('Email and password are required');
            clearSupabaseStorage();

            const response = await supabaseClient.auth.signInWithPassword({ email, password });

            if (response.error) {
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

            // Update last seen (if profile exists)
            try {
                await supabaseClient
                    .from('profiles')
                    .update({ last_seen_at: new Date().toISOString(), is_online: true })
                    .eq('id', response.data.user.id);
            } catch (e) { /* ignore */ }

            return { user: response.data.user, session: response.data.session, error: null };
        } catch (error) {
            return { user: null, session: null, error: error.message || 'Login failed. Please try again.' };
        }
    },

    async signOut() {
        try {
            const { error } = await supabaseClient.auth.signOut();
            if (error) throw new Error(error.message);
            clearSupabaseStorage();
            return { error: null };
        } catch (error) {
            return { error: error.message };
        }
    },

    async getCurrentUser() {
        try {
            const { data: { user }, error } = await supabaseClient.auth.getUser();
            if (error) return { user: null, profile: null, error: error.message };
            if (!user) return { user: null, profile: null, error: null };

            // Load profile
            let profile = null;
            try {
                const { data, error: pErr } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                if (!pErr) profile = data;
            } catch (e) { /* ignore */ }

            return { user, profile, error: null };
        } catch (error) {
            return { user: null, profile: null, error: error.message };
        }
    },

    async getSession() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) return { session: null, error: error.message };
            return { session, error: null };
        } catch (error) {
            return { session: null, error: error.message };
        }
    },

    async updateProfile(updates) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            // First update auth metadata
            const { error: metaError } = await supabaseClient.auth.updateUser({
                data: updates
            });
            if (metaError) throw new Error(metaError.message);

            // Then update profiles table
            const allowed = ['display_name', 'bio', 'country', 'birth_date', 'preferred_language', 
                'avatar_url', 'banner_url', 'favorite_genres', 'favorite_anime', 'favorite_character', 
                'favorite_studio', 'favorite_quote', 'social_links'];
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
            return { data: null, error: error.message };
        }
    },

    onAuthStateChange(callback) {
        return supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || event === 'USER_DELETED') clearSupabaseStorage();
            callback(event, session);
        });
    }
};

// Export
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

console.log('[AniVerse] Supabase client initialized');