type PcmAudio = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>;

export function encodeWav(audio: PcmAudio, gain = 1): Blob {
  const channels = audio.numberOfChannels;
  const buffer = new ArrayBuffer(44 + audio.length * channels * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, buffer.byteLength - 44, true);
  for (let channel = 0; channel < channels; channel++) {
    const samples = audio.getChannelData(channel);
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(-1, Math.min(1, (samples[i] ?? 0) * gain));
      view.setInt16(44 + (i * channels + channel) * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
