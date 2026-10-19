export const DEMO = false;

export const MEASUREMENT_SETTINGS = Object.freeze({
  signalType: "pink-tsp",
  durationSeconds: 2.73,
  startFrequencyHz: 40,
  endFrequencyHz: 16000,
  averages: 3,
  playbackGain: 0.5
});

const RESPONSE_SECONDS = 0.9;
const EDGE_OCTAVES = 1;
const SWEEP_START_RATIO = 0.02;
const SWEEP_END_RATIO = 0.92;

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function nearestPowerOfTwo(value) {
  const exponent = Math.round(Math.log2(Math.max(value, 1)));
  return 2 ** Math.max(12, exponent);
}

function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const stepReal = Math.cos(angle), stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let twiddleReal = 1, twiddleImag = 0;
      for (let offset = 0; offset < size / 2; offset++) {
        const even = start + offset, odd = even + size / 2;
        const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        [twiddleReal, twiddleImag] = [
          twiddleReal * stepReal - twiddleImag * stepImag,
          twiddleReal * stepImag + twiddleImag * stepReal
        ];
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

function makePinkTsp(sampleRate, settings) {
  const size = nearestPowerOfTwo(sampleRate * settings.durationSeconds);
  const half = size / 2;
  const df = sampleRate / size;
  const nyquist = sampleRate / 2;
  const endFrequency = Math.min(settings.endFrequencyHz, nyquist * 0.95);
  const startFrequency = Math.max(df * 4, Math.min(settings.startFrequencyHz, endFrequency / 4));
  const lowOctaves = Math.min(EDGE_OCTAVES, Math.log2(startFrequency / df));
  const highOctaves = Math.min(EDGE_OCTAVES, Math.log2(nyquist / endFrequency));
  const amplitude = new Float64Array(half + 1);
  const cumulativeEnergy = new Float64Array(half + 1);
  let totalEnergy = 0;

  for (let bin = 1; bin < half; bin++) {
    const frequency = bin * df;
    let taper = 1;
    if (frequency < startFrequency) {
      const position = Math.log2(startFrequency / frequency) / lowOctaves;
      taper = position >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * position));
    } else if (frequency > endFrequency) {
      const position = Math.log2(frequency / endFrequency) / highOctaves;
      taper = position >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * position));
    }
    amplitude[bin] = taper / Math.sqrt(frequency);
    totalEnergy += amplitude[bin] ** 2;
    cumulativeEnergy[bin] = totalEnergy;
  }
  if (!totalEnergy) throw new Error("TSP信号を生成できませんでした。");

  const tStart = SWEEP_START_RATIO * size / sampleRate;
  const tSpan = (SWEEP_END_RATIO - SWEEP_START_RATIO) * size / sampleRate;
  const phase = new Float64Array(half + 1);
  for (let bin = 0; bin <= half; bin++) {
    const previousDelay = tStart + tSpan * (cumulativeEnergy[Math.max(0, bin - 1)] / totalEnergy);
    const currentDelay = tStart + tSpan * (cumulativeEnergy[bin] / totalEnergy);
    phase[bin] = bin === 0
      ? 0
      : phase[bin - 1] - 2 * Math.PI * df * (previousDelay + currentDelay) / 2;
  }

  const real = new Float64Array(size), imag = new Float64Array(size);
  for (let bin = 1; bin < half; bin++) {
    const magnitude = amplitude[bin];
    if (!magnitude) continue;
    real[bin] = magnitude * Math.cos(phase[bin]);
    imag[bin] = magnitude * Math.sin(phase[bin]);
    real[size - bin] = real[bin];
    imag[size - bin] = -imag[bin];
  }
  fft(real, imag, true);

  let peak = 0;
  for (let i = 0; i < size; i++) {
    peak = Math.max(peak, Math.abs(real[i]));
  }
  if (!peak) throw new Error("TSP信号を生成できませんでした。");
  const normalization = 1 / peak;
  return Float32Array.from(real, value => value * normalization);
}

