/**
 * AniVerse - Centralized Supabase Client
 * Version: 2.0.0 – Full DB & Storage Support
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
    async signUp({ email, password, username, displayName, country, birthDate }) {
        try {
            if (!email || !password) throw new Error('Email and password are required');
            if (password.length < 8) throw new Error('Password must be at least 8 characters');
            if (!username || username.length < 3) throw new Error('Username must be at least 3 characters');
            if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
                throw new Error('Username must be 3-30 characters, alphanumeric and underscore only');
            }

            console.log('[Auth] Signing up user:', email);
            clearSupabaseStorage();

            const response = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        username,
                        display_name: displayName || username,
                        country: country || null,
                        birth_date: birthDate || null
                    }
                }
            });

            if (response.error) {
                let errorMessage = response.error.message || 'Signup failed.';
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

            // Fallback profile creation
            let profileCreated = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!profileCreated && retryCount < maxRetries) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
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
                                username,
                                display_name: displayName || username,
                                email,
                                country: country || null,
                                birth_date: birthDate || null,
                                created_at: new Date().toISOString()
                            });
                        console.log('[Auth] Profile created (fallback)');
                    }
                    profileCreated = true;
                } catch (profileError) {
                    console.warn(`[Auth] Profile creation attempt ${retryCount + 1} failed:`, profileError);
                    retryCount++;
                }
            }

            return {
                user: response.data.user,
                session: response.data.session,
                error: null
            };

        } catch (error) {
            console.error('[Auth] Signup error:', error);
            return { user: null, session: null, error: error.message || 'Signup failed. Please try again.' };
        }
    },

    async signIn({ email, password }) {
        try {
            if (!email || !password) throw new Error('Email and password are required');
            console.log('[Auth] Signing in user:', email);
            clearSupabaseStorage();

            const response = await supabaseClient.auth.signInWithPassword({ email, password });

            if (response.error) {
                let errorMessage = response.error.message || 'Login failed.';
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

            // Update last seen (silent fail)
            try {
                await supabaseClient
                    .from('profiles')
                    .update({ last_seen_at: new Date().toISOString(), is_online: true })
                    .eq('id', response.data.user.id);
            } catch (e) { /* ignore */ }

            return { user: response.data.user, session: response.data.session, error: null };
        } catch (error) {
            console.error('[Auth] Login error:', error);
            return { user: null, session: null, error: error.message || 'Login failed. Please try again.' };
        }
    },

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
            let retryCount = 0;
            const maxRetries = 3;

            while (!profile && retryCount < maxRetries) {
                try {
                    if (retryCount > 0) await new Promise(resolve => setTimeout(resolve, 300 * retryCount));
                    const { data, error: pErr } = await supabaseClient
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .maybeSingle();
                    if (!pErr && data) profile = data;
                } catch (e) { /* ignore */ }
                retryCount++;
            }

            return { user, profile, error: null };
        } catch (error) {
            console.error('[Auth] Get current user error:', error);
            return { user: null, profile: null, error: error.message };
        }
    },

    async getSession() {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw new Error(error.message);
            return { session, error: null };
        } catch (error) {
            return { session: null, error: error.message };
        }
    },

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

    // --- FRIEND REQUESTS ---
    async sendFriendRequest(receiverId) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            // Check if already friends or request pending
            const { data: existing, error: checkError } = await supabaseClient
                .from('friend_requests')
                .select('id, status')
                .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
                .or(`sender_id.eq.${receiverId},receiver_id.eq.${receiverId}`)
                .maybeSingle();

            if (checkError) throw new Error(checkError.message);
            if (existing) {
                if (existing.status === 'pending') throw new Error('Friend request already pending.');
                if (existing.status === 'accepted') throw new Error('You are already friends.');
                throw new Error('Request already exists.');
            }

            const { data, error } = await supabaseClient
                .from('friend_requests')
                .insert({ sender_id: user.id, receiver_id: receiverId, status: 'pending' })
                .select()
                .single();

            if (error) throw new Error(error.message);
            return { data, error: null };
        } catch (error) {
            return { data: null, error: error.message };
        }
    },

    // --- MESSAGES ---
    async sendMessage({ receiverId, content, replyToId = null }) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');
            if (!content || !content.trim()) throw new Error('Message cannot be empty');

            // Find or create conversation
            let conversationId = await this._getOrCreateConversation(user.id, receiverId);

            const { data, error } = await supabaseClient
                .from('messages')
                .insert({
                    conversation_id: conversationId,
                    sender_id: user.id,
                    receiver_id: receiverId,
                    content: content.trim(),
                    reply_to_id: replyToId
                })
                .select()
                .single();

            if (error) throw new Error(error.message);

            // Update conversation last message
            await supabaseClient
                .from('conversations')
                .update({ last_message_id: data.id, last_message_at: data.created_at })
                .eq('id', conversationId);

            return { data, error: null };
        } catch (error) {
            return { data: null, error: error.message };
        }
    },

    async _getOrCreateConversation(userId1, userId2) {
        // Find existing conversation
        const { data, error } = await supabaseClient
            .from('conversations')
            .select('id')
            .or(`participant1_id.eq.${userId1},participant1_id.eq.${userId2}`)
            .or(`participant2_id.eq.${userId1},participant2_id.eq.${userId2}`)
            .maybeSingle();

        if (data) return data.id;

        // Create new
        const { data: newConvo, error: createError } = await supabaseClient
            .from('conversations')
            .insert({
                participant1_id: userId1 < userId2 ? userId1 : userId2,
                participant2_id: userId1 < userId2 ? userId2 : userId1
            })
            .select()
            .single();

        if (createError) throw new Error(createError.message);
        return newConvo.id;
    },

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
// DATABASE MODULE
// ============================================================

