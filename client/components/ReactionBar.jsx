/**
 * ReactionBar Component
 * Release 3.2.3 - Floating Emoji Reaction Bar
 * Quick selections: 👍, ❤️, 😂, 😮, 😢, 🙏
 */

import React from 'react';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const ReactionBar = React.memo(function ReactionBar({ onSelect, onClose, position = 'top' }) {
  return (
    <div
      style={{
        position: 'absolute',
        [position === 'top' ? 'bottom' : 'top']: '100%',
        left: 0,
        marginBottom: '6px',
        marginTop: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backgroundColor: '#1E293B',
        border: '1px solid #334155',
        borderRadius: '9999px',
        padding: '4px 8px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
        zIndex: 50,
        animation: 'popIn 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onSelect(emoji);
            if (onClose) onClose();
          }}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            lineHeight: 1,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: '50%',
            transition: 'transform 0.1s ease, background-color 0.1s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.25)';
            e.currentTarget.style.backgroundColor = '#334155';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
});

export default ReactionBar;