function buildRepeatedSignal(pulse, sampleRate, settings) {
  const maxTotalLength = Math.floor(sampleRate * (settings.durationSeconds + RESPONSE_SECONDS) * settings.averages);
  const slotLength = Math.floor(maxTotalLength / settings.averages);
  const responseLength = slotLength - pulse.length;
  if (responseLength <= 0) {
    throw new Error("この端末のサンプリングレートでは測定時間内にTSPを再生できません。");
  }
  const totalLength = slotLength * settings.averages;
  if (totalLength > maxTotalLength) {
    throw new Error("測定時間に対して信号長が長すぎます。");
  }
  const output = new Float32Array(totalLength);
  for (let repetition = 0; repetition < settings.averages; repetition++) {
    output.set(pulse, repetition * slotLength);
  }
  return { output, slotLength, responseLength };
}

function collectRecording(session, durationSeconds, ctrl, playbackGain) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let recording = true;
    let settled = false;
    let timeoutId, cancelId;
    const previousHandler = session.processor.onaudioprocess;
    let sourceEnded = false;
    session.processor.onaudioprocess = event => {
      previousHandler(event);
      if (!recording) return;
      chunks.push({
        time: Number.isFinite(event.playbackTime)
          ? event.playbackTime
          : session.context.currentTime - event.inputBuffer.length / session.sampleRate,
        samples: new Float32Array(event.inputBuffer.getChannelData(0))
      });
    };

    const startAt = session.context.currentTime + 0.05;
    const source = session.context.createBufferSource();
    const buffer = session.context.createBuffer(1, session.measurementBuffer.length, session.sampleRate);
    buffer.copyToChannel(session.measurementBuffer, 0);
    source.buffer = buffer;
    const gain = session.context.createGain();
    gain.gain.value = playbackGain;
    source.connect(gain);
    gain.connect(session.context.destination);
    const stopSource = () => {
      if (sourceEnded) return;
      try {
        source.stop();
      } catch (error) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      }
    };
    const cleanup = () => {
      recording = false;
      window.clearTimeout(timeoutId);
      window.clearInterval(cancelId);
      source.disconnect();
      gain.disconnect();
      session.processor.onaudioprocess = previousHandler;
    };
    source.onended = () => {
      sourceEnded = true;
      window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!chunks.length) {
          reject(new Error("マイクから音声を取得できませんでした。"));
          return;
        }

        const firstTime = chunks[0].time;
        const last = chunks[chunks.length - 1];
        const samples = new Float32Array(
          Math.ceil((last.time - firstTime) * session.sampleRate) + last.samples.length
        );
        chunks.forEach(chunk => {
          const offset = Math.round((chunk.time - firstTime) * session.sampleRate);
          samples.set(chunk.samples, Math.max(0, offset));
        });
        resolve({
          samples,
          expectedStart: Math.max(0, Math.round((startAt - firstTime) * session.sampleRate)),
          playbackStart: startAt
        });
      }, 200);
    };

    try {
      source.start(startAt);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
    cancelId = window.setInterval(() => {
      if (!ctrl.cancelled || settled) return;
      settled = true;
      stopSource();
      cleanup();
      reject(new Error("cancelled"));
    }, 100);
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      stopSource();
      cleanup();
      reject(new Error("録音がタイムアウトしました。もう一度お試しください。"));
    }, durationSeconds * 1000 + 5000);
  });
}

function findResponseStart(recording, signal, expected, sampleRate) {
  const radius = Math.round(sampleRate * 0.5);
  const base = Math.max(0, expected - radius);
  const searchLength = Math.min(recording.length - base, signal.length + radius * 2);
  if (searchLength < signal.length) throw new Error("録音データが短すぎます。");

  const size = nextPowerOfTwo(searchLength + signal.length);
  const recReal = new Float64Array(size), recImag = new Float64Array(size);
  const sigReal = new Float64Array(size), sigImag = new Float64Array(size);
  for (let i = 0; i < searchLength; i++) recReal[i] = recording[base + i];
  for (let i = 0; i < signal.length; i++) sigReal[i] = signal[i];
  fft(recReal, recImag);
  fft(sigReal, sigImag);
  for (let i = 0; i < size; i++) {
    const real = recReal[i] * sigReal[i] + recImag[i] * sigImag[i];
    const imag = recImag[i] * sigReal[i] - recReal[i] * sigImag[i];
    recReal[i] = real;
    recImag[i] = imag;
  }
  fft(recReal, recImag, true);

  const expectedLocal = expected - base;
  const minLag = Math.max(0, Math.floor(expectedLocal - radius));
  const maxLag = Math.min(searchLength - signal.length, Math.ceil(expectedLocal + radius));
  let bestLag = -1, bestValue = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = Math.abs(recReal[lag]);
    if (value > bestValue) { bestValue = value; bestLag = lag; }
  }
  if (bestLag < 0 || bestValue === 0) throw new Error("再生信号を録音から検出できませんでした。");
  return base + bestLag;
}