const DB = {
    async getFriends(userId, options = {}) {
        try {
            const { data, error } = await supabaseClient
                .from('friends')
                .select(`
                    id,
                    user_id,
                    friend_id,
                    profiles_user:user_id (id, username, display_name, avatar_url, is_online, level),
                    profiles_friend:friend_id (id, username, display_name, avatar_url, is_online, level)
                `)
                .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
                .order('created_at', { ascending: false });

            if (error) throw new Error(error.message);

            // Map to friend objects
            const friends = data.map(item => {
                const isUser1 = item.user_id === userId;
                const friend = isUser1 ? item.profiles_friend : item.profiles_user;
                return { ...friend, is_online: friend.is_online || false };
            });

            return { friends, error: null };
        } catch (error) {
            return { friends: null, error: error.message };
        }
    },

    async getFriendRequests(userId, type = 'received') {
        try {
            const column = type === 'received' ? 'receiver_id' : 'sender_id';
            const { data, error } = await supabaseClient
                .from('friend_requests')
                .select(`
                    *,
                    sender:profiles!sender_id (id, username, display_name, avatar_url),
                    receiver:profiles!receiver_id (id, username, display_name, avatar_url)
                `)
                .eq(column, userId)
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) throw new Error(error.message);
            return { requests: data, error: null };
        } catch (error) {
            return { requests: null, error: error.message };
        }
    },

    async getMessages(conversationId, options = {}) {
        try {
            const limit = options.limit || 50;
            const { data, error } = await supabaseClient
                .from('messages')
                .select(`
                    *,
                    sender:profiles!sender_id (id, username, display_name, avatar_url)
                `)
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw new Error(error.message);
            return { messages: data.reverse(), error: null };
        } catch (error) {
            return { messages: null, error: error.message };
        }
    },

    async getConversations(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('conversations')
                .select(`
                    *,
                    participant1:profiles!participant1_id (id, username, display_name, avatar_url, is_online),
                    participant2:profiles!participant2_id (id, username, display_name, avatar_url, is_online),
                    last_message:messages!last_message_id (id, content, created_at, sender_id)
                `)
                .or(`participant1_id.eq.${userId},participant2_id.eq.${userId}`)
                .order('last_message_at', { ascending: false, nulls_last: true });

            if (error) throw new Error(error.message);
            return { conversations: data, error: null };
        } catch (error) {
            return { conversations: null, error: error.message };
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
                    guilds!inner (id, name, slug, logo_url, category, visibility, level, is_official)
                `)
                .eq('user_id', userId);

            if (error) throw new Error(error.message);
            const guilds = data.map(item => item.guilds);
            return { guilds, error: null };
        } catch (error) {
            return { guilds: null, error: error.message };
        }
    },

    async getGuildPosts(guildId, options = {}) {
        try {
            const limit = options.limit || 20;
            const { data, error } = await supabaseClient
                .from('guild_posts')
                .select(`
                    *,
                    author:profiles!author_id (id, username, display_name, avatar_url)
                `)
                .eq('guild_id', guildId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw new Error(error.message);
            return { posts: data, error: null };
        } catch (error) {
            return { posts: null, error: error.message };
        }
    },

    async getNotifications(userId, options = {}) {
        try {
            const limit = options.limit || 50;
            const { data, error } = await supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw new Error(error.message);
            return { notifications: data, error: null };
        } catch (error) {
            return { notifications: null, error: error.message };
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

    async getUserActivity(userId) {
        try {
            // Simulate activity from posts, comments, etc.
            const { data: posts, error: pErr } = await supabaseClient
                .from('guild_posts')
                .select('id, title, created_at')
                .eq('author_id', userId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(10);

            if (pErr) throw new Error(pErr.message);

            const activities = posts.map(post => ({
                action: 'post_created',
                created_at: post.created_at,
                data: { title: post.title, postId: post.id }
            }));

            return { activities, error: null };
        } catch (error) {
            return { activities: null, error: error.message };
        }
    }
};

// ============================================================
// REALTIME MODULE
// ============================================================

const Realtime = {
    subscribe(table, callback, filter = null) {
        let channel = supabaseClient
            .channel(`realtime:${table}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: table,
                filter: filter
            }, (payload) => {
                callback(payload);
            })
            .subscribe();

        return {
            unsubscribe: () => {
                supabaseClient.removeChannel(channel);
            }
        };
    }
};

