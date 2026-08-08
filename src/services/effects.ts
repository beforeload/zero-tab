export function playCloseSound(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const startedAt = context.currentTime;
    const duration = 0.25;
    const buffer = context.createBuffer(
      1,
      context.sampleRate * duration,
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const position = index / data.length;
      const envelope =
        position < 0.1
          ? position / 0.1
          : Math.pow(1 - (position - 0.1) / 0.9, 1.5);
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(4000, startedAt);
    filter.frequency.exponentialRampToValueAtTime(400, startedAt + duration);
    gain.gain.setValueAtTime(0.15, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startedAt + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(startedAt);
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // Sound is decorative.
  }
}

export function shootConfetti(x: number, y: number): void {
  const colors = [
    '#c8713a',
    '#e8a070',
    '#5a7a62',
    '#8aaa92',
    '#5a6b7a',
    '#8a9baa',
    '#d4b896',
    '#b35a5a',
  ];
  for (let index = 0; index < 14; index += 1) {
    const particle = document.createElement('span');
    const size = 5 + Math.random() * 6;
    const circle = Math.random() > 0.5;
    particle.className = 'confetti-particle';
    Object.assign(particle.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: colors[Math.floor(Math.random() * colors.length)],
      borderRadius: circle ? '50%' : '2px',
    });
    document.body.appendChild(particle);
    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 90;
    particle.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance + 70}px)) rotate(${circle ? 0 : 240}deg)`,
          opacity: 0,
        },
      ],
      { duration: 700 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.2,1)' },
    ).finished.finally(() => particle.remove());
  }
}