function deconvolve(recording, start, signal, responseLength) {
  const size = nextPowerOfTwo(signal.length + responseLength);
  const signalReal = new Float64Array(size), signalImag = new Float64Array(size);
  const responseReal = new Float64Array(size), responseImag = new Float64Array(size);
  for (let i = 0; i < signal.length; i++) signalReal[i] = signal[i];
  for (let i = 0; i < responseLength; i++) responseReal[i] = recording[start + i] || 0;
  fft(signalReal, signalImag);
  fft(responseReal, responseImag);

  let peakPower = 0;
  for (let i = 0; i < size; i++) {
    peakPower = Math.max(peakPower, signalReal[i] ** 2 + signalImag[i] ** 2);
  }
  const regularizer = peakPower * 1e-8;
  for (let i = 0; i < size; i++) {
    const power = signalReal[i] ** 2 + signalImag[i] ** 2 + regularizer;
    const real = (responseReal[i] * signalReal[i] + responseImag[i] * signalImag[i]) / power;
    const imag = (responseImag[i] * signalReal[i] - responseReal[i] * signalImag[i]) / power;
    responseReal[i] = real;
    responseImag[i] = imag;
  }
  fft(responseReal, responseImag, true);
  return responseReal.slice(0, responseLength);
}

function regression(values, sampleRate, lowDb, highDb) {
  const points = [];
  for (let i = 0; i < values.length; i++) {
    const db = values[i];
    if (Number.isFinite(db) && db <= lowDb && db >= highDb) points.push([i / sampleRate, db]);
  }
  if (points.length < 12) return { seconds: null, r2: 0 };
  const meanX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  if (!varianceX || !varianceY) return { seconds: null, r2: 0 };
  const slope = covariance / varianceX;
  if (!(slope < 0)) return { seconds: null, r2: 0 };
  return { seconds: -60 / slope, r2: Math.max(0, Math.min(1, covariance ** 2 / (varianceX * varianceY))) };
}

function decayCurve(ir) {
  const curve = new Float32Array(ir.length);
  let energy = 0;
  for (let i = ir.length - 1; i >= 0; i--) {
    energy += ir[i] ** 2;
    curve[i] = energy;
  }
  const reference = curve[0] || 1;
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.max(-100, 10 * Math.log10(Math.max(curve[i] / reference, 1e-10)));
  }
  return curve;
}

function filterOctave(input, sampleRate, center) {
  const q = Math.SQRT2;
  const omega = 2 * Math.PI * center / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = -2 * Math.cos(omega) / a0, a2 = (1 - alpha) / a0;
  const output = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return output;
}

function downsample(values, count) {
  const result = new Array(count);
  for (let i = 0; i < count; i++) result[i] = values[Math.min(values.length - 1, Math.floor(i * values.length / count))];
  return result;
}

function analyzeImpulseResponse(ir, sampleRate) {
  const edc = decayCurve(ir);
  const edtFit = regression(edc, sampleRate, 0, -10);
  const t20 = regression(edc, sampleRate, -5, -25);
  const t30 = regression(edc, sampleRate, -5, -35);
  const primary = t30.seconds ? t30 : t20;
  if (!primary.seconds || !Number.isFinite(primary.seconds)) {
    throw new Error("残響時間を算出できませんでした。周囲を静かにして、マイクとスピーカーをふさがない状態で再測定してください。");
  }

  const bands = [125, 250, 500, 1000, 2000, 4000, 8000]
    .filter(hz => hz * Math.SQRT2 < sampleRate / 2)
    .map(hz => {
      const curve = decayCurve(filterOctave(ir, sampleRate, hz));
      const fit = regression(curve, sampleRate, -5, -25);
      return { hz, rt60: fit.seconds || 0, edt: regression(curve, sampleRate, 0, -10).seconds || 0 };
    });

  let max = 0;
  for (const value of ir) max = Math.max(max, Math.abs(value));
  max ||= 1;
  const normalizedIr = Float32Array.from(ir, value => value / max);
  return {
    rt60: primary.seconds,
    edt: edtFit.seconds || primary.seconds,
    r2: primary.r2,
    valid: primary.r2 > 0.8,
    bands,
    ir: downsample(normalizedIr, 800),
    edc: downsample(edc, 800)
  };
}

