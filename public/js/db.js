import { db, auth, FieldValue, Timestamp } from "./firebase-init.js";
import { averageMeasurements } from "./acoustics.js";

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
  const facilityId = addFacilityToBatch(batch, state, user.uid);

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
    r2: r.r2,
    valid: r.valid,
    bands: r.bands,
    ir: Array.from(r.ir),
    sampleRate: r.sampleRate,
    trials: r.trials ? r.trials.map(({ rt60, edt }) => ({ rt60, edt })) : [],
    ownerUid: user.uid,
    createdAt: FieldValue.serverTimestamp()
  });

  await batch.commit();
  state.facilityId = facilityId;
}

export async function uploadConcaveMeasurements(state, name) {
  const user = await ensureUser();
  const roomResults = [state.results[0], state.results[1]];
  const average = averageMeasurements(roomResults);
  const resultSets = [
    { key: "average", label: "2部屋平均", result: average },
    { key: "room1", label: "部屋1", result: roomResults[0] },
    { key: "room2", label: "部屋2", result: roomResults[1] }
  ].map(({ key, label, result }) => ({
    key,
    label,
    ...measurementData(result),
    measuredAt: Timestamp.fromDate(result.measuredAt)
  }));
  const batch = db.batch();
  const facilityId = addFacilityToBatch(batch, state, user.uid);
  const mRef = db.collection("measurements").doc();
  batch.set(mRef, {
    measurementId: mRef.id,
    name,
    facilityId,
    measuredAt: Timestamp.fromDate(new Date(Math.max(...roomResults.map(result => result.measuredAt.getTime())))),
    pointIndex: 1,
    position: state.points,
    isConcaveBundle: true,
    rt60: average.rt60,
    edt: average.edt,
    r2: average.r2,
    valid: average.valid,
    bands: average.bands,
    resultSets,
    ownerUid: user.uid,
    createdAt: FieldValue.serverTimestamp()
  });

  await batch.commit();
  state.facilityId = facilityId;
}

function measurementData(result) {
  return {
    rt60: result.rt60,
    edt: result.edt,
    r2: result.r2,
    valid: result.valid,
    bands: result.bands,
    sampleRate: result.sampleRate,
    ir: Array.from(result.ir)
  };
}

function addFacilityToBatch(batch, state, uid) {
  if (state.facilityId) return state.facilityId;
  const fRef = db.collection("facilities").doc();
  batch.set(fRef, {
    facilityId: fRef.id,
    name: state.facility,
    prefecture: state.pref,
    city: state.city,
    address: `${state.pref}${state.city}`,
    volume: state.volume,
    directDistance: state.dc,
    room: {
      use: state.use, useNote: state.useNote,
      shape: state.roomShape,
      depth: state.depth, width: state.width, height: state.height,
      sections: state.sections.map(({ x, y, width, depth }) => ({ x, y, width, depth }))
    },
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp()
  });
  return fRef.id;
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

export async function deleteMeasurement(facilityId, measurementId) {
  const user = await ensureUser();
  const measurements = await db.collection("measurements")
    .where("facilityId", "==", facilityId)
    .where("ownerUid", "==", user.uid)
    .get();
  const remaining = measurements.docs.filter(doc => doc.id !== measurementId);
  const batch = db.batch();
  batch.delete(db.collection("measurements").doc(measurementId));
  if (!remaining.length) {
    batch.delete(db.collection("facilities").doc(facilityId));
  }
  await batch.commit();
}