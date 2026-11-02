/**
 * Auralis - Configuration
 *
 * HOW TO GET A FREE JAMENDO CLIENT ID:
 * 1. Go to the Jamendo Developer Portal: https://developer.jamendo.com/
 * 2. Create a free account and register an application (takes < 1 minute).
 * 3. Copy your "Client ID" and paste it into JAMENDO_CLIENT_ID below.
 *
 * NOTE: You can also paste your Client ID directly into the Auralis UI
 * using the "API Key" button at the top right of the player!
 */

const CONFIG = {
  // PASTE YOUR JAMENDO CLIENT ID HERE (e.g., "a1b2c3d4"):
  JAMENDO_CLIENT_ID: "YOUR_JAMENDO_CLIENT_ID",

  // Jamendo API v3.0 Base URL
  API_BASE_URL: "https://api.jamendo.com/v3.0",

  // Default number of tracks to fetch per query
  DEFAULT_LIMIT: 24,

  // Audio format: mp32 (192kbps MP3) or mp31 (96kbps)
  AUDIO_FORMAT: "mp32",

  // Curated genre & mood tags for quick discovery chips
  GENRE_TAGS: [
    { label: "Trending", tag: "trending", icon: "🔥" },
    { label: "Lo-Fi", tag: "lofi", icon: "☕" },
    { label: "Chillout", tag: "chillout", icon: "✨" },
    { label: "Synthwave", tag: "synthwave", icon: "🌆" },
    { label: "Electronic", tag: "electronic", icon: "⚡" },
    { label: "Acoustic", tag: "acoustic", icon: "🎸" },
    { label: "Rock", tag: "rock", icon: "🤘" },
    { label: "Jazz", tag: "jazz", icon: "🎷" },
    { label: "Ambient", tag: "ambient", icon: "🌌" },
    { label: "Hip-Hop", tag: "hiphop", icon: "🎧" }
  ],

  // Curated fallback Jamendo tracks loaded if client ID is not yet provided
  // or before user registers their free key, so playback and streaming work immediately!
  FALLBACK_TRACKS: [
    {
      id: "1884490",
      name: "Dark Plasman (Edit)",
      artist_name: "Kamil Muzyk",
      album_name: "Retro Synth Odyssey",
      duration: 287,
      image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1884490/mp32/"
    },
    {
      id: "1884491",
      name: "Moving Piano Solo",
      artist_name: "Lonely Piano",
      album_name: "Quiet Solitude",
      duration: 141,
      image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1884491/mp32/"
    },
    {
      id: "1532771",
      name: "Let Me Hear You",
      artist_name: "Paul Werner",
      album_name: "Club Vibes Volume 1",
      duration: 170,
      image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1532771/mp32/"
    },
    {
      id: "1884489",
      name: "Cadillac",
      artist_name: "MC Borrow",
      album_name: "Urban Flow",
      duration: 169,
      image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1884489/mp32/"
    },
    {
      id: "1884488",
      name: "Over My Dead Body",
      artist_name: "Aligned In Ruins",
      album_name: "Raw Horizons",
      duration: 250,
      image: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1884488/mp32/"
    },
    {
      id: "1884486",
      name: "Exit Strategy",
      artist_name: "Aligned In Ruins",
      album_name: "Heavy Distortion",
      duration: 317,
      image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=300&auto=format&fit=crop&q=80",
      audio: "https://mp3d.jamendo.com/download/track/1884486/mp32/"
    }
  ]
};
