const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'YT Music Backend',
    version: '1.0.0'
  });
});

// Get download info for a video
app.get('/api/download-info', async (req, res) => {
  try {
    const { videoId } = req.query;
    
    if (!videoId) {
      return res.status(400).json({ error: 'videoId parameter is required' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Validate video URL
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    // Get video info
    const info = await ytdl.getInfo(videoUrl);
    
    // Get audio formats
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    // Find best audio quality
    const bestAudio = audioFormats.reduce((best, format) => {
      if (! best || (format.audioBitrate && format.audioBitrate > best.audioBitrate)) {
        return format;
      }
      return best;
    }, null);

    res.json({
      videoId: videoId,
      title: info.videoDetails.title,
      author: info.videoDetails.author. name,
      lengthSeconds: info.videoDetails. lengthSeconds,
      downloadUrl: bestAudio?. url || null,
      quality: bestAudio?.audioBitrate || 'unknown',
      format: bestAudio?.mimeType?. split(';')[0] || 'audio/webm'
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
    const { videoId, quality } = req.query;
    
    if (!videoId) {
      return res.status(400).json({ error: 'videoId parameter is required' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    // Get video info first to set proper headers
    const info = await ytdl.getInfo(videoUrl);
    const title = info.videoDetails.title. replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    // Stream the audio
    const audioStream = ytdl(videoUrl, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    audioStream.pipe(res);

    audioStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (! res.headersSent) {
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
