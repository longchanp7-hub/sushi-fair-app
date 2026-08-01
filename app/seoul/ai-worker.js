let extractor = null;
let prototypes = [];
let intentIds = [];

self.onmessage = async event => {
  const data = event.data || {};
  if (data.type === 'init') {
    try {
      self.postMessage({ type: 'progress', percent: 5, message: '読み取り機能を準備しています' });
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1');
      extractor = await pipeline(
        'feature-extraction',
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        {
          progress_callback: progress => {
            if (progress?.status === 'progress') {
              const raw = Number(progress.progress || 0);
              const percent = raw <= 1 ? raw * 82 + 6 : raw * 0.82 + 6;
              self.postMessage({
                type: 'progress',
                percent: Math.min(88, Math.max(6, Math.round(percent))),
                message: 'ことばの読み取りを準備しています',
              });
            }
          },
        },
      );

      intentIds = data.intents.map(intent => intent.id);
      const texts = data.intents.map(intent => intent.examples.join('。'));
      self.postMessage({ type: 'progress', percent: 91, message: '旅行用の困りごとを覚えています' });
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      prototypes = output.tolist();
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || '準備に失敗しました' });
    }
  }

  if (data.type === 'classify') {
    try {
      if (!extractor || !prototypes.length) throw new Error('not ready');
      const output = await extractor(data.text, { pooling: 'mean', normalize: true });
      const vector = output.tolist()[0];
      let bestIndex = 0;
      let bestScore = -Infinity;
      prototypes.forEach((prototype, index) => {
        const score = dot(vector, prototype);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      self.postMessage({
        type: 'result',
        requestId: data.requestId,
        intentId: intentIds[bestIndex],
        score: Math.max(0, Math.min(1, bestScore)),
      });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || '判定に失敗しました' });
    }
  }
};

function dot(a, b) {
  let total = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) total += a[i] * b[i];
  return total;
}
