/**
 * AniVerse - Centralized Supabase Client
 * Version: 2.2.0 – Full Debugging + Storage Fix
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
    console.log(`[Storage] Getting public URL for bucket: ${bucket}, path: ${path}`);
    
    try {
        const { data, error } = supabaseClient.storage
            .from(bucket)
            .getPublicUrl(path);
        
        if (error) {
            console.error('[Storage] getPublicUrl error:', error);
            console.error('[Storage] Error details:', {
                message: error.message,
                status: error.status,
                statusText: error.statusText
            });
            return null;
        }
        
        console.log('[Storage] getPublicUrl response:', data);
        console.log('[Storage] Public URL generated:', data?.publicUrl);
        
        return data?.publicUrl || null;
        
    } catch (error) {
        console.error('[Storage] getPublicUrl exception:', error);
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

    // ============================================================
    // GUILD MANAGEMENT
    // ============================================================
    
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

            // --- CREATE DEFAULT ROLES ---
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
// STORAGE MODULE - FIXED WITH DEBUGGING
// ============================================================

const Storage = {
    async upload(bucket, path, file, options = {}) {
        console.log('========== STORAGE UPLOAD DEBUG START ==========');
        
        try {
            // Step 1: Validate file
            console.log('[Storage] Step 1: Validating file...');
            console.log('[Storage] File name:', file.name);
            console.log('[Storage] File type:', file.type);
            console.log('[Storage] File size:', file.size, 'bytes');
            console.log('[Storage] File size (KB):', (file.size / 1024).toFixed(2), 'KB');
            console.log('[Storage] File size (MB):', (file.size / 1024 / 1024).toFixed(2), 'MB');
            
            if (!file || file.size === 0) {
                console.error('[Storage] ❌ Invalid file: Empty or null');
                return { url: null, error: 'Invalid file: Empty or null' };
            }

            // Step 2: Validate file type
            const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
            console.log('[Storage] Step 2: Validating file type...');
            console.log('[Storage] Valid types:', validTypes);
            console.log('[Storage] File type:', file.type);
            
            if (!validTypes.includes(file.type)) {
                console.error(`[Storage] ❌ Invalid file type: ${file.type}`);
                return { url: null, error: `Only PNG, JPG, GIF, WEBP, and SVG images are allowed. Received: ${file.type}` };
            }

            // Step 3: Validate file size
            const maxSize = options.maxSize || 5 * 1024 * 1024;
            console.log('[Storage] Step 3: Validating file size...');
            console.log('[Storage] Max size:', maxSize, 'bytes', `(${maxSize / 1024 / 1024}MB)`);
            
            if (file.size > maxSize) {
                console.error(`[Storage] ❌ File too large: ${file.size} > ${maxSize}`);
                return { url: null, error: `File size must be less than ${maxSize / 1024 / 1024}MB. Current: ${(file.size / 1024 / 1024).toFixed(2)}MB` };
            }

            // Step 4: Check bucket
            console.log('[Storage] Step 4: Checking bucket...');
            console.log('[Storage] Bucket name:', bucket);
            console.log('[Storage] Upload path:', path);
            
            const BUCKET_NAME = bucket;
            
            try {
                const { data: buckets, error: bucketError } = await supabaseClient.storage.listBuckets();
                
                if (bucketError) {
                    console.error('[Storage] ❌ Failed to list buckets:', bucketError);
                } else {
                    console.log('[Storage] Available buckets:', buckets?.map(b => b.name));
                    const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);
                    console.log('[Storage] Bucket exists:', bucketExists);
                    
                    if (!bucketExists) {
                        console.error(`[Storage] ❌ Bucket "${BUCKET_NAME}" does not exist!`);
                        console.log('[Storage] Creating bucket...');
                        
                        const { data: newBucket, error: createError } = await supabaseClient.storage
                            .createBucket(BUCKET_NAME, {
                                public: true,
                                allowedMimeTypes: validTypes,
                                fileSizeLimit: maxSize
                            });
                        
                        if (createError) {
                            console.error('[Storage] ❌ Failed to create bucket:', createError);
                            return { url: null, error: `Bucket "${BUCKET_NAME}" does not exist and could not be created: ${createError.message}` };
                        }
                        
                        console.log('[Storage] ✅ Bucket created successfully!');
                    }
                }
            } catch (err) {
                console.error('[Storage] ❌ Bucket check error:', err);
            }

            // Step 5: Upload file
            console.log('[Storage] Step 5: Uploading file...');
            console.log('[Storage] Upload parameters:');
            console.log('[Storage] - Bucket:', BUCKET_NAME);
            console.log('[Storage] - Path:', path);
            console.log('[Storage] - File size:', file.size);
            console.log('[Storage] - File type:', file.type);
            console.log('[Storage] - Options:', { cacheControl: '3600', upsert: true });
            
            const startTime = Date.now();
            
            const { data, error } = await supabaseClient.storage
                .from(BUCKET_NAME)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: true
                });
            
            const endTime = Date.now();
            console.log('[Storage] Upload time:', (endTime - startTime), 'ms');

            // Step 6: Check upload result
            console.log('[Storage] Step 6: Upload result');
            console.log('[Storage] Upload successful:', !error);
            console.log('[Storage] Upload data:', data);
            
            if (error) {
                console.error('[Storage] ❌ Upload failed with error:');
                console.error('[Storage] - Error object:', error);
                console.error('[Storage] - Error message:', error.message);
                console.error('[Storage] - Error status:', error.status);
                console.error('[Storage] - Error statusText:', error.statusText);
                
                // Check for specific errors
                if (error.message?.includes('bucket') || error.status === 404) {
                    console.error('[Storage] ❌ Bucket not found or not accessible');
                } else if (error.message?.includes('permission') || error.status === 403) {
                    console.error('[Storage] ❌ Permission denied - Check RLS policies');
                } else if (error.message?.includes('duplicate')) {
                    console.warn('[Storage] ⚠️ File already exists, overwriting...');
                }
                
                return { 
                    url: null, 
                    error: error.message || 'Upload failed',
                    details: error
                };
            }

            console.log('[Storage] ✅ Upload completed successfully!');
            console.log('[Storage] Upload response:', JSON.stringify(data, null, 2));

            // Step 7: Get public URL
            console.log('[Storage] Step 7: Getting public URL...');
            console.log('[Storage] Using bucket:', BUCKET_NAME);
            console.log('[Storage] Using path:', path);
            console.log('[Storage] Exact path from upload:', data?.path || 'No path in response');

            let publicUrl = null;
            let urlError = null;

            try {
                // Method 1: Using getPublicUrl
                console.log('[Storage] Method 1: Using getPublicUrl()...');
                const { data: urlData, error: urlErrorObj } = supabaseClient.storage
                    .from(BUCKET_NAME)
                    .getPublicUrl(path);
                
                if (urlErrorObj) {
                    console.error('[Storage] ❌ getPublicUrl() error:', urlErrorObj);
                    urlError = urlErrorObj.message;
                } else {
                    publicUrl = urlData?.publicUrl;
                    console.log('[Storage] getPublicUrl() result:', urlData);
                    console.log('[Storage] Public URL (Method 1):', publicUrl);
                    
                    if (!publicUrl) {
                        console.warn('[Storage] ⚠️ getPublicUrl() returned empty/null');
                        urlError = 'getPublicUrl() returned empty';
                    }
                }
            } catch (err) {
                console.error('[Storage] ❌ getPublicUrl() threw error:', err);
                urlError = err.message;
            }

            // Step 8: Try alternative URL construction (if needed)
            if (!publicUrl) {
                console.log('[Storage] Step 8: Trying alternative URL construction...');
                
                try {
                    // Method 2: Manual URL construction
                    const supabaseUrl = SUPABASE_URL || 'https://qmcisykwfyjbjluqdthv.supabase.co';
                    console.log('[Storage] Supabase URL:', supabaseUrl);
                    
                    // Construct URL manually
                    const altUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${path}`;
                    console.log('[Storage] Alternative URL:', altUrl);
                    
                    // Test if URL is accessible
                    try {
                        const testResponse = await fetch(altUrl, { method: 'HEAD' });
                        console.log('[Storage] URL test response:', testResponse.status, testResponse.statusText);
                        
                        if (testResponse.ok) {
                            publicUrl = altUrl;
                            console.log('[Storage] ✅ Alternative URL works!');
                        } else {
                            console.warn('[Storage] ⚠️ Alternative URL not accessible:', testResponse.status);
                        }
                    } catch (fetchErr) {
                        console.warn('[Storage] ⚠️ Could not test URL:', fetchErr.message);
                    }
                } catch (err) {
                    console.error('[Storage] ❌ Alternative URL construction failed:', err);
                }
            }

            // Step 9: Final result
            console.log('[Storage] Step 9: Final result');
            console.log('[Storage] Success:', publicUrl ? 'YES' : 'NO');
            console.log('[Storage] Final URL:', publicUrl || 'NO URL');
            console.log('[Storage] Error:', urlError || 'None');
            console.log('========== STORAGE UPLOAD DEBUG END ==========');

            if (!publicUrl) {
                return { url: null, error: urlError || 'Failed to get public URL' };
            }

            console.log('[Storage] ✅ File uploaded successfully!');
            console.log('[Storage] Public URL:', publicUrl);
            
            return { url: publicUrl, error: null };

        } catch (error) {
            console.error('[Storage] ❌ Unexpected error in upload process:', error);
            console.error('[Storage] Error stack:', error.stack);
            console.log('========== STORAGE UPLOAD DEBUG END (ERROR) ==========');
            
            return { 
                url: null, 
                error: error.message || 'Upload failed',
                stack: error.stack
            };
        }
    },

    async delete(bucket, path) {
        console.log(`[Storage] Deleting file: ${bucket}/${path}`);
        
        try {
            const { data, error } = await supabaseClient.storage
                .from(bucket)
                .remove([path]);

            if (error) {
                console.error('[Storage] Delete error:', error);
                throw new Error(error.message);
            }
            
            console.log('[Storage] Delete successful:', data);
            return { data, error: null };
        } catch (error) {
            console.error('[Storage] Delete error:', error);
            return { data: null, error: error.message };
        }
    },

    getPublicUrl(bucket, path) {
        console.log(`[Storage] Getting public URL for: ${bucket}/${path}`);
        return getPublicUrl(bucket, path);
    },

    async list(bucket, path = '') {
        console.log(`[Storage] Listing files: ${bucket}/${path}`);
        
        try {
            const { data, error } = await supabaseClient.storage
                .from(bucket)
                .list(path);

            if (error) throw new Error(error.message);
            console.log(`[Storage] Found ${data?.length || 0} files`);
            return { files: data, error: null };
        } catch (error) {
            console.error('[Storage] List error:', error);
            return { files: null, error: error.message };
        }
    },

    // ============================================================
    // VERIFY BUCKET - Debugging Tool
    // ============================================================
    
    async verifyBucket(bucketName) {
        console.log('========== VERIFY BUCKET ==========');
        console.log('[Storage] Verifying bucket:', bucketName);
        
        try {
            const { data: buckets, error } = await supabaseClient.storage.listBuckets();
            
            if (error) {
                console.error('[Storage] ❌ Failed to list buckets:', error);
                return { exists: false, error: error.message };
            }
            
            console.log('[Storage] All buckets:', buckets.map(b => ({
                name: b.name,
                id: b.id,
                public: b.public,
                created_at: b.created_at
            })));
            
            const bucket = buckets.find(b => b.name === bucketName);
            
            if (!bucket) {
                console.error(`[Storage] ❌ Bucket "${bucketName}" not found!`);
                return { exists: false, bucket: null };
            }
            
            console.log(`[Storage] ✅ Bucket "${bucketName}" exists!`);
            console.log('[Storage] Bucket details:', bucket);
            console.log('[Storage] Is public:', bucket.public);
            
            return { exists: true, bucket, isPublic: bucket.public };
            
        } catch (error) {
            console.error('[Storage] ❌ Verification error:', error);
            return { exists: false, error: error.message };
        }
    },

    // ============================================================
    // CREATE BUCKET IF NOT EXISTS - Auto-fix
    // ============================================================
    
    async ensureBucket(bucketName, options = {}) {
        console.log(`[Storage] Ensuring bucket exists: ${bucketName}`);
        
        try {
            const { exists, bucket } = await this.verifyBucket(bucketName);
            
            if (exists) {
                console.log(`[Storage] ✅ Bucket "${bucketName}" already exists`);
                
                // Make sure it's public
                if (!bucket.public) {
                    console.log(`[Storage] Making bucket "${bucketName}" public...`);
                    const { error: updateError } = await supabaseClient.storage
                        .updateBucket(bucketName, {
                            public: true,
                            allowedMimeTypes: options.allowedMimeTypes || ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
                            fileSizeLimit: options.fileSizeLimit || 5242880
                        });
                    
                    if (updateError) {
                        console.error(`[Storage] ❌ Failed to make bucket public:`, updateError);
                        return { success: false, error: updateError.message };
                    }
                    
                    console.log(`[Storage] ✅ Bucket "${bucketName}" is now public!`);
                }
                
                return { success: true, bucket };
            }
            
            console.log(`[Storage] Creating bucket "${bucketName}"...`);
            
            const { data: newBucket, error: createError } = await supabaseClient.storage
                .createBucket(bucketName, {
                    public: true,
                    allowedMimeTypes: options.allowedMimeTypes || ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
                    fileSizeLimit: options.fileSizeLimit || 5242880
                });
            
            if (createError) {
                console.error(`[Storage] ❌ Failed to create bucket:`, createError);
                return { success: false, error: createError.message };
            }
            
            console.log(`[Storage] ✅ Bucket "${bucketName}" created successfully!`);
            return { success: true, bucket: newBucket };
            
        } catch (error) {
            console.error(`[Storage] ❌ ensureBucket error:`, error);
            return { success: false, error: error.message };
        }
    },

    // ============================================================
    // UPLOAD AVATAR - Simplified with auto-bucket creation
    // ============================================================
    
    async uploadAvatar(userId, file) {
        console.log('[Storage] Uploading avatar for user:', userId);
        
        try {
            // Ensure avatars bucket exists
            const bucketResult = await this.ensureBucket('avatars', {
                allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
                fileSizeLimit: 5 * 1024 * 1024
            });
            
            if (!bucketResult.success) {
                return { url: null, error: bucketResult.error };
            }
            
            // Generate path
            const fileExt = file.name.split('.').pop();
            const fileName = `${userId}_${Date.now()}.${fileExt}`;
            const path = `avatars/${fileName}`;
            
            // Upload
            const result = await this.upload('avatars', path, file);
            
            if (result.error) {
                return result;
            }
            
            // Update profile
            const { error: updateError } = await supabaseClient
                .from('profiles')
                .update({ avatar_url: result.url })
                .eq('id', userId);
            
            if (updateError) {
                console.error('[Storage] ❌ Failed to update profile:', updateError);
                return { url: result.url, error: null, profileUpdateError: updateError };
            }
            
            console.log('[Storage] ✅ Avatar uploaded and profile updated!');
            return { url: result.url, error: null };
            
        } catch (error) {
            console.error('[Storage] ❌ Upload avatar error:', error);
            return { url: null, error: error.message };
        }
    }
};

// ============================================================
// DEBUG FUNCTIONS - Available in Console
// ============================================================

// Bucket verification
window.verifyBucket = async function(bucketName = 'avatars') {
    return await Storage.verifyBucket(bucketName);
};

// Test upload
window.testAvatarUpload = async function() {
    console.log('========== TEST AVATAR UPLOAD ==========');
    
    try {
        // Create a test image
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        
        // Gradient background
        const gradient = ctx.createLinearGradient(0, 0, 200, 200);
        gradient.addColorStop(0, '#7c5cfc');
        gradient.addColorStop(1, '#5c8cfc');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 200, 200);
        
        // Text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TEST', 100, 100);
        
        // Border
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;
        ctx.strokeRect(10, 10, 180, 180);
        
        // Convert to blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], 'test-avatar.png', { type: 'image/png' });
        
        console.log('Test file created:', file);
        console.log('File size:', file.size, 'bytes');
        
        // Get current user
        const { user } = await Auth.getCurrentUser();
        if (!user) {
            console.error('❌ No user logged in');
            return;
        }
        
        console.log('Current user:', user.id);
        
        // Upload test avatar
        const result = await Storage.uploadAvatar(user.id, file);
        
        if (result.url) {
            console.log('✅ Test upload successful!');
            console.log('📸 Avatar URL:', result.url);
            return result;
        } else {
            console.error('❌ Test upload failed:', result.error);
            return result;
        }
        
    } catch (error) {
        console.error('❌ Test upload error:', error);
        return { url: null, error: error.message };
    }
};

console.log(`
🔍 Avatar Upload Debugging Tool
================================
Commands available:
1. verifyBucket() - Check if 'avatars' bucket exists and is public
2. testAvatarUpload() - Test upload with a test image
3. Storage.verifyBucket('avatars') - Detailed bucket check
4. Storage.ensureBucket('avatars') - Create bucket if not exists

Make sure you're logged in before running testAvatarUpload()
`);

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
    // Debug tools
    verifyBucket: window.verifyBucket,
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

console.log('[AniVerse] Supabase client fully initialized with debugging tools');
console.log('[AniVerse] Storage module ready with auto-bucket creation');