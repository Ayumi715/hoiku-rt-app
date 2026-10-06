export const state = {};

export function resetFlow() {
  Object.assign(state, {
    ready: false, use: "", useNote: "",
    depth: 0, width: 0, height: 0, volume: 0, dc: 0,
    points: [], activeIdx: 0,
    results: {},
    facilityId: null
  });
}

export function resetAll() {
  resetFlow();
  Object.assign(state, { facility: "", pref: "", city: "" });
}

resetAll();