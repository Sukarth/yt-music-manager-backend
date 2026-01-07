const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Use system yt-dlp if available, otherwise use bundled one
let ytDlpPath = 'yt-dlp';
try {
  // Check if yt-dlp is available in system
  const foundPath = execSync('which yt-dlp').toString().trim();
  console.log(`✅ Using system yt-dlp found at: ${foundPath}`);
  ytDlpPath = foundPath;
} catch (e) {
  console.log('ℹ️ System yt-dlp not found via which, checking version...');
  try {
    execSync('yt-dlp --version');
    console.log('✅ yt-dlp is accessible in PATH');
    ytDlpPath = 'yt-dlp';
  } catch (e2) {
    console.log('ℹ️ yt-dlp not found in PATH, will use bundled version if possible');
    ytDlpPath = undefined;
  }
}

const ytDlp = new YTDlpWrap(ytDlpPath);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'YT Music Backend',
    version: '1.1.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Helper function to get YouTube API client with OAuth token
function getYouTubeClient(accessToken) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

// Get user's playlists (requires OAuth)
app.get('/api/user-playlists', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const accessToken = authHeader.substring(7);
    const youtube = getYouTubeClient(accessToken);

    // Fetch user's playlists
    const response = await youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
      maxResults: 50
    });

    const playlists = response.data.items.map(playlist => ({
      id: playlist.id,
      title: playlist.snippet.title,
      description: playlist.snippet.description,
      thumbnailUrl: playlist.snippet.thumbnails?.medium?.url || playlist.snippet.thumbnails?.default?.url || '',
      itemCount: playlist.contentDetails.itemCount,
      privacy: playlist.status?.privacyStatus || 'public'
    }));

    res.json({ playlists });

  } catch (error) {
    console.error('Error fetching user playlists:', error);
    if (error.code === 401) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        message: 'Please sign in again'
      });
    }
    res.status(500).json({
      error: 'Failed to fetch user playlists',
      message: error.message
    });
  }
});

// Get playlist info (hybrid: YouTube API for private, yt-dlp for public/unlisted) (hybrid: YouTube API for private, yt-dlp for public/unlisted)
app.get('/api/playlist-info', async (req, res) => {
  try {
    const { playlistId } = req.query;
    const authHeader = req.headers.authorization;

    if (!playlistId) {
      return res.status(400).json({ error: 'playlistId parameter is required' });
    }

    // Try yt-dlp first (works for public and unlisted playlists)
    try {
      const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      const metadata = await ytDlp.getVideoInfo([playlistUrl, '--flat-playlist', '--dump-single-json']);

      const rawData = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      let playlistData = rawData;
      let entries = [];

      if (Array.isArray(rawData)) {
        playlistData = rawData.find(item => item._type === 'playlist') || rawData[rawData.length - 1];
        entries = rawData.filter(item => item._type === 'url' || item._type === 'video');
      } else {
        entries = rawData.entries || [];
      }

      return res.json({
        id: playlistId,
        title: playlistData.title || 'Unknown Playlist',
        description: playlistData.description || '',
        thumbnailUrl: playlistData.thumbnails && playlistData.thumbnails.length > 0 ? playlistData.thumbnails[playlistData.thumbnails.length - 1].url : null || '',
        itemCount: playlistData.playlist_count || entries.length || 0,
        source: 'yt-dlp'
      });
    } catch (ytdlpError) {
      console.log('yt-dlp failed, trying YouTube API...', ytdlpError.message);
      
      // If yt-dlp fails and we have OAuth token, try YouTube API (for private playlists)
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const accessToken = authHeader.substring(7);
        const youtube = getYouTubeClient(accessToken);

        try {
          const response = await youtube.playlists.list({
            part: ['snippet', 'contentDetails'],
            id: [playlistId]
          });

          if (response.data.items && response.data.items.length > 0) {
            const playlist = response.data.items[0];
            return res.json({
              id: playlistId,
              title: playlist.snippet.title,
              description: playlist.snippet.description || '',
              thumbnailUrl: playlist.snippet.thumbnails?.medium?.url || playlist.snippet.thumbnails?.default?.url || '',
              itemCount: playlist.contentDetails.itemCount,
              source: 'youtube-api'
            });
          }
        } catch (apiError) {
          console.error('YouTube API also failed:', apiError.message);
        }
      }

      // Both methods failed
      throw ytdlpError;
    }

  } catch (error) {
    console.error('Error fetching playlist info:', error);
    res.status(500).json({
      error: 'Failed to fetch playlist info',
      message: error.message
    });
  }
});

// Get playlist videos
app.get('/api/playlist-videos', async (req, res) => {
  try {
    const { playlistId } = req.query;

    if (!playlistId) {
      return res.status(400).json({ error: 'playlistId parameter is required' });
    }

    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

    // Get full playlist with all videos using yt-dlp
    // Use --dump-single-json to get reliable playlist metadata and entries
    const metadata = await ytDlp.getVideoInfo([playlistUrl, '--flat-playlist', '--dump-single-json']);

    const rawData = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    let playlistData = rawData;
    let entries = [];

    // Handle case where yt-dlp returns an array
    if (Array.isArray(rawData)) {
      playlistData = rawData.find(item => item._type === 'playlist') || rawData[rawData.length - 1];
      entries = rawData.filter(item => item._type === 'url' || item._type === 'video');
    } else {
      entries = rawData.entries || [];
    }

    // Process entries
    const videos = entries.map(video => {
      if (!video) return null;
      return {
        id: video.id,
        title: video.title || 'Unknown',
        author: video.uploader || video.channel || video.uploader_id || 'Unknown',
        duration: video.duration || 0,
        thumbnailUrl: video.thumbnail || (video.thumbnails && video.thumbnails.length > 0 ? video.thumbnails[0].url : '') || ''
      };
    }).filter(v => v !== null);

    res.json({
      playlistId: playlistId,
      title: playlistData.title || '',
      itemCount: videos.length,
      videos
    });

  } catch (error) {
    console.error('Error fetching playlist videos:', error);
    res.status(500).json({
      error: 'Failed to fetch playlist videos',
      message: error.message
    });
  }
});

// Get download info for a video
app.get('/api/download-info', async (req, res) => {
  try {
    const { videoId } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId parameter is required' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info using yt-dlp
    const metadata = await ytDlp.getVideoInfo([videoUrl, '--dump-json']);
    const info = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

    res.json({
      videoId: videoId,
      title: info.title,
      author: info.uploader || info.channel || 'Unknown',
      lengthSeconds: info.duration || 0,
      downloadUrl: videoUrl, // yt-dlp will handle the actual download
      quality: 'best',
      format: 'audio/mp4'
    });

  } catch (error) {
    console.error('Error fetching download info:', error);
    res.status(500).json({
      error: 'Failed to fetch download info',
      message: error.message
    });
  }
});

// Get direct download stream
app.get('/api/download', async (req, res) => {
  try {
    const { videoId } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId parameter is required' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info for title
    const metadata = await ytDlp.getVideoInfo([videoUrl, '--dump-json']);
    const info = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const title = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${title}.m4a"`);
    res.setHeader('Content-Type', 'audio/mp4');

    // Stream audio using yt-dlp
    const stream = ytDlp.execStream([
      videoUrl,
      '-f', 'bestaudio',
      '-o', '-' // Output to stdout
    ]);

    stream.pipe(res);

    stream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    });

  } catch (error) {
    console.error('Error downloading:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to download',
        message: error.message
      });
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Binding: 0.0.0.0`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
