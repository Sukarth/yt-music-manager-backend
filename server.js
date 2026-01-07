const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const { spawn } = require('child_process');
const { execSync } = require('child_process');
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

// Get playlist info
app.get('/api/playlist-info', async (req, res) => {
  try {
    const { playlistId } = req.query;
    
    if (!playlistId) {
      return res.status(400).json({ error: 'playlistId parameter is required' });
    }

    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

    // Get playlist info using yt-dlp (works with public and unlisted playlists)
    // Use --dump-single-json to get a single JSON object with all metadata and entries
    const metadata = await ytDlp.getVideoInfo([playlistUrl, '--flat-playlist', '--dump-single-json']);
    
    // Parse the JSON output
    const playlistData = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

    res.json({
      id: playlistId,
      title: playlistData.title || 'Unknown Playlist',
      description: playlistData.description || '',
      thumbnailUrl: playlistData.thumbnails && playlistData.thumbnails.length > 0 ? playlistData.thumbnails[playlistData.thumbnails.length - 1].url : null || '',
      itemCount: playlistData.playlist_count || (playlistData.entries ? playlistData.entries.length : 0)
    });

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
    
    const playlistData = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const entries = playlistData.entries || [];
    
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
