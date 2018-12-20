import clz from 'clz-buffer';
import cryptonight from 'url-loader?name=[name].[ext]!./cryptonight.js';

importScripts(cryptonight); // imports the cryptonight.js "glue" script generated by emscripten

// webassembly cryptonight is called here.
const cn = Module.cwrap('cryptonight', '', [
  /*'number', 'number', 'number', 'number', 'number'*/
]);

const hex2uint8 = (buffer, s) => {
  let result = new Uint8Array(
    buffer,
    Module._malloc(s.length / 2),
    s.length / 2
  );
  for (let i = 0; i < s.length / 2; i++) {
    result[i] = parseInt(s.substr(2 * i, 2), 16);
  }
  return result;
};

const getCryptoNightBigEndian = (input, output) => {
  cn(
    output.byteOffset,
    input.byteOffset,
    input.byteLength,
    /* lite */ 0,
    /* variant */ 2
  );

  // reverse from little-endian to big-endian
  output.reverse();
};

const throttled = (delay, fn) => {
  let lastCall = 0;
  return function(...args) {
    const now = new Date().getTime();
    if (now - lastCall < delay) {
      return;
    }
    lastCall = now;
    return fn(...args);
  };
};

onmessage = function(e) {
  const { hash, targetDifficulty } = e.data;
  let currentWorkNonce = 0;

  const mainThreadUpdate = throttled(500, () => {
    // emit the final workNonce calculated for transaction
    postMessage({
      cmd: 'current',
      workNonce: currentWorkNonce,
    });
  });

  // calculate a cryptonight hash
  function calculatePowNonce() {
    let bits = Math.log2(targetDifficulty);
    bits = Math.ceil(bits);
    const target = bits;

    const heap = Module.HEAPU8.buffer;
    const input = new Uint8Array(heap, Module._malloc(64), 64);

    const rlpIntArray = hex2uint8(heap, hash);
    const rlpHash = new Uint8Array(heap, Module._malloc(32), 32);
    getCryptoNightBigEndian(rlpIntArray, rlpHash);

    input.set(rlpHash, 0);

    const inputDataView = new DataView(
      heap,
      input.byteOffset,
      input.byteLength
    );

    const outputMalloc = Module._malloc(32);
    let bestBit = 0;
    do {
      // set in big-endian
      inputDataView.setUint32(60, currentWorkNonce);

      const outputHash = new Uint8Array(heap, outputMalloc, 32);
      getCryptoNightBigEndian(input, outputHash);

      const firstBit = clz(outputHash);

      if (firstBit > bestBit) {
        bestBit = firstBit;

        if (bestBit >= target) {
          break;
        }
      }

      currentWorkNonce++;

      mainThreadUpdate();
    } while (bestBit <= target);
  }

  calculatePowNonce();

  // emit the final workNonce calculated for transaction
  postMessage({
    cmd: 'finished',
    workNonce: currentWorkNonce,
  });
};

Module.onRuntimeInitialized = () => {
  // emit to main thread that worker has finished loading
  postMessage({
    cmd: 'ready',
  });
};
