// true の間は結果画面に「デモ用」と表示します。本物の処理に置き換えたら false に。
export const DEMO = true;

// ★ 実際の測定処理に差し替える場所
// 戻り値: { rt60: 秒, edt: 秒, bands: [{hz, rt60, edt}, ...] }
// ctrl.cancelled が true なら中止してください。
export function runMeasurement(ctrl) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (ctrl.cancelled) return reject(new Error("cancelled"));
      resolve({
        rt60: 0.62, edt: 0.58,
        bands: [
          { hz: 125,  rt60: 0.78, edt: 0.74 },
          { hz: 250,  rt60: 0.70, edt: 0.66 },
          { hz: 500,  rt60: 0.62, edt: 0.58 },
          { hz: 1000, rt60: 0.58, edt: 0.54 },
          { hz: 2000, rt60: 0.55, edt: 0.51 },
          { hz: 4000, rt60: 0.50, edt: 0.47 }
        ]
      });
    }, 3000);
  });
}