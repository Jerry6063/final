/***** Firebase init (your config) *****/
const firebaseConfig = {
  apiKey: "AIzaSyDSgiWXAFq552j5TQpY52X_rH0yFkYRYxk",
  authDomain: "blindness-1ef2c.firebaseapp.com",
  projectId: "blindness-1ef2c",
  storageBucket: "blindness-1ef2c.firebasestorage.app",
  messagingSenderId: "288595185055",
  appId: "1:288595185055:web:853644611a9f3a4fba81aa"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
firebase.firestore().enablePersistence().catch(()=>{}); // offline cache best-effort

/***** Anonymous auth *****/
let currentUser = null;
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(u => { currentUser = u; });

/***** Map *****/
const NYC_CENTER = [40.7128, -74.0060];
const map = L.map("map", { zoomControl: true }).setView(NYC_CENTER, 11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);

/***** APS official points (read-only) *****/
const APS_ENDPOINT = "https://data.cityofnewyork.us/resource/de3m-c5p4.geojson?$limit=20000";
let apsLayer = null;
(async function loadAPS(){
  try{
    const res = await fetch(APS_ENDPOINT);
    if(!res.ok) throw new Error(res.statusText);
    const geo = await res.json();
    if (apsLayer) apsLayer.remove();
    apsLayer = L.geoJSON(geo, {
      pointToLayer: (_, latlng)=> L.circleMarker(latlng, {
        radius:6, fillColor:"#60a5fa", color:"#0b0c0f", weight:1, fillOpacity:.9
      }),
      onEachFeature: (f, layer)=>{
        const p = f.properties || {};
        const title = p.location || p.intersection || p.cross_streets || p.street || "Accessible Pedestrian Signal";
        const sub = [p.borough || p.boro, p.zipcode].filter(Boolean).join(" · ");
        const html = `
          <div style="font:13px/1.35 ui-sans-serif,system-ui">
            <div style="font-weight:700;margin-bottom:2px">${title}</div>
            ${sub ? `<div style="color:#9aa4b2;margin-bottom:6px">${sub}</div>` : ""}
          </div>`;
        layer.bindPopup(html);
      }
    }).addTo(map);
  }catch(err){
    console.error("APS load failed:", err);
  }
})();

/***** Community reviews (Firestore ⇄ map) *****/
const reviewsLayer = L.layerGroup().addTo(map);
const reviewMarkers = new Map(); // docId -> marker
const countEl = document.getElementById("countReviews");

function iconByRating(r){
  const color = r === 'down' ? '#ef4444' : '#22c55e';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <circle cx="12" cy="12" r="9" fill="${color}" stroke="#0b0c0f" stroke-width="1.2"/></svg>`;
  return L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
    iconSize: [24,24], iconAnchor: [12,12], popupAnchor: [0,-10]
  });
}

// delete helper (author only)
async function deleteReview(id){
  if (!confirm('Delete this review?')) return;
  try {
    await db.collection('reviews').doc(id).delete();
    const m = reviewMarkers.get(id);
    if (m) { reviewsLayer.removeLayer(m); reviewMarkers.delete(id); }
    if (countEl) countEl.textContent = String(reviewMarkers.size);
  } catch (e) {
    console.error(e);
    alert('Delete failed. Please try again.');
  }
}

function renderReview(id, data){
  const canDelete = currentUser && data.userId === currentUser.uid;
  const latlng = L.latLng(data.lat, data.lng);

  const html = `
    <div style="font:13px/1.35 ui-sans-serif,system-ui">
      <div style="font-weight:700">${data.facilityType || 'Facility'}</div>
      ${data.address ? `<div class="muted" style="margin:4px 0">${data.address}</div>` : ""}
      <div style="margin:4px 0">Rating: ${data.rating === 'down' ? '👎 Hard to use' : '👍 Works well'}</div>
      ${Array.isArray(data.tags) && data.tags.length ? `<div>Tags: ${data.tags.join(' · ')}</div>` : ""}
      ${data.comment ? `<div style="margin-top:6px">${data.comment}</div>` : ""}
      <div class="muted small" style="margin-top:8px">${new Date(data.createdAt?.toMillis?.() || Date.now()).toLocaleString()}</div>
      ${canDelete ? `<div style="margin-top:8px"><button id="del-${id}" style="border:1px solid #444;background:#1b1f2a;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer">Delete</button></div>` : ""}
    </div>`;

  let m = reviewMarkers.get(id);
  if (m) {
    m.setLatLng(latlng).setIcon(iconByRating(data.rating)).setPopupContent(html);
  } else {
    m = L.marker(latlng, { icon: iconByRating(data.rating) }).bindPopup(html).addTo(reviewsLayer);
    reviewMarkers.set(id, m);
  }

  // bind delete on popup open (ensures button exists in DOM)
  m.off('popupopen');
  m.on('popupopen', () => {
    const btn = document.getElementById(`del-${id}`);
    if (btn) btn.onclick = () => deleteReview(id);
  });

  if (countEl) countEl.textContent = String(reviewMarkers.size);
}

// live subscription
db.collection('reviews').orderBy('createdAt','desc').limit(5000)
  .onSnapshot(snap=>{
    snap.docChanges().forEach(ch=>{
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        const m = reviewMarkers.get(id);
        if (m) { reviewsLayer.removeLayer(m); reviewMarkers.delete(id); }
      } else {
        renderReview(id, ch.doc.data());
      }
    });
    if (countEl) countEl.textContent = String(reviewMarkers.size);
  });

/***** Sidebar form (create review) *****/
const collapseBtn = document.getElementById("collapseBtn");
if (collapseBtn) {
  collapseBtn.addEventListener("click", ()=>{
    document.body.classList.toggle("collapsed");
    collapseBtn.classList.toggle("collapsed");
    setTimeout(()=>map.invalidateSize(), 200);
  });
}

const chosenLatLngEl = document.getElementById('chosenLatLng');
const useMapClickBtn = document.getElementById('useMapClick');
const useCenterBtn = document.getElementById('useCenter');
const submitBtn = document.getElementById('submitReview');
const toastEl = document.getElementById('toast');

let pendingLatLng = null;
let captureNextClick = false;
const showToast = (msg)=>{ if (toastEl){ toastEl.textContent = msg; toastEl.style.opacity = 1; setTimeout(()=>toastEl.style.opacity=0, 1200);} };

if (useMapClickBtn) {
  useMapClickBtn.addEventListener('click', ()=>{
    captureNextClick = true;
    if (chosenLatLngEl) chosenLatLngEl.textContent = 'Click a location on the map…';
  });
}
map.on('click', e=>{
  if (!captureNextClick) return;
  captureNextClick = false;
  pendingLatLng = e.latlng;
  if (chosenLatLngEl) chosenLatLngEl.textContent = `Chosen: ${pendingLatLng.lat.toFixed(5)}, ${pendingLatLng.lng.toFixed(5)}`;
});
if (useCenterBtn) {
  useCenterBtn.addEventListener('click', ()=>{
    const c = map.getCenter();
    pendingLatLng = c;
    if (chosenLatLngEl) chosenLatLngEl.textContent = `Chosen: ${pendingLatLng.lat.toFixed(5)}, ${pendingLatLng.lng.toFixed(5)}`;
  });
}

if (submitBtn) {
  submitBtn.addEventListener('click', async ()=>{
    if (!pendingLatLng) { alert('Please choose a map location first.'); return; }

    const address = document.getElementById('address').value.trim();
    const facilityType = document.getElementById('facilityType').value;
    const rating = [...document.querySelectorAll('input[name="rating"]')].find(i=>i.checked).value;
    const tags = [...document.querySelectorAll('#tagChips input[type="checkbox"]')].filter(i=>i.checked).map(i=>i.value);
    const comment = document.getElementById('comment').value.trim();

    const doc = {
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
      address,
      facilityType,
      rating,
      tags,
      comment,
      userId: currentUser?.uid || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try{
      await db.collection('reviews').add(doc);
      // reset form
      document.getElementById('address').value = '';
      document.getElementById('facilityType').selectedIndex = 0;
      document.querySelector('input[name="rating"][value="up"]').checked = true;
      document.querySelectorAll('#tagChips input[type="checkbox"]').forEach(i=>i.checked=false);
      document.getElementById('comment').value = '';
      pendingLatLng = null;
      if (chosenLatLngEl) chosenLatLngEl.textContent = '';
      showToast('Review submitted');
    }catch(err){
      console.error(err);
      alert('Submit failed. Please try again.');
    }
  });
}
