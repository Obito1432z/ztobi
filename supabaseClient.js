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
            if (key.includes('supabase') || key.includes('sb-') || key.includes('aniverse') || key.includes('auth.token') || key.includes('refresh_token')) {
                localStorage.removeItem(key);
            }
        });
        sessionStorage.clear();
    } catch (e) { /* ignore */ }
}

const Auth = {
    /**
     * Sign up a new user with proper error propagation
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

            // Log full response for debugging
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

            // If the trigger failed, we manually create the profile
            // This is a fallback in case the trigger fails
            try {
                const { error: profileError } = await supabaseClient
                    .from('profiles')
                    .insert({
                        id: response.data.user.id,
                        username: username || email.split('@')[0],
                        display_name: displayName || username || email.split('@')[0],
                        email: email,
                        created_at: new Date().toISOString(),
                        level: 0,
                        experience_points: 0,
                        is_online: false
                    });

                if (profileError) {
                    console.warn('[Auth] Profile creation via trigger failed, but user exists. Manual insert failed:', profileError);
                } else {
                    console.log('[Auth] Profile created successfully (manual fallback)');
                }
            } catch (profileErr) {
                console.warn('[Auth] Manual profile creation error:', profileErr);
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

    // ... (keep other methods like signIn, signOut, getCurrentUser, etc.)
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
window.updateUserProfile = Auth.updateProfile.bind(Auth);

console.log('[AniVerse] Supabase client initialized');