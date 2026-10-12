/**
 * ImageZoomViewer Component
 * Release 3.2.3 - Fullscreen Pinch-to-Zoom & Drag-Pan Preview Modal
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export const ImageZoomViewer = React.memo(function ImageZoomViewer({ src, alt = 'Image Preview', onClose }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistRef = useRef(0);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setScale((prev) => Math.min(Math.max(prev + delta, 1), 4));
  };

  // Mouse drag panning
  const handleMouseDown = (e) => {
    if (scale <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging || scale <= 1) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch pinch-to-zoom & pan
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchDistRef.current = dist;
    } else if (e.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDistRef.current > 0) {
        const factor = dist / lastTouchDistRef.current;
        setScale((prev) => Math.min(Math.max(prev * factor, 1), 4));
      }
      lastTouchDistRef.current = dist;
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y
      });
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistRef.current = 0;
    setIsDragging(false);
  };

  // Double tap to reset
  const handleDoubleTap = () => {
    if (scale > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2);
    }
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        overflow: 'hidden'
      }}
      onClick={onClose}
    >
      {/* Controls Header */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 10000
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(s + 0.3, 4))}
          style={buttonStyle}
          title="Zoom In"
        >
          <ZoomIn size={20} color="#FFFFFF" />
        </button>
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(s - 0.3, 1))}
          style={buttonStyle}
          title="Zoom Out"
        >
          <ZoomOut size={20} color="#FFFFFF" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          style={buttonStyle}
          title="Reset"
        >
          <RotateCcw size={20} color="#FFFFFF" />
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ ...buttonStyle, backgroundColor: 'rgba(239, 68, 68, 0.4)' }}
          title="Close"
        >
          <X size={20} color="#FFFFFF" />
        </button>
      </div>

      {/* Image Container */}
      <div
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleTap}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            maxWidth: '92vw',
            maxHeight: '92vh',
            objectFit: 'contain',
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
            borderRadius: '6px'
          }}
        />
      </div>
    </div>
  );
});

const buttonStyle = {
  background: 'rgba(255, 255, 255, 0.15)',
  border: 'none',
  borderRadius: '50%',
  width: '38px',
  height: '38px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  backdropFilter: 'blur(8px)',
  transition: 'background-color 0.15s'
};

export default ImageZoomViewer;
