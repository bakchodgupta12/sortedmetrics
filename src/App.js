import React from 'react';

export default function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28 }}>
        Sorted Wallet Metrics
      </h1>
      <p style={{ color: 'var(--muted)' }}>
        Scaffold ready — features coming next.
      </p>
    </div>
  );
}