// ============================================================
// STORAGE MODULE
// ============================================================

const Storage = {
    async upload(bucket, path, file) {
        try {
            // Validate file type and size
            const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                throw new Error('Only PNG, JPG, GIF, and WEBP images are allowed.');
            }
            if (file.size > 5 * 1024 * 1024) {
                throw new Error('File size must be less than 5MB.');
            }

            const { data, error } = await supabaseClient.storage
                .from(bucket)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (error) throw new Error(error.message);

            // Get public URL
            const { publicURL, error: urlError } = supabaseClient.storage
                .from(bucket)
                .getPublicUrl(data.path);

            if (urlError) throw new Error(urlError.message);

            return { url: publicURL, error: null };
        } catch (error) {
            return { url: null, error: error.message };
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
    realtime: Realtime,
    storage: Storage,
    clearStorage: clearSupabaseStorage
};

// Backward compatibility
window.signUp = Auth.signUp.bind(Auth);
window.signIn = Auth.signIn.bind(Auth);
window.signOut = Auth.signOut.bind(Auth);
window.getCurrentUser = Auth.getCurrentUser.bind(Auth);
window.getSession = Auth.getSession.bind(Auth);
window.updateProfile = Auth.updateProfile.bind(Auth);
window.onAuthStateChange = Auth.onAuthStateChange.bind(Auth);
window.clearSupabaseStorage = clearSupabaseStorage;

console.log('[AniVerse] Supabase client fully initialized');