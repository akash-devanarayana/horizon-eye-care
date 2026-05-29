const fs = require('fs');
const path = require('path');

function generateWav(filename, notes) {
  const sampleRate = 44100;
  const samples = [];

  for (const { freq, duration, volume = 0.3 } of notes) {
    const count = Math.floor(sampleRate * duration);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(1, (count - i) / (sampleRate * 0.15)) * Math.min(1, i / (sampleRate * 0.01));
      samples.push(Math.sin(2 * Math.PI * freq * t) * volume * envelope);
    }
  }

  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.floor(val * 32767), 44 + i * 2);
  }

  fs.writeFileSync(path.join(__dirname, 'assets', 'sounds', filename), buffer);
  console.log(`Created ${filename}`);
}

// Gentle ascending chime for break start
generateWav('break-start.wav', [
  { freq: 523.25, duration: 0.2, volume: 0.25 },
  { freq: 659.25, duration: 0.2, volume: 0.3 },
  { freq: 783.99, duration: 0.4, volume: 0.25 },
]);

// Soft descending tone for break end
generateWav('break-end.wav', [
  { freq: 783.99, duration: 0.15, volume: 0.2 },
  { freq: 659.25, duration: 0.15, volume: 0.25 },
  { freq: 523.25, duration: 0.3, volume: 0.2 },
]);