export async function openMicrophone(onLevel) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("このブラウザーではマイクを利用できません。HTTPSまたはlocalhostで開いてください。");
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザーはWeb Audioに対応していません。");

  const context = new AudioContextClass();
  let resumeError = null;
  try {
    context.resume().catch(error => { resumeError = error; });
  } catch (error) {
    resumeError = error;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    let smoothedDb = -60;
    processor.onaudioprocess = event => {
      const samples = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
      const rms = Math.sqrt(sumSquares / samples.length);
      const db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-6))));
      smoothedDb = 0.7 * smoothedDb + 0.3 * db;
      onLevel(smoothedDb);
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);

    return {
      context,
      processor,
      sampleRate: context.sampleRate,
      measurementBuffer: null,
      setMeasurementBuffer(buffer) { this.measurementBuffer = buffer; },
      async resume() {
        try {
          if (context.state !== "running") await context.resume();
        } catch (error) {
          throw new Error("ブラウザーの音声処理を開始できませんでした。開始ボタンをもう一度押してください。", { cause: error });
        }
        if (context.state !== "running") {
          throw new Error("ブラウザーの音声処理が停止しています。開始ボタンをもう一度押してください。", { cause: resumeError });
        }
      },
      async stop() {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
        stream.getTracks().forEach(track => track.stop());
        if (context.state !== "closed") await context.close();
      }
    };
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") await context.close();
    throw error;
  }
}

export async function playTspPreview() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザーは音声再生に対応していません。");
  const context = new AudioContextClass();
  try {
    await context.resume();
    if (context.state !== "running") throw new Error("音声を再生できません。ブラウザーの音声設定を確認してください。");
    const signal = makePinkTsp(context.sampleRate, MEASUREMENT_SETTINGS);
    const buffer = context.createBuffer(1, signal.length, context.sampleRate);
    buffer.copyToChannel(signal, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = MEASUREMENT_SETTINGS.playbackGain;
    source.connect(gain);
    gain.connect(context.destination);
    await new Promise((resolve, reject) => {
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        resolve();
      };
      try {
        source.start();
      } catch (error) {
        source.disconnect();
        gain.disconnect();
        reject(error);
      }
    });
  } finally {
    if (context.state !== "closed") await context.close();
  }
}

export async function runMeasurement(session, ctrl, settings = MEASUREMENT_SETTINGS) {
  const sampleRate = session.sampleRate;
  const pulse = makePinkTsp(sampleRate, settings);
  const { output, slotLength, responseLength } = buildRepeatedSignal(pulse, sampleRate, settings);
  session.setMeasurementBuffer(output);

  const captureDuration = output.length / sampleRate;
  const recordingPromise = collectRecording(session, captureDuration, ctrl, settings.playbackGain);
  const recording = await recordingPromise;
  if (ctrl.cancelled) throw new Error("cancelled");

  const responses = [];
  for (let average = 0; average < settings.averages; average++) {
    const expected = recording.expectedStart + average * slotLength;
    const start = findResponseStart(recording.samples, pulse, expected, sampleRate);
    responses.push(deconvolve(recording.samples, start, pulse, pulse.length + responseLength));
  }
  const ir = new Float32Array(responses[0].length);
  for (const response of responses) {
    for (let i = 0; i < ir.length; i++) ir[i] += response[i] / responses.length;
  }
  const analysis = analyzeImpulseResponse(ir, sampleRate);
  return { ...analysis, sampleRate, measuredDuration: captureDuration };
}
