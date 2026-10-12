/**
 * VideoPlayer Component
 * Release 3.2.3 - Instant Byte-Range Buffered Video Playback
 */

import React, { useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';

export const VideoPlayer = React.memo(function VideoPlayer({ src, isViewOnce = false }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const duration = videoRef.current.duration || 1;
    setProgress((current / duration) * 100);
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pos * (videoRef.current.duration || 1);
  };

  const toggleFullscreen = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '360px',
        borderRadius: '10px',
        overflow: 'hidden',
        backgroundColor: '#0F172A',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
      }}
    >
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        onClick={togglePlay}
        style={{
          width: '100%',
          maxHeight: '260px',
          objectFit: 'cover',
          display: 'block',
          cursor: 'pointer'
        }}
      />

      {/* Media Overlay Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(transparent, rgba(15, 23, 42, 0.95))',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          onClick={handleSeek}
          style={{
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            borderRadius: '2px',
            cursor: 'pointer',
            position: 'relative'
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#38BDF8',
              borderRadius: '2px'
            }}
          />
        </div>

        {/* Buttons Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={togglePlay}
            style={controlBtnStyle}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} color="#FFFFFF" /> : <Play size={16} color="#FFFFFF" />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={toggleMute}
              style={controlBtnStyle}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={16} color="#FFFFFF" /> : <Volume2 size={16} color="#FFFFFF" />}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              style={controlBtnStyle}
              title="Fullscreen"
            >
              <Maximize size={16} color="#FFFFFF" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

const controlBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px'
};

export default VideoPlayer;
