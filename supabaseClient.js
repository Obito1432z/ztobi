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

// Initialize Supabase client
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
     * Sign up a new user
     */
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            // Validate inputs
            if (!email || !password) {
                throw new Error('Email and password are required');
            }
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }

            console.log('[Auth] Signing up user:', email);

            // Clear any existing session first
            clearSupabaseStorage();

            // Attempt signup with Supabase Auth
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

            // Check for error
            if (response.error) {
                console.error('[Auth] Signup error:', response.error);
                
                let errorMessage = response.error.message || 'Signup failed. Please try again.';
                
                if (response.error.message && response.error.message.includes('User already registered')) {
                    errorMessage = 'An account with this email already exists. Please log in instead.';
                }
                
                throw new Error(errorMessage);
            }

            // Check if we got user data
            if (!response.data || !response.data.user) {
                throw new Error('Signup failed. No user data returned.');
            }

            console.log('[Auth] User created successfully:', response.data.user.id);

            // Clear any cached data
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
                if (response.error.message && response.error.message.includes('Invalid login credentials')) {
                    throw new Error('Invalid email or password');
                }
                throw new Error(response.error.message || 'Login failed. Please try again.');
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

            let profile = null;
            try {
                const { data, error: profileError } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();

                if (profileError) {
                    console.warn('[Auth] Profile fetch error:', profileError);
                } else {
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
    },

    /**
     * Update user profile
     */
    async updateProfile(updates) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const allowedFields = [
                'display_name', 'bio', 'country', 'birth_date', 'preferred_language', 
                'avatar_url', 'banner_url', 'favorite_genres', 'favorite_anime', 
                'favorite_character', 'favorite_studio', 'favorite_quote', 'social_links'
            ];
            
            const sanitized = {};
            Object.keys(updates).forEach(key => {
                if (allowedFields.includes(key)) {
                    sanitized[key] = updates[key];
                }
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
    }
};

// ============================================================
// DATABASE MODULE
// ============================================================

const DB = {
    async getProfile(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.warn('[DB] Profile fetch warning:', error);
                return { data: null, error: null };
            }
            return { data, error: null };
        } catch (error) {
            return { data: null, error: error.message };
        }
    },

    async getFriends(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('friends')
                .select(`
                    user_id,
                    friend_id,
                    created_at,
                    profile_friend:profiles!friend_id (
                        id, username, display_name, avatar_url, is_online, last_seen_at
                    )
                `)
                .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

            if (error) throw new Error(error.message);
            return { friends: data || [], error: null };
        } catch (error) {
            return { friends: null, error: error.message };
        }
    },

    async getUserGuilds(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('guild_members')
                .select(`
                    guild_id,
                    role_id,
                    joined_at,
                    guilds!inner (
                        id, name, slug, logo_url, category, visibility, level, is_official
                    )
                `)
                .eq('user_id', userId);

            if (error) throw new Error(error.message);
            return { guilds: data || [], error: null };
        } catch (error) {
            return { guilds: null, error: error.message };
        }
    },

    async getNotifications(userId, options = {}) {
        try {
            const { limit = 20, offset = 0, unreadOnly = false } = options;

            let query = supabaseClient
                .from('notifications')
                .select('*', { count: 'exact' })
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (unreadOnly) {
                query = query.eq('is_read', false);
            }

            const { data, count, error } = await query;
            if (error) throw new Error(error.message);
            return { notifications: data || [], count: count || 0, error: null };
        } catch (error) {
            return { notifications: null, count: 0, error: error.message };
        }
    },

    async markNotificationRead(notificationId, userId) {
        try {
            const { error } = await supabaseClient
                .from('notifications')
                .update({ is_read: true, read_at: new Date().toISOString() })
                .eq('id', notificationId)
                .eq('user_id', userId);

            if (error) throw new Error(error.message);
            return { error: null };
        } catch (error) {
            return { error: error.message };
        }
    },

    async getGuildPosts(guildId, options = {}) {
        try {
            const { limit = 20, offset = 0 } = options;

            const { data, count, error } = await supabaseClient
                .from('guild_posts')
                .select('*, author:profiles!author_id (id, username, display_name, avatar_url)', { count: 'exact' })
                .eq('guild_id', guildId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw new Error(error.message);
            return { posts: data || [], count: count || 0, error: null };
        } catch (error) {
            return { posts: null, count: 0, error: error.message };
        }
    },

    async getMessages(conversationId, options = {}) {
        try {
            const { limit = 50, offset = 0 } = options;

            const { data, error } = await supabaseClient
                .from('messages')
                .select(`
                    *,
                    sender:profiles!sender_id (id, username, display_name, avatar_url)
                `)
                .eq('conversation_id', conversationId)
                .is('deleted_by_sender', false)
                .is('deleted_by_receiver', false)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw new Error(error.message);
            return { messages: data ? data.reverse() : [], error: null };
        } catch (error) {
            return { messages: null, error: error.message };
        }
    },

    async getUserActivity(userId, options = {}) {
        try {
            const { limit = 20, offset = 0 } = options;

            const { data, error } = await supabaseClient
                .from('user_activity_log')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw new Error(error.message);
            return { activities: data || [], error: null };
        } catch (error) {
            return { activities: null, error: error.message };
        }
    }
};

// ============================================================
// STORAGE MODULE
// ============================================================

const Storage = {
    async upload(bucket, path, file) {
        try {
            const { error: uploadError } = await supabaseClient.storage
                .from(bucket)
                .upload(path, file, { upsert: true });

            if (uploadError) throw new Error(uploadError.message);

            const { data: { publicUrl } } = supabaseClient.storage
                .from(bucket)
                .getPublicUrl(path);

            return { url: publicUrl, error: null };
        } catch (error) {
            return { url: null, error: error.message };
        }
    },

    async delete(bucket, path) {
        try {
            const { error } = await supabaseClient.storage
                .from(bucket)
                .remove([path]);

            if (error) throw new Error(error.message);
            return { error: null };
        } catch (error) {
            return { error: error.message };
        }
    }
};

// ============================================================
// EXPOSE GLOBALLY
// ============================================================

window.AniVerse = {
    client: supabaseClient,
    auth: Auth,
    db: DB,
    storage: Storage,
    clearStorage: clearSupabaseStorage
};

// Individual functions
window.signUp = Auth.signUp.bind(Auth);
window.signIn = Auth.signIn.bind(Auth);
window.signOut = Auth.signOut.bind(Auth);
window.getCurrentUser = Auth.getCurrentUser.bind(Auth);
window.getSession = Auth.getSession.bind(Auth);
window.isAuthenticated = Auth.isAuthenticated.bind(Auth);
window.updateUserProfile = Auth.updateProfile.bind(Auth);
window.onAuthStateChange = Auth.onAuthStateChange.bind(Auth);
window.clearSupabaseStorage = clearSupabaseStorage;

console.log('[AniVerse] Supabase client initialized successfully');