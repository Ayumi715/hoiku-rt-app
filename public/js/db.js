import { db, auth, FieldValue, Timestamp } from "./firebase-init.js";

let signInPromise = null;
export function ensureUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  signInPromise ||= new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      if (user) return resolve(user);
      auth.signInAnonymously()
        .then(c => resolve(c.user))
        .catch(e => { signInPromise = null; reject(e); });
    }, e => { unsub(); signInPromise = null; reject(e); });
  });
  return signInPromise;
}

// 1測定点ぶんを保存。施設は初回のみ作成し、同じ施設IDを使い回す
export async function uploadMeasurement(state, idx, name) {
  const user = await ensureUser();
  const r = state.results[idx];
  const batch = db.batch();

  let facilityId = state.facilityId;
  if (!facilityId) {
    const fRef = db.collection("facilities").doc();
    facilityId = fRef.id;
    batch.set(fRef, {
      facilityId,
      name: state.facility,
      prefecture: state.pref,
      city: state.city,
      address: `${state.pref}${state.city}`,
      volume: state.volume,
      directDistance: state.dc,
      room: {
        use: state.use, useNote: state.useNote,
        depth: state.depth, width: state.width, height: state.height
      },
      ownerUid: user.uid,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  const mRef = db.collection("measurements").doc();
  batch.set(mRef, {
    measurementId: mRef.id,
    name,
    facilityId,
    measuredAt: Timestamp.fromDate(r.measuredAt),
    pointIndex: idx + 1,
    position: state.points[idx],
    rt60: r.rt60,
    edt: r.edt,
    bands: r.bands,
    ownerUid: user.uid,
    createdAt: FieldValue.serverTimestamp()
  });

  await batch.commit();
  state.facilityId = facilityId;
}

// 同じ端末(匿名ユーザー)の保存結果を施設ごとにまとめて取得
export async function loadHistory() {
  const user = await ensureUser();
  const [fs, ms] = await Promise.all([
    db.collection("facilities").where("ownerUid", "==", user.uid).get(),
    db.collection("measurements").where("ownerUid", "==", user.uid).get()
  ]);
  const byFacility = {};
  ms.docs.forEach(d => { const m = d.data(); (byFacility[m.facilityId] ||= []).push(m); });
  const ts = f => (f.createdAt && f.createdAt.toMillis ? f.createdAt.toMillis() : 0);
  return fs.docs
    .map(d => ({ ...d.data(), measurements: (byFacility[d.id] || []).sort((a, b) => a.pointIndex - b.pointIndex) }))
    .sort((a, b) => ts(b) - ts(a));
}