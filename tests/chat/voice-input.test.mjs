/** Voice input never leaves a microphone running, never writes a late transcript, and never drops captured speech. Fake browser media. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';
import { reduceVoiceInput } from '../../src/features/chat/lib/voice-input-machine.ts';
import * as capabilityMessages from '../../src/lib/capability-messages.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(t) {
  const effects = [];
  const react = {
    useCallback: (callback) => callback,
    useRef: (current) => ({ current }),
    useState(initial) {
      let value = typeof initial === 'function' ? initial() : initial;
      return [
        value,
        (next) => {
          value = typeof next === 'function' ? next(value) : next;
        },
      ];
    },
    useEffect: (effect) => effects.push(effect),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const machine = loadTsx('src/features/chat/hooks/use-machine-store.ts', (name) => {
    if (name === 'react') return react;
    if (name === '../lib/reducer-store') return { createReducerStore };
    throw new Error(name);
  });
  const transcripts = [];
  const mic = deferred();
  let requested = 0;
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const globals = ['navigator', 'MediaRecorder', 'AudioContext', 'fetch'];
  const previous = new Map(
    globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  t.after(() => {
    for (const name of globals) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => {
          requested++;
          return mic.promise;
        },
      },
    },
  });
  const recorders = [];
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    mimeType = 'audio/webm';
    constructor(stream) {
      this.stream = stream;
      recorders.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['audio']) });
      this.onstop();
    }
  }
  globalThis.MediaRecorder = Recorder;
  globalThis.AudioContext = class {
    state = 'running';
    createAnalyser() {
      return { fftSize: 512, getByteTimeDomainData() {} };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  };
  const hook = loadTsx('src/features/chat/hooks/use-voice-input.ts', (name) => {
    const modules = {
      react,
      zod: { z },
      sonner: { toast: Object.assign(() => {}, { error() {} }) },
      '@/lib/errors': { AppError },
      '@/lib/capability-messages': capabilityMessages,
      '@/lib/observability-client': { captureException() {} },
      '../lib/voice-input-machine': { reduceVoiceInput },
      './use-machine-store': machine,
    };
    assert.ok(name in modules, name);
    return modules[name];
  });
  const voice = hook.useVoiceInput((text) => transcripts.push(text));
  const cleanup = effects.map((effect) => effect()).filter(Boolean);
  t.after(() => {
    for (const effect of cleanup) effect();
  });
  return {
    voice,
    recorders,
    mic,
    stream,
    transcripts,
    unmount: () => cleanup.forEach((effect) => effect()),
    requested: () => requested,
    stopped: () => stopped,
  };
}

test('a double tap opens one microphone, and cancel closes it', async (t) => {
  const host = setup(t);
  const first = host.voice.controls.start();
  await host.voice.controls.start();
  assert.equal(host.requested(), 1);
  host.mic.resolve(host.stream);
  await first;
  host.voice.controls.cancel();
  assert.ok(host.stopped() > 0);
});

test('leaving before permission arrives turns the late microphone off', async (t) => {
  const host = setup(t);
  const start = host.voice.controls.start();
  host.unmount();
  host.mic.resolve(host.stream);
  await start;
  assert.equal(host.stopped(), 1);
});

test('a transcript that arrives after leaving never writes into a draft', async (t) => {
  const host = setup(t);
  const response = deferred();
  globalThis.fetch = () => response.promise;
  host.mic.resolve(host.stream);
  await host.voice.controls.start();
  host.voice.controls.confirm();
  host.voice.controls.confirm();
  host.unmount();
  response.resolve(Response.json({ text: 'late transcript' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(host.transcripts, []);
});

test('a failed recording setup leaves no microphone running', async (t) => {
  const host = setup(t);
  globalThis.AudioContext = class {
    constructor() {
      throw new Error('Audio unavailable');
    }
  };
  host.mic.resolve(host.stream);
  await host.voice.controls.start();
  assert.equal(host.recorders[0].state, 'inactive');
  assert.ok(host.stopped() > 0);
  assert.deepEqual(host.transcripts, []);
});

test('speech captured before the recorder stops by itself is still transcribed', async (t) => {
  const host = setup(t);
  globalThis.fetch = async () => Response.json({ text: 'captured speech' });
  host.mic.resolve(host.stream);
  await host.voice.controls.start();
  host.recorders[0].stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(host.transcripts, ['captured speech']);
});
