/**
 * AniVerse - Centralized Supabase Client
 * Version: 2.3.0 - PURE DEBUGGING - NO CUSTOM ERRORS
 */

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

function getPublicUrl(bucket, path) {
    console.log('[DEBUG] getPublicUrl called with:', { bucket, path });
    
    try {
        const result = supabaseClient.storage.from(bucket).getPublicUrl(path);
        console.log('[DEBUG] getPublicUrl raw result:', result);
        console.log('[DEBUG] getPublicUrl data:', result.data);
        console.log('[DEBUG] getPublicUrl error:', result.error);
        console.log('[DEBUG] getPublicUrl publicUrl:', result.data?.publicUrl);
        
        return result.data?.publicUrl || null;
    } catch (error) {
        console.error('[DEBUG] getPublicUrl exception:', error);
        console.error('[DEBUG] Exception stack:', error.stack);
        return null;
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

            if (updates.avatar_url && !updates.avatar_url.startsWith('http')) {
                throw new Error('Invalid avatar URL');
            }

            const { error: metaError } = await supabaseClient.auth.updateUser({
                data: updates
            });
            if (metaError) throw new Error(metaError.message);

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

    async sendFriendRequest(receiverId) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

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

    async sendMessage({ receiverId, content, replyToId = null }) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');
            if (!content || !content.trim()) throw new Error('Message cannot be empty');

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
        const { data, error } = await supabaseClient
            .from('conversations')
            .select('id')
            .or(`participant1_id.eq.${userId1},participant1_id.eq.${userId2}`)
            .or(`participant2_id.eq.${userId1},participant2_id.eq.${userId2}`)
            .maybeSingle();

        if (data) return data.id;

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
    },

    async createGuild(guildData) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { 
                name, 
                description, 
                category, 
                visibility = 'public', 
                language = 'en',
                tags = null,
                logo_url = null,
                banner_url = null
            } = guildData;

            if (!name || name.length < 3 || name.length > 50) {
                throw new Error('Guild name must be 3-50 characters');
            }
            if (!description || description.length < 20 || description.length > 500) {
                throw new Error('Description must be 20-500 characters');
            }

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

            const { data: existing } = await supabaseClient
                .from('guilds')
                .select('id')
                .or(`name.eq.${name},slug.eq.${slug}`)
                .maybeSingle();

            if (existing) {
                throw new Error('A guild with this name already exists');
            }

            const { data: guild, error } = await supabaseClient
                .from('guilds')
                .insert({
                    name,
                    slug,
                    description,
                    category,
                    visibility,
                    language,
                    tags: tags || null,
                    logo_url: logo_url || null,
                    banner_url: banner_url || null,
                    created_by: user.id,
                    level: 1,
                    experience_points: 0
                })
                .select()
                .single();

            if (error) throw new Error(error.message);

            const { data: memberRole, error: memberError } = await supabaseClient
                .from('guild_roles')
                .insert({
                    guild_id: guild.id,
                    name: 'Member',
                    color: '#6a6a7a',
                    is_default: true
                })
                .select()
                .single();

            if (memberError) {
                console.error('[Auth] Member role creation error:', memberError);
            }

            const { data: adminRole, error: adminError } = await supabaseClient
                .from('guild_roles')
                .insert({
                    guild_id: guild.id,
                    name: 'Admin',
                    color: '#7c5cfc',
                    is_default: false
                })
                .select()
                .single();

            if (adminError) {
                console.error('[Auth] Admin role creation error:', adminError);
            }

            const { data: modRole, error: modError } = await supabaseClient
                .from('guild_roles')
                .insert({
                    guild_id: guild.id,
                    name: 'Moderator',
                    color: '#5c8cfc',
                    is_default: false
                })
                .select()
                .single();

            if (modError) {
                console.error('[Auth] Moderator role creation error:', modError);
            }

            if (memberRole) {
                await supabaseClient
                    .from('guild_members')
                    .insert({
                        guild_id: guild.id,
                        user_id: user.id,
                        role_id: memberRole.id
                    });
            }

            return { data: guild, error: null };

        } catch (error) {
            console.error('[Auth] Create guild error:', error);
            return { data: null, error: error.message };
        }
    },

    async updateGuild(guildId, updates) {
        try {
            const { user } = await this.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const allowed = ['name', 'description', 'category', 'visibility', 'language', 
                'tags', 'logo_url', 'banner_url'];
            const sanitized = {};
            Object.keys(updates).forEach(key => {
                if (allowed.includes(key)) sanitized[key] = updates[key];
            });
            sanitized.updated_at = new Date().toISOString();

            const { data, error } = await supabaseClient
                .from('guilds')
                .update(sanitized)
                .eq('id', guildId)
                .select()
                .single();

            if (error) throw new Error(error.message);
            return { data, error: null };

        } catch (error) {
            console.error('[Auth] Update guild error:', error);
            return { data: null, error: error.message };
        }
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
                    guilds!inner (id, name, slug, logo_url, banner_url, category, visibility, level, is_official)
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

    async getGuild(guildId) {
        try {
            const { data, error } = await supabaseClient
                .from('guilds')
                .select('*')
                .eq('id', guildId)
                .is('deleted_at', null)
                .single();

            if (error) throw new Error(error.message);
            return { guild: data, error: null };
        } catch (error) {
            return { guild: null, error: error.message };
        }
    },

    async getGuildMembers(guildId, options = {}) {
        try {
            const limit = options.limit || 50;
            const { data, error } = await supabaseClient
                .from('guild_members')
                .select(`
                    user_id,
                    role_id,
                    joined_at,
                    profiles!inner (id, username, display_name, avatar_url, level),
                    guild_roles!inner (name, color)
                `)
                .eq('guild_id', guildId)
                .order('joined_at', { ascending: false })
                .limit(limit);

            if (error) throw new Error(error.message);
            return { members: data, error: null };
        } catch (error) {
            return { members: null, error: error.message };
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
    },

    async searchUsers(query) {
        try {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('id, username, display_name, avatar_url, level')
                .textSearch('display_name', query, { config: 'english' })
                .limit(20);

            if (error) throw new Error(error.message);
            return { users: data, error: null };
        } catch (error) {
            return { users: null, error: error.message };
        }
    },

    async searchGuilds(query) {
        try {
            const { data, error } = await supabaseClient
                .from('guilds')
                .select('id, name, description, logo_url, banner_url, category, member_count, level')
                .textSearch('name', query, { config: 'english' })
                .is('deleted_at', null)
                .limit(20);

            if (error) throw new Error(error.message);
            return { guilds: data, error: null };
        } catch (error) {
            return { guilds: null, error: error.message };
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
// STORAGE MODULE - PURE DEBUGGING - NO CUSTOM ERRORS
// ============================================================

const Storage = {
    async upload(bucket, path, file, options = {}) {
        console.log('========== STORAGE.UPLOAD DEBUG START ==========');
        console.log('[DEBUG] upload() called with:');
        console.log('[DEBUG] - bucket:', bucket);
        console.log('[DEBUG] - path:', path);
        console.log('[DEBUG] - file name:', file?.name);
        console.log('[DEBUG] - file type:', file?.type);
        console.log('[DEBUG] - file size:', file?.size);
        console.log('[DEBUG] - options:', options);
        
        try {
            // Step 1: Upload
            console.log('[DEBUG] Step 1: Calling supabaseClient.storage.from().upload()...');
            const uploadResult = await supabaseClient.storage
                .from(bucket)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: true
                });
            
            console.log('[DEBUG] Upload result (raw):', uploadResult);
            console.log('[DEBUG] Upload data:', uploadResult.data);
            console.log('[DEBUG] Upload error:', uploadResult.error);
            
            // Step 2: Check for upload error
            if (uploadResult.error) {
                console.error('[DEBUG] ❌ Upload error detected:');
                console.error('[DEBUG] - Error message:', uploadResult.error.message);
                console.error('[DEBUG] - Error status:', uploadResult.error.status);
                console.error('[DEBUG] - Error statusText:', uploadResult.error.statusText);
                console.error('[DEBUG] - Full error object:', uploadResult.error);
                console.log('========== STORAGE.UPLOAD DEBUG END ==========');
                return { url: null, error: uploadResult.error };
            }
            
            console.log('[DEBUG] ✅ Upload successful!');
            console.log('[DEBUG] Upload response data:', uploadResult.data);
            
            // Step 3: Get public URL
            console.log('[DEBUG] Step 2: Getting public URL...');
            console.log('[DEBUG] Calling getPublicUrl with:', { bucket, path });
            
            const urlResult = supabaseClient.storage.from(bucket).getPublicUrl(path);
            console.log('[DEBUG] getPublicUrl result (raw):', urlResult);
            console.log('[DEBUG] getPublicUrl data:', urlResult.data);
            console.log('[DEBUG] getPublicUrl error:', urlResult.error);
            console.log('[DEBUG] getPublicUrl publicUrl:', urlResult.data?.publicUrl);
            
            const publicUrl = urlResult.data?.publicUrl || null;
            console.log('[DEBUG] Final publicUrl:', publicUrl);
            
            // Step 4: Return result
            console.log('========== STORAGE.UPLOAD DEBUG END ==========');
            return { 
                url: publicUrl, 
                error: urlResult.error || null,
                uploadData: uploadResult.data,
                uploadError: uploadResult.error
            };
            
        } catch (error) {
            console.error('[DEBUG] ❌ Exception caught in upload():');
            console.error('[DEBUG] - Error message:', error.message);
            console.error('[DEBUG] - Error stack:', error.stack);
            console.error('[DEBUG] - Full error:', error);
            console.log('========== STORAGE.UPLOAD DEBUG END ==========');
            return { url: null, error: error };
        }
    },

    async delete(bucket, path) {
        console.log('[DEBUG] delete() called with:', { bucket, path });
        
        try {
            const result = await supabaseClient.storage.from(bucket).remove([path]);
            console.log('[DEBUG] Delete result:', result);
            return { data: result.data, error: result.error || null };
        } catch (error) {
            console.error('[DEBUG] Delete exception:', error);
            return { data: null, error: error };
        }
    },

    getPublicUrl(bucket, path) {
        console.log('[DEBUG] getPublicUrl() called with:', { bucket, path });
        return getPublicUrl(bucket, path);
    },

    async list(bucket, path = '') {
        console.log('[DEBUG] list() called with:', { bucket, path });
        
        try {
            const result = await supabaseClient.storage.from(bucket).list(path);
            console.log('[DEBUG] List result:', result);
            return { files: result.data, error: result.error || null };
        } catch (error) {
            console.error('[DEBUG] List exception:', error);
            return { files: null, error: error };
        }
    },

    // ============================================================
    // COMPLETE AVATAR UPLOAD WITH FULL DEBUGGING
    // ============================================================
    
    async uploadAvatar(userId, file) {
        console.log('========== UPLOAD AVATAR DEBUG START ==========');
        console.log('[DEBUG] uploadAvatar() called with:');
        console.log('[DEBUG] - userId:', userId);
        console.log('[DEBUG] - file name:', file?.name);
        console.log('[DEBUG] - file type:', file?.type);
        console.log('[DEBUG] - file size:', file?.size);
        
        try {
            // Step 1: Validate file
            console.log('[DEBUG] Step 1: Validating file...');
            if (!file) {
                console.error('[DEBUG] ❌ File is null or undefined');
                return { url: null, error: new Error('File is required') };
            }
            
            if (file.size === 0) {
                console.error('[DEBUG] ❌ File is empty');
                return { url: null, error: new Error('File is empty') };
            }
            
            // Step 2: Generate path
            console.log('[DEBUG] Step 2: Generating file path...');
            const fileExt = file.name.split('.').pop();
            const fileName = `${userId}_${Date.now()}.${fileExt}`;
            const path = `avatars/${fileName}`;
            console.log('[DEBUG] - fileExt:', fileExt);
            console.log('[DEBUG] - fileName:', fileName);
            console.log('[DEBUG] - full path:', path);
            
            // Step 3: Upload
            console.log('[DEBUG] Step 3: Calling Storage.upload()...');
            const uploadResult = await this.upload('avatars', path, file);
            console.log('[DEBUG] uploadResult:', uploadResult);
            
            if (uploadResult.error) {
                console.error('[DEBUG] ❌ Upload failed:');
                console.error('[DEBUG] - Error:', uploadResult.error);
                console.log('========== UPLOAD AVATAR DEBUG END ==========');
                return { url: null, error: uploadResult.error };
            }
            
            if (!uploadResult.url) {
                console.error('[DEBUG] ❌ Upload returned no URL');
                console.error('[DEBUG] - uploadResult:', uploadResult);
                console.log('========== UPLOAD AVATAR DEBUG END ==========');
                return { url: null, error: new Error('Upload succeeded but no URL returned') };
            }
            
            console.log('[DEBUG] ✅ Upload successful with URL:', uploadResult.url);
            
            // Step 4: Update profile
            console.log('[DEBUG] Step 4: Updating profile with avatar URL...');
            console.log('[DEBUG] - Profile ID:', userId);
            console.log('[DEBUG] - Avatar URL:', uploadResult.url);
            
            const updateResult = await supabaseClient
                .from('profiles')
                .update({ avatar_url: uploadResult.url })
                .eq('id', userId)
                .select();
            
            console.log('[DEBUG] Profile update result:');
            console.log('[DEBUG] - Data:', updateResult.data);
            console.log('[DEBUG] - Error:', updateResult.error);
            console.log('[DEBUG] - Status:', updateResult.status);
            console.log('[DEBUG] - StatusText:', updateResult.statusText);
            
            if (updateResult.error) {
                console.error('[DEBUG] ❌ Profile update failed:');
                console.error('[DEBUG] - Error:', updateResult.error);
                console.log('========== UPLOAD AVATAR DEBUG END ==========');
                return { 
                    url: uploadResult.url, 
                    error: updateResult.error,
                    uploadData: uploadResult.uploadData
                };
            }
            
            console.log('[DEBUG] ✅ Profile updated successfully!');
            console.log('========== UPLOAD AVATAR DEBUG END ==========');
            
            return { 
                url: uploadResult.url, 
                error: null,
                uploadData: uploadResult.uploadData
            };
            
        } catch (error) {
            console.error('[DEBUG] ❌ Exception in uploadAvatar():');
            console.error('[DEBUG] - Error:', error);
            console.error('[DEBUG] - Message:', error.message);
            console.error('[DEBUG] - Stack:', error.stack);
            console.log('========== UPLOAD AVATAR DEBUG END ==========');
            return { url: null, error: error };
        }
    }
};

// ============================================================
// EXPOSE TO WINDOW FOR DEBUGGING
// ============================================================

// Expose debug functions to window
window.testAvatarUpload = async function() {
    console.log('========== TEST AVATAR UPLOAD ==========');
    
    try {
        // Create test image
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#7c5cfc';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TEST', 100, 100);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], 'test-avatar.png', { type: 'image/png' });
        
        console.log('[DEBUG] Test file created:', file);
        
        // Get current user
        const { user } = await Auth.getCurrentUser();
        if (!user) {
            console.error('[DEBUG] ❌ No user logged in');
            return { success: false, error: 'No user logged in' };
        }
        
        console.log('[DEBUG] Current user:', user.id);
        
        // Upload
        const result = await Storage.uploadAvatar(user.id, file);
        console.log('[DEBUG] Final result:', result);
        
        return result;
        
    } catch (error) {
        console.error('[DEBUG] Test error:', error);
        return { success: false, error: error };
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
    clearStorage: clearSupabaseStorage,
    getPublicUrl: getPublicUrl,
    testAvatarUpload: window.testAvatarUpload
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

console.log('[AniVerse] Supabase client initialized with DEBUG MODE');
console.log('[AniVerse] Run testAvatarUpload() in console to test avatar upload');