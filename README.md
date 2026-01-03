# YT Music Manager Backend

Backend service for YT Music Manager mobile app.  Provides YouTube audio download functionality.

## Features
- Get download info for YouTube videos
- Stream audio directly to client
- Audio-only format selection
- CORS enabled for mobile app

## API Endpoints

### GET /
Health check endpoint

### GET /api/download-info? videoId=VIDEO_ID
Get download information for a video

### GET /api/download? videoId=VIDEO_ID
Stream audio file directly

## Deployment
Deployed on Render

## Tech Stack
- Node.js
- Express
- ytdl-core
