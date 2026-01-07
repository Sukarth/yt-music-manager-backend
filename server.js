const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize yt-dlp (will auto-download binary if needed)
const ytDlp = new YTDlpWrap();

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
    const metadata = await ytDlp.getVideoInfo([playlistUrl, '--flat-playlist', '--dump-json']);
    
    // Parse the JSON output
    const playlistData = typeof metadata === 'string' ? JSON.parse(metadata.split('\n')[0]) : metadata;

    res.json({
      id: playlistId,
      title: playlistData.title || 'Unknown Playlist',
      description: playlistData.description || '',
      thumbnailUrl: playlistData.thumbnail || '',
      itemCount: playlistData.playlist_count || 0
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
    const metadata = await ytDlp.getVideoInfo([playlistUrl, '--flat-playlist', '--dump-json']);
    
    // yt-dlp returns one JSON per line for each video
    const lines = metadata.split('\n').filter(line => line.trim());
    
    const videos = lines.slice(1).map(line => {
      try {
        const video = JSON.parse(line);
        return {
          id: video.id,
          title: video.title || 'Unknown',
          author: video.uploader || video.channel || 'Unknown',
          duration: video.duration || 0,
          thumbnailUrl: video.thumbnail || ''
        };
      } catch (e) {
        console.error('Failed to parse video line:', e);
        return null;
      }
    }).filter(v => v !== null);

    res.json({
      playlistId: playlistId,
      title: '',
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

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Download yt-dlp binary if not present
  try {
    await ytDlp.downloadYTDlp();
    console.log('✅ yt-dlp ready');
  } catch (error) {
    console.log('ℹ️ yt-dlp already installed or download failed');
  }
});
