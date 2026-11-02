/**
 * ==========================================================================
 * Auralis - Core Application Logic
 * Clean, modular vanilla JavaScript.
 *
 * Modules:
 * 1. Storage & State Management
 * 2. Jamendo API Service
 * 3. Audio Player Engine
 * 4. Playlist Manager (with Drag & Drop)
 * 5. UI Rendering & Interactions
 * 6. Keyboard Shortcuts & Setup
 * ==========================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. STORAGE & STATE MANAGEMENT
     ========================================================================== */

  const STORAGE_KEYS = {
    PLAYLIST: 'vibep_playlist',
    CURRENT_TRACK_ID: 'vibep_current_track_id',
    VOLUME: 'vibep_volume',
    SHUFFLE: 'vibep_shuffle',
    REPEAT: 'vibep_repeat',
    LIKES: 'vibep_likes',
    CLIENT_ID_OVERRIDE: 'vibep_jamendo_client_id'
  };

  const state = {
    currentTrack: null,
    isPlaying: false,
    playlist: [],
    searchResults: [],
    searchType: 'all', // 'all' | 'artist' | 'tag'
    currentQuery: '',
    currentTag: 'trending',
    isShuffle: false,
    repeatMode: 'off', // 'off' | 'all' | 'one'
    volume: 0.8,
    isMuted: false,
    previousVolume: 0.8,
    likedTrackIds: new Set(),
    draggedIndex: null,
    isSeeking: false,
    audioElement: new Audio()
  };

  // Helper: Format seconds into M:SS or H:MM:SS
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const paddedSecs = secs < 10 ? `0${secs}` : secs;

    if (hrs > 0) {
      const paddedMins = mins < 10 ? `0${mins}` : mins;
      return `${hrs}:${paddedMins}:${paddedSecs}`;
    }
    return `${mins}:${paddedSecs}`;
  }

  // Load persisted state from localStorage
  function loadPersistedState() {
    // Playlist
    try {
      const savedPlaylist = localStorage.getItem(STORAGE_KEYS.PLAYLIST);
      if (savedPlaylist) {
        state.playlist = JSON.parse(savedPlaylist);
        // If saved playlist had old demo tracks or broken image URLs, refresh to verified Jamendo tracks
        if (state.playlist.some(t => t.id && (String(t.id).startsWith('demo-') || (t.image && t.image.includes('1520523839898'))))) {
          state.playlist = [...CONFIG.FALLBACK_TRACKS];
          savePlaylistToStorage();
        }
      } else if (CONFIG && CONFIG.FALLBACK_TRACKS) {
        // Pre-populate with default fallback tracks if playlist is empty
        state.playlist = [...CONFIG.FALLBACK_TRACKS];
        savePlaylistToStorage();
      }
    } catch (e) {
      console.warn('Could not parse saved playlist:', e);
      state.playlist = [];
    }

    // Volume
    const savedVol = localStorage.getItem(STORAGE_KEYS.VOLUME);
    if (savedVol !== null) {
      state.volume = Math.max(0, Math.min(1, parseFloat(savedVol)));
      state.audioElement.volume = state.volume;
    }

    // Shuffle & Repeat
    state.isShuffle = localStorage.getItem(STORAGE_KEYS.SHUFFLE) === 'true';
    const savedRepeat = localStorage.getItem(STORAGE_KEYS.REPEAT);
    if (savedRepeat && ['off', 'all', 'one'].includes(savedRepeat)) {
      state.repeatMode = savedRepeat;
    }

    // Liked tracks
    try {
      const savedLikes = localStorage.getItem(STORAGE_KEYS.LIKES);
      if (savedLikes) {
        state.likedTrackIds = new Set(JSON.parse(savedLikes));
      }
    } catch (e) {
      state.likedTrackIds = new Set();
    }
  }

  function savePlaylistToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLIST, JSON.stringify(state.playlist));
    } catch (e) {
      console.error('Failed to save playlist to localStorage:', e);
    }
  }

  function saveLikesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.LIKES, JSON.stringify([...state.likedTrackIds]));
    } catch (e) {
      console.error('Failed to save likes to localStorage:', e);
    }
  }

  /* ==========================================================================
     2. JAMENDO API SERVICE
     ========================================================================== */

  const JamendoAPI = {
    getClientId() {
      // 1. Check local override entered via UI modal
      const localOverride = localStorage.getItem(STORAGE_KEYS.CLIENT_ID_OVERRIDE);
      if (localOverride && localOverride.trim()) {
        return localOverride.trim();
      }
      // 2. Fall back to config.js
      if (CONFIG && CONFIG.JAMENDO_CLIENT_ID && CONFIG.JAMENDO_CLIENT_ID !== 'YOUR_JAMENDO_CLIENT_ID') {
        return CONFIG.JAMENDO_CLIENT_ID.trim();
      }
      return '';
    },

    isConfigured() {
      const id = this.getClientId();
      return Boolean(id && id !== 'YOUR_JAMENDO_CLIENT_ID');
    },

    /**
     * Map Jamendo raw track object into unified internal Track model
     */
    mapTrack(raw) {
      return {
        id: String(raw.id),
        name: raw.name || 'Untitled Track',
        artist_name: raw.artist_name || 'Unknown Artist',
        album_name: raw.album_name || 'Single',
        duration: parseInt(raw.duration, 10) || 180,
        image: raw.image || raw.album_image || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80',
        audio: raw.audio || (raw.audiodownload ? raw.audiodownload : '')
      };
    },

    /**
     * Fetch trending tracks
     */
    async fetchTrending(limit = CONFIG.DEFAULT_LIMIT || 24) {
      if (!this.isConfigured()) {
        return { success: false, reason: 'NO_KEY', tracks: CONFIG.FALLBACK_TRACKS };
      }

      const clientId = this.getClientId();
      const url = `${CONFIG.API_BASE_URL}/tracks/?client_id=${clientId}&format=json&limit=${limit}&order=popularity_week&include=musicinfo&audioformat=${CONFIG.AUDIO_FORMAT || 'mp32'}`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.headers && data.headers.status === 'failed') {
          return { success: false, reason: 'API_ERROR', message: data.headers.error_message || 'API error' };
        }

        const tracks = (data.results || []).map(this.mapTrack);
        return { success: true, tracks };
      } catch (err) {
        return { success: false, reason: 'NETWORK_ERROR', message: err.message };
      }
    },

    /**
     * Search tracks by title, artist, or genre tag
     */
    async searchTracks(query, type = 'all', limit = CONFIG.DEFAULT_LIMIT || 24) {
      if (!this.isConfigured()) {
        // Filter demo tracks locally if in preview mode
        const q = query.toLowerCase();
        const filtered = (CONFIG.FALLBACK_TRACKS || []).filter(t => 
          t.name.toLowerCase().includes(q) || t.artist_name.toLowerCase().includes(q)
        );
        return { success: true, tracks: filtered, isLocalFallback: true };
      }

      const clientId = this.getClientId();
      const encoded = encodeURIComponent(query.trim());
      let paramStr = '';

      if (type === 'artist') {
        paramStr = `artist_name=${encoded}&order=popularity_week`;
      } else if (type === 'tag') {
        paramStr = `fuzzytags=${encoded}&order=popularity_week`;
      } else {
        // Default search by track title
        paramStr = `namesearch=${encoded}`;
      }

      const url = `${CONFIG.API_BASE_URL}/tracks/?client_id=${clientId}&format=json&limit=${limit}&${paramStr}&include=musicinfo&audioformat=${CONFIG.AUDIO_FORMAT || 'mp32'}`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.headers && data.headers.status === 'failed') {
          return { success: false, reason: 'API_ERROR', message: data.headers.error_message };
        }

        const tracks = (data.results || []).map(this.mapTrack);
        return { success: true, tracks };
      } catch (err) {
        return { success: false, reason: 'NETWORK_ERROR', message: err.message };
      }
    },

    /**
     * Fetch tracks by genre tag chip
     */
    async fetchByTag(tag, limit = CONFIG.DEFAULT_LIMIT || 24) {
      if (tag === 'trending') {
        return this.fetchTrending(limit);
      }

      if (!this.isConfigured()) {
        return { success: true, tracks: CONFIG.FALLBACK_TRACKS, isLocalFallback: true };
      }

      const clientId = this.getClientId();
      const encoded = encodeURIComponent(tag);
      const url = `${CONFIG.API_BASE_URL}/tracks/?client_id=${clientId}&format=json&limit=${limit}&fuzzytags=${encoded}&order=popularity_week&include=musicinfo&audioformat=${CONFIG.AUDIO_FORMAT || 'mp32'}`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.headers && data.headers.status === 'failed') {
          return { success: false, reason: 'API_ERROR', message: data.headers.error_message };
        }

        const tracks = (data.results || []).map(this.mapTrack);
        return { success: true, tracks };
      } catch (err) {
        return { success: false, reason: 'NETWORK_ERROR', message: err.message };
      }
    }
  };

  /* ==========================================================================
     3. AUDIO PLAYER ENGINE
     ========================================================================== */

  const Player = {
    init() {
      const audio = state.audioElement;
      audio.preload = 'metadata';

      // Attach audio event listeners
      audio.addEventListener('play', () => {
        state.isPlaying = true;
        UI.syncPlayState(true);
      });

      audio.addEventListener('pause', () => {
        state.isPlaying = false;
        UI.syncPlayState(false);
      });

      audio.addEventListener('loadedmetadata', () => {
        const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : (state.currentTrack ? state.currentTrack.duration : 0);
        UI.updateTimeline(audio.currentTime, dur);
      });

      audio.addEventListener('timeupdate', () => {
        if (!state.isSeeking) {
          const current = audio.currentTime;
          const duration = (audio.duration && !isNaN(audio.duration)) ? audio.duration : (state.currentTrack ? state.currentTrack.duration : 0);
          UI.updateTimeline(current, duration);
        }
      });

      audio.addEventListener('progress', () => {
        if (audio.buffered.length > 0 && audio.duration) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
          const pct = (bufferedEnd / audio.duration) * 100;
          DOM.progressBuffer.style.width = `${pct}%`;
        }
      });

      audio.addEventListener('ended', () => {
        this.handleTrackEnded();
      });

      audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        state.isPlaying = false;
        UI.syncPlayState(false);
        UI.showToast('Unable to stream this audio track.', '⚠️');
      });
    },

    playTrack(track) {
      if (!track || !track.audio) {
        UI.showToast('This track does not have a streamable audio URL.', '⚠️');
        return;
      }

      // Check if it's already the current track
      if (state.currentTrack && state.currentTrack.id === track.id) {
        if (state.isPlaying) {
          this.pause();
        } else {
          this.resume();
        }
        return;
      }

      state.currentTrack = track;
      try {
        localStorage.setItem(STORAGE_KEYS.CURRENT_TRACK_ID, track.id);
      } catch (e) {}

      // Update Audio element
      state.audioElement.src = track.audio;
      state.audioElement.currentTime = 0;
      
      const playPromise = state.audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('Playback prevented by browser autoplay policy:', err);
          state.isPlaying = false;
          UI.syncPlayState(false);
        });
      }

      // Update UI components
      UI.renderNowPlaying(track);
      UI.updateVinylCover(track);
      UI.highlightActiveTrack(track.id);
    },

    resume() {
      if (!state.currentTrack) {
        if (state.playlist.length > 0) {
          this.playTrack(state.playlist[0]);
        } else if (state.searchResults.length > 0) {
          this.playTrack(state.searchResults[0]);
        }
        return;
      }
      state.audioElement.play().catch(e => console.warn(e));
    },

    pause() {
      state.audioElement.pause();
    },

    togglePlayPause() {
      if (state.isPlaying) {
        this.pause();
      } else {
        this.resume();
      }
    },

    handleTrackEnded() {
      if (state.repeatMode === 'one') {
        state.audioElement.currentTime = 0;
        state.audioElement.play().catch(e => console.warn(e));
        return;
      }
      this.playNext(true);
    },

    playNext(isAuto = false) {
      const activeList = state.playlist.length > 0 ? state.playlist : state.searchResults;
      if (activeList.length === 0) return;

      if (!state.currentTrack) {
        this.playTrack(activeList[0]);
        return;
      }

      const currentIndex = activeList.findIndex(t => t.id === state.currentTrack.id);

      // Shuffle logic
      if (state.isShuffle) {
        if (activeList.length === 1) {
          this.playTrack(activeList[0]);
          return;
        }
        let randomIndex;
        do {
          randomIndex = Math.floor(Math.random() * activeList.length);
        } while (randomIndex === currentIndex && activeList.length > 1);
        this.playTrack(activeList[randomIndex]);
        return;
      }

      // Sequential next
      if (currentIndex !== -1 && currentIndex < activeList.length - 1) {
        this.playTrack(activeList[currentIndex + 1]);
      } else if (state.repeatMode === 'all' || isAuto) {
        // Loop back to start
        this.playTrack(activeList[0]);
      } else {
        // Reached end and repeat is off
        this.pause();
        state.audioElement.currentTime = 0;
        UI.updateTimeline(0, state.audioElement.duration || 0);
      }
    },

    playPrev() {
      // If played for more than 3 seconds, rewind to start of current song
      if (state.audioElement.currentTime > 3) {
        state.audioElement.currentTime = 0;
        return;
      }

      const activeList = state.playlist.length > 0 ? state.playlist : state.searchResults;
      if (activeList.length === 0) return;

      if (!state.currentTrack) {
        this.playTrack(activeList[0]);
        return;
      }

      const currentIndex = activeList.findIndex(t => t.id === state.currentTrack.id);

      if (state.isShuffle) {
        const randomIndex = Math.floor(Math.random() * activeList.length);
        this.playTrack(activeList[randomIndex]);
        return;
      }

      if (currentIndex > 0) {
        this.playTrack(activeList[currentIndex - 1]);
      } else {
        // Go to last track if repeat all
        if (state.repeatMode === 'all') {
          this.playTrack(activeList[activeList.length - 1]);
        } else {
          state.audioElement.currentTime = 0;
        }
      }
    },

    seek(fraction) {
      if (state.audioElement.duration) {
        state.audioElement.currentTime = state.audioElement.duration * fraction;
      }
    },

    setVolume(val) {
      state.volume = Math.max(0, Math.min(1, val));
      state.audioElement.volume = state.volume;
      state.isMuted = state.volume === 0;

      try {
        localStorage.setItem(STORAGE_KEYS.VOLUME, state.volume.toString());
      } catch (e) {}

      UI.updateVolumeUI();
    },

    toggleMute() {
      if (state.isMuted) {
        // Unmute
        this.setVolume(state.previousVolume > 0 ? state.previousVolume : 0.8);
      } else {
        // Mute
        state.previousVolume = state.volume;
        this.setVolume(0);
      }
    },

    toggleShuffle() {
      state.isShuffle = !state.isShuffle;
      try {
        localStorage.setItem(STORAGE_KEYS.SHUFFLE, state.isShuffle.toString());
      } catch (e) {}
      UI.updateShuffleUI();
      UI.showToast(state.isShuffle ? 'Shuffle is On' : 'Shuffle is Off', '🔀');
    },

    cycleRepeat() {
      if (state.repeatMode === 'off') {
        state.repeatMode = 'all';
        UI.showToast('Repeat All', '🔁');
      } else if (state.repeatMode === 'all') {
        state.repeatMode = 'one';
        UI.showToast('Repeat One Track', '🔂');
      } else {
        state.repeatMode = 'off';
        UI.showToast('Repeat Off', '➡️');
      }

      try {
        localStorage.setItem(STORAGE_KEYS.REPEAT, state.repeatMode);
      } catch (e) {}

      UI.updateRepeatUI();
    }
  };

  /* ==========================================================================
     4. PLAYLIST MANAGER (With HTML5 Drag & Drop)
     ========================================================================== */

  const Playlist = {
    add(track) {
      if (!track) return;
      // Check if already in playlist
      const exists = state.playlist.some(t => t.id === track.id);
      if (exists) {
        UI.showToast(`"${track.name}" is already in your playlist!`, 'ℹ️');
        return;
      }

      state.playlist.push(track);
      savePlaylistToStorage();
      UI.renderPlaylist();
      UI.showToast(`Added "${track.name}" to playlist`, '✓');
    },

    remove(trackId) {
      const index = state.playlist.findIndex(t => t.id === trackId);
      if (index === -1) return;

      const removed = state.playlist.splice(index, 1)[0];
      savePlaylistToStorage();
      UI.renderPlaylist();
      UI.showToast(`Removed "${removed.name}"`, '🗑️');

      // If removed song was current track, continue playing or stop
      if (state.currentTrack && state.currentTrack.id === trackId) {
        // If playlist still has tracks, play next or previous
        if (state.playlist.length > 0) {
          const nextIndex = Math.min(index, state.playlist.length - 1);
          Player.playTrack(state.playlist[nextIndex]);
        }
      }
    },

    reorder(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= state.playlist.length || toIndex >= state.playlist.length) return;

      const [moved] = state.playlist.splice(fromIndex, 1);
      state.playlist.splice(toIndex, 0, moved);

      savePlaylistToStorage();
      UI.renderPlaylist();
    },

    clear() {
      if (state.playlist.length === 0) return;
      if (confirm('Clear all songs from your playlist?')) {
        state.playlist = [];
        savePlaylistToStorage();
        UI.renderPlaylist();
        UI.showToast('Playlist cleared', '🧹');
      }
    },

    shufflePlay() {
      if (state.playlist.length === 0) {
        UI.showToast('Your playlist is empty! Add some tracks first.', 'ℹ️');
        return;
      }
      state.isShuffle = true;
      UI.updateShuffleUI();
      const randomIndex = Math.floor(Math.random() * state.playlist.length);
      Player.playTrack(state.playlist[randomIndex]);
    },

    getTotalDuration() {
      return state.playlist.reduce((acc, t) => acc + (t.duration || 0), 0);
    }
  };

  /* ==========================================================================
     5. DOM ELEMENTS CACHE
     ========================================================================== */

  const DOM = {};

  function cacheDOMElements() {
    DOM.searchInput = document.getElementById('searchInput');
    DOM.searchForm = document.getElementById('searchForm');
    DOM.clearSearchBtn = document.getElementById('clearSearchBtn');
    DOM.genreTagsContainer = document.getElementById('genreTagsContainer');
    DOM.filterModeButtons = document.querySelectorAll('.filter-mode-btn');

    DOM.apiKeyStatusBtn = document.getElementById('apiKeyStatusBtn');
    DOM.statusDot = document.getElementById('statusDot');
    DOM.apiStatusText = document.getElementById('apiStatusText');
    DOM.apiNoticeBanner = document.getElementById('apiNoticeBanner');
    DOM.openSetupModalBtn = document.getElementById('openSetupModalBtn');

    DOM.resultsHeading = document.getElementById('resultsHeading');
    DOM.resultsCountBadge = document.getElementById('resultsCountBadge');
    DOM.resultsGrid = document.getElementById('resultsGrid');
    DOM.resultsEmptyState = document.getElementById('resultsEmptyState');
    DOM.resultsErrorState = document.getElementById('resultsErrorState');
    DOM.errorMessageDetail = document.getElementById('errorMessageDetail');
    DOM.retrySearchBtn = document.getElementById('retrySearchBtn');
    DOM.loadFallbackBtn = document.getElementById('loadFallbackBtn');
    DOM.resetSearchBtn = document.getElementById('resetSearchBtn');
    DOM.refreshBtn = document.getElementById('refreshBtn');

    // Sidebar
    DOM.sidebar = document.getElementById('sidebar');
    DOM.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    DOM.mobileDrawerBtn = document.getElementById('mobileDrawerBtn');
    DOM.drawerToggleBottomBtn = document.getElementById('drawerToggleBottomBtn');
    DOM.playlistList = document.getElementById('playlistList');
    DOM.playlistEmptyState = document.getElementById('playlistEmptyState');
    DOM.playlistCount = document.getElementById('playlistCount');
    DOM.playlistDuration = document.getElementById('playlistDuration');
    DOM.clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
    DOM.shufflePlayBtn = document.getElementById('shufflePlayBtn');

    // Vinyl Disc
    DOM.vinylWidget = document.getElementById('vinylWidget');
    DOM.vinylDisc = document.getElementById('vinylDisc');
    DOM.vinylCover = document.getElementById('vinylCover');
    DOM.vinylStatusText = document.getElementById('vinylStatusText');

    // Player Bar
    DOM.nowPlayingBar = document.getElementById('nowPlayingBar');
    DOM.nowPlayingCover = document.getElementById('nowPlayingCover');
    DOM.nowPlayingTitle = document.getElementById('nowPlayingTitle');
    DOM.nowPlayingArtist = document.getElementById('nowPlayingArtist');
    DOM.btnLike = document.getElementById('btnLike');
    DOM.btnAddToPlaylist = document.getElementById('btnAddToPlaylist');

    DOM.btnShuffle = document.getElementById('btnShuffle');
    DOM.btnPrev = document.getElementById('btnPrev');
    DOM.btnPlayPause = document.getElementById('btnPlayPause');
    DOM.playIcon = document.getElementById('playIcon');
    DOM.pauseIcon = document.getElementById('pauseIcon');
    DOM.btnNext = document.getElementById('btnNext');
    DOM.btnRepeat = document.getElementById('btnRepeat');
    DOM.repeatOneBadge = document.getElementById('repeatOneBadge');

    DOM.currentTime = document.getElementById('currentTime');
    DOM.totalTime = document.getElementById('totalTime');
    DOM.progressContainer = document.getElementById('progressContainer');
    DOM.progressBuffer = document.getElementById('progressBuffer');
    DOM.progressFill = document.getElementById('progressFill');
    DOM.progressHandle = document.getElementById('progressHandle');

    DOM.btnVolume = document.getElementById('btnVolume');
    DOM.volHighIcon = document.getElementById('volHighIcon');
    DOM.volMutedIcon = document.getElementById('volMutedIcon');
    DOM.volumeSlider = document.getElementById('volumeSlider');

    // Modals
    DOM.apiKeyModal = document.getElementById('apiKeyModal');
    DOM.closeApiModalBtn = document.getElementById('closeApiModalBtn');
    DOM.modalApiKeyInput = document.getElementById('modalApiKeyInput');
    DOM.saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    DOM.resetApiKeyBtn = document.getElementById('resetApiKeyBtn');
    DOM.apiKeyFeedback = document.getElementById('apiKeyFeedback');

    DOM.shortcutsBtn = document.getElementById('shortcutsBtn');
    DOM.shortcutsModal = document.getElementById('shortcutsModal');
    DOM.closeShortcutsModalBtn = document.getElementById('closeShortcutsModalBtn');
    DOM.dismissShortcutsBtn = document.getElementById('dismissShortcutsBtn');

    DOM.toastContainer = document.getElementById('toastContainer');
  }

  /* ==========================================================================
     6. UI RENDERING & COMPONENT UPDATES
     ========================================================================== */

  const UI = {
    renderGenreTags() {
      if (!CONFIG.GENRE_TAGS || !DOM.genreTagsContainer) return;
      DOM.genreTagsContainer.innerHTML = CONFIG.GENRE_TAGS.map(tagObj => `
        <button class="genre-tag-chip ${tagObj.tag === state.currentTag ? 'active' : ''}" data-tag="${tagObj.tag}">
          <span>${tagObj.icon || '🎵'}</span>
          <span>${tagObj.label}</span>
        </button>
      `).join('');
    },

    renderSkeletons(count = 12) {
      DOM.resultsGrid.innerHTML = Array.from({ length: count }).map(() => `
        <div class="skeleton-card">
          <div class="skeleton-img"></div>
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      `).join('');
      DOM.resultsEmptyState.style.display = 'none';
      DOM.resultsErrorState.style.display = 'none';
    },

    renderSearchResults(tracks) {
      state.searchResults = tracks || [];
      DOM.resultsCountBadge.textContent = `${state.searchResults.length} songs`;

      if (state.searchResults.length === 0) {
        DOM.resultsGrid.innerHTML = '';
        DOM.resultsEmptyState.style.display = 'flex';
        DOM.resultsErrorState.style.display = 'none';
        return;
      }

      DOM.resultsEmptyState.style.display = 'none';
      DOM.resultsErrorState.style.display = 'none';

      DOM.resultsGrid.innerHTML = state.searchResults.map(track => {
        const isCurrentPlaying = state.currentTrack && state.currentTrack.id === track.id && state.isPlaying;
        const isInPlaylist = state.playlist.some(p => p.id === track.id);
        const durationFormatted = formatTime(track.duration);

        return `
          <div class="track-card ${state.currentTrack && state.currentTrack.id === track.id ? 'active-card' : ''}" data-id="${track.id}">
            <div class="card-cover-wrapper">
              <img 
                src="${track.image}" 
                alt="${track.name}" 
                class="card-cover" 
                loading="lazy"
                onerror="this.src='https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80'"
              >
              <button class="card-play-btn" data-action="play" data-id="${track.id}" aria-label="Play track">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
              <button 
                class="card-add-playlist-btn ${isInPlaylist ? 'added' : ''}" 
                data-action="add-playlist" 
                data-id="${track.id}" 
                title="${isInPlaylist ? 'In Playlist' : 'Add to Playlist'}"
                aria-label="Add to playlist"
              >
                ${isInPlaylist ? `
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ` : `
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                `}
              </button>
              <span class="card-duration-badge">${durationFormatted}</span>
            </div>
            <div class="card-meta">
              <div class="card-title" title="${track.name}">${track.name}</div>
              <div class="card-artist" title="${track.artist_name}">${track.artist_name}</div>
            </div>
          </div>
        `;
      }).join('');
    },

    showError(heading, message) {
      DOM.resultsGrid.innerHTML = '';
      DOM.resultsEmptyState.style.display = 'none';
      DOM.resultsErrorState.style.display = 'flex';
      document.getElementById('errorMessageHeading').textContent = heading;
      DOM.errorMessageDetail.textContent = message;
      DOM.resultsCountBadge.textContent = 'Error';
    },

    renderPlaylist() {
      const list = state.playlist;
      DOM.playlistCount.textContent = `${list.length} ${list.length === 1 ? 'song' : 'songs'}`;
      DOM.playlistDuration.textContent = `${formatTime(Playlist.getTotalDuration())} total`;

      if (list.length === 0) {
        DOM.playlistList.innerHTML = '';
        DOM.playlistEmptyState.style.display = 'flex';
        return;
      }

      DOM.playlistEmptyState.style.display = 'none';

      DOM.playlistList.innerHTML = list.map((track, index) => {
        const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
        const isCurrentlyPlaying = isCurrent && state.isPlaying;

        return `
          <li 
            class="playlist-item ${isCurrent ? 'active-playing' : ''}" 
            data-index="${index}" 
            data-id="${track.id}"
            draggable="true"
          >
            <div class="playlist-drag-handle" title="Drag to reorder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="6" r="1.5"></circle>
                <circle cx="15" cy="6" r="1.5"></circle>
                <circle cx="9" cy="12" r="1.5"></circle>
                <circle cx="15" cy="12" r="1.5"></circle>
                <circle cx="9" cy="18" r="1.5"></circle>
                <circle cx="15" cy="18" r="1.5"></circle>
              </svg>
            </div>
            <div class="playlist-item-cover-wrap" data-action="play-playlist-item" data-id="${track.id}">
              <img 
                src="${track.image}" 
                alt="${track.name}" 
                class="playlist-item-cover"
                loading="lazy"
                onerror="this.src='https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80'"
              >
              <div class="playlist-item-play-overlay">
                ${isCurrentlyPlaying ? `
                  <div class="equalizer-wave">
                    <span></span><span></span><span></span>
                  </div>
                ` : `
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                `}
              </div>
            </div>
            <div class="playlist-item-info" data-action="play-playlist-item" data-id="${track.id}">
              <span class="playlist-item-title" title="${track.name}">${track.name}</span>
              <span class="playlist-item-artist" title="${track.artist_name}">${track.artist_name}</span>
            </div>
            <span class="playlist-item-duration">${formatTime(track.duration)}</span>
            <button 
              class="playlist-item-remove-btn" 
              data-action="remove-from-playlist" 
              data-id="${track.id}"
              title="Remove from playlist" 
              aria-label="Remove track"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </li>
        `;
      }).join('');

      this.bindDragAndDropEvents();
    },

    bindDragAndDropEvents() {
      const items = DOM.playlistList.querySelectorAll('.playlist-item');

      items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
          state.draggedIndex = parseInt(item.dataset.index, 10);
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', state.draggedIndex);
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          items.forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
          });
          state.draggedIndex = null;
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          const bounding = item.getBoundingClientRect();
          const offset = e.clientY - bounding.top;
          const isOverTopHalf = offset < bounding.height / 2;

          items.forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
          if (isOverTopHalf) {
            item.classList.add('drag-over-top');
          } else {
            item.classList.add('drag-over-bottom');
          }
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const targetIndex = parseInt(item.dataset.index, 10);
          const fromIndex = state.draggedIndex;

          const bounding = item.getBoundingClientRect();
          const offset = e.clientY - bounding.top;
          const isOverTopHalf = offset < bounding.height / 2;
          let insertIndex = isOverTopHalf ? targetIndex : targetIndex + 1;

          if (fromIndex !== null && fromIndex !== undefined) {
            if (fromIndex < insertIndex) {
              insertIndex--;
            }
            Playlist.reorder(fromIndex, insertIndex);
          }
        });
      });
    },

    renderNowPlaying(track) {
      if (!track) return;
      DOM.nowPlayingCover.src = track.image || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80';
      DOM.nowPlayingCover.onerror = () => {
        DOM.nowPlayingCover.src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80';
      };
      DOM.nowPlayingTitle.textContent = track.name;
      DOM.nowPlayingTitle.title = track.name;
      DOM.nowPlayingArtist.textContent = track.artist_name;
      DOM.nowPlayingArtist.title = track.artist_name;

      // Update liked status
      if (state.likedTrackIds.has(track.id)) {
        DOM.btnLike.classList.add('liked');
      } else {
        DOM.btnLike.classList.remove('liked');
      }

      // Update add to playlist button in player bar
      const isInPlaylist = state.playlist.some(p => p.id === track.id);
      if (isInPlaylist) {
        DOM.btnAddToPlaylist.style.opacity = '0.4';
        DOM.btnAddToPlaylist.title = 'Already in playlist';
      } else {
        DOM.btnAddToPlaylist.style.opacity = '1';
        DOM.btnAddToPlaylist.title = 'Add to playlist';
      }

      // Update duration immediately so timeline does not display 0:00 while loading
      if (track.duration && (!state.audioElement.duration || isNaN(state.audioElement.duration))) {
        this.updateTimeline(state.audioElement.currentTime || 0, track.duration);
      }
    },

    updateVinylCover(track) {
      if (!track) return;
      DOM.vinylCover.src = track.image || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80';
      DOM.vinylCover.onerror = () => {
        DOM.vinylCover.src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80';
      };
    },

    syncPlayState(isPlaying) {
      if (isPlaying) {
        DOM.playIcon.style.display = 'none';
        DOM.pauseIcon.style.display = 'block';
        DOM.vinylWidget.classList.add('is-playing');
        DOM.vinylStatusText.textContent = 'PLAYING';
      } else {
        DOM.playIcon.style.display = 'block';
        DOM.pauseIcon.style.display = 'none';
        DOM.vinylWidget.classList.remove('is-playing');
        DOM.vinylStatusText.textContent = 'PAUSED';
      }

      // Re-render equalizer bars in playlist & card glow
      if (state.currentTrack) {
        this.highlightActiveTrack(state.currentTrack.id);
      }
    },

    highlightActiveTrack(trackId) {
      // Sidebar
      const playlistItems = DOM.playlistList.querySelectorAll('.playlist-item');
      playlistItems.forEach(item => {
        const id = item.dataset.id;
        if (id === trackId) {
          item.classList.add('active-playing');
          const overlay = item.querySelector('.playlist-item-play-overlay');
          if (overlay) {
            overlay.innerHTML = state.isPlaying ? `
              <div class="equalizer-wave">
                <span></span><span></span><span></span>
              </div>
            ` : `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            `;
          }
        } else {
          item.classList.remove('active-playing');
          const overlay = item.querySelector('.playlist-item-play-overlay');
          if (overlay) {
            overlay.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            `;
          }
        }
      });

      // Cards Grid
      const cards = DOM.resultsGrid.querySelectorAll('.track-card');
      cards.forEach(card => {
        if (card.dataset.id === trackId) {
          card.classList.add('active-card');
        } else {
          card.classList.remove('active-card');
        }
      });
    },

    updateTimeline(currentTime, duration) {
      DOM.currentTime.textContent = formatTime(currentTime);
      DOM.totalTime.textContent = formatTime(duration);

      const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
      DOM.progressFill.style.width = `${percent}%`;
      DOM.progressHandle.style.left = `${percent}%`;
      DOM.progressContainer.setAttribute('aria-valuenow', Math.round(percent));
    },

    updateVolumeUI() {
      DOM.volumeSlider.value = state.volume;
      const pct = state.volume * 100;
      DOM.volumeSlider.style.background = `linear-gradient(to right, var(--accent-mint) ${pct}%, var(--border-subtle) ${pct}%)`;

      if (state.volume === 0 || state.isMuted) {
        DOM.volHighIcon.style.display = 'none';
        DOM.volMutedIcon.style.display = 'block';
      } else {
        DOM.volHighIcon.style.display = 'block';
        DOM.volMutedIcon.style.display = 'none';
      }
    },

    updateShuffleUI() {
      if (state.isShuffle) {
        DOM.btnShuffle.classList.add('active');
      } else {
        DOM.btnShuffle.classList.remove('active');
      }
    },

    updateRepeatUI() {
      DOM.btnRepeat.classList.remove('active', 'repeat-one');
      if (state.repeatMode === 'all') {
        DOM.btnRepeat.classList.add('active');
      } else if (state.repeatMode === 'one') {
        DOM.btnRepeat.classList.add('active', 'repeat-one');
      }
    },

    updateApiStatus() {
      const isConfigured = JamendoAPI.isConfigured();
      if (isConfigured) {
        DOM.statusDot.className = 'status-dot';
        DOM.apiStatusText.textContent = 'Jamendo Live';
        DOM.apiNoticeBanner.style.display = 'none';
      } else {
        DOM.statusDot.className = 'status-dot warning';
        DOM.apiStatusText.textContent = 'Preview Mode';
        DOM.apiNoticeBanner.style.display = 'flex';
      }
    },

    showToast(message, icon = '🎵') {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-text">${message}</span>
      `;
      DOM.toastContainer.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-removing');
        setTimeout(() => toast.remove(), 250);
      }, 3000);
    }
  };

  /* ==========================================================================
     7. APP CONTROLLER & DISPATCHER
     ========================================================================== */

  const App = {
    async init() {
      cacheDOMElements();
      loadPersistedState();
      Player.init();

      // Set initial volume UI
      UI.updateVolumeUI();
      UI.updateShuffleUI();
      UI.updateRepeatUI();
      UI.renderGenreTags();
      UI.renderPlaylist();
      UI.updateApiStatus();

      // If there's a track saved from before or in playlist, load its details in the bottom bar
      if (state.playlist.length > 0) {
        const savedTrackId = localStorage.getItem(STORAGE_KEYS.CURRENT_TRACK_ID);
        const match = state.playlist.find(t => t.id === savedTrackId) || state.playlist[0];
        state.currentTrack = match;
        UI.renderNowPlaying(match);
        UI.updateVinylCover(match);
      }

      this.bindEventListeners();
      this.bindKeyboardShortcuts();
      this.startVinylPhysicsLoop();

      // Load initial trending tracks
      await this.loadTrending();
    },

    /**
     * Turntable Physics: Spins smoothly while playing and eases slowly to a stop when paused.
     * Respects prefers-reduced-motion.
     */
    startVinylPhysicsLoop() {
      let vinylAngle = 0;
      let currentVelocity = 0;

      const loop = () => {
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) {
          currentVelocity = 0;
          requestAnimationFrame(loop);
          return;
        }

        const targetVelocity = state.isPlaying ? 0.35 : 0;
        // Friction: smooth acceleration when starting, smooth gradual brake when paused (~1.5s stop)
        const rate = state.isPlaying ? 0.04 : 0.022;
        currentVelocity += (targetVelocity - currentVelocity) * rate;

        if (Math.abs(currentVelocity) < 0.001) {
          currentVelocity = 0;
        }

        if (currentVelocity > 0 && DOM.vinylDisc) {
          vinylAngle = (vinylAngle + currentVelocity) % 360;
          DOM.vinylDisc.style.transform = `rotate(${vinylAngle.toFixed(2)}deg)`;
        }

        requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    },

    async loadTrending() {
      DOM.resultsHeading.textContent = 'Trending Tracks';
      UI.renderSkeletons(12);

      const result = await JamendoAPI.fetchTrending();
      if (result.success) {
        UI.renderSearchResults(result.tracks);
      } else {
        if (result.reason === 'NO_KEY') {
          UI.renderSearchResults(result.tracks);
        } else {
          UI.renderSearchResults(CONFIG.FALLBACK_TRACKS || []);
          DOM.apiNoticeBanner.style.display = 'flex';
          DOM.statusDot.className = 'status-dot warning';
          DOM.apiStatusText.textContent = 'Preview Mode';
        }
      }
    },

    async handleSearch(query) {
      if (!query || !query.trim()) {
        await this.loadTrending();
        return;
      }

      state.currentQuery = query.trim();
      const typeLabel = state.searchType === 'artist' ? 'Artist' : state.searchType === 'tag' ? 'Tag' : 'Tracks';
      DOM.resultsHeading.textContent = `Search: "${query}" (${typeLabel})`;
      UI.renderSkeletons(12);

      const result = await JamendoAPI.searchTracks(query, state.searchType);
      if (result.success) {
        UI.renderSearchResults(result.tracks);
      } else {
        UI.showError('Search failed', result.message || 'Could not fetch search results.');
      }
    },

    async handleTagClick(tag) {
      state.currentTag = tag;
      DOM.genreTagsContainer.querySelectorAll('.genre-tag-chip').forEach(btn => {
        if (btn.dataset.tag === tag) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      if (tag === 'trending') {
        await this.loadTrending();
        return;
      }

      const tagObj = (CONFIG.GENRE_TAGS || []).find(t => t.tag === tag);
      const label = tagObj ? tagObj.label : tag;
      DOM.resultsHeading.textContent = `${label} Vibe`;
      UI.renderSkeletons(12);

      const result = await JamendoAPI.fetchByTag(tag);
      if (result.success) {
        UI.renderSearchResults(result.tracks);
      } else {
        UI.showError(`Failed to load ${label} tracks`, result.message);
      }
    },

    bindEventListeners() {
      // Search form
      DOM.searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = DOM.searchInput.value;
        this.handleSearch(val);
      });

      DOM.searchInput.addEventListener('input', (e) => {
        if (e.target.value.trim().length > 0) {
          DOM.clearSearchBtn.style.display = 'flex';
        } else {
          DOM.clearSearchBtn.style.display = 'none';
        }
      });

      DOM.clearSearchBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        DOM.clearSearchBtn.style.display = 'none';
        this.loadTrending();
      });

      // Filter Mode Buttons (All / Artist / Genre)
      DOM.filterModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          DOM.filterModeButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.searchType = btn.dataset.type;

          const query = DOM.searchInput.value.trim();
          if (query) {
            this.handleSearch(query);
          }
        });
      });

      // Genre Tags
      DOM.genreTagsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.genre-tag-chip');
        if (btn) {
          const tag = btn.dataset.tag;
          this.handleTagClick(tag);
        }
      });

      // Refresh button
      DOM.refreshBtn.addEventListener('click', () => {
        if (state.currentQuery) {
          this.handleSearch(state.currentQuery);
        } else {
          this.handleTagClick(state.currentTag);
        }
      });

      // Reset search button
      DOM.resetSearchBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        DOM.clearSearchBtn.style.display = 'none';
        this.loadTrending();
      });

      // Retry connection button
      DOM.retrySearchBtn.addEventListener('click', () => {
        this.loadTrending();
      });

      // Load fallback demo tracks button
      DOM.loadFallbackBtn.addEventListener('click', () => {
        DOM.resultsHeading.textContent = 'Demo Tracks (Preview Mode)';
        UI.renderSearchResults(CONFIG.FALLBACK_TRACKS);
      });

      // Results Grid Clicks (Event Delegation)
      DOM.resultsGrid.addEventListener('click', (e) => {
        // Add to Playlist button
        const addBtn = e.target.closest('[data-action="add-playlist"]');
        if (addBtn) {
          e.stopPropagation();
          const trackId = addBtn.dataset.id;
          const track = state.searchResults.find(t => t.id === trackId);
          if (track) {
            Playlist.add(track);
            addBtn.classList.add('added');
            addBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
          }
          return;
        }

        // Quick play button or Card click
        const card = e.target.closest('.track-card');
        if (card) {
          const trackId = card.dataset.id;
          const track = state.searchResults.find(t => t.id === trackId);
          if (track) {
            Player.playTrack(track);
          }
        }
      });

      // Sidebar Playlist clicks
      DOM.playlistList.addEventListener('click', (e) => {
        // Remove button
        const removeBtn = e.target.closest('[data-action="remove-from-playlist"]');
        if (removeBtn) {
          e.stopPropagation();
          Playlist.remove(removeBtn.dataset.id);
          return;
        }

        // Play playlist item
        const item = e.target.closest('.playlist-item');
        if (item) {
          const trackId = item.dataset.id;
          const track = state.playlist.find(t => t.id === trackId);
          if (track) {
            Player.playTrack(track);
          }
        }
      });

      // Playlist Sidebar Header Actions
      DOM.clearPlaylistBtn.addEventListener('click', () => Playlist.clear());
      DOM.shufflePlayBtn.addEventListener('click', () => Playlist.shufflePlay());

      // Vinyl Widget Click: toggle play/pause or focus
      DOM.vinylWidget.addEventListener('click', () => {
        Player.togglePlayPause();
      });

      // Now-Playing Bar Controls
      DOM.btnPlayPause.addEventListener('click', () => Player.togglePlayPause());
      DOM.btnNext.addEventListener('click', () => Player.playNext());
      DOM.btnPrev.addEventListener('click', () => Player.playPrev());
      DOM.btnShuffle.addEventListener('click', () => Player.toggleShuffle());
      DOM.btnRepeat.addEventListener('click', () => Player.cycleRepeat());

      // Like Button
      DOM.btnLike.addEventListener('click', () => {
        if (!state.currentTrack) return;
        const id = state.currentTrack.id;
        if (state.likedTrackIds.has(id)) {
          state.likedTrackIds.delete(id);
          DOM.btnLike.classList.remove('liked');
          UI.showToast('Removed from Liked Songs', '🤍');
        } else {
          state.likedTrackIds.add(id);
          DOM.btnLike.classList.add('liked');
          UI.showToast('Saved to Liked Songs', '❤️');
        }
        saveLikesToStorage();
      });

      // Add Current Track to Playlist
      DOM.btnAddToPlaylist.addEventListener('click', () => {
        if (state.currentTrack) {
          Playlist.add(state.currentTrack);
        }
      });

      // Timeline Scrubber Click & Drag
      const handleSeekEvent = (e) => {
        const rect = DOM.progressContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickX / rect.width));
        Player.seek(fraction);
        if (state.audioElement.duration) {
          UI.updateTimeline(state.audioElement.duration * fraction, state.audioElement.duration);
        }
      };

      DOM.progressContainer.addEventListener('mousedown', (e) => {
        state.isSeeking = true;
        handleSeekEvent(e);

        const onMouseMove = (moveEvent) => {
          if (state.isSeeking) {
            handleSeekEvent(moveEvent);
          }
        };

        const onMouseUp = () => {
          state.isSeeking = false;
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      // Volume Controls
      DOM.volumeSlider.addEventListener('input', (e) => {
        Player.setVolume(parseFloat(e.target.value));
      });

      DOM.btnVolume.addEventListener('click', () => {
        Player.toggleMute();
      });

      // Mobile Drawer Toggles
      const toggleDrawer = () => {
        DOM.sidebar.classList.toggle('drawer-open');
        DOM.sidebarBackdrop.classList.toggle('active');
      };

      DOM.mobileDrawerBtn.addEventListener('click', toggleDrawer);
      DOM.drawerToggleBottomBtn.addEventListener('click', toggleDrawer);
      DOM.sidebarBackdrop.addEventListener('click', () => {
        DOM.sidebar.classList.remove('drawer-open');
        DOM.sidebarBackdrop.classList.remove('active');
      });

      // Modals
      this.bindModalEvents();

      // Keyboard Shortcuts
      this.bindKeyboardShortcuts();
    },

    bindModalEvents() {
      // API Key Modal
      const openApiModal = () => {
        const currentKey = JamendoAPI.getClientId();
        DOM.modalApiKeyInput.value = currentKey;
        DOM.apiKeyFeedback.style.display = 'none';
        DOM.apiKeyModal.style.display = 'flex';
        DOM.modalApiKeyInput.focus();
      };

      const closeApiModal = () => {
        DOM.apiKeyModal.style.display = 'none';
      };

      DOM.apiKeyStatusBtn.addEventListener('click', openApiModal);
      DOM.openSetupModalBtn.addEventListener('click', openApiModal);
      DOM.closeApiModalBtn.addEventListener('click', closeApiModal);
      DOM.apiKeyModal.addEventListener('click', (e) => {
        if (e.target === DOM.apiKeyModal) closeApiModal();
      });

      DOM.saveApiKeyBtn.addEventListener('click', async () => {
        const inputKey = DOM.modalApiKeyInput.value.trim();
        if (!inputKey) {
          DOM.apiKeyFeedback.className = 'modal-feedback error';
          DOM.apiKeyFeedback.textContent = 'Please enter a valid Client ID or click Clear Key.';
          DOM.apiKeyFeedback.style.display = 'block';
          return;
        }

        localStorage.setItem(STORAGE_KEYS.CLIENT_ID_OVERRIDE, inputKey);
        UI.updateApiStatus();

        DOM.apiKeyFeedback.className = 'modal-feedback success';
        DOM.apiKeyFeedback.textContent = 'Testing connection with Jamendo API...';
        DOM.apiKeyFeedback.style.display = 'block';

        const testRes = await JamendoAPI.fetchTrending(1);
        if (testRes.success) {
          DOM.apiKeyFeedback.textContent = 'Success! Jamendo Client ID is active and connected.';
          UI.showToast('Jamendo API Connected!', '🎉');
          setTimeout(() => {
            closeApiModal();
            this.loadTrending();
          }, 900);
        } else {
          DOM.apiKeyFeedback.className = 'modal-feedback error';
          DOM.apiKeyFeedback.textContent = `Jamendo responded with: ${testRes.message || 'Invalid Client ID'}. Please check your key.`;
        }
      });

      DOM.resetApiKeyBtn.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEYS.CLIENT_ID_OVERRIDE);
        DOM.modalApiKeyInput.value = '';
        UI.updateApiStatus();
        DOM.apiKeyFeedback.className = 'modal-feedback success';
        DOM.apiKeyFeedback.textContent = 'Client ID reset to config.js defaults.';
        DOM.apiKeyFeedback.style.display = 'block';
        setTimeout(() => {
          closeApiModal();
          this.loadTrending();
        }, 800);
      });

      // Shortcuts Modal
      const openShortcutsModal = () => {
        DOM.shortcutsModal.style.display = 'flex';
      };
      const closeShortcutsModal = () => {
        DOM.shortcutsModal.style.display = 'none';
      };

      DOM.shortcutsBtn.addEventListener('click', openShortcutsModal);
      DOM.closeShortcutsModalBtn.addEventListener('click', closeShortcutsModal);
      DOM.dismissShortcutsBtn.addEventListener('click', closeShortcutsModal);
      DOM.shortcutsModal.addEventListener('click', (e) => {
        if (e.target === DOM.shortcutsModal) closeShortcutsModal();
      });
    },

    bindKeyboardShortcuts() {
      window.addEventListener('keydown', (e) => {
        // Do not trigger shortcuts if typing inside an input or textarea
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea') {
          return;
        }

        switch (e.code) {
          case 'Space':
            e.preventDefault();
            Player.togglePlayPause();
            break;

          case 'ArrowRight':
            e.preventDefault();
            Player.playNext();
            break;

          case 'ArrowLeft':
            e.preventDefault();
            Player.playPrev();
            break;

          case 'ArrowUp':
            e.preventDefault();
            Player.setVolume(state.volume + 0.05);
            break;

          case 'ArrowDown':
            e.preventDefault();
            Player.setVolume(state.volume - 0.05);
            break;

          case 'KeyM':
            e.preventDefault();
            Player.toggleMute();
            break;

          case 'KeyS':
            e.preventDefault();
            Player.toggleShuffle();
            break;

          case 'KeyR':
            e.preventDefault();
            Player.cycleRepeat();
            break;

          case 'Escape':
            DOM.apiKeyModal.style.display = 'none';
            DOM.shortcutsModal.style.display = 'none';
            DOM.sidebar.classList.remove('drawer-open');
            DOM.sidebarBackdrop.classList.remove('active');
            break;

          default:
            break;
        }
      });
    }
  };

  // Launch the App on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    App.init();
  });

})();
